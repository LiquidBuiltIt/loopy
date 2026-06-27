import path from "node:path";
import { discoverWorkflows } from "./discovery.js";
import { readRuns, readSidecar } from "./ledger.js";

export type PollResult =
  | { state: "success" | "failure"; workflow: string; summary: string }
  | { state: "running" }
  | { state: "not-found" };

// Locate which workflow a runId belongs to: a live sidecar (in-flight) or a
// recorded verdict in runs.jsonl (terminal). Returns the workflow relative path.
export function findRunWorkflow(root: string, runId: string): string | null {
  for (const w of discoverWorkflows(root)) {
    const dir = path.join(root, w);
    if (readSidecar(dir, runId)) return w;
    if (readRuns(dir).some((r) => r.runId === runId)) return w;
  }
  return null;
}

// A single read: has this run reached a verdict yet? A terminal record wins over
// a lingering sidecar (the two briefly coexist during cleanup).
export function pollOnce(root: string, runId: string): PollResult {
  const workflow = findRunWorkflow(root, runId);
  if (!workflow) return { state: "not-found" };
  const dir = path.join(root, workflow);
  const recs = readRuns(dir).filter((r) => r.runId === runId);
  const last = recs[recs.length - 1];
  if (last) return { state: last.status, workflow, summary: last.action_summary };
  return { state: "running" };
}

export type Sleeper = (ms: number) => Promise<void>;

export type PollOutcome = { code: number; line: string };

// Block until the run reaches a verdict. Exit code carries the outcome so the
// command composes in `&&` chains and as an agent's completion hook:
//   0 success · 1 failure · 2 timeout · 3 unknown run
export async function pollRuns(
  root: string,
  runId: string,
  opts: { intervalMs: number; timeoutMs?: number; sleep: Sleeper; now: () => number },
): Promise<PollOutcome> {
  const start = opts.now();
  for (;;) {
    const r = pollOnce(root, runId);
    if (r.state === "not-found") return { code: 3, line: `unknown run: ${runId}` };
    if (r.state === "success") return { code: 0, line: `success\t${r.workflow}\t${r.summary}` };
    if (r.state === "failure") return { code: 1, line: `failure\t${r.workflow}\t${r.summary}` };
    if (opts.timeoutMs !== undefined && opts.now() - start >= opts.timeoutMs) {
      return { code: 2, line: `timeout waiting for ${runId}` };
    }
    await opts.sleep(opts.intervalMs);
  }
}
