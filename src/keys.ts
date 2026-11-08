import { slugify } from "./slug.js";
import type { ConflictNote } from "./conflicts.js";

/**
 * Write-time key hygiene. The contradiction detector only ever compares notes that share the SAME
 * exact `key` within the same project (see `conflicts.ts`), so two notes about the same thing filed
 * under different key strings (`data-store` vs `datastore`, `ci` vs `continuous-integration`) are
 * never paired and a real clash is missed.
 *
 * This helper nudges the author at save time: if the project already has a live note under a
 * DIFFERENT but near-certainly-equivalent key, suggest reusing it so notes converge onto shared keys.
 * It is advisory only — it never rewrites the key, never blocks the save, never touches the judge.
 *
 * Like the judge, it is tuned to UNDER-suggest, and here the bar is deliberately high: a wrong nudge
 * trains the author to ignore every nudge, so we fire ONLY on the two cases where two keys are almost
 * surely the same name spelled two ways:
 *
 *   1. SEPARATOR-ONLY — identical once hyphens/underscores are dropped (`data-store` == `datastore`).
 *   2. INITIALISM — one key is the first-letters acronym of the other's (≥2) tokens
 *      (`ci` == `continuous-integration`, `api` == `application-programming-interface`).
 *
 * Everything weaker stays SILENT on purpose. In particular we do NOT nudge on:
 *   - a bare token subset (`auth` vs `auth-timeout`, `storage` vs `storage-choice`): a more specific
 *     key is usually a DIFFERENT one-value-per-key fact, not the same thing;
 *   - a single-character edit (`cost` vs `cast`, `prod` vs `prot`): edit-distance-1 cannot tell a typo
 *     from a genuinely different word;
 *   - a same-initial subsequence (`cat` vs `catalog`, `db` vs `database`, `os` vs `options`): no string
 *     rule separates a real abbreviation from an unrelated short word, so we miss these rather than
 *     risk the cry-wolf false positive.
 */

/** Tokens of a slugified key, split on `-`, empties dropped. */
function tokens(slug: string): string[] {
  return slug.split("-").filter(Boolean);
}

/**
 * How similar are two already-slugified keys? Returns a score in (0, 1]; 0 means "not similar enough
 * to suggest". Only the two high-precision cases score above 0. Assumes `a !== b` (exact matches
 * already group and need no nudge).
 */
function keySimilarity(a: string, b: string): number {
  if (!a || !b) return 0;

  // 1. Separator-only difference: same characters once hyphens are removed (`datastore`/`data-store`).
  //    (Underscores already normalize to hyphens via slugify, so this also covers `data_store`.)
  if (a.replace(/-/g, "") === b.replace(/-/g, "")) return 0.95;

  // 2. Initialism: one key is a single token that equals the first-letters acronym of the other key's
  //    tokens, and the other has at least two tokens (so the acronym is non-trivial).
  const ta = tokens(a);
  const tb = tokens(b);
  const isAcronymOf = (acr: string[], full: string[]) =>
    acr.length === 1 && full.length >= 2 && acr[0] === full.map((t) => t[0]).join("");
  if (isAcronymOf(ta, tb) || isAcronymOf(tb, ta)) return 0.9;

  return 0;
}

/**
 * The best existing live key in `project` that is near-certainly the same name as `candidateKey`
 * spelled differently, or null when there is nothing worth nudging about. Compares on slugified keys;
 * returns the existing key in its stored spelling for a friendly message. Exact matches never suggest
 * (they already group).
 *
 * "Live" mirrors `findConflictPairs` in conflicts.ts: both `active` and `conflict`-status notes count,
 * so convergence is still nudged precisely when a key is already contested.
 */
export function suggestExistingKey(
  candidateKey: string | undefined,
  others: ConflictNote[],
  project: string | undefined,
): string | null {
  const candidate = candidateKey ? slugify(candidateKey) : "";
  if (!candidate) return null;
  const wantProject = (project ?? "").trim().toLowerCase();

  // Collapse existing live same-project keys to one entry per slug, keeping a stored spelling to show.
  const seen = new Map<string, string>();
  for (const other of others) {
    if (other.status !== undefined && other.status !== "active" && other.status !== "conflict") continue;
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
