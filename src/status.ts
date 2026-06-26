import path from "node:path";
import { discoverWorkflows } from "./discovery.js";
import { readRuns, listSidecars } from "./ledger.js";

export type StatusRunner = (
  cmd: string,
  args: string[],
) => { status: number | null; stdout: string; stderr: string; error?: Error };

// Shape of each entry from `claude agents --json` (only the fields we surface).
// Background sessions (--bg dispatches) report under `state`; interactive sessions use `status`.
type Agent = { sessionId: string; status?: string; state?: string; cwd: string };

export type OperatorOutcome = "success" | "failure" | "running";

export type OperatorSession = {
  workflow: string;
  outcome: OperatorOutcome;
};

// looopy records the short 8-char id from the `backgrounded · <id>` banner,
// while `claude agents --json` reports the full session UUID. Normalize both to
// the segment before the first `-` so the two sides join.
function shortId(id: string): string {
  return id.split("-")[0];
}

/**
 * Gather the looopy-session map from disk: all sessionIds looopy has spawned,
 * keyed to their workflow relative path and best-known outcome.
 */
export function gatherOperatorSessions(root: string): Map<string, OperatorSession> {
  const map = new Map<string, OperatorSession>();
  const workflows = discoverWorkflows(root);

  for (const workflow of workflows) {
    const dir = path.join(root, workflow);

    // Sidecar-only (in-flight): outcome = "running" unless overridden by runs.jsonl
    for (const { sessionId } of listSidecars(dir)) {
      if (sessionId && !map.has(shortId(sessionId))) {
        map.set(shortId(sessionId), { workflow, outcome: "running" });
      }
    }

    // runs.jsonl: latest record by ts wins; overrides sidecar entry
    const runs = readRuns(dir);
    // Group by sessionId, find latest ts per sessionId
    const bySession = new Map<string, { ts: string; outcome: OperatorOutcome }>();
    for (const r of runs) {
      if (!r.sessionId) continue;
      const existing = bySession.get(r.sessionId);
      if (!existing || r.ts > existing.ts) {
        bySession.set(r.sessionId, { ts: r.ts, outcome: r.status as OperatorOutcome });
      }
    }
    for (const [sessionId, { outcome }] of bySession) {
      map.set(shortId(sessionId), { workflow, outcome });
    }
  }

  return map;
}

/**
 * Pure join/format function: takes live claude agents + looopy session map + optional filter.
 * Returns the tab-separated table string.
 */
export function formatStatus(
  agents: Agent[],
  looopySessions: Map<string, OperatorSession>,
  pathArg?: string,
): string {
  const header = "WORKFLOW\tID\tSTATE\tOUTCOME";

  const rows: string[] = [];
  for (const agent of agents) {
    const id = shortId(agent.sessionId);
    const session = looopySessions.get(id);
    if (!session) continue; // not looopy-spawned

    if (pathArg && session.workflow !== pathArg) continue;

    const state = agent.state ?? agent.status ?? "unknown";
    rows.push(`${session.workflow}\t${id}\t${state}\t${session.outcome}`);
  }

  return [header, ...rows].join("\n");
}

export function statusRuns(
  pathArg: string | undefined,
  run: StatusRunner,
  root: string,
): string {
  const result = run("claude", ["agents", "--json"]);
  if (result.error || result.status === 127) {
    throw new Error("could not run `claude` — is Claude Code installed and on PATH?");
  }
  if (result.status !== 0) {
    throw new Error(`claude agents failed: ${result.stderr.trim()}`);
  }

  let agents: Agent[];
  try {
    agents = JSON.parse(result.stdout || "[]");
  } catch {
    agents = [];
  }

  const looopySessions = gatherOperatorSessions(root);
  return formatStatus(agents, looopySessions, pathArg);
}

export function logsCmd(id: string): string[] {
  return ["logs", id];
}

export function stopCmd(id: string): string[] {
  return ["stop", id];
}
