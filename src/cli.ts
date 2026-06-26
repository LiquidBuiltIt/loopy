#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { realpathSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { Command } from "commander";
import { resolveRoot } from "./paths.js";
import { discoverWorkflows, isWorkflow } from "./discovery.js";
import { loadConfig } from "./config.js";
import { dispatch } from "./dispatch.js";
import { statusRuns, logsCmd, stopCmd, type StatusRunner } from "./status.js";
import { initHome, newWorkflow } from "./scaffold.js";
import { readRuns, formatRuns } from "./ledger.js";
import { validateWorkflow } from "./validate.js";
import { onboard } from "./onboard.js";

export function reportOne(root: string, workflow: string, limit: number): string {
  const dir = path.join(root, workflow);
  const runs = readRuns(dir, limit);
  if (runs.length === 0) return `${workflow}: no runs recorded yet.`;
  return `${workflow}\n${formatRuns(runs)}`;
}

export function reportAll(root: string): string {
  const workflows = discoverWorkflows(root);
  if (workflows.length === 0) return `No workflows under ${root}.`;
  const header = "WORKFLOW\tSTATUS\tCONF\tWHEN\tSUMMARY";
  const rows = workflows.map((w) => {
    const last = readRuns(path.join(root, w), 1)[0];
    if (!last) return `${w}\t-\t-\t-\t(no runs)`;
    return `${w}\t${last.status}\t${last.confidence.toFixed(2)}\t${last.ts}\t${last.action_summary}`;
  });
  return [header, ...rows].join("\n");
}

export function isClaudeMissingMessage(message: string): boolean {
  return /on PATH/.test(message);
}

export function parseRunArgs(tokens: string[]): {
  params: Record<string, string>;
  note?: string;
} {
  const params: Record<string, string> = {};
  let note: string | undefined;
  for (const tok of tokens) {
    if (tok.startsWith("--")) {
      const eq = tok.indexOf("=");
      if (eq === -1) {
        throw new Error(`bad flag (expected --key=value): ${tok}`);
      }
      params[tok.slice(2, eq)] = tok.slice(eq + 1);
    } else if (note === undefined) {
      note = tok;
    }
  }
  return { params, note };
}

function fail(message: string, code = 1): never {
  process.stderr.write(`looopy: ${message}\n`);
  process.exit(code);
}

const statusRunner: StatusRunner = (cmd, args) => {
  const r = spawnSync(cmd, args, { encoding: "utf8" });
  return {
    status: r.status,
    stdout: r.stdout ?? "",
    stderr: r.stderr ?? "",
    error: r.error ?? undefined,
  };
};

