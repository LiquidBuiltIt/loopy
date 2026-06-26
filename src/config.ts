import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { CONFIG_FILENAME } from "./constants.js";

export type ParamSpec = { name: string; required: boolean; description?: string };
export type WorkflowConfig = { skill: string; version: string; params: ParamSpec[] };

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

const ParamSchema = z.object({
  name: z.string().min(1),
  required: z.boolean().default(false),
  description: z.string().optional(),
});

const ConfigSchema = z.object({
  skill: z.string().min(1),
  version: z.string().min(1, "version is required (e.g. \"0.1.0\")"),
  params: z.array(ParamSchema).default([]),
});

export function parseConfig(raw: unknown): WorkflowConfig {
  const result = ConfigSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new ConfigError(`Invalid ${CONFIG_FILENAME}:\n${issues}`);
  }
  return result.data;
}

export function loadConfig(workflowDir: string): WorkflowConfig {
  const file = path.join(workflowDir, CONFIG_FILENAME);
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    throw new ConfigError(`No ${CONFIG_FILENAME} found in ${workflowDir}`);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    throw new ConfigError(`Malformed JSON in ${file}: ${(e as Error).message}`);
  }
  return parseConfig(raw);
}
