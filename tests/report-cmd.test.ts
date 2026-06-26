import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { reportOne, reportAll } from "../src/cli.js";
import { appendRun } from "../src/ledger.js";

let root: string;
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), "op-report-")); });

function mkWorkflow(rel: string) {
  const dir = path.join(root, rel);
  fs.mkdirSync(path.join(dir, ".looopy"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".looopy", "config.json"),
    JSON.stringify({ skill: "s", params: [] }));
  return dir;
}
const rec = (over: object) => ({
  ts: "2026-06-22T00:00:00Z", runId: "r", sessionId: "s", params: {},
  status: "success", reasoning: "ok", confidence: 0.9,
  action_summary: "did", reportedBy: "agent", ...over,
}) as any;

describe("reportOne", () => {
  it("tails one workflow's ledger", () => {
    const dir = mkWorkflow("a/b");
    appendRun(dir, rec({ runId: "1", action_summary: "first" }));
    appendRun(dir, rec({ runId: "2", action_summary: "second", status: "failure" }));
    const out = reportOne(root, "a/b", 10);
    expect(out).toContain("first");
    expect(out).toContain("second");
    expect(out).toContain("failure");
  });
  it("reports no runs cleanly", () => {
    mkWorkflow("a/b");
    expect(reportOne(root, "a/b", 10)).toMatch(/no runs/i);
  });
});

describe("reportAll", () => {
  it("shows the latest run per workflow", () => {
    const a = mkWorkflow("a");
    const b = mkWorkflow("b");
    appendRun(a, rec({ action_summary: "old" }));
    appendRun(a, rec({ action_summary: "latest-a" }));
    appendRun(b, rec({ action_summary: "latest-b", status: "failure" }));
    const out = reportAll(root);
    expect(out).toContain("a");
    expect(out).toContain("latest-a");
    expect(out).not.toContain("old");
    expect(out).toContain("latest-b");
  });
});
