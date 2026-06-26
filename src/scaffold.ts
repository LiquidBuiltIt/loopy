import fs from "node:fs";
import path from "node:path";
import { CONFIG_FILENAME, ROOT_MARKER } from "./constants.js";

export class ScaffoldError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScaffoldError";
  }
}

const STARTER_CLAUDE_MD = `# Operator Workflow Library

This is your Operator workflow home. Each subdirectory containing a
\`${CONFIG_FILENAME}\` file is a callable workflow:

    looopy run <path> [--key=value ...] "optional note"

Create one with: \`looopy new <name>\`
`;

export function initHome(root: string): { root: string; created: string[] } {
  fs.mkdirSync(root, { recursive: true });
  const created: string[] = [];

  const marker = path.join(root, ROOT_MARKER);
  if (!fs.existsSync(marker)) {
    fs.writeFileSync(marker, JSON.stringify({ schemaVersion: 0 }, null, 2));
    created.push(marker);
  }

  const claudeMd = path.join(root, "CLAUDE.md");
  if (!fs.existsSync(claudeMd)) {
    fs.writeFileSync(claudeMd, STARTER_CLAUDE_MD);
    created.push(claudeMd);
  }

  return { root, created };
}

export function newWorkflow(root: string, name: string): string {
  if (!name || path.isAbsolute(name) || name.split("/").includes("..")) {
    throw new ScaffoldError(`invalid workflow name: "${name}"`);
  }
  const dir = path.join(root, name);
  const cfg = path.join(dir, CONFIG_FILENAME);
  if (fs.existsSync(cfg)) {
    throw new ScaffoldError(`workflow already exists: ${name}`);
  }
  fs.mkdirSync(path.dirname(cfg), { recursive: true });
  fs.writeFileSync(cfg, JSON.stringify({ skill: "", version: "0.1.0", params: [] }, null, 2));
  return dir;
}
