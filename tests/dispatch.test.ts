import { describe, it, expect } from "vitest";
import {
  checkRequiredParams,
  composePrompt,
  dispatch,
  DispatchError,
  buildMcpConfig,
  buildStopHookSettings,
  parseSessionId,
  type Runner,
} from "../src/dispatch.js";
import type { WorkflowConfig } from "../src/config.js";
import { readSidecar } from "../src/ledger.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

describe("checkRequiredParams", () => {
  it("returns missing required names, sorted", () => {
    const missing = checkRequiredParams(
      [
        { name: "mode", required: true },
        { name: "cap", required: true },
        { name: "note", required: false },
      ],
      { mode: "pitch" },
    );
    expect(missing).toEqual(["cap"]);
  });

  it("returns [] when all required present", () => {
    expect(
      checkRequiredParams([{ name: "mode", required: true }], { mode: "x" }),
    ).toEqual([]);
  });
});

describe("composePrompt", () => {
  it("includes skill and params", () => {
    const result = composePrompt("reddit-skill", { mode: "pitch", cap: "3" });
    expect(result).toContain("Invoke the reddit-skill skill.\nParams: mode=pitch, cap=3.");
    expect(result).toContain("looopy_report");
  });

  it("appends the note when present", () => {
    const result = composePrompt("s", { mode: "pitch" }, "skip r/startups");
    expect(result).toContain("Invoke the s skill.\nParams: mode=pitch.\nAdditional context: skip r/startups.");
    expect(result).toContain("looopy_report");
  });

  it("handles no params", () => {
    const result = composePrompt("s", {});
    expect(result).toContain("Invoke the s skill.\nParams: .");
    expect(result).toContain("looopy_report");
  });

  it("renders description alongside value when spec has one", () => {
    const result = composePrompt(
      "job-hunter",
      { profile: "aidan-rodriguez" },
      undefined,
      [{ name: "profile", required: true, description: "the candidate profile to run the cycle for" }],
    );
    expect(result).toContain("profile=aidan-rodriguez (the candidate profile to run the cycle for)");
  });

  it("renders plain k=v when spec has no description", () => {
    const result = composePrompt(
      "job-hunter",
      { mode: "pitch" },
      undefined,
      [{ name: "mode", required: true }],
    );
    expect(result).toContain("mode=pitch");
    expect(result).not.toContain("mode=pitch (");
  });
});

describe("dispatch", () => {
  const config: WorkflowConfig = {
    skill: "reddit-skill",
    params: [{ name: "mode", required: true }],
  };

  it("throws DispatchError listing missing required params", () => {
    expect(() =>
      dispatch({ workflowDir: "/wf", config, params: {} }),
    ).toThrow(/missing required param/i);
  });

  it("runs claude --bg with the right args, cwd, and returns the session id", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "op-test-"));
    const calls: any[] = [];
    const run: Runner = (cmd, args, opts) => {
      calls.push({ cmd, args, opts });
      return { status: 0, stdout: "sess_123\n", stderr: "" };
    };
    const id = dispatch({
      workflowDir: dir,
      config,
      params: { mode: "pitch" },
      env: {},
      run,
    });
    expect(id).toBe("sess_123");
    expect(calls[0].cmd).toBe("claude");
    expect(calls[0].args.slice(0, 3)).toEqual([
      "--bg",
      "--permission-mode",
      "auto",
    ]);
    const lastArg = calls[0].args[calls[0].args.length - 1];
    expect(lastArg).toContain("Invoke the reddit-skill skill");
    expect(calls[0].opts.cwd).toBe(dir);
  });

  it("throws DispatchError when claude is missing (status 127)", () => {
    const run: Runner = () => ({ status: 127, stdout: "", stderr: "not found" });
    expect(() =>
      dispatch({ workflowDir: "/wf", config, params: { mode: "x" }, env: {}, run }),
    ).toThrow(DispatchError);
  });

  it("throws DispatchError on non-zero status", () => {
    const run: Runner = () => ({ status: 1, stdout: "", stderr: "boom" });
    expect(() =>
      dispatch({ workflowDir: "/wf", config, params: { mode: "x" }, env: {}, run }),
    ).toThrow(/boom/);
  });
});

