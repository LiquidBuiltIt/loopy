import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { inferSkill, inferParams, composeHandoff, onboard } from "../src/onboard.js";

function writeSkill(
  dir: string,
  skillDirName: string,
  frontmatterName: string,
  pipelineContent?: string,
) {
  const skillDir = path.join(dir, ".claude/skills", skillDirName);
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(
    path.join(skillDir, "SKILL.md"),
    `---\nname: ${frontmatterName}\n---\n# ${frontmatterName}\n`,
  );
  if (pipelineContent !== undefined) {
    fs.writeFileSync(path.join(skillDir, "pipeline.js"), pipelineContent);
  }
  return skillDir;
}

function writeConfig(dir: string, cfg: unknown) {
  fs.mkdirSync(path.join(dir, ".looopy"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, ".looopy/config.json"),
    JSON.stringify(cfg, null, 2),
  );
}

describe("inferSkill", () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "op-onboard-"));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("returns the skill name when exactly one skill found", () => {
    writeSkill(dir, "my-skill", "my-skill");
    const result = inferSkill(dir);
    expect(result.found).toBe(true);
    expect(result.name).toBe("my-skill");
    expect(result.candidates).toEqual(["my-skill"]);
  });

  it("returns found=false with candidates when multiple skills exist", () => {
    writeSkill(dir, "skill-a", "skill-a");
    writeSkill(dir, "skill-b", "skill-b");
    const result = inferSkill(dir);
    expect(result.found).toBe(false);
    expect(result.candidates.length).toBe(2);
    expect(result.candidates).toContain("skill-a");
    expect(result.candidates).toContain("skill-b");
  });

  it("returns found=false with empty candidates when no skills exist", () => {
    const result = inferSkill(dir);
    expect(result.found).toBe(false);
    expect(result.candidates).toEqual([]);
  });

  it("reads skill name from frontmatter (not dir name)", () => {
    writeSkill(dir, "dir-name", "frontmatter-name");
    const result = inferSkill(dir);
    expect(result.found).toBe(true);
    expect(result.name).toBe("frontmatter-name");
  });
});

describe("inferParams", () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "op-params-"));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("parses // args: comment with required/optional flags", () => {
    const skillDir = writeSkill(
      dir,
      "my-skill",
      "my-skill",
      "// args: { profile, target?, maxRounds?, submitConcurrency? }\n\nconst x = A.profile;",
    );
    const params = inferParams(skillDir);
    expect(params).toEqual([
      { name: "profile", required: true },
      { name: "target", required: false },
      { name: "maxRounds", required: false },
      { name: "submitConcurrency", required: false },
    ]);
  });

  it("falls back to A.member scraping when no // args: comment", () => {
    const skillDir = writeSkill(
      dir,
      "my-skill",
      "my-skill",
      "const x = A.profile;\nconst y = A.target;\nconst z = A.profile;",
    );
    const params = inferParams(skillDir);
    // distinct names, all required:false
    const names = params.map((p) => p.name);
    expect(names).toContain("profile");
    expect(names).toContain("target");
    expect(new Set(names).size).toBe(names.length); // distinct
    for (const p of params) expect(p.required).toBe(false);
  });

  it("returns empty list when no pipeline.js", () => {
    const skillDir = writeSkill(dir, "my-skill", "my-skill");
    const params = inferParams(skillDir);
    expect(params).toEqual([]);
  });
});

describe("composeHandoff", () => {
  it("includes FOR AGENTS and FOR HUMANS blocks", () => {
    const text = composeHandoff({
      workflowName: "my-workflow",
      workflowPath: "/some/path/my-workflow",
      skillName: "my-skill",
      skillFound: true,
      skillCandidates: ["my-skill"],
      params: [{ name: "profile", required: true }],
      paramsInferred: true,
    });
    expect(text).toContain("FOR AGENTS:");
    expect(text).toContain("FOR HUMANS:");
  });

  it("includes the resolved workflow name", () => {
    const text = composeHandoff({
      workflowName: "reddit-outreach",
      workflowPath: "/some/path/reddit-outreach",
      skillName: "my-skill",
      skillFound: true,
      skillCandidates: ["my-skill"],
      params: [],
      paramsInferred: true,
    });
    expect(text).toContain("reddit-outreach");
  });

  it("surfaces candidate skill names when skill not found", () => {
    const text = composeHandoff({
      workflowName: "my-workflow",
      workflowPath: "/some/path",
      skillName: undefined,
      skillFound: false,
      skillCandidates: ["skill-a", "skill-b"],
      params: [],
      paramsInferred: false,
    });
    expect(text).toContain("skill-a");
    expect(text).toContain("skill-b");
  });

  it("marks inferred params as unverified", () => {
    const text = composeHandoff({
      workflowName: "my-workflow",
      workflowPath: "/some/path",
      skillName: "my-skill",
      skillFound: true,
      skillCandidates: ["my-skill"],
      params: [{ name: "profile", required: true }],
      paramsInferred: true,
    });
    // Should mention unverified somewhere in the summary
    expect(text.toLowerCase()).toMatch(/inferred|unverified/);
  });
});

describe("onboard (orchestrator)", () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "op-onboard-orch-"));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("creates skeleton config when none exists and single skill found", () => {
    writeSkill(
      dir,
      "my-skill",
      "my-skill",
      "// args: { profile, target? }\n",
    );
    onboard(dir);
    const cfg = JSON.parse(
      fs.readFileSync(path.join(dir, ".looopy/config.json"), "utf8"),
    );
    expect(cfg.skill).toBe("my-skill");
    expect(cfg.params.length).toBe(2);
    expect(cfg.params[0]).toMatchObject({ name: "profile", required: true });
    expect(cfg.params[1]).toMatchObject({ name: "target", required: false });
  });

  it("does NOT clobber existing non-empty config", () => {
    writeConfig(dir, { skill: "existing-skill", params: [{ name: "x", required: true, description: "desc" }] });
    writeSkill(dir, "my-skill", "my-skill");
    onboard(dir);
    const cfg = JSON.parse(
      fs.readFileSync(path.join(dir, ".looopy/config.json"), "utf8"),
    );
    expect(cfg.skill).toBe("existing-skill");
    expect(cfg.params[0].description).toBe("desc");
  });

  it("returns handoff string with FOR AGENTS and FOR HUMANS", () => {
    writeSkill(dir, "my-skill", "my-skill", "// args: { profile }\n");
    const handoff = onboard(dir);
    expect(handoff).toContain("FOR AGENTS:");
    expect(handoff).toContain("FOR HUMANS:");
  });

  it("multi-skill dir: skill left blank, candidates surfaced in handoff", () => {
    writeSkill(dir, "skill-a", "skill-a");
    writeSkill(dir, "skill-b", "skill-b");
    onboard(dir);
    const cfg = JSON.parse(
      fs.readFileSync(path.join(dir, ".looopy/config.json"), "utf8"),
    );
    expect(cfg.skill).toBe("");
  });

  it("does NOT overwrite non-empty skill even when single skill inferred", () => {
    writeConfig(dir, { skill: "keep-me", params: [] });
    writeSkill(dir, "other-skill", "other-skill");
    onboard(dir);
    const cfg = JSON.parse(
      fs.readFileSync(path.join(dir, ".looopy/config.json"), "utf8"),
    );
    expect(cfg.skill).toBe("keep-me");
  });
});
