import { describe, expect, it } from "vitest";
import { suggestExistingKey } from "./keys.js";
import type { ConflictNote } from "./conflicts.js";

const OLD = "2026-10-01T10:00:00.000Z";

/** An active existing note with a given key/project; body is irrelevant to key suggestion. */
function note(id: string, key: string, project = "memex"): ConflictNote {
  return { id, key, project, status: "active", updated: OLD, body: "x" };
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
  // POSITIVE — clearly two spellings of one thing, MUST nudge.
  { name: "p1: abbreviation db -> database", candidateKey: "db", existing: [note("a", "database")], expect: "database" },
  { name: "p2: abbreviation database -> db (symmetric)", candidateKey: "database", existing: [note("a", "db")], expect: "db" },
  { name: "p3: subset storage -> storage-choice", candidateKey: "storage", existing: [note("a", "storage-choice")], expect: "storage-choice" },
  { name: "p4: subset storage-choice -> storage", candidateKey: "storage-choice", existing: [note("a", "storage")], expect: "storage" },
  { name: "p5: dash-only datastore -> data-store", candidateKey: "datastore", existing: [note("a", "data-store")], expect: "data-store" },
  { name: "p6: dash-only data-store -> datastore", candidateKey: "data-store", existing: [note("a", "datastore")], expect: "datastore" },
  { name: "p7: single-char typo databse -> database", candidateKey: "databse", existing: [note("a", "database")], expect: "database" },
  { name: "p8: candidate key spelling is normalized before compare", candidateKey: "Data_Store", existing: [note("a", "datastore")], expect: "datastore" },

  // NEGATIVE — must stay SILENT (the under-suggest bias; a bad nudge trains authors to ignore nudges).
  { name: "n1: unrelated storage vs schedule", candidateKey: "storage", existing: [note("a", "schedule")], expect: null },
  { name: "n2: exact match never nudges", candidateKey: "storage", existing: [note("a", "storage")], expect: null },
  { name: "n3: exact match after normalization never nudges", candidateKey: "Storage-Choice", existing: [note("a", "storage-choice")], expect: null },
  { name: "n4: same key but different project", candidateKey: "database", existing: [note("a", "db", "other-project")], expect: null },
  { name: "n5: only shares one token of several (storage-choice vs storage-decision)", candidateKey: "storage-choice", existing: [note("a", "storage-decision")], expect: null },
  { name: "n6: short unrelated single tokens (api vs app)", candidateKey: "api", existing: [note("a", "app")], expect: null },
  { name: "n7: subsequence but different initial (db vs feedback)", candidateKey: "db", existing: [note("a", "feedback")], expect: null },
  { name: "n8: superseded existing note is ignored", candidateKey: "db", existing: [{ ...note("a", "database"), status: "superseded" }], expect: null },
  { name: "n9: no candidate key at all", candidateKey: "", existing: [note("a", "database")], expect: null },
  { name: "n10: typo gate ignores very short keys (db vs dc)", candidateKey: "db", existing: [note("a", "dc")], expect: null },
];

describe("write-time key nudge (suggestExistingKey)", () => {
  it.each(CASES)("$name", ({ candidateKey, project, existing, expect: expected }) => {
    expect(suggestExistingKey(candidateKey, existing, project ?? "memex")).toBe(expected);
  });

  it("keeps silence the majority outcome (under-suggest bias)", () => {
    const silent = CASES.filter((c) => c.expect === null).length;
    expect(silent).toBeGreaterThan(CASES.length / 2);
  });

  it("prefers the strongest match when several keys are similar", () => {
    // `storage` is a strict-subset match (0.9) for `storage-choice`; `storagr` is only a typo (0.85).
    const existing = [note("weak", "storagr"), note("strong", "storage-choice")];
    expect(suggestExistingKey("storage", existing, "memex")).toBe("storage-choice");
  });
});
