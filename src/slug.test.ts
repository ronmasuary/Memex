import { describe, expect, it } from "vitest";
import { assertSafeFilename, InvalidNameError, isReservedName, makeSlug, slugify, uniqueSlug } from "./slug.js";

describe("slugify", () => {
  it("lowercases, strips accents and collapses punctuation to single dashes", () => {
    expect(slugify("  Storage Décision: Why SQLite?! ")).toBe("storage-decision-why-sqlite");
    expect(slugify("a___b---c")).toBe("a-b-c");
  });

  it("caps at 60 chars without a trailing dash", () => {
    const slug = slugify(`${"word ".repeat(30)}end`);
    expect(slug.length).toBeLessThanOrEqual(60);
    expect(slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  it("gives non-ASCII titles a stable hash slug and rejects empty titles", () => {
    expect(makeSlug("שלום עולם")).toMatch(/^note-[0-9a-f]{8}$/);
    expect(makeSlug("שלום עולם")).toBe(makeSlug("שלום עולם"));
    expect(() => makeSlug("   ")).toThrow(InvalidNameError);
  });
});

describe("filename safety", () => {
  it("suffixes on collision and keeps the suffix inside the length cap", () => {
    const taken = new Set(["storage", "storage-2"]);
    expect(uniqueSlug("storage", (s) => taken.has(s))).toBe("storage-3");
    const long = "a".repeat(60);
    const next = uniqueSlug(long, (s) => s === long);
    expect(next).toHaveLength(60);
    expect(next.endsWith("-2")).toBe(true);
  });

  it("rejects Windows reserved names with and without an extension", () => {
    const reserved = ["con", "prn", "aux", "nul", ..."123456789".split("").flatMap((n) => [`com${n}`, `lpt${n}`])];
    for (const name of reserved) {
      expect(isReservedName(name), name).toBe(true);
      expect(isReservedName(`${name}.md`), `${name}.md`).toBe(true);
      expect(() => makeSlug(name), name).toThrow(InvalidNameError);
      expect(() => assertSafeFilename(`${name.toUpperCase()}.txt`)).toThrow(InvalidNameError);
    }
    expect(isReservedName("console")).toBe(false);
    expect(isReservedName("com10")).toBe(false);
  });

  it('rejects <>:"|?* and trailing dots/spaces in names, and strips them from slugs', () => {
    for (const bad of ["a<b", "a>b", "a:b", 'a"b', "a|b", "a?b", "a*b", "a/b", "a\\b", "trail.", "trail "]) {
      expect(() => assertSafeFilename(bad), bad).toThrow(InvalidNameError);
    }
    expect(makeSlug('what: <is> "this"|? * ...  ')).toBe("what-is-this");
  });
});
