import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  statusRuns,
  formatStatus,
  gatherOperatorSessions,
  logsCmd,
  stopCmd,
  type StatusRunner,
  type OperatorSession,
} from "../src/status.js";
import { appendRun, writeSidecar, type RunRecord } from "../src/ledger.js";
import { CONFIG_FILENAME } from "../src/constants.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "op-status-"));
}

function makeWorkflow(root: string, name: string): string {
  const dir = path.join(root, name);
  fs.mkdirSync(path.join(dir, ".looopy"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, CONFIG_FILENAME),
    JSON.stringify({ skill: "test-skill", params: [] }),
  );
  return dir;
}

const rec = (over: Partial<RunRecord> = {}): RunRecord => ({
  ts: "2026-06-22T00:00:00Z",
  runId: "r1",
  sessionId: "s1",
  params: {},
  status: "success",
  reasoning: "ok",
  confidence: 0.9,
  action_summary: "did stuff",
  reportedBy: "agent",
  ...over,
});

// ── formatStatus (pure) ───────────────────────────────────────────────────────

describe("formatStatus", () => {
  const opSessions = new Map<string, OperatorSession>([
    ["aaaa1111", { workflow: "wf-a", outcome: "success" }],
    ["bbbb2222", { workflow: "wf-b", outcome: "running" }],
  ]);

  // claude reports full UUIDs; looopy keyed by the short first segment.
  const fakeAgents = [
    { sessionId: "aaaa1111-1111-1111-1111-111111111111", state: "idle", cwd: "/root/wf-a" },
    { sessionId: "bbbb2222-2222-2222-2222-222222222222", state: "working", cwd: "/root/wf-b" },
    { sessionId: "ffff9999-9999-9999-9999-999999999999", status: "done", cwd: "/some/other/dir" },
  ];

  it("includes header always", () => {
    const out = formatStatus([], opSessions);
    expect(out).toBe("WORKFLOW\tID\tSTATE\tOUTCOME");
  });

  it("excludes non-looopy sessions", () => {
    const out = formatStatus(fakeAgents, opSessions);
    expect(out).not.toContain("ffff9999");
  });

  it("includes looopy sessions with correct columns", () => {
    const out = formatStatus(fakeAgents, opSessions);
    expect(out).toContain("wf-a\taaaa1111\tidle\tsuccess");
    expect(out).toContain("wf-b\tbbbb2222\tworking\trunning");
  });

  it("uses status field when state is absent (interactive session)", () => {
    const agents = [{ sessionId: "aaaa1111-1111-1111-1111-111111111111", status: "done", cwd: "/root/wf-a" }];
    const out = formatStatus(agents, opSessions);
    expect(out).toContain("done");
  });

  it("falls back to 'unknown' when neither state nor status present", () => {
    const agents = [{ sessionId: "aaaa1111-1111-1111-1111-111111111111", cwd: "/root/wf-a" }];
    const out = formatStatus(agents, opSessions);
    expect(out).toContain("unknown");
  });

  it("pathArg filters to one workflow", () => {
    const out = formatStatus(fakeAgents, opSessions, "wf-a");
    expect(out).toContain("wf-a");
    expect(out).not.toContain("wf-b");
  });

  it("zero looopy sessions → just the header", () => {
    const out = formatStatus(fakeAgents, new Map());
    expect(out).toBe("WORKFLOW\tID\tSTATE\tOUTCOME");
  });

  it("matches the short recorded id against claude's full UUID and displays the short id", () => {
    // looopy records the short banner id; claude reports the full UUID.
    const sessions = new Map<string, OperatorSession>([
      ["6ba57ec8", { workflow: "job-hunter", outcome: "failure" }],
    ]);
    const agents = [
      { sessionId: "6ba57ec8-6216-4579-836e-100c9c2db648", state: "done", cwd: "/root/job-hunter" },
    ];
    const out = formatStatus(agents, sessions);
    expect(out).toContain("job-hunter\t6ba57ec8\tdone\tfailure");
  });
});

// ── gatherOperatorSessions ────────────────────────────────────────────────────

