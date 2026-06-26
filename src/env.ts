const AUTH_KEYS = ["ANTHROPIC_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN"];

export function buildChildEnv(
  base: NodeJS.ProcessEnv,
  declared: string[] = [],
): NodeJS.ProcessEnv {
  const env = { ...base };
  delete env.CLAUDECODE;
  for (const key of AUTH_KEYS) {
    if (!declared.includes(key)) delete env[key];
  }
  return env;
}
