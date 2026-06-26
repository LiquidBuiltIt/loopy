import { describe, it, expect } from "vitest";
import { CONFIG_FILENAME, OPERATOR_DIR, PRUNE_DIRS } from "../src/constants.js";

describe("constants", () => {
  it("config marker lives under the .looopy dir", () => {
    expect(CONFIG_FILENAME).toBe(".looopy/config.json");
    expect(OPERATOR_DIR).toBe(".looopy");
  });
  it("prunes .looopy and ignores dirs without a config marker", () => {
    expect(PRUNE_DIRS).toContain(".looopy");
    expect(PRUNE_DIRS).toContain(".claude");
  });
});
