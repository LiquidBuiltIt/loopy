import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  appendRun, readRuns, hasRun, writeSidecar, readSidecar,
  readBounce, writeBounce, cleanupRun, formatRuns, ledgerPath,
  listSidecars,
  type RunRecord,
} from "../src/ledger.js";

let wf: string;
beforeEach(() => {
  wf = fs.mkdtempSync(path.join(os.tmpdir(), "op-ledger-"));
});

const rec = (over: Partial<RunRecord> = {}): RunRecord => ({
  ts: "2026-06-22T00:00:00Z", runId: "r1", sessionId: "s1", params: {},
  status: "success", reasoning: "ok", confidence: 0.9,
  action_summary: "did stuff", reportedBy: "agent", ...over,
});

describe("ledger", () => {
  it("appends and reads back one record per line", () => {
    appendRun(wf, rec({ runId: "a" }));
    appendRun(wf, rec({ runId: "b" }));
    const runs = readRuns(wf);
    expect(runs.map((r) => r.runId)).toEqual(["a", "b"]);
    expect(fs.readFileSync(ledgerPath(wf), "utf8").trim().split("\n")).toHaveLength(2);
  });
  it("readRuns returns [] when no ledger exists", () => {
    expect(readRuns(wf)).toEqual([]);
  });
  it("readRuns limit returns the last N", () => {
    appendRun(wf, rec({ runId: "a" }));
    appendRun(wf, rec({ runId: "b" }));
    appendRun(wf, rec({ runId: "c" }));
    expect(readRuns(wf, 2).map((r) => r.runId)).toEqual(["b", "c"]);
  });
  it("hasRun detects a runId in the ledger", () => {
    appendRun(wf, rec({ runId: "xyz" }));
    expect(hasRun(wf, "xyz")).toBe(true);
    expect(hasRun(wf, "nope")).toBe(false);
  });
  it("sidecar round-trips", () => {
    writeSidecar(wf, "r1", { sessionId: "S", params: { mode: "x" }, ts: "T" });
    expect(readSidecar(wf, "r1")).toEqual({ sessionId: "S", params: { mode: "x" }, ts: "T" });
    expect(readSidecar(wf, "missing")).toBeNull();
  });
  it("bounce counter defaults to 0 and persists", () => {
    expect(readBounce(wf, "r1")).toBe(0);
    writeBounce(wf, "r1", 2);
    expect(readBounce(wf, "r1")).toBe(2);
  });
  it("cleanupRun removes sidecar and bounce, leaves ledger", () => {
    appendRun(wf, rec({ runId: "r1" }));
    writeSidecar(wf, "r1", { sessionId: "S", params: {}, ts: "T" });
    writeBounce(wf, "r1", 1);
    cleanupRun(wf, "r1");
    expect(readSidecar(wf, "r1")).toBeNull();
    expect(readBounce(wf, "r1")).toBe(0);
    expect(hasRun(wf, "r1")).toBe(true);
  });
  it("formatRuns prints a header and a row per record", () => {
    const out = formatRuns([rec({ status: "failure", confidence: 0.3, action_summary: "broke" })]);
    expect(out).toContain("STATUS");
    expect(out).toContain("failure");
    expect(out).toContain("broke");
  });
  it("formatRuns shows the version column, '-' when absent", () => {
    const out = formatRuns([rec({ version: "1.2.0" }), rec()]);
    const [header, row1, row2] = out.split("\n");
    expect(header).toContain("VERSION");
    expect(row1.split("\t")).toContain("1.2.0");
    expect(row2.split("\t")).toContain("-");
  });
  it("listSidecars returns [] when .looopy dir does not exist", () => {
    expect(listSidecars(wf)).toEqual([]);
  });
  it("listSidecars returns runId+sessionId for each .run-*.json file", () => {
    writeSidecar(wf, "r1", { sessionId: "S1", params: {}, ts: "T" });
    writeSidecar(wf, "r2", { sessionId: "S2", params: {}, ts: "T" });
    const results = listSidecars(wf);
    expect(results).toHaveLength(2);
    expect(results.find((x) => x.runId === "r1")).toEqual({ runId: "r1", sessionId: "S1" });
    expect(results.find((x) => x.runId === "r2")).toEqual({ runId: "r2", sessionId: "S2" });
  });
  it("listSidecars ignores non-sidecar files in .looopy dir", () => {
    writeSidecar(wf, "r1", { sessionId: "S1", params: {}, ts: "T" });
    // Write a bounce file — should be ignored
    writeBounce(wf, "r1", 2);
    const results = listSidecars(wf);
    expect(results).toHaveLength(1);
  });
});
