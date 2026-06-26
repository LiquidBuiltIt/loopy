import fs from "node:fs";
import path from "node:path";
import { CONFIG_FILENAME } from "./constants.js";
import type { ParamSpec } from "./config.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SkillInferResult =
  | { found: true; name: string; candidates: string[]; skillDir: string }
  | { found: false; name?: undefined; candidates: string[]; skillDir?: undefined };

export type ComposeHandoffOptions = {
  workflowName: string;
  workflowPath: string;
  skillName: string | undefined;
  skillFound: boolean;
  skillCandidates: string[];
  params: Array<Pick<ParamSpec, "name" | "required">>;
  paramsInferred: boolean;
};

// ---------------------------------------------------------------------------
// Frontmatter parser (minimal — name: field only)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Pure function: inferSkill
// ---------------------------------------------------------------------------

export function inferSkill(dir: string): SkillInferResult {
  const skillsDir = path.join(dir, ".claude/skills");
  if (!fs.existsSync(skillsDir)) {
    return { found: false, candidates: [] };
  }

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(skillsDir, { withFileTypes: true });
  } catch {
    return { found: false, candidates: [] };
  }

  const found: Array<{ name: string; skillDir: string }> = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const skillMd = path.join(skillsDir, entry.name, "SKILL.md");
    if (!fs.existsSync(skillMd)) continue;
    try {
      const content = fs.readFileSync(skillMd, "utf8");
      const name = parseFrontmatterName(content) ?? entry.name;
      found.push({ name, skillDir: path.join(skillsDir, entry.name) });
    } catch {
      continue;
    }
  }

  const candidates = found.map((f) => f.name);

  if (found.length === 1) {
    return { found: true, name: found[0].name, candidates, skillDir: found[0].skillDir };
  }
  return { found: false, candidates };
}

// ---------------------------------------------------------------------------
// Pure function: inferParams
// ---------------------------------------------------------------------------

export function inferParams(skillDir: string): Array<Pick<ParamSpec, "name" | "required">> {
  const pipelinePath = path.join(skillDir, "pipeline.js");
  if (!fs.existsSync(pipelinePath)) return [];

  let content: string;
  try {
    content = fs.readFileSync(pipelinePath, "utf8");
  } catch {
    return [];
  }

  // PRIMARY: look for `// args: { ... }` on any line
  const argsCommentMatch = content.match(/\/\/\s*args:\s*\{([^}]*)\}/);
  if (argsCommentMatch) {
    const inner = argsCommentMatch[1];
    const tokens = inner.split(",").map((t) => t.trim()).filter(Boolean);
    return tokens.map((token) => {
      const optional = token.endsWith("?");
      const name = optional ? token.slice(0, -1) : token;
      return { name: name.trim(), required: !optional };
    });
  }

  // FALLBACK: scrape distinct `A.<member>` accesses
  const memberRe = /\bA\.([A-Za-z_$][\w$]*)/g;
  const seen = new Set<string>();
  const params: Array<Pick<ParamSpec, "name" | "required">> = [];
  let m: RegExpExecArray | null;
  while ((m = memberRe.exec(content)) !== null) {
    const name = m[1];
    if (!seen.has(name)) {
      seen.add(name);
      params.push({ name, required: false });
    }
  }
  return params;
}

// ---------------------------------------------------------------------------
// Pure function: composeHandoff
// ---------------------------------------------------------------------------

