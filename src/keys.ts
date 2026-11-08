import { slugify } from "./slug.js";
import type { ConflictNote } from "./conflicts.js";

/**
 * Write-time key hygiene. The contradiction detector only ever compares notes that share the SAME
 * exact `key` within the same project (see `conflicts.ts`), so two notes about the same thing filed
 * under different key strings (`db` vs `database`) are never paired and a real clash is missed.
 *
 * This helper nudges the author at save time: if the project already has an active note under a
 * DIFFERENT but clearly-similar key, suggest reusing it so notes converge onto shared keys. It is
 * advisory only — it never rewrites the key, never blocks the save, never touches the judge.
 *
 * Like the judge, it is tuned to UNDER-suggest: a wrong nudge trains the author to ignore nudges, so
 * we only fire on keys that are unmistakably two spellings of one thing (a strict token subset, a
 * dash-only difference, a short abbreviation, or a single-character typo). Loosely-related keys that
 * merely share a token (`storage-choice` vs `storage-decision`) stay silent on purpose.
 */

/** Lower, bounded Levenshtein: stops counting once the distance exceeds `max` (returns max + 1). */
function boundedEditDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const curr = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const d = Math.min(prev[j]! + 1, curr[j - 1]! + 1, prev[j - 1]! + cost);
      curr.push(d);
      if (d < rowMin) rowMin = d;
    }
    if (rowMin > max) return max + 1;
    prev = curr;
  }
  return prev[b.length]!;
}

/** Is `short` a subsequence of `long` (characters in order, gaps allowed)? */
function isSubsequence(short: string, long: string): boolean {
  let i = 0;
  for (let j = 0; j < long.length && i < short.length; j++) {
    if (short[i] === long[j]) i++;
  }
  return i === short.length;
}

/**
 * How similar are two already-slugified keys? Returns a score in (0, 1]; 0 means "not similar enough
 * to suggest". Deliberately conservative — it only scores the four unmistakable cases, everything
 * else is 0. Assumes `a !== b` (exact matches already group and need no nudge).
 */
function keySimilarity(a: string, b: string): number {
  if (!a || !b) return 0;

  // 1. Dash-only difference: same characters once hyphens are removed (`datastore` vs `data-store`).
  if (a.replace(/-/g, "") === b.replace(/-/g, "")) return 0.95;

  const setA = new Set(a.split("-").filter(Boolean));
  const setB = new Set(b.split("-").filter(Boolean));

  // 2. One key's tokens are a strict subset of the other's (`storage` vs `storage-choice`).
  const aInB = [...setA].every((t) => setB.has(t));
  const bInA = [...setB].every((t) => setA.has(t));
  if ((aInB || bInA) && setA.size !== setB.size) return 0.9;

  const single = setA.size === 1 && setB.size === 1;
  if (single) {
    const [short, long] = a.length <= b.length ? [a, b] : [b, a];

    // 3. Short abbreviation of a longer single token (`db` vs `database`): the short key is a
    //    same-initial subsequence of the long one. Gated tight so unrelated short keys stay silent.
    if (short.length >= 2 && short.length <= 4 && long.length >= short.length + 2 && short[0] === long[0] && isSubsequence(short, long)) {
      return 0.8;
    }

    // 4. Single-character typo in a reasonably-long single-token key (`databse` vs `database`).
    if (short.length >= 4 && boundedEditDistance(a, b, 1) <= 1) return 0.85;
  }

  return 0;
}

/**
 * The best existing active key in `project` that is clearly similar-but-not-equal to `candidateKey`,
 * or null when there is nothing worth nudging about. Compares on slugified keys; returns the existing
 * key in its stored spelling for a friendly message. Exact matches never suggest (they already group).
 */
export function suggestExistingKey(
  candidateKey: string | undefined,
  others: ConflictNote[],
  project: string | undefined,
): string | null {
  const candidate = candidateKey ? slugify(candidateKey) : "";
  if (!candidate) return null;
  const wantProject = (project ?? "").trim().toLowerCase();

  // Collapse existing active same-project keys to one entry per slug, keeping a stored spelling to show.
  const seen = new Map<string, string>();
  for (const other of others) {
    if (other.status !== undefined && other.status !== "active") continue;
    if ((other.project ?? "").trim().toLowerCase() !== wantProject) continue;
    const slug = other.key ? slugify(other.key) : "";
    if (!slug || slug === candidate) continue; // empty, or exact match (already groups)
    if (!seen.has(slug)) seen.set(slug, other.key!.trim());
  }

  let best: { key: string; slug: string; score: number } | null = null;
  for (const [slug, original] of seen) {
    const score = keySimilarity(candidate, slug);
    if (score <= 0) continue;
    // Highest score wins; ties broken by slug for deterministic output.
    if (!best || score > best.score || (score === best.score && slug < best.slug)) {
      best = { key: original, slug, score };
    }
  }
  return best ? best.key : null;
}
