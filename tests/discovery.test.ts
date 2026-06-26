import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { discoverWorkflows, isWorkflow } from "../src/discovery.js";

const MARKER = ".looopy/config.json";

function mkWorkflow(root: string, rel: string) {
  const dir = path.join(root, rel);
  fs.mkdirSync(path.join(dir, ".looopy"), { recursive: true });
  fs.writeFileSync(path.join(dir, MARKER), JSON.stringify({ skill: "s" }));
}

describe("discoverWorkflows", () => {
  let root: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "op-disc-"));
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("returns [] for a non-existent root", () => {
    expect(discoverWorkflows(path.join(root, "nope"))).toEqual([]);
  });

  it("finds nested workflows as relative slash paths, sorted", () => {
    mkWorkflow(root, "paid-research-hustles");
    mkWorkflow(root, "supersurf/outreach/reddit");
    expect(discoverWorkflows(root)).toEqual([
      "paid-research-hustles",
      "supersurf/outreach/reddit",
    ]);
  });

  it("does not descend into pruned dirs", () => {
    // a marker buried inside work/ must NOT be discovered
    const buried = path.join(root, "wf", "work", "snapshot");
    fs.mkdirSync(path.join(buried, ".looopy"), { recursive: true });
    fs.writeFileSync(path.join(buried, MARKER), "{}");
    mkWorkflow(root, "wf");
    expect(discoverWorkflows(root)).toEqual(["wf"]);
  });

  it("prunes .looopy and ignores dirs without a config marker", () => {
    const root2 = fs.mkdtempSync(path.join(os.tmpdir(), "op-prune-"));
    try {
      fs.mkdirSync(path.join(root2, "wf", ".looopy"), { recursive: true });
      fs.writeFileSync(path.join(root2, "wf", ".looopy", "config.json"),
        JSON.stringify({ skill: "x", params: [] }));
      // a stray .looopy with only a ledger, no config -> not a workflow
      fs.mkdirSync(path.join(root2, "bare", ".looopy"), { recursive: true });
      fs.writeFileSync(path.join(root2, "bare", ".looopy", "runs.jsonl"), "");
      expect(discoverWorkflows(root2)).toEqual(["wf"]);
    } finally {
      fs.rmSync(root2, { recursive: true, force: true });
    }
  });
});

describe("isWorkflow", () => {
  it("is true only when the marker exists", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "op-isw-"));
    expect(isWorkflow(dir)).toBe(false);
    fs.mkdirSync(path.join(dir, ".looopy"), { recursive: true });
    fs.writeFileSync(path.join(dir, MARKER), "{}");
    expect(isWorkflow(dir)).toBe(true);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
