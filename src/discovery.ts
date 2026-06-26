import fs from "node:fs";
import path from "node:path";
import { CONFIG_FILENAME, PRUNE_DIRS } from "./constants.js";

export function isWorkflow(dir: string): boolean {
  return fs.existsSync(path.join(dir, CONFIG_FILENAME));
}

export function discoverWorkflows(root: string): string[] {
  const found: string[] = [];

  function walk(absDir: string) {
    if (isWorkflow(absDir)) {
      const rel = path.relative(root, absDir);
      if (rel !== "") found.push(rel.split(path.sep).join("/"));
    }
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(absDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (PRUNE_DIRS.includes(entry.name)) continue;
      walk(path.join(absDir, entry.name));
    }
  }

  if (!fs.existsSync(root)) return [];
  walk(root);
  return found.sort();
}
