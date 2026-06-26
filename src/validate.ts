import fs from "node:fs";
import path from "node:path";
import { loadConfig, ConfigError } from "./config.js";

export type CheckResult = { label: string; pass: boolean; detail?: string };
export type ValidationResult = { ok: boolean; checks: CheckResult[] };

/**
 * Parse the `name:` field from YAML frontmatter (the block between the first
 * two `---` lines). Returns undefined if no name found.
 */
function parseFrontmatterName(content: string): string | undefined {
  const lines = content.split("\n");
  let inFrontmatter = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === "---") {
      if (!inFrontmatter) {
        inFrontmatter = true;
        continue;
      } else {
        break;
      }
    }
    if (inFrontmatter) {
      const m = trimmed.match(/^name:\s*(.+)$/);
      if (m) return m[1].trim();
    }
  }
  return undefined;
}

/**
 * Check whether a skill exists on disk under <dir>/.claude/skills/.
 * First looks for an exact dir-name match, then scans all skill dirs for a
 * frontmatter `name:` field matching the requested skill.
 */
function skillExistsOnDisk(dir: string, skill: string): { found: boolean; detail: string } {
  const exactPath = path.join(dir, ".claude/skills", skill, "SKILL.md");
  if (fs.existsSync(exactPath)) {
    return { found: true, detail: `found at .claude/skills/${skill}/SKILL.md` };
  }

  // Scan all skills for frontmatter name match
  const skillsDir = path.join(dir, ".claude/skills");
  if (!fs.existsSync(skillsDir)) {
    return { found: false, detail: `no .claude/skills directory found` };
  }

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(skillsDir, { withFileTypes: true });
  } catch {
    return { found: false, detail: `cannot read .claude/skills` };
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const skillMd = path.join(skillsDir, entry.name, "SKILL.md");
    if (!fs.existsSync(skillMd)) continue;
    try {
      const content = fs.readFileSync(skillMd, "utf8");
      const name = parseFrontmatterName(content);
      if (name === skill) {
        return {
          found: true,
          detail: `found via frontmatter name in .claude/skills/${entry.name}/SKILL.md`,
        };
      }
    } catch {
      continue;
    }
  }

  return { found: false, detail: `no skill named "${skill}" found in .claude/skills/` };
}

export function validateWorkflow(dir: string): ValidationResult {
  const checks: CheckResult[] = [];

  // Check 1: config exists and parses
  let config;
  try {
    config = loadConfig(dir);
    checks.push({ label: "config exists & parses", pass: true, detail: "OK" });
  } catch (e) {
    const msg = e instanceof ConfigError ? e.message : String(e);
    checks.push({ label: "config exists & parses", pass: false, detail: msg });
    // Remaining checks are meaningless without a config
    checks.push({ label: "version present", pass: false, detail: "skipped (config failed)" });
    checks.push({ label: "skill non-empty", pass: false, detail: "skipped (config failed)" });
    checks.push({ label: "skill exists on disk", pass: false, detail: "skipped (config failed)" });
    checks.push({ label: "params", pass: false, detail: "skipped (config failed)" });
    return { ok: false, checks };
  }

  // Check: version is present (schema enforces this; surfaced as a visible check)
  const hasVersion = config.version.length > 0;
  checks.push({
    label: "version present",
    pass: hasVersion,
    detail: hasVersion ? `version = "${config.version}"` : "version is missing",
  });

  // Check 2: skill is non-empty (schema already enforces this, but belt+suspenders)
  const skillNonEmpty = config.skill.length > 0;
  checks.push({
    label: "skill non-empty",
    pass: skillNonEmpty,
    detail: skillNonEmpty ? `skill = "${config.skill}"` : "skill is empty",
  });

  // Check 3: skill exists on disk
  if (skillNonEmpty) {
    const { found, detail } = skillExistsOnDisk(dir, config.skill);
    checks.push({ label: "skill exists on disk", pass: found, detail });
  } else {
    checks.push({
      label: "skill exists on disk",
      pass: false,
      detail: "skipped (skill is empty)",
    });
  }

  // Check 4: params (always pass — schema guarantees validity; just report count)
  checks.push({
    label: "params",
    pass: true,
    detail: `${config.params.length} param(s) defined`,
  });

  const ok = checks.every((c) => c.pass);
  return { ok, checks };
}
