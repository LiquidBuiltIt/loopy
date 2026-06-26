import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { initHome, newWorkflow, ScaffoldError } from "../src/scaffold.js";

describe("initHome", () => {
  let base: string;
  beforeEach(() => {
    base = fs.mkdtempSync(path.join(os.tmpdir(), "op-init-"));
  });
  afterEach(() => fs.rmSync(base, { recursive: true, force: true }));

  it("creates the home, root marker, and starter CLAUDE.md", () => {
    const root = path.join(base, "Agents", "Operator");
    const res = initHome(root);
    expect(fs.existsSync(path.join(root, ".looopy-root"))).toBe(true);
    expect(fs.existsSync(path.join(root, "CLAUDE.md"))).toBe(true);
    expect(res.created.length).toBe(2);
  });

  it("is idempotent (no new files on re-run)", () => {
    const root = path.join(base, "home");
    initHome(root);
    const res = initHome(root);
    expect(res.created).toEqual([]);
  });
});

describe("newWorkflow", () => {
  let root: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "op-new-"));
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it("creates a nested workflow dir + skeleton config", () => {
    const dir = newWorkflow(root, "supersurf/outreach/reddit");
    const cfg = path.join(dir, ".looopy/config.json");
    expect(fs.existsSync(cfg)).toBe(true);
    expect(JSON.parse(fs.readFileSync(cfg, "utf8"))).toEqual({
      skill: "",
      version: "0.1.0",
      params: [],
    });
  });

  it("rejects an existing workflow", () => {
    newWorkflow(root, "wf");
    expect(() => newWorkflow(root, "wf")).toThrow(ScaffoldError);
  });

  it("rejects unsafe names", () => {
    expect(() => newWorkflow(root, "")).toThrow(ScaffoldError);
    expect(() => newWorkflow(root, "../escape")).toThrow(ScaffoldError);
    expect(() => newWorkflow(root, "/abs")).toThrow(ScaffoldError);
  });
});
