import {
  hasRun, readBounce, writeBounce, appendRun, readSidecar, cleanupRun,
  type RunRecord,
} from "./ledger.js";

export const MAX_BOUNCES = 3;
export const STOP_REASON =
  "You have not recorded a verdict. Call looopy_report({status, reasoning, " +
  "confidence, action_summary}) now with your final result, then stop.";

export type StopGateState = { reported: boolean; bounce: number; maxBounces: number };
export type StopGateDecision =
  | { action: "allow"; writeBackstop: boolean }
  | { action: "block"; reason: string; nextBounce: number };

export function decideStop(s: StopGateState): StopGateDecision {
  if (s.reported) return { action: "allow", writeBackstop: false };
  if (s.bounce >= s.maxBounces) return { action: "allow", writeBackstop: true };
  return { action: "block", reason: STOP_REASON, nextBounce: s.bounce + 1 };
}

function argValue(argv: string[], flag: string): string | undefined {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : undefined;
}

export function runStopGate(
  argv: string[],
  stdinText: string,
  nowISO: string,
): { stdout: string } {
  const runId = argValue(argv, "--run-id");
  if (!runId) throw new Error("stop-gate requires --run-id");

  let payload: { cwd?: string; session_id?: string } = {};
  try {
    payload = JSON.parse(stdinText || "{}");
  } catch {
    payload = {};
  }
  // Prefer the explicit --workflow-dir arg injected at dispatch time; this ensures
  // the stop-gate always operates on the correct .looopy/ dir even if the agent
  // changed cwd mid-run. The cwd/process.cwd() fallbacks are defensive only.
  const workflowDir = argValue(argv, "--workflow-dir") ?? payload.cwd ?? process.cwd();

  const decision = decideStop({
    reported: hasRun(workflowDir, runId),
    bounce: readBounce(workflowDir, runId),
    maxBounces: MAX_BOUNCES,
  });

  if (decision.action === "block") {
    writeBounce(workflowDir, runId, decision.nextBounce);
    return { stdout: JSON.stringify({ decision: "block", reason: decision.reason }) };
  }

  // allow
  if (decision.writeBackstop) {
    const sc = readSidecar(workflowDir, runId);
    const record: RunRecord = {
      ts: nowISO,
      runId,
      sessionId: payload.session_id ?? sc?.sessionId ?? null,
      params: sc?.params ?? {},
      version: sc?.version,
      status: "failure",
      reasoning: "no valid report after 3 attempts",
      confidence: 1,
      action_summary: "hook backstop: agent ended without calling looopy_report",
      reportedBy: "hook-backstop",
    };
    appendRun(workflowDir, record);
  }
  cleanupRun(workflowDir, runId);
  return { stdout: "" };
}
