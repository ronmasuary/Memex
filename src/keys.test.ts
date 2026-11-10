import { describe, expect, it } from "vitest";
import { suggestExistingKey } from "./keys.js";
import type { ConflictNote } from "./conflicts.js";

const OLD = "2026-10-01T10:00:00.000Z";

/** An existing note with a given key/project/status; body is irrelevant to key suggestion. */
function note(id: string, key: string, project = "memex", status = "active"): ConflictNote {
  return { id, key, project, status, updated: OLD, body: "x" };
}

interface KeyCase {
  name: string;
  candidateKey: string;
  project?: string;
  existing: ConflictNote[];
  /** The stored key we expect to be nudged toward, or null for silence. */
  expect: string | null;
}

const CASES: KeyCase[] = [
  // POSITIVE — near-certainly one name spelled two ways, MUST nudge.
  { name: "p1: separator-only datastore -> data-store", candidateKey: "datastore", existing: [note("a", "data-store")], expect: "data-store" },
  { name: "p2: separator-only data-store -> datastore (symmetric)", candidateKey: "data-store", existing: [note("a", "datastore")], expect: "datastore" },
  { name: "p3: underscore spelling nudges toward the unseparated key", candidateKey: "Data_Store", existing: [note("a", "datastore")], expect: "datastore" },
  { name: "p4: initialism ci -> continuous-integration", candidateKey: "ci", existing: [note("a", "continuous-integration")], expect: "continuous-integration" },
  { name: "p5: initialism continuous-integration -> ci (symmetric)", candidateKey: "continuous-integration", existing: [note("a", "ci")], expect: "ci" },
  { name: "p6: initialism api -> application-programming-interface", candidateKey: "api", existing: [note("a", "application-programming-interface")], expect: "application-programming-interface" },
  { name: "p7: nudges toward a conflict-status note too (mirrors findConflictPairs)", candidateKey: "datastore", existing: [note("a", "data-store", "memex", "conflict")], expect: "data-store" },

  // NEGATIVE — must stay SILENT (the under-suggest bias; a bad nudge trains authors to ignore nudges).
  { name: "n1: token subset storage vs storage-choice (likely a different fact)", candidateKey: "storage", existing: [note("a", "storage-choice")], expect: null },
  { name: "n2: token subset auth vs auth-timeout", candidateKey: "auth", existing: [note("a", "auth-timeout")], expect: null },
  { name: "n3: token subset db-host vs db-host-port", candidateKey: "db-host", existing: [note("a", "db-host-port")], expect: null },
  { name: "n4: single-char edit cost vs cast (typo or different word — can't tell)", candidateKey: "cost", existing: [note("a", "cast")], expect: null },
  { name: "n5: single-char edit prod vs prot", candidateKey: "prod", existing: [note("a", "prot")], expect: null },
  { name: "n6: single-char edit west vs best", candidateKey: "west", existing: [note("a", "best")], expect: null },
  { name: "n7: abbreviation-shaped cat vs catalog (unrelated short word)", candidateKey: "cat", existing: [note("a", "catalog")], expect: null },
  { name: "n8: abbreviation-shaped con vs console", candidateKey: "con", existing: [note("a", "console")], expect: null },
  { name: "n9: abbreviation-shaped app vs applepay", candidateKey: "app", existing: [note("a", "applepay")], expect: null },
  { name: "n10: abbreviation-shaped db vs database (deliberate miss)", candidateKey: "db", existing: [note("a", "database")], expect: null },
  { name: "n11: unrelated storage vs schedule", candidateKey: "storage", existing: [note("a", "schedule")], expect: null },
  { name: "n12: exact match never nudges", candidateKey: "storage", existing: [note("a", "storage")], expect: null },
  { name: "n13: exact match after normalization never nudges", candidateKey: "Storage-Choice", existing: [note("a", "storage-choice")], expect: null },
  { name: "n14: similar key but different project", candidateKey: "datastore", existing: [note("a", "data-store", "other-project")], expect: null },
  { name: "n15: superseded existing note is ignored", candidateKey: "datastore", existing: [{ ...note("a", "data-store"), status: "superseded" }], expect: null },
  { name: "n16: no candidate key at all", candidateKey: "", existing: [note("a", "data-store")], expect: null },
];

describe("write-time key nudge (suggestExistingKey)", () => {
  it.each(CASES)("$name", ({ candidateKey, project, existing, expect: expected }) => {
    expect(suggestExistingKey(candidateKey, existing, project ?? "memex")).toBe(expected);
  });

  it("keeps silence the dominant outcome (under-suggest bias)", () => {
    const silent = CASES.filter((c) => c.expect === null).length;
    expect(silent).toBeGreaterThan(CASES.length / 2);
  });

  it("prefers the stronger signal when several keys match", () => {
    // `c-i` is a separator-only match (0.95) for candidate `ci`; `continuous-integration` is only an
    // initialism (0.9). The stronger match wins, so output never depends on iteration order.
    const existing = [note("weak", "continuous-integration"), note("strong", "c-i")];
    expect(suggestExistingKey("ci", existing, "memex")).toBe("c-i");
  });
});