describe("inline injection", () => {
  it("buildMcpConfig registers an looopy stdio server with run env", () => {
    const cfg = JSON.parse(buildMcpConfig("run123", "/wf/dir"));
    const s = cfg.mcpServers.looopy;
    expect(s.type).toBe("stdio");
    expect(s.command).toBe("looopy");
    expect(s.args).toEqual(["mcp-serve"]);
    expect(s.env.OPERATOR_RUN_ID).toBe("run123");
    expect(s.env.OPERATOR_WORKFLOW_DIR).toBe("/wf/dir");
  });
  it("buildStopHookSettings injects a Stop hook calling looopy stop-gate with workflow-dir", () => {
    const cfg = JSON.parse(buildStopHookSettings("run123", "/wf/dir"));
    const hook = cfg.hooks.Stop[0].hooks[0];
    expect(hook.type).toBe("command");
    expect(hook.command).toBe("looopy stop-gate --run-id run123 --workflow-dir '/wf/dir'");
  });
});

describe("dispatch wiring", () => {
  it("passes inline flags, instructs looopy_report, and writes the sidecar", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "op-disp-"));
    const calls: any[] = [];
    const run = (cmd: string, args: string[], opts: any) => {
      calls.push({ cmd, args, opts });
      return { status: 0, stdout: "sess_abc\n", stderr: "" };
    };
    const id = dispatch({
      workflowDir: dir,
      config: { skill: "reddit-skill", params: [] },
      params: { mode: "pitch" },
      env: {},
      run,
      genRunId: () => "rid7",
      now: () => "2026-06-22T00:00:00Z",
    });
    expect(id).toBe("sess_abc");
    const args = calls[0].args;
    expect(args).toContain("--mcp-config");
    expect(args).toContain("--settings");
    // prompt is the last arg and instructs the report tool
    expect(args[args.length - 1]).toContain("looopy_report");
    // sidecar captured the session id and params
    expect(readSidecar(dir, "rid7")).toEqual({
      sessionId: "sess_abc", params: { mode: "pitch" }, ts: "2026-06-22T00:00:00Z",
    });
  });

  it("stamps the config version into the sidecar", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "op-disp-"));
    const run = () => ({ status: 0, stdout: "sess_v\n", stderr: "" });
    dispatch({
      workflowDir: dir,
      config: { skill: "reddit-skill", version: "3.0.1", params: [] },
      params: {},
      env: {},
      run,
      genRunId: () => "ridv",
      now: () => "2026-06-22T00:00:00Z",
    });
    expect(readSidecar(dir, "ridv")?.version).toBe("3.0.1");
  });
});

const REAL_BG_STDOUT = `backgrounded · f57bff00
  claude agents             list sessions
  claude attach f57bff00    open in this terminal
  claude logs f57bff00      show recent output
  claude stop f57bff00      stop this session
`;

describe("parseSessionId", () => {
  it("extracts the short id from realistic multi-line claude --bg output", () => {
    expect(parseSessionId(REAL_BG_STDOUT)).toBe("f57bff00");
  });

  it("falls back to the last token of the first line for a bare single-token input", () => {
    expect(parseSessionId("sess_xyz\n")).toBe("sess_xyz");
  });
});

describe("dispatch wiring — realistic claude --bg stdout", () => {
  it("returns the short session id (not the blob) and writes it to the sidecar", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "op-disp-real-"));
    const run = (_cmd: string, _args: string[], _opts: any) => ({
      status: 0,
      stdout: REAL_BG_STDOUT,
      stderr: "",
    });
    const id = dispatch({
      workflowDir: dir,
      config: { skill: "reddit-skill", params: [] },
      params: { mode: "pitch" },
      env: {},
      run,
      genRunId: () => "rid8",
      now: () => "2026-06-22T00:00:00Z",
    });
    expect(id).toBe("f57bff00");
    expect(readSidecar(dir, "rid8")).toEqual({
      sessionId: "f57bff00",
      params: { mode: "pitch" },
      ts: "2026-06-22T00:00:00Z",
    });
  });
});
