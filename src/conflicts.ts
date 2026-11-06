import { slugify } from "./slug.js";

/**
 * Deterministic contradiction detection. Deliberately tuned to UNDER-flag: a false positive
 * ("your memory cries wolf") is the failure mode that kills the tool, a miss is merely a miss.
 *
 * A candidate conflicts with an existing note only when ALL of these hold:
 *   1. both carry the same non-empty `key` AND belong to the same `project`;
 *   2. the existing note is active (not `superseded`, not flagged `conflict`) and is not the candidate itself;
 *   3. the candidate does not supersede it (explicit `supersedes:` or the existing note is newer);
 *   4. the bodies differ after normalization;
 *   5. the bodies assert *different values* for the thing the key names. A "value" is a token that
 *      carries a fact: a number, a Capitalized name, a `code` span, or an identifier-like word.
 *      Plain prose differences (a restatement in other words) never count.
 *
 * Bodies with no value tokens on either side are never flagged: we cannot tell a contradiction
 * from a rewording without semantics, and semantics is v0.3 territory.
 */

export interface ConflictNote {
  id: string;
  title?: string;
  key?: string;
  /** Project namespace. Conflicts are scoped per project, so the same key in two projects never cross-flags. */
  project?: string;
  status?: string;
  body: string;
  /** ISO timestamp. */
  updated: string;
  /** Ids this note explicitly supersedes (frontmatter-style; also parsed from the body). */
  supersedes?: string[];
}

/** Project a vault `Note` (or anything shaped like one) down to the fields the detector reads. */
export function toConflictNote(n: {
  id: string;
  title?: string;
  key?: string;
  project?: string;
  status?: string;
  body: string;
  updated: string;
}): ConflictNote {
  return { id: n.id, title: n.title, key: n.key, project: n.project, status: n.status, body: n.body, updated: n.updated };
}

export interface ConflictWarning {
  /** The existing note the candidate may contradict. */
  id: string;
  title?: string;
  key: string;
  /** Value tokens only the existing note asserts. */
  existingValues: string[];
  /** Value tokens only the candidate asserts. */
  candidateValues: string[];
  message: string;
}