export function composeHandoff(opts: ComposeHandoffOptions): string {
  const {
    workflowName,
    workflowPath,
    skillName,
    skillFound,
    skillCandidates,
    params,
    paramsInferred,
  } = opts;

  const skillSummary = skillFound
    ? skillName!
    : skillCandidates.length > 0
      ? `(could not infer — candidates: ${skillCandidates.join(", ")})`
      : "(could not infer — no skills found)";

  const paramSummary =
    params.length === 0
      ? "none inferred"
      : params
          .map((p) => `${p.name} (${p.required ? "required" : "optional"})`)
          .join(", ");

  const paramNote = paramsInferred
    ? " [INFERRED/UNVERIFIED — confirm against pipeline.js]"
    : "";

  const lines: string[] = [];

  lines.push("Scaffold completed!");
  lines.push(`  Workflow path : ${workflowPath}`);
  lines.push(`  Inferred skill: ${skillSummary}`);
  lines.push(`  Inferred params: ${paramSummary}${paramNote}`);
  lines.push("");

  // FOR AGENTS block
  lines.push("FOR AGENTS:");
  lines.push(
    `(1) Verify the inferred skill name "${skillFound ? skillName : "(unknown)"}" exists under ` +
      `${workflowPath}/.claude/skills/ — confirm the SKILL.md frontmatter \`name:\` matches ` +
      `what is written in .looopy/config.json.`,
  );
  lines.push(
    `(2) Confirm each param name and required flag against ${workflowPath}/.claude/skills/${skillFound ? skillName : "<skill>"}/pipeline.js's \`args\` ` +
      `block or \`// args:\` comment — the current params are: ${paramSummary}.`,
  );
  lines.push(
    `(3) Write a one-line description for each param in ${workflowPath}/.looopy/config.json ` +
      `— descriptions are currently missing (they are optional for the tool but help agents invoke correctly).`,
  );
  lines.push(
    `(4) Check the skill's SKILL.md "Invoke" block at ` +
      `${workflowPath}/.claude/skills/${skillFound ? skillName : "<skill>"}/SKILL.md — ` +
      `if it hardcodes example values instead of mapping Workflow \`args\` params, add a one-line note there.`,
  );
  lines.push(
    `(5) Run \`looopy validate ${workflowName}\` to confirm all checks pass.`,
  );
  lines.push("");

  // FOR HUMANS block
  lines.push("FOR HUMANS:");
  lines.push("Copy the FOR AGENTS block into your agent's conversation to finish onboarding.");

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Orchestrator: onboard(dir)
// ---------------------------------------------------------------------------

export function onboard(dir: string): string {
  const workflowName = path.basename(dir);
  const configPath = path.join(dir, CONFIG_FILENAME);
  const configExists = fs.existsSync(configPath);

  // Step 1: read or create skeleton config
  let cfg: { skill: string; version: string; params: Array<Pick<ParamSpec, "name" | "required" | "description">> };

  if (configExists) {
    try {
      cfg = JSON.parse(fs.readFileSync(configPath, "utf8"));
    } catch {
      cfg = { skill: "", version: "0.1.0", params: [] };
    }
  } else {
    cfg = { skill: "", version: "0.1.0", params: [] };
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2));
  }

  // Seed a version on a pre-existing config that predates the field.
  if (!cfg.version) cfg.version = "0.1.0";

  // Step 2: infer skill
  const skillResult = inferSkill(dir);
  let paramsInferred = false;

  // Write skill into config only if config.skill is currently empty
  if (skillResult.found && cfg.skill === "") {
    cfg.skill = skillResult.name;
  }

  // Step 3: infer params from the chosen skill's pipeline.js
  let inferredParams: Array<Pick<ParamSpec, "name" | "required">> = [];
  if (skillResult.found) {
    inferredParams = inferParams(skillResult.skillDir);
    paramsInferred = true;
  }

  // Write inferred params into config ONLY if config currently has zero params
  if (cfg.params.length === 0 && inferredParams.length > 0) {
    cfg.params = inferredParams;
  }

  // Persist updated config
  fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2));

  // Step 4: compose and return handoff
  return composeHandoff({
    workflowName,
    workflowPath: dir,
    skillName: skillResult.found ? skillResult.name : undefined,
    skillFound: skillResult.found,
    skillCandidates: skillResult.candidates,
    params: cfg.params,
    paramsInferred,
  });
}
