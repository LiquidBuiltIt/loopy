import fs from "node:fs";
import path from "node:path";
import { OPERATOR_DIR } from "./constants.js";

export type RunStatus = "success" | "failure";

export type AgentReport = {
  status: RunStatus;
  reasoning: string;
  confidence: number;
  action_summary: string;
};

export type RunRecord = AgentReport & {
  ts: string;
  runId: string;
  sessionId: string | null;
  params: Record<string, string>;
  version?: string;
  reportedBy: "agent" | "hook-backstop";
};

export type Sidecar = {
  sessionId: string;
  params: Record<string, string>;
  ts: string;
  version?: string;
};

function opDir(workflowDir: string): string {
  return path.join(workflowDir, OPERATOR_DIR);
}

export function ledgerPath(workflowDir: string): string {
  return path.join(opDir(workflowDir), "runs.jsonl");
}

export function appendRun(workflowDir: string, record: RunRecord): void {
  fs.mkdirSync(opDir(workflowDir), { recursive: true });
  fs.appendFileSync(ledgerPath(workflowDir), JSON.stringify(record) + "\n");
}

export function readRuns(workflowDir: string, limit?: number): RunRecord[] {
  let text: string;
  try {
    text = fs.readFileSync(ledgerPath(workflowDir), "utf8");
  } catch {
    return [];
  }
  const records = text
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l) => JSON.parse(l) as RunRecord);
  return typeof limit === "number" ? records.slice(-limit) : records;
}

export function hasRun(workflowDir: string, runId: string): boolean {
  return readRuns(workflowDir).some((r) => r.runId === runId);
}

function sidecarPath(workflowDir: string, runId: string): string {
  return path.join(opDir(workflowDir), `.run-${runId}.json`);
}

export function writeSidecar(workflowDir: string, runId: string, data: Sidecar): void {
  fs.mkdirSync(opDir(workflowDir), { recursive: true });
  fs.writeFileSync(sidecarPath(workflowDir, runId), JSON.stringify(data));
}

export function readSidecar(workflowDir: string, runId: string): Sidecar | null {
  try {
    return JSON.parse(fs.readFileSync(sidecarPath(workflowDir, runId), "utf8")) as Sidecar;
  } catch {
    return null;
  }
}

function bouncePath(workflowDir: string, runId: string): string {
  return path.join(opDir(workflowDir), `.bounce-${runId}`);
}

export function readBounce(workflowDir: string, runId: string): number {
  try {
    const n = parseInt(fs.readFileSync(bouncePath(workflowDir, runId), "utf8").trim(), 10);
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

export function writeBounce(workflowDir: string, runId: string, n: number): void {
  fs.mkdirSync(opDir(workflowDir), { recursive: true });
  fs.writeFileSync(bouncePath(workflowDir, runId), String(n));
}

export function cleanupRun(workflowDir: string, runId: string): void {
  fs.rmSync(sidecarPath(workflowDir, runId), { force: true });
  fs.rmSync(bouncePath(workflowDir, runId), { force: true });
}

export function listSidecars(workflowDir: string): { runId: string; sessionId: string }[] {
  const dir = opDir(workflowDir);
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const results: { runId: string; sessionId: string }[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const m = entry.name.match(/^\.run-(.+)\.json$/);
    if (!m) continue;
    const runId = m[1];
    try {
      const data = JSON.parse(fs.readFileSync(path.join(dir, entry.name), "utf8")) as Sidecar;
      results.push({ runId, sessionId: data.sessionId });
    } catch {
      // skip unparseable sidecars
    }
  }
  return results;
}

export function formatRuns(records: RunRecord[]): string {
  const header = "TS\tVERSION\tSTATUS\tCONF\tSUMMARY";
  const rows = records.map(
    (r) => `${r.ts}\t${r.version ?? "-"}\t${r.status}\t${r.confidence.toFixed(2)}\t${r.action_summary}`,
  );
  return [header, ...rows].join("\n");
}
