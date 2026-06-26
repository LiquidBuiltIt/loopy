import os from "node:os";
import path from "node:path";
import { DEFAULT_HOME_SUBPATH } from "./constants.js";

export function resolveRoot(
  env: NodeJS.ProcessEnv = process.env,
  home: string = os.homedir(),
): string {
  const override = env.OPERATOR_ROOT?.trim();
  if (override) {
    const expanded = override.startsWith("~")
      ? path.join(home, override.slice(1))
      : override;
    return path.resolve(expanded);
  }
  return path.join(home, DEFAULT_HOME_SUBPATH);
}
