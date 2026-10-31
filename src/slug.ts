import { createHash } from "node:crypto";

export const MAX_SLUG_LENGTH = 60;

const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/;
// Characters Windows forbids in filenames, plus path separators and control chars.
// eslint-disable-next-line no-control-regex
const FORBIDDEN_CHARS = /[<>:"|?*\\/\u0000-\u001f]/;

export class InvalidNameError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidNameError";
  }
}

/** Pure formatting: lowercase ASCII `[a-z0-9-]`, no edge/double dashes, <= 60 chars. May return "". */
export function slugify(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/g, "");
}

/** True for Windows reserved device names, with or without an extension (`con`, `NUL.txt`). */
export function isReservedName(name: string): boolean {
  const base = (name.split(".")[0] ?? "").trimEnd().toLowerCase();
  return RESERVED.test(base);
}

/** Throws unless `name` is a safe file or directory name on Windows, macOS and Linux. */
export function assertSafeFilename(name: string): void {
  if (name.length === 0) throw new InvalidNameError("name is empty");
  if (FORBIDDEN_CHARS.test(name)) {
    throw new InvalidNameError(`name "${name}" contains a forbidden character (<>:"|?*, slashes or control chars)`);
  }
  if (/[. ]$/.test(name)) {
    throw new InvalidNameError(`name "${name}" ends with a dot or space`);
  }
  if (isReservedName(name)) {
    throw new InvalidNameError(`name "${name}" is a reserved Windows device name`);
  }
}

/**
 * Slug for a title or project name. Titles with no ASCII letters or digits
 * (e.g. non-Latin scripts) get a stable `note-<hash>` slug so they still round-trip.
 * Throws on empty input or reserved names.
 */
export function makeSlug(title: string): string {
  const trimmed = title.trim();
  if (trimmed.length === 0) throw new InvalidNameError("title is empty");
  let slug = slugify(trimmed);
  if (slug.length === 0) {
    slug = `note-${createHash("sha1").update(trimmed.normalize("NFC")).digest("hex").slice(0, 8)}`;
  }
  assertSafeFilename(slug);
  return slug;
}

/** `storage`, n=2 -> `storage-2`; the base is trimmed so the result stays within the length cap. */
export function withSuffix(slug: string, n: number): string {
  if (n <= 1) return slug;
  const suffix = `-${n}`;
  return `${slug.slice(0, MAX_SLUG_LENGTH - suffix.length).replace(/-+$/g, "")}${suffix}`;
}

/** First of `slug`, `slug-2`, `slug-3`, ... for which `isTaken` is false. */
export function uniqueSlug(slug: string, isTaken: (candidate: string) => boolean): string {
  for (let n = 1; n < 10_000; n++) {
    const candidate = withSuffix(slug, n);
    if (!isTaken(candidate)) return candidate;
  }
  throw new InvalidNameError(`could not find a free slug for "${slug}"`);
}
