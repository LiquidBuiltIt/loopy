import { z } from "zod";
import { appendRun, readSidecar, type AgentReport, type RunRecord } from "./ledger.js";

export type ReportInput = AgentReport;

export const reportShape = {
  status: z.enum(["success", "failure"]),
  reasoning: z.string().min(1),
  confidence: z.number().min(0).max(1),
  action_summary: z.string().min(1),
};

export function buildReportRecord(
  env: NodeJS.ProcessEnv,
  input: ReportInput,
  nowISO: string,
): { workflowDir: string; record: RunRecord } {
  const runId = env.OPERATOR_RUN_ID;
  const workflowDir = env.OPERATOR_WORKFLOW_DIR;
  if (!runId || !workflowDir) {
    throw new Error("OPERATOR_RUN_ID and OPERATOR_WORKFLOW_DIR must be set");
  }
  const sc = readSidecar(workflowDir, runId);
  const record: RunRecord = {
    ts: nowISO,
    runId,
    sessionId: sc?.sessionId ?? null,
    params: sc?.params ?? {},
    version: sc?.version,
    status: input.status,
    reasoning: input.reasoning,
    confidence: input.confidence,
    action_summary: input.action_summary,
    reportedBy: "agent",
  };
  return { workflowDir, record };
}

export function runReport(
  env: NodeJS.ProcessEnv,
  input: ReportInput,
  nowISO: string,
): void {
  const { workflowDir, record } = buildReportRecord(env, input, nowISO);
  appendRun(workflowDir, record);
}

export async function serveMcp(): Promise<void> {
  const { McpServer } = await import("@modelcontextprotocol/sdk/server/mcp.js");
  const { StdioServerTransport } = await import("@modelcontextprotocol/sdk/server/stdio.js");

  const server = new McpServer({ name: "looopy", version: "1.0.0" });

  server.tool(
    "looopy_report",
    "Record the workflow's terminal verdict. Call exactly once, as your final action.",
    reportShape,
    async (input: ReportInput) => {
      runReport(process.env, input, new Date().toISOString());
      return { content: [{ type: "text" as const, text: "Run recorded. You may end your turn." }] };
    },
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
