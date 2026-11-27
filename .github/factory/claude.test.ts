import { describe, expect, it } from "vitest";
import { fill } from "./claude";

describe("fill", () => {
  it("replaces every placeholder with its value", () => {
    expect(fill("{{A}} and {{B}}, {{A}} again", { A: "one", B: "two" })).toBe(
      "one and two, one again",
    );
  });

  it("throws on a placeholder with no value", () => {
    expect(() => fill("{{A}} and {{B}}", { A: "one" })).toThrow(
      "No value for {{B}}.",
    );
  });
});