const SUPERSEDES_LINE = /^[ \t>*-]*supersedes\s*:\s*(.+)$/gim;
const RECONCILED_LINE = /^[ \t>*-]*reconciled[ -]with\s*:\s*(.+)$/gim;
const WIKILINK_OR_SLUG = /\[\[([^\]|#]+)(?:[#|][^\]]*)?\]\]|([A-Za-z0-9][A-Za-z0-9_-]*)/g;

/** Ids named on `Supersedes: [[a]], b` lines in a note body. */
export function extractSupersedes(body: string): string[] {
  return idsOnLines(body, SUPERSEDES_LINE);
}

function idsOnLines(body: string, lines: RegExp): string[] {
  const ids = new Set<string>();
  for (const line of body.matchAll(lines)) {
    for (const m of (line[1] ?? "").matchAll(WIKILINK_OR_SLUG)) {
      const id = slugify(m[1] ?? m[2] ?? "");
      if (id) ids.add(id);
    }
  }
  return [...ids];
}

/** Ids named on `Reconciled with: [[a]]` lines: a resolved "keep both", which silences the pair for good. */
export function extractReconciled(body: string): string[] {
  return idsOnLines(body, RECONCILED_LINE);
}

function normalizeKey(key: string | undefined): string {
  return key ? slugify(key) : "";
}

function normalizeProject(project: string | undefined): string {
  return (project ?? "").trim().toLowerCase();
}

function normalizeBody(body: string): string {
  return body.toLowerCase().replace(/\s+/g, " ").trim();
}

const NUMBER = /^\d+(?:[.,]\d+)*$/;

/**
 * A "hard" value token is a concrete, contested value rather than a bare name: a `code span`
 * (stored with a leading backtick), a dotted/underscored identifier (`todos.json`, `todo_file`,
 * `db.internal`), or any token carrying a digit (`node18`, `us-east-1`). Plain proper nouns and
 * acronyms (`postgres`, `aws`, `db`) are soft. Used only to decide whether a *reused-key* pair that
 * also shares a token clashes (hard difference) or merely names complementary facets (soft).
 */
function isHardValue(word: string): boolean {
  return word.startsWith("`") || /[._-]/.test(word) || /\d/.test(word);
}

/** Fact-bearing tokens. Lowercased; numbers keep a following unit so `200ms` != `200 users`. */
export function valueTokens(body: string): Set<string> {
  const values = new Set<string>();
  // Code spans and quoted strings are explicit values.
  for (const m of body.matchAll(/`([^`\n]+)`/g)) values.add(`\`${m[1]!.trim().toLowerCase()}`);
  const prose = body.replace(/`[^`\n]*`/g, " ").replace(/\[\[[^\]]*\]\]/g, " ");

  // Numbers, keeping only a unit that is directly attached (`200ms`, `50%`, `16gb`). A unit must NOT
  // reach across whitespace to grab the next prose word: "16 seconds" and "16 workers" would then sit
  // in different buckets and never compare, so a real numeric contradiction phrased two ways is missed.
  for (const m of prose.matchAll(/\b(\d+(?:[.,]\d+)*)(%|[a-zA-Z]{1,12})?/g)) {
    values.add(`#${m[1]}${m[2] ? `~${m[2].toLowerCase()}` : ""}`);
  }

  // Capitalized words not at a sentence start, and identifier-like words (camelCase, snake_case,
  // kebab-with-digit, dotted names). Plain lowercase prose is ignored on purpose.
  const sentenceStart = /(^|[.!?]\s+|\n\s*(?:[-*>]\s+)?)$/;
  for (const m of prose.matchAll(/[A-Za-z][A-Za-z0-9]*(?:[._-][A-Za-z0-9]+)*/g)) {
    const word = m[0];
    const before = prose.slice(0, m.index);
    const identifier = /[a-z][A-Z]/.test(word) || /[_.]/.test(word) || (/\d/.test(word) && /[A-Za-z]/.test(word));
    const proper = /^[A-Z]/.test(word) && !sentenceStart.test(before);
    const acronym = /^[A-Z]{2,}[0-9]*$/.test(word);
    if (identifier || proper || acronym) values.add(word.toLowerCase());
  }
  return values;
}

function split(values: Set<string>): { words: Set<string>; numbers: Map<string, Set<string>> } {
  const words = new Set<string>();
  const numbers = new Map<string, Set<string>>();
  for (const v of values) {
    if (v.startsWith("#")) {
      const [num = "", unit = ""] = v.slice(1).split("~");
      if (!NUMBER.test(num)) continue;
      let set = numbers.get(unit);
      if (!set) numbers.set(unit, (set = new Set()));
      set.add(num);
    } else {
      words.add(v);
    }
  }
  return { words, numbers };
}

/**
 * Do these two bodies assert different values? Returns the differing value tokens when they do,
 * null when they agree or when we cannot tell (the conservative default).
 */
function differingValues(existing: string, candidate: string): { existing: string[]; candidate: string[] } | null {
  const a = split(valueTokens(existing));
  const b = split(valueTokens(candidate));

  // (a) Named values. Each side must assert at least one value the other lacks: if one side's values
  //     are a subset of the other's, nothing new is claimed (a restatement or a refinement), so we stay
  //     silent. Among the values that differ, we then ask how much the notes overlap:
  //       - They share NO value token -> they plainly disagree, so any distinctive named value flags.
  //         (This subsumes the old no-overlap rule unchanged.)
  //       - They share a value token -> they are at least partly about the same thing. Incidental
  //         overlap must not mask a real contradiction whose values are buried under it
  //         ("single JSON file `todos.json`" vs "SQLite ... `todos.db`"), but a bare proper-noun
  //         difference under overlap is as likely two complementary facets ("Postgres, on AWS" vs
  //         "Postgres, via PgBouncer") as a genuine clash. We cannot tell those apart without
  //         semantics, so we only flag when each side's distinctive set carries a HARD value -- a
  //         `code span`, a dotted/underscored identifier, or a token bearing a digit -- which is what
  //         a concrete contested value (a filename, path, key, or version) looks like. Soft-only
  //         differences under overlap stay silent (the conservative default; a miss, never a cry-wolf).
  if (a.words.size > 0 && b.words.size > 0) {
    const aOnly = [...a.words].filter((w) => !b.words.has(w)).sort();
    const bOnly = [...b.words].filter((w) => !a.words.has(w)).sort();
    if (aOnly.length === 0 || bOnly.length === 0) return null; // subset: restatement or refinement
    const sharesToken = a.words.size !== aOnly.length; // some value token appears on both sides
    if (!sharesToken) return { existing: aOnly, candidate: bOnly }; // pure disagreement
    if (aOnly.some(isHardValue) && bOnly.some(isHardValue)) return { existing: aOnly, candidate: bOnly };
    return null; // overlap with only soft (proper-noun) differences: cannot tell a clash from facets
  }

  // (b) Numeric values with the same unit and no number in common, e.g. `Postgres 16` vs `Postgres 15`.
  //     Only when neither side names anything (otherwise rule (a) already spoke).
  if (a.words.size === 0 && b.words.size === 0) {
    for (const [unit, nums] of a.numbers) {
      const other = b.numbers.get(unit);
      if (!other || nums.size === 0 || other.size === 0) continue;
      if (![...nums].some((n) => other.has(n))) {
        return { existing: [...nums].sort().map((n) => n + (unit ? ` ${unit}` : "")), candidate: [...other].sort().map((n) => n + (unit ? ` ${unit}` : "")) };
      }
    }
  }
  return null;
}

/** Existing active notes the candidate may contradict. Empty array = silence. */
export function detectConflicts(candidate: ConflictNote, existing: ConflictNote[]): ConflictWarning[] {
  const key = normalizeKey(candidate.key);
  if (!key) return [];
  const project = normalizeProject(candidate.project);
  const superseded = new Set([...(candidate.supersedes ?? []), ...extractSupersedes(candidate.body)].map((s) => slugify(s)));
  const warnings: ConflictWarning[] = [];

  for (const other of existing) {
    if (other.id === candidate.id) continue;
    if (other.status !== undefined && other.status !== "active") continue; // superseded, archived or already flagged
    if (normalizeKey(other.key) !== key) continue;
    if (normalizeProject(other.project) !== project) continue; // conflicts are per-project; same key across projects is fine
    if (superseded.has(other.id)) continue;
    if (Date.parse(other.updated) > Date.parse(candidate.updated)) continue; // candidate is the older write
    if (normalizeBody(other.body) === normalizeBody(candidate.body)) continue;
    // The other note may itself declare that it supersedes the candidate's lineage; honour it too.
    if ((other.supersedes ?? []).concat(extractSupersedes(other.body)).includes(candidate.id)) continue;
    // "Keep both" resolutions leave a `Reconciled with:` line on either side.
    if (extractReconciled(other.body).includes(candidate.id) || extractReconciled(candidate.body).includes(other.id)) continue;

    const diff = differingValues(other.body, candidate.body);
    if (!diff) continue;
    warnings.push({
      id: other.id,
      title: other.title,
      key,
      existingValues: diff.existing,
      candidateValues: diff.candidate,
      message:
        `This may contradict note "${other.title ?? other.id}" (id: ${other.id}), which has the same key "${key}" ` +
        `but states ${diff.existing.join(", ")} where this note states ${diff.candidate.join(", ")}. ` +
        `If this note replaces it, add a line "Supersedes: [[${other.id}]]" to the body; otherwise reconcile the two.`,
    });
  }
  return warnings;
}

export interface ConflictPair {
  /** The older note (by `updated`, ties broken by id). */
  a: ConflictNote;
  /** The newer note, the one whose write collided with `a`. */
  b: ConflictNote;
  key: string;
  /** Value tokens only `a` asserts. */
  aValues: string[];
  /** Value tokens only `b` asserts. */
  bValues: string[];
}

/**
 * Every unresolved contradiction in a set of notes: the same detector `remember` uses, run over all pairs.
 * Notes flagged `status: conflict` take part (they are unresolved by definition); `superseded` notes never do.
 * Each pair is reported once, older note first.
 */
export function findConflictPairs(notes: ConflictNote[]): ConflictPair[] {
  const live = notes.map((n) => (n.status === "conflict" ? { ...n, status: "active" } : n));
  const pairs = new Map<string, ConflictPair>();
  for (const candidate of live) {
    if (candidate.status !== undefined && candidate.status !== "active") continue;
    for (const w of detectConflicts(candidate, live)) {
      const other = live.find((n) => n.id === w.id);
      if (!other) continue;
      const [a, b, aValues, bValues] =
        Date.parse(other.updated) < Date.parse(candidate.updated) || (other.updated === candidate.updated && other.id < candidate.id)
          ? [other, candidate, w.existingValues, w.candidateValues]
          : [candidate, other, w.candidateValues, w.existingValues];
      pairs.set(`${a.id}~${b.id}`, { a, b, key: w.key, aValues, bValues });
    }
  }
  return [...pairs.values()].sort((x, y) => y.b.updated.localeCompare(x.b.updated) || x.a.id.localeCompare(y.a.id));
}