// Read the package version at runtime (package.json sits one level above the
// compiled dist/cli.js, and above src/cli.ts in dev — both resolve correctly).
function readVersion(): string {
  try {
    const pkg = readFileSync(new URL("../package.json", import.meta.url), "utf8");
    return JSON.parse(pkg).version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

export function buildProgram(): Command {
  const program = new Command();
  program
    .name("looopy")
    .description("Dispatch workflows as fire-and-forget background Claude runs")
    .version(readVersion())
    .enablePositionalOptions();

  program
    .command("init")
    .description("Scaffold the workflow-library home")
    .action(() => {
      const root = resolveRoot();
      const { created } = initHome(root);
      if (created.length === 0) {
        process.stdout.write(`Already initialized: ${root}\n`);
      } else {
        process.stdout.write(`Initialized ${root}\n`);
        for (const f of created) process.stdout.write(`  created ${f}\n`);
      }
    });

  program
    .command("new <name>")
    .description("Scaffold a new workflow inside the home")
    .action((name: string) => {
      const root = resolveRoot();
      try {
        const dir = newWorkflow(root, name);
        process.stdout.write(`Created workflow at ${dir}\n`);
      } catch (e) {
        fail((e as Error).message);
      }
    });

  program
    .command("ls")
    .description("List discovered workflows")
    .action(() => {
      const root = resolveRoot();
      const workflows = discoverWorkflows(root);
      if (workflows.length === 0) {
        process.stdout.write(
          `No workflows under ${root}. Create one with: looopy new <name>\n`,
        );
        return;
      }
      for (const w of workflows) process.stdout.write(`${w}\n`);
    });

  program
    .command("run <pathArg> [extras...]")
    .description("Dispatch a workflow in the background")
    .passThroughOptions()
    .action((pathArg: string, extras: string[]) => {
      const root = resolveRoot();
      const dir = path.join(root, pathArg);
      if (!isWorkflow(dir)) {
        const near = discoverWorkflows(root).filter((w) => w.includes(pathArg));
        const hint = near.length ? ` Did you mean: ${near.join(", ")}?` : "";
        fail(`unknown workflow: ${pathArg}.${hint}`);
      }
      let parsed;
      try {
        parsed = parseRunArgs(extras);
      } catch (e) {
        fail((e as Error).message);
      }
      try {
        const config = loadConfig(dir);
        const id = dispatch({
          workflowDir: dir,
          config,
          params: parsed.params,
          note: parsed.note,
        });
        process.stdout.write(`${id}\n`);
      } catch (e) {
        const code = isClaudeMissingMessage((e as Error).message) ? 127 : 1;
        fail((e as Error).message, code);
      }
    });

  program
    .command("status [pathArg]")
    .alias("ps")
    .description("List live looopy-spawned runs")
    .action((pathArg: string | undefined) => {
      const root = resolveRoot();
      try {
        process.stdout.write(statusRuns(pathArg, statusRunner, root) + "\n");
      } catch (e) {
        const msg = (e as Error).message;
        fail(msg, isClaudeMissingMessage(msg) ? 127 : 1);
      }
    });

  program
    .command("logs <id>")
    .description("Print recent output of a run")
    .action((id: string) => {
      const r = spawnSync("claude", logsCmd(id), { stdio: "inherit" });
      if (r.error) {
        fail("could not run `claude` — is Claude Code installed and on PATH?", 127);
      }
      process.exit(r.status ?? 0);
    });

  program
    .command("stop <id>")
    .description("Stop a run")
    .action((id: string) => {
      const r = spawnSync("claude", stopCmd(id), { stdio: "inherit" });
      if (r.error) {
        fail("could not run `claude` — is Claude Code installed and on PATH?", 127);
      }
      process.exit(r.status ?? 0);
    });

  program
    .command("report [workflow]")
    .description("Review recorded run outcomes")
    .option("-n, --limit <n>", "max runs to show for a single workflow", "10")
    .action((workflow: string | undefined, opts: { limit: string }) => {
      const root = resolveRoot();
      if (workflow) {
        process.stdout.write(reportOne(root, workflow, parseInt(opts.limit, 10) || 10) + "\n");
      } else {
        process.stdout.write(reportAll(root) + "\n");
      }
    });

  program
    .command("mcp-serve", { hidden: true })
    .description("Run the looopy_report MCP server (stdio; used internally at dispatch)")
    .action(async () => {
      const { serveMcp } = await import("./mcp.js");
      await serveMcp();
    });

  program
    .command("stop-gate", { hidden: true })
    .description("Stop-hook gate enforcing looopy_report (used internally at dispatch)")
    .option("--run-id <id>", "run correlation id")
    .allowUnknownOption()
    .action(async () => {
      let stdinText = "";
      try {
        stdinText = readFileSync(0, "utf8");
      } catch {
        stdinText = "";
      }
      const { runStopGate } = await import("./stopgate.js");
      const { stdout } = runStopGate(process.argv.slice(2), stdinText, new Date().toISOString());
      if (stdout) process.stdout.write(stdout + "\n");
      process.exit(0);
    });

  program
    .command("validate <pathArg>")
    .description("Validate a workflow's config and skill wiring")
    .action((pathArg: string) => {
      const root = resolveRoot();
      const dir = path.isAbsolute(pathArg) ? pathArg : path.join(root, pathArg);
      const result = validateWorkflow(dir);
      for (const check of result.checks) {
        const icon = check.pass ? "✓" : "✗";
        const detail = check.detail ? ` — ${check.detail}` : "";
        process.stdout.write(`${icon} ${check.label}${detail}\n`);
      }
      if (!result.ok) {
        const failures = result.checks.filter((c) => !c.pass).map((c) => c.label);
        process.stderr.write(`\nFailed: ${failures.join(", ")}\n`);
        process.exit(1);
      }
    });

  program
    .command("onboard <pathArg>")
    .description("Scaffold and emit handoff for an existing workflow dir")
    .action((pathArg: string) => {
      const root = resolveRoot();
      // Resolve exactly as `run` does: join root + pathArg
      const dir = path.isAbsolute(pathArg) ? pathArg : path.join(root, pathArg);
      try {
        const handoff = onboard(dir);
        process.stdout.write(handoff + "\n");
      } catch (e) {
        fail((e as Error).message);
      }
    });

  return program;
}

// Resolve argv[1] through any symlink (e.g. an npm-link/global bin shim points
// at this file) before comparing, so the program runs whether invoked directly
// (`node dist/cli.js`) or via the installed `looopy` symlink.
function invokedDirectly(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(entry)).href;
  } catch {
    return false;
  }
}
if (invokedDirectly()) {
  buildProgram().parseAsync(process.argv);
}
