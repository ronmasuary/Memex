import type { ConflictNote } from "./conflicts.js";

/**
 * Conflict-detection correctness suite fixtures. This file is meant to GROW: every false positive
 * found while dogfooding becomes a new `expect: "silent"` case here. Most cases assert silence on
 * purpose, because a detector that cries wolf is dead within a day.
 */
export interface ConflictCase {
  name: string;
  existing: ConflictNote[];
  candidate: ConflictNote;
  expect: "flag" | "silent";
  /** For `flag` cases: id of the note that must be named in the warning. */
  flags?: string;
}

const OLD = "2026-10-01T10:00:00.000Z";
const NEW = "2026-10-29T10:00:00.000Z";

export const CASES: ConflictCase[] = [
  // (a) same key, different value -> MUST flag
  {
    name: "a1: same key, different database named",
    existing: [{ id: "storage-decision", key: "storage-choice", status: "active", updated: OLD, body: "We store notes in Postgres." }],
    candidate: { id: "storage-update", key: "storage-choice", updated: NEW, body: "We store notes in SQLite." },
    expect: "flag",
    flags: "storage-decision",
  },
  {
    name: "a2: same key, different version number",
    existing: [{ id: "pg-version", key: "pg-version", status: "active", updated: OLD, body: "Production runs 16." }],
    candidate: { id: "pg-version-2", key: "pg-version", updated: NEW, body: "Production runs 15." },
    expect: "flag",
    flags: "pg-version",
  },

  // (b) same key, same value restated differently -> MUST NOT flag
  {
    name: "b1: same fact, reworded, same named value",
    existing: [{ id: "storage-decision", key: "storage-choice", status: "active", updated: OLD, body: "We store notes in Postgres." }],
    candidate: { id: "storage-restated", key: "storage-choice", updated: NEW, body: "Postgres is where all of our notes end up living." },
    expect: "silent",
  },
  {
    name: "b2: identical body modulo whitespace and case",
    existing: [{ id: "a", key: "k", status: "active", updated: OLD, body: "Use Postgres 16." }],
    candidate: { id: "b", key: "k", updated: NEW, body: "use   postgres 16.\n" },
    expect: "silent",
  },
  {
    name: "b3: prose-only rewording with no named values (cannot tell, so stay quiet)",
    existing: [{ id: "tone", key: "reply-tone", status: "active", updated: OLD, body: "answers should be short and direct" }],
    candidate: { id: "tone-2", key: "reply-tone", updated: NEW, body: "keep replies brief and to the point" },
    expect: "silent",
  },
  {
    name: "b4: restatement with an extra unrelated number",
    existing: [{ id: "db", key: "db", status: "active", updated: OLD, body: "Database is Postgres." }],
    candidate: { id: "db-2", key: "db", updated: NEW, body: "Postgres is the database, chosen in 2026." },
    expect: "silent",
  },

  // (c) explicit supersede / newer -> MUST NOT flag
  {
    name: "c1: candidate declares `Supersedes: [[id]]`",
    existing: [{ id: "storage-decision", key: "storage-choice", status: "active", updated: OLD, body: "We store notes in Postgres." }],
    candidate: { id: "storage-v2", key: "storage-choice", updated: NEW, body: "We store notes in SQLite.\n\nSupersedes: [[storage-decision]]" },
    expect: "silent",
  },
  {
    name: "c2: candidate lists `supersedes` in frontmatter-style field",
    existing: [{ id: "storage-decision", key: "storage-choice", status: "active", updated: OLD, body: "We store notes in Postgres." }],
    candidate: { id: "storage-v2", key: "storage-choice", updated: NEW, supersedes: ["storage-decision"], body: "We store notes in SQLite." },
    expect: "silent",
  },
  {
    name: "c3: the existing note is newer than the candidate",
    existing: [{ id: "storage-decision", key: "storage-choice", status: "active", updated: NEW, body: "We store notes in Postgres." }],
    candidate: { id: "storage-old", key: "storage-choice", updated: OLD, body: "We store notes in SQLite." },
    expect: "silent",
  },
  {
    name: "c4: the existing note is already marked conflict",
    existing: [{ id: "storage-decision", key: "storage-choice", status: "conflict", updated: OLD, body: "We store notes in Postgres." }],
    candidate: { id: "storage-v2", key: "storage-choice", updated: NEW, body: "We store notes in SQLite." },
    expect: "silent",
  },

  // (e) same key + different value but DIFFERENT project -> MUST NOT flag (conflicts are per-project)
  {
    name: "e1: same key and differing value across two projects",
    existing: [{ id: "memex-storage", key: "storage-choice", project: "memex", status: "active", updated: OLD, body: "We store notes in SQLite." }],
    candidate: { id: "wikey-storage", key: "storage-choice", project: "wikey", updated: NEW, body: "We store notes in Postgres." },
    expect: "silent",
  },
  {
    name: "e2: same key and differing value within one project still flags",
    existing: [{ id: "memex-storage", key: "storage-choice", project: "memex", status: "active", updated: OLD, body: "We store notes in SQLite." }],
    candidate: { id: "memex-storage-2", key: "storage-choice", project: "memex", updated: NEW, body: "We store notes in Postgres." },
    expect: "flag",
    flags: "memex-storage",
  },

  // (d) similar wording, different key, unrelated -> MUST NOT flag
  {
    name: "d1: near-identical wording under a different key",
    existing: [{ id: "storage-decision", key: "storage-choice", status: "active", updated: OLD, body: "We store notes in Postgres." }],
    candidate: { id: "cache-decision", key: "cache-choice", updated: NEW, body: "We store cache entries in Redis." },
    expect: "silent",
  },
  {
    name: "d2: no key on the candidate at all",
    existing: [{ id: "storage-decision", key: "storage-choice", status: "active", updated: OLD, body: "We store notes in Postgres." }],
    candidate: { id: "scratch", updated: NEW, body: "We store notes in SQLite." },
    expect: "silent",
  },
  {
    name: "d3: updating the same note never conflicts with itself",
    existing: [{ id: "storage-decision", key: "storage-choice", status: "active", updated: OLD, body: "We store notes in Postgres." }],
    candidate: { id: "storage-decision", key: "storage-choice", updated: NEW, body: "We store notes in SQLite." },
    expect: "silent",
  },

  // (f) numeric contradictions must not be lost to differently-phrased prose around the number.
  {
    name: "f1: same numeric fact, different trailing word on each side (unit must be adjacency-only)",
    existing: [{ id: "port-old", key: "service-port", status: "active", updated: OLD, body: "runs on 3000 by default" }],
    candidate: { id: "port-new", key: "service-port", updated: NEW, body: "listens on 8080 now" },
    expect: "flag",
    flags: "port-old",
  },
  {
    name: "f2: a genuinely-attached unit still distinguishes buckets (200ms vs 200 requests is not a clash)",
    existing: [{ id: "lat", key: "budget", status: "active", updated: OLD, body: "latency budget is 200ms" }],
    candidate: { id: "thru", key: "budget", updated: NEW, body: "throughput is 200 per second" },
    expect: "silent",
  },
];