describe("gatherOperatorSessions", () => {
  let root: string;

  beforeEach(() => {
    root = makeRoot();
  });

  it("returns empty map when no workflows", () => {
    const map = gatherOperatorSessions(root);
    expect(map.size).toBe(0);
  });

  it("picks up sessionId from runs.jsonl with correct outcome", () => {
    const dir = makeWorkflow(root, "wf1");
    appendRun(dir, rec({ sessionId: "s1", status: "failure", ts: "2026-06-22T01:00:00Z" }));
    const map = gatherOperatorSessions(root);
    expect(map.get("s1")).toEqual({ workflow: "wf1", outcome: "failure" });
  });

  it("uses latest ts when sessionId has multiple runs.jsonl entries", () => {
    const dir = makeWorkflow(root, "wf1");
    appendRun(dir, rec({ runId: "r1", sessionId: "s1", status: "failure", ts: "2026-06-22T01:00:00Z" }));
    appendRun(dir, rec({ runId: "r2", sessionId: "s1", status: "success", ts: "2026-06-22T02:00:00Z" }));
    const map = gatherOperatorSessions(root);
    expect(map.get("s1")?.outcome).toBe("success");
  });

  it("sidecar-only sessionId gets outcome 'running'", () => {
    const dir = makeWorkflow(root, "wf2");
    writeSidecar(dir, "r99", { sessionId: "slive999", params: {}, ts: "T" });
    const map = gatherOperatorSessions(root);
    expect(map.get("slive999")).toEqual({ workflow: "wf2", outcome: "running" });
  });

  it("runs.jsonl entry overrides sidecar outcome for same sessionId", () => {
    const dir = makeWorkflow(root, "wf3");
    writeSidecar(dir, "r1", { sessionId: "s1", params: {}, ts: "T" });
    appendRun(dir, rec({ sessionId: "s1", status: "success" }));
    const map = gatherOperatorSessions(root);
    expect(map.get("s1")?.outcome).toBe("success");
  });

  it("skips null sessionId in runs.jsonl", () => {
    const dir = makeWorkflow(root, "wf4");
    appendRun(dir, rec({ sessionId: null, runId: "r-null" }));
    const map = gatherOperatorSessions(root);
    expect(map.has("null")).toBe(false);
    expect(map.size).toBe(0);
  });
});

// ── statusRuns (integration with fake runner) ─────────────────────────────────

describe("statusRuns", () => {
  let root: string;

  beforeEach(() => {
    root = makeRoot();
  });

  it("throws when claude is missing (status 127)", () => {
    const run: StatusRunner = () => ({ status: 127, stdout: "", stderr: "" });
    expect(() => statusRuns(undefined, run, root)).toThrow(/claude/i);
  });

  it("throws when claude exits non-zero", () => {
    const run: StatusRunner = () => ({ status: 1, stdout: "", stderr: "boom" });
    expect(() => statusRuns(undefined, run, root)).toThrow(/claude agents failed/);
  });

  it("shows only looopy-spawned live sessions", () => {
    const dir = makeWorkflow(root, "my-wf");
    appendRun(dir, rec({ sessionId: "ops10001", status: "success" }));

    const agents = JSON.stringify([
      { sessionId: "ops10001-1111-2222-3333-444455556666", state: "idle", cwd: path.join(root, "my-wf") },
      { sessionId: "foreign0-0000-0000-0000-000000000000", state: "working", cwd: "/elsewhere" },
    ]);
    const run: StatusRunner = () => ({ status: 0, stdout: agents, stderr: "" });

    const out = statusRuns(undefined, run, root);
    expect(out).toContain("ops10001");
    expect(out).not.toContain("foreign0");
  });

  it("pathArg filters to one workflow", () => {
    const dirA = makeWorkflow(root, "wf-a");
    const dirB = makeWorkflow(root, "wf-b");
    appendRun(dirA, rec({ runId: "r1", sessionId: "saaa0001", status: "success" }));
    appendRun(dirB, rec({ runId: "r2", sessionId: "sbbb0002", status: "failure" }));

    const agents = JSON.stringify([
      { sessionId: "saaa0001-1111-1111-1111-111111111111", state: "idle", cwd: path.join(root, "wf-a") },
      { sessionId: "sbbb0002-2222-2222-2222-222222222222", state: "idle", cwd: path.join(root, "wf-b") },
    ]);
    const run: StatusRunner = () => ({ status: 0, stdout: agents, stderr: "" });

    const out = statusRuns("wf-a", run, root);
    expect(out).toContain("saaa0001");
    expect(out).not.toContain("sbbb0002");
  });

  it("zero matching rows → just the header", () => {
    const run: StatusRunner = () => ({ status: 0, stdout: "[]", stderr: "" });
    const out = statusRuns(undefined, run, root);
    expect(out).toBe("WORKFLOW\tID\tSTATE\tOUTCOME");
  });
});

// ── logsCmd / stopCmd (unchanged) ─────────────────────────────────────────────

describe("logsCmd / stopCmd", () => {
  it("builds native args", () => {
    expect(logsCmd("a1")).toEqual(["logs", "a1"]);
    expect(stopCmd("a1")).toEqual(["stop", "a1"]);
  });
});
