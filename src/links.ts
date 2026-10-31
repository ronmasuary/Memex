import { slugify } from "./slug.js";

const WIKILINK = /\[\[([^[\]\n|#]+)(?:#[^\]|\n]*)?(?:\|[^\]\n]*)?\]\]/g;
const FENCED_CODE = /^(```|~~~)[\s\S]*?^\1[^\n]*$/gm;
const INLINE_CODE = /`[^`\n]*`/g;

/**
 * Note ids referenced by `[[wikilinks]]` in `body`, in first-seen order, deduplicated.
 * Supports `[[target]]`, `[[target|alias]]` and `[[target#heading]]`; ignores code.
 */
export function extractWikilinks(body: string): string[] {
  const text = body.replace(FENCED_CODE, "").replace(INLINE_CODE, "");
  const seen = new Set<string>();
  for (const match of text.matchAll(WIKILINK)) {
    const id = slugify(match[1] ?? "");
    if (id) seen.add(id);
  }
  return [...seen];
}

export interface LinkSource {
  id: string;
  links: string[];
}

/** Map of target id -> sorted ids of notes linking to it. Self-links are ignored. */
export function buildBacklinks(notes: LinkSource[]): Map<string, string[]> {
  const map = new Map<string, Set<string>>();
  for (const note of notes) {
    for (const target of note.links) {
      if (target === note.id) continue;
      let sources = map.get(target);
      if (!sources) map.set(target, (sources = new Set()));
      sources.add(note.id);
    }
  }
  return new Map([...map].map(([target, sources]) => [target, [...sources].sort()]));
}
