import { describe, it, expect } from "vitest";
import { resolveRoot } from "../src/paths.js";

describe("resolveRoot", () => {
  it("defaults to <home>/Agents/Operator", () => {
    expect(resolveRoot({}, "/home/alice")).toBe("/home/alice/Agents/Operator");
  });

  it("honors OPERATOR_ROOT override", () => {
    expect(resolveRoot({ OPERATOR_ROOT: "/srv/wf" }, "/home/alice")).toBe(
      "/srv/wf",
    );
  });

  it("expands a leading ~ in OPERATOR_ROOT", () => {
    expect(resolveRoot({ OPERATOR_ROOT: "~/wf" }, "/home/alice")).toBe(
      "/home/alice/wf",
    );
  });

  it("ignores an empty OPERATOR_ROOT", () => {
    expect(resolveRoot({ OPERATOR_ROOT: "" }, "/home/alice")).toBe(
      "/home/alice/Agents/Operator",
    );
  });
});
