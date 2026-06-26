import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildReportRecord, runReport } from "../src/mcp.js";
import { writeSidecar, readRuns } from "../src/ledger.js";

let wf: string;
beforeEach(() => {
  wf = fs.mkdtempSync(path.join(os.tmpdir(), "op-mcp-"));
});

const input = {
  status: "success" as const, reasoning: "clean sweep",
  confidence: 0.8, action_summary: "no leads, no post",
};

describe("buildReportRecord", () => {
  it("enriches the agent input with sidecar metadata", () => {
    writeSidecar(wf, "r1", { sessionId: "sX", params: { mode: "pitch" }, ts: "T0" });
    const env = { OPERATOR_RUN_ID: "r1", OPERATOR_WORKFLOW_DIR: wf };
    const { workflowDir, record } = buildReportRecord(env, input, "2026-06-22T01:00:00Z");
    expect(workflowDir).toBe(wf);
    expect(record).toEqual({
      ts: "2026-06-22T01:00:00Z", runId: "r1", sessionId: "sX",
      params: { mode: "pitch" }, status: "success", reasoning: "clean sweep",
      confidence: 0.8, action_summary: "no leads, no post", reportedBy: "agent",
    });
  });
  it("copies the workflow version from the sidecar onto the record", () => {
    writeSidecar(wf, "r1", { sessionId: "sX", params: {}, ts: "T0", version: "2.1.0" });
    const env = { OPERATOR_RUN_ID: "r1", OPERATOR_WORKFLOW_DIR: wf };
    const { record } = buildReportRecord(env, input, "T1");
    expect(record.version).toBe("2.1.0");
  });
  it("degrades to null session / empty params when no sidecar", () => {
    const env = { OPERATOR_RUN_ID: "r9", OPERATOR_WORKFLOW_DIR: wf };
    const { record } = buildReportRecord(env, input, "T");
    expect(record.sessionId).toBeNull();
    expect(record.params).toEqual({});
  });
  it("throws when run env is missing", () => {
    expect(() => buildReportRecord({}, input, "T")).toThrow(/OPERATOR_RUN_ID/);
  });
});

describe("runReport", () => {
  it("appends the enriched record to the ledger", () => {
    writeSidecar(wf, "r1", { sessionId: "sX", params: {}, ts: "T0" });
    runReport({ OPERATOR_RUN_ID: "r1", OPERATOR_WORKFLOW_DIR: wf }, input, "T1");
    const runs = readRuns(wf);
    expect(runs).toHaveLength(1);
    expect(runs[0].runId).toBe("r1");
    expect(runs[0].reportedBy).toBe("agent");
  });
});
