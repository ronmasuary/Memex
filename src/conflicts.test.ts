import { describe, expect, it } from "vitest";
import { detectConflicts, extractSupersedes } from "./conflicts.js";
import { CASES } from "./conflicts.fixtures.js";

describe("conflict-detection correctness suite", () => {
  it.each(CASES)("$name", ({ existing, candidate, expect: expected, flags }) => {
    const warnings = detectConflicts(candidate, existing);
    if (expected === "flag") {
      expect(warnings.map((w) => w.id)).toEqual([flags]);
      expect(warnings[0]?.message).toContain(flags!);
    } else {
      expect(warnings).toEqual([]);
    }
  });

  it("keeps silence the majority outcome", () => {
    const silent = CASES.filter((c) => c.expect === "silent").length;
    expect(silent).toBeGreaterThan(CASES.length / 2);
  });

  it("parses Supersedes lines", () => {
    expect(extractSupersedes("x\nSupersedes: [[a-b]], c-d")).toEqual(["a-b", "c-d"]);
  });
});
