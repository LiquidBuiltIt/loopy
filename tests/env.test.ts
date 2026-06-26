import { describe, it, expect } from "vitest";
import { buildChildEnv } from "../src/env.js";

describe("buildChildEnv", () => {
  it("always deletes CLAUDECODE", () => {
    const out = buildChildEnv({ CLAUDECODE: "1", PATH: "/bin" });
    expect(out.CLAUDECODE).toBeUndefined();
    expect(out.PATH).toBe("/bin");
  });

  it("strips auth keys by default", () => {
    const out = buildChildEnv({
      ANTHROPIC_API_KEY: "sk-x",
      CLAUDE_CODE_OAUTH_TOKEN: "tok",
    });
    expect(out.ANTHROPIC_API_KEY).toBeUndefined();
    expect(out.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined();
  });

  it("keeps auth keys when declared", () => {
    const out = buildChildEnv(
      { ANTHROPIC_API_KEY: "sk-x" },
      ["ANTHROPIC_API_KEY"],
    );
    expect(out.ANTHROPIC_API_KEY).toBe("sk-x");
  });

  it("does not mutate the input env", () => {
    const base = { CLAUDECODE: "1" };
    buildChildEnv(base);
    expect(base.CLAUDECODE).toBe("1");
  });
});
