import { slugify } from "./slug.js";

/**
 * Deterministic contradiction detection. Deliberately tuned to UNDER-flag: a false positive
 * ("your memory cries wolf") is the failure mode that kills the tool, a miss is merely a miss.
 *
 * A candidate conflicts with an existing note only when ALL of these hold:
 *   1. both carry the same non-empty `key` AND belong to the same `project`;
 *   2. the existing note is active and is not the candidate itself;
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
const WIKILINK_OR_SLUG = /\[\[([^\]|#]+)(?:[#|][^\]]*)?\]\]|([A-Za-z0-9][A-Za-z0-9_-]*)/g;

/** Ids named on `Supersedes: [[a]], b` lines in a note body. */
export function extractSupersedes(body: string): string[] {
  const ids = new Set<string>();
  for (const line of body.matchAll(SUPERSEDES_LINE)) {
    for (const m of (line[1] ?? "").matchAll(WIKILINK_OR_SLUG)) {
      const id = slugify(m[1] ?? m[2] ?? "");
      if (id) ids.add(id);
    }
  }
  return [...ids];
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

/** Fact-bearing tokens. Lowercased; numbers keep a following unit so `200ms` != `200 users`. */
export function valueTokens(body: string): Set<string> {
  const values = new Set<string>();
  // Code spans and quoted strings are explicit values.
  for (const m of body.matchAll(/`([^`\n]+)`/g)) values.add(`\`${m[1]!.trim().toLowerCase()}`);
  const prose = body.replace(/`[^`\n]*`/g, " ").replace(/\[\[[^\]]*\]\]/g, " ");

  // Numbers (optionally with a unit suffix/following unit word handled by pairing below).
  for (const m of prose.matchAll(/\b(\d+(?:[.,]\d+)*)\s*(%|[a-zA-Z]{1,12})?/g)) {
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

  // (a) Named values: both sides name something, and they share none of it -> different thing asserted.
  if (a.words.size > 0 && b.words.size > 0) {
    const shared = [...a.words].some((w) => b.words.has(w));
    if (!shared) return { existing: [...a.words].sort(), candidate: [...b.words].sort() };
    return null; // a shared name means the notes talk about the same value; stay silent.
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
    if (other.status === "conflict") continue;
    if (normalizeKey(other.key) !== key) continue;
    if (normalizeProject(other.project) !== project) continue; // conflicts are per-project; same key across projects is fine
    if (superseded.has(other.id)) continue;
    if (Date.parse(other.updated) > Date.parse(candidate.updated)) continue; // candidate is the older write
    if (normalizeBody(other.body) === normalizeBody(candidate.body)) continue;
    // The other note may itself declare that it supersedes the candidate's lineage; honour it too.
    if ((other.supersedes ?? []).concat(extractSupersedes(other.body)).includes(candidate.id)) continue;

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
