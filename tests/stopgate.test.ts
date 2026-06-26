import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { decideStop, runStopGate, MAX_BOUNCES } from "../src/stopgate.js";
import { appendRun, writeSidecar, writeBounce, readBounce, readRuns, readSidecar } from "../src/ledger.js";

describe("decideStop (pure)", () => {
  it("allows without backstop when already reported", () => {
    expect(decideStop({ reported: true, bounce: 0, maxBounces: 3 }))
      .toEqual({ action: "allow", writeBackstop: false });
  });
  it("blocks and increments when not reported and under the cap", () => {
    expect(decideStop({ reported: false, bounce: 0, maxBounces: 3 }))
      .toMatchObject({ action: "block", nextBounce: 1 });
  });
  it("allows with backstop once the cap is hit", () => {
    expect(decideStop({ reported: false, bounce: 3, maxBounces: 3 }))
      .toEqual({ action: "allow", writeBackstop: true });
  });
});

describe("runStopGate (IO)", () => {
  let wf: string;
  beforeEach(() => { wf = fs.mkdtempSync(path.join(os.tmpdir(), "op-gate-")); });

  const stdin = (over: object = {}) =>
    JSON.stringify({ session_id: "sess1", cwd: wf, stop_hook_active: false, hook_event_name: "Stop", ...over });

  it("allows (no output) and cleans up when the report exists", () => {
    appendRun(wf, { ts: "T", runId: "r1", sessionId: "s", params: {}, status: "success",
      reasoning: "x", confidence: 1, action_summary: "y", reportedBy: "agent" });
    writeBounce(wf, "r1", 1);
    const { stdout } = runStopGate(["--run-id", "r1"], stdin(), "Tnow");
    expect(stdout).toBe("");
    expect(readBounce(wf, "r1")).toBe(0); // bounce file removed
  });

  it("blocks with a reason and bumps the bounce when not reported", () => {
    const { stdout } = runStopGate(["--run-id", "r1"], stdin(), "Tnow");
    const out = JSON.parse(stdout);
    expect(out.decision).toBe("block");
    expect(out.reason).toMatch(/looopy_report/);
    expect(readBounce(wf, "r1")).toBe(1);
  });

  it("prefers --workflow-dir over stdin cwd when both are present", () => {
    // Set up the real run in wf (the --workflow-dir target)
    appendRun(wf, { ts: "T", runId: "r1", sessionId: "s", params: {}, status: "success",
      reasoning: "x", confidence: 1, action_summary: "y", reportedBy: "agent" });
    // stdin cwd points somewhere else — a different temp dir
    const otherDir = fs.mkdtempSync(path.join(os.tmpdir(), "op-gate-other-"));
    const stdinWithOtherCwd = JSON.stringify({
      session_id: "sess1", cwd: otherDir, stop_hook_active: false, hook_event_name: "Stop",
    });
    // passing --workflow-dir wf should find the report and allow cleanly
    const { stdout } = runStopGate(
      ["--run-id", "r1", "--workflow-dir", wf],
      stdinWithOtherCwd,
      "Tnow",
    );
    expect(stdout).toBe(""); // allowed because wf has the report
  });

  it("writes a hook-backstop failure record and allows at the cap", () => {
    writeSidecar(wf, "r1", { sessionId: "sess1", params: { mode: "pitch" }, ts: "T0" });
    writeBounce(wf, "r1", MAX_BOUNCES);
    const { stdout } = runStopGate(["--run-id", "r1"], stdin(), "Tnow");
    expect(stdout).toBe("");
    const runs = readRuns(wf);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      runId: "r1", sessionId: "sess1", params: { mode: "pitch" },
      status: "failure", reportedBy: "hook-backstop",
    });
    expect(readSidecar(wf, "r1")).toBeNull(); // cleaned up
  });
});
