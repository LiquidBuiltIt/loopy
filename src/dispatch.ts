import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { WorkflowConfig, ParamSpec } from "./config.js";
import { buildChildEnv } from "./env.js";
import { writeSidecar } from "./ledger.js";

export type Runner = (
  cmd: string,
  args: string[],
  opts: { cwd: string; env: NodeJS.ProcessEnv },
) => { status: number | null; stdout: string; stderr: string; error?: Error };

export class DispatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DispatchError";
  }
}

const defaultRunner: Runner = (cmd, args, opts) => {
  const r = spawnSync(cmd, args, {
    cwd: opts.cwd,
    env: opts.env,
    encoding: "utf8",
  });
  return {
    status: r.status,
    stdout: r.stdout ?? "",
    stderr: r.stderr ?? "",
    error: r.error ?? undefined,
  };
};

export function checkRequiredParams(
  params: ParamSpec[],
  provided: Record<string, string>,
): string[] {
  return params
    .filter((p) => p.required && !(p.name in provided))
    .map((p) => p.name)
    .sort();
}

export function buildMcpConfig(runId: string, workflowDir: string): string {
  return JSON.stringify({
    mcpServers: {
      looopy: {
        type: "stdio",
        command: "looopy",
        args: ["mcp-serve"],
        env: { OPERATOR_RUN_ID: runId, OPERATOR_WORKFLOW_DIR: workflowDir },
      },
    },
  });
}

export function buildStopHookSettings(runId: string, workflowDir: string): string {
  return JSON.stringify({
    hooks: {
      Stop: [
        {
          matcher: "",
          hooks: [{ type: "command", command: `looopy stop-gate --run-id ${runId} --workflow-dir '${workflowDir}'` }],
        },
      ],
    },
  });
}

export function composePrompt(
  skill: string,
  params: Record<string, string>,
  note?: string,
  specs?: ParamSpec[],
): string {
  const specByName = new Map((specs ?? []).map((s) => [s.name, s]));
  const rendered = Object.entries(params)
    .map(([k, v]) => {
      const desc = specByName.get(k)?.description;
      return desc ? `${k}=${v} (${desc})` : `${k}=${v}`;
    })
    .join(", ");
  let prompt = `Invoke the ${skill} skill.\nParams: ${rendered}.`;
  if (note && note.trim()) prompt += `\nAdditional context: ${note}.`;
  prompt +=
    `\n\nWhen the workflow is complete you MUST call the looopy_report tool ` +
    `exactly once as your final action, with your verdict: ` +
    `status ("success" or "failure"), reasoning, confidence (0-1), and action_summary. ` +
    `Do not end your turn until you have called it.`;
  return prompt;
}

export function parseSessionId(stdout: string): string {
  const m = stdout.match(/·\s*(\S+)/);          // "backgrounded · <id>"
  if (m) return m[1];
  const firstLine = stdout.split("\n").map((s) => s.trim()).filter(Boolean)[0] ?? "";
  return firstLine.split(/\s+/).pop() ?? stdout.trim();
}

export function dispatch(opts: {
  workflowDir: string;
  config: WorkflowConfig;
  params: Record<string, string>;
  note?: string;
  env?: NodeJS.ProcessEnv;
  run?: Runner;
  genRunId?: () => string;
  now?: () => string;
}): string {
  const { workflowDir, config, params, note } = opts;
  const env = opts.env ?? process.env;
  const run = opts.run ?? defaultRunner;
  const genRunId = opts.genRunId ?? (() => randomUUID().replace(/-/g, "").slice(0, 8));
  const now = opts.now ?? (() => new Date().toISOString());

  const missing = checkRequiredParams(config.params, params);
  if (missing.length > 0) {
    throw new DispatchError(
      `missing required param: ${missing.join(", ")}`,
    );
  }

  const runId = genRunId();

  // The prompt is the initial user turn, passed as a positional argument so the
  // background session begins working immediately. `--append-system-prompt`
  // only augments the system prompt and never starts a turn, so a session
  // seeded that way comes up idle.
  const prompt = composePrompt(config.skill, params, note, config.params);
  const args = [
    "--bg",
    "--permission-mode",
    "auto",
    "--mcp-config",
    buildMcpConfig(runId, workflowDir),
    "--settings",
    buildStopHookSettings(runId, workflowDir),
    prompt,
  ];

  const result = run("claude", args, {
    cwd: workflowDir,
    env: buildChildEnv(env),
  });

  if (result.error || result.status === 127) {
    throw new DispatchError(
      "could not run `claude` — is Claude Code installed and on PATH?",
    );
  }
  if (result.status !== 0) {
    throw new DispatchError(
      `claude exited with status ${result.status}: ${result.stderr.trim()}`,
    );
  }
  const sessionId = parseSessionId(result.stdout);
  writeSidecar(workflowDir, runId, { sessionId, params, ts: now(), version: config.version });
  return sessionId;
}
