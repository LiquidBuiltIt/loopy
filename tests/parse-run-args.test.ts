import { describe, it, expect } from "vitest";
import { parseRunArgs, isClaudeMissingMessage } from "../src/cli.js";

describe("parseRunArgs", () => {
  it("parses --key=value flags into params", () => {
    expect(parseRunArgs(["--mode=pitch", "--cap=3"])).toEqual({
      params: { mode: "pitch", cap: "3" },
      note: undefined,
    });
  });

  it("captures the first non-flag token as the note", () => {
    expect(parseRunArgs(["--mode=pitch", "skip r/startups"])).toEqual({
      params: { mode: "pitch" },
      note: "skip r/startups",
    });
  });

  it("allows = inside the value", () => {
    expect(parseRunArgs(["--q=a=b"])).toEqual({
      params: { q: "a=b" },
      note: undefined,
    });
  });

  it("throws on a --flag without =", () => {
    expect(() => parseRunArgs(["--bare"])).toThrow();
  });
});

describe("isClaudeMissingMessage", () => {
  it("returns true for a message containing 'on PATH'", () => {
    expect(
      isClaudeMissingMessage(
        "could not run `claude` — is Claude Code installed and on PATH?",
      ),
    ).toBe(true);
  });

  it("returns false for an unrelated user-error message", () => {
    expect(isClaudeMissingMessage("missing required param: intent")).toBe(false);
  });

  it("returns false for an unknown-workflow message", () => {
    expect(isClaudeMissingMessage("unknown workflow: foo")).toBe(false);
  });
});
