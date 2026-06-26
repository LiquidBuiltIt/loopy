import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { validateWorkflow } from "../src/validate.js";

function writeConfig(dir: string, cfg: unknown) {
  fs.mkdirSync(path.join(dir, ".looopy"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, ".looopy/config.json"),
    JSON.stringify(cfg, null, 2),
  );
}

function writeSkill(dir: string, skillName: string, frontmatterName?: string) {
  const skillDir = path.join(dir, ".claude/skills", skillName);
  fs.mkdirSync(skillDir, { recursive: true });
  const name = frontmatterName ?? skillName;
  fs.writeFileSync(
    path.join(skillDir, "SKILL.md"),
    `---\nname: ${name}\n---\n# ${name}\n`,
  );
}

describe("validateWorkflow", () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "op-validate-"));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("passes a fully valid config with skill on disk", () => {
    writeConfig(dir, { skill: "my-skill", version: "1.0.0", params: [{ name: "profile", required: true, description: "desc" }] });
    writeSkill(dir, "my-skill");
    const result = validateWorkflow(dir);
    expect(result.ok).toBe(true);
    expect(result.checks.every((c) => c.pass)).toBe(true);
  });

  it("fails when version is missing", () => {
    writeConfig(dir, { skill: "my-skill", params: [] });
    writeSkill(dir, "my-skill");
    const result = validateWorkflow(dir);
    expect(result.ok).toBe(false);
    const configCheck = result.checks.find((c) => c.label === "config exists & parses");
    expect(configCheck?.pass).toBe(false);
  });

  it("fails when config.json is missing", () => {
    const result = validateWorkflow(dir);
    expect(result.ok).toBe(false);
    const configCheck = result.checks.find((c) => c.label === "config exists & parses");
    expect(configCheck?.pass).toBe(false);
  });

  it("fails when skill is empty string", () => {
    writeConfig(dir, { skill: "", params: [] });
    const result = validateWorkflow(dir);
    expect(result.ok).toBe(false);
    // config will fail to parse (skill must be non-empty per schema) — OR
    // if we allow empty for raw JSON, the skill check fails
    const failing = result.checks.filter((c) => !c.pass);
    expect(failing.length).toBeGreaterThan(0);
  });

  it("fails when named skill has no SKILL.md on disk", () => {
    writeConfig(dir, { skill: "ghost-skill", version: "1.0.0", params: [] });
    // No skill dir written
    const result = validateWorkflow(dir);
    expect(result.ok).toBe(false);
    const skillCheck = result.checks.find((c) => c.label === "skill exists on disk");
    expect(skillCheck?.pass).toBe(false);
  });

  it("passes when skill is found via frontmatter name (dir name differs)", () => {
    // dir name is "skill-dir" but frontmatter name is "my-skill"
    writeConfig(dir, { skill: "my-skill", version: "1.0.0", params: [] });
    writeSkill(dir, "skill-dir", "my-skill");
    const result = validateWorkflow(dir);
    expect(result.ok).toBe(true);
    const skillCheck = result.checks.find((c) => c.label === "skill exists on disk");
    expect(skillCheck?.pass).toBe(true);
  });

  it("is valid WITH descriptions (descriptions are fine but not required)", () => {
    writeConfig(dir, {
      skill: "my-skill",
      version: "1.0.0",
      params: [{ name: "profile", required: true, description: "the profile" }],
    });
    writeSkill(dir, "my-skill");
    const result = validateWorkflow(dir);
    expect(result.ok).toBe(true);
  });

  it("is valid WITHOUT descriptions (descriptions are optional)", () => {
    writeConfig(dir, {
      skill: "my-skill",
      version: "1.0.0",
      params: [{ name: "profile", required: true }],
    });
    writeSkill(dir, "my-skill");
    const result = validateWorkflow(dir);
    expect(result.ok).toBe(true);
  });

  it("reports param count in checks", () => {
    writeConfig(dir, {
      skill: "my-skill",
      version: "1.0.0",
      params: [
        { name: "profile", required: true },
        { name: "target", required: false },
      ],
    });
    writeSkill(dir, "my-skill");
    const result = validateWorkflow(dir);
    const paramCheck = result.checks.find((c) => c.label === "params");
    expect(paramCheck?.pass).toBe(true);
    expect(paramCheck?.detail).toContain("2");
  });
});
