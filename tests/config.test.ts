import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  parseConfig,
  loadConfig,
  ConfigError,
  type WorkflowConfig,
} from "../src/config.js";

describe("parseConfig", () => {
  it("parses a valid config", () => {
    const cfg: WorkflowConfig = parseConfig({
      skill: "outreach-orchestrator",
      version: "1.0.0",
      params: [{ name: "mode", required: true }],
    });
    expect(cfg.skill).toBe("outreach-orchestrator");
    expect(cfg.version).toBe("1.0.0");
    expect(cfg.params).toEqual([{ name: "mode", required: true }]);
  });

  it("defaults params to [] and required to false", () => {
    const cfg = parseConfig({ skill: "x", version: "1.0.0", params: [{ name: "a" }] });
    expect(cfg.params).toEqual([{ name: "a", required: false }]);
    const cfg2 = parseConfig({ skill: "x", version: "1.0.0" });
    expect(cfg2.params).toEqual([]);
  });

  it("throws ConfigError when version is missing", () => {
    expect(() => parseConfig({ skill: "x", params: [] })).toThrow(ConfigError);
  });

  it("parses a param with an optional description", () => {
    const cfg = parseConfig({
      skill: "x",
      version: "1.0.0",
      params: [{ name: "profile", required: true, description: "the candidate profile to run the cycle for" }],
    });
    expect(cfg.params).toEqual([
      { name: "profile", required: true, description: "the candidate profile to run the cycle for" },
    ]);
  });

  it("parses a param without description (backward compatible)", () => {
    const cfg = parseConfig({
      skill: "x",
      version: "1.0.0",
      params: [{ name: "mode", required: false }],
    });
    expect(cfg.params[0].description).toBeUndefined();
  });

  it("throws ConfigError when skill is missing", () => {
    expect(() => parseConfig({ params: [] })).toThrow(ConfigError);
  });

  it("throws ConfigError when a param has no name", () => {
    expect(() => parseConfig({ skill: "x", params: [{ required: true }] })).toThrow(
      ConfigError,
    );
  });
});

describe("loadConfig", () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "op-cfg-"));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("loads a config file from a dir", () => {
    fs.mkdirSync(path.join(dir, ".looopy"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, ".looopy/config.json"),
      JSON.stringify({ skill: "s", version: "1.0.0", params: [] }),
    );
    expect(loadConfig(dir).skill).toBe("s");
  });

  it("throws ConfigError when the file is absent", () => {
    expect(() => loadConfig(dir)).toThrow(ConfigError);
  });

  it("throws ConfigError on malformed JSON", () => {
    fs.mkdirSync(path.join(dir, ".looopy"), { recursive: true });
    fs.writeFileSync(path.join(dir, ".looopy/config.json"), "{ not json");
    expect(() => loadConfig(dir)).toThrow(ConfigError);
  });
});
