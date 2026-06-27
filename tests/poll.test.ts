import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { appendRun, writeSidecar, type RunRecord } from "../src/ledger.js";
import { CONFIG_FILENAME } from "../src/constants.js";
import { pollOnce, pollRuns } from "../src/poll.js";

let root: string;
let wfDir: string;
const WF = "wf-a";

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "op-poll-"));
  wfDir = path.join(root, WF);
  fs.mkdirSync(path.join(wfDir, ".looopy"), { recursive: true });
  fs.writeFileSync(path.join(wfDir, CONFIG_FILENAME), "{}");
});

const rec = (over: Partial<RunRecord> = {}): RunRecord => ({
  ts: "2026-06-22T00:00:00Z", runId: "r1", sessionId: "s1", params: {},
  status: "success", reasoning: "ok", confidence: 0.9,
  action_summary: "did stuff", reportedBy: "agent", ...over,
});

const sidecar = () => writeSidecar(wfDir, "r1", { sessionId: "s1", params: {}, ts: "t" });

describe("pollOnce", () => {
  it("not-found for an unknown runId", () => {
    expect(pollOnce(root, "nope").state).toBe("not-found");
  });
  it("running when a sidecar exists but no verdict recorded", () => {
    sidecar();
    expect(pollOnce(root, "r1").state).toBe("running");
  });
  it("returns the verdict once recorded", () => {
    appendRun(wfDir, rec({ status: "failure", action_summary: "broke" }));
    expect(pollOnce(root, "r1")).toEqual({ state: "failure", workflow: WF, summary: "broke" });
  });
  it("terminal record wins over a lingering sidecar", () => {
    sidecar();
    appendRun(wfDir, rec({ status: "success" }));
    expect(pollOnce(root, "r1").state).toBe("success");
  });
  it("latest record for a runId wins", () => {
    appendRun(wfDir, rec({ ts: "a", status: "failure" }));
    appendRun(wfDir, rec({ ts: "b", status: "success", action_summary: "fixed" }));
    expect(pollOnce(root, "r1")).toMatchObject({ state: "success", summary: "fixed" });
  });
});

describe("pollRuns", () => {
  const noSleep = async () => {};
  const fixedNow = () => 0;

  it("exit 0 on success", async () => {
    appendRun(wfDir, rec({ status: "success" }));
    const r = await pollRuns(root, "r1", { intervalMs: 1, sleep: noSleep, now: fixedNow });
    expect(r.code).toBe(0);
    expect(r.line).toContain("success");
  });
  it("exit 1 on failure", async () => {
    appendRun(wfDir, rec({ status: "failure" }));
    const r = await pollRuns(root, "r1", { intervalMs: 1, sleep: noSleep, now: fixedNow });
    expect(r.code).toBe(1);
  });
  it("exit 3 on unknown run", async () => {
    const r = await pollRuns(root, "ghost", { intervalMs: 1, sleep: noSleep, now: fixedNow });
    expect(r.code).toBe(3);
  });
  it("exit 2 on timeout while still running", async () => {
    sidecar();
    let t = 0;
    const now = () => t;
    const sleep = async () => { t += 10; };
    const r = await pollRuns(root, "r1", { intervalMs: 1, timeoutMs: 5, sleep, now });
    expect(r.code).toBe(2);
    expect(r.line).toContain("timeout");
  });
  it("blocks through running polls then returns the verdict", async () => {
    sidecar();
    let polls = 0;
    const sleep = async () => {
      polls += 1;
      if (polls === 3) appendRun(wfDir, rec({ status: "success" }));
    };
    const r = await pollRuns(root, "r1", { intervalMs: 1, sleep, now: () => 0 });
    expect(r.code).toBe(0);
    expect(polls).toBe(3);
  });
});
