# 4. Slug and filename rules

Status: accepted

## Context

Agents generate filenames from titles. `Storage.md` and `storage.md` are two files in git
but one file on macOS and Windows, which leaves the working tree permanently dirty and
makes pulls fail. Windows also forbids reserved device names (`con`, `nul`, ...), the
characters `<>:"|?*`, and names ending in a dot or space, and has path-length limits.

## Decision

Note ids and file names are slugs: lowercase ASCII `[a-z0-9-]`, at most 60 characters,
at most two directory levels (`<project>/<slug>.md`). The slug is derived from the title,
so differently-cased titles collapse to the same file and the second write updates the
first. Ids are unique across the vault because wikilinks address notes by id alone: a
slug already taken by a different note gets a `-2`, `-3`, ... suffix. Reserved Windows
names (`con`, `prn`, `aux`, `nul`, `com1`-`com9`, `lpt1`-`lpt9`), with or without an
extension, are rejected, as are forbidden characters and trailing dots or spaces. Titles
with no ASCII letters get a stable `note-<hash>` slug. The index and links store POSIX
relative paths; conversion to native paths happens only at the filesystem boundary.

## Consequences

- No case-collision or reserved-name failures on any supported OS.
- Slugs are less pretty than titles; the real title lives in frontmatter.
- A note titled exactly `con` or `nul` cannot be written; the error says why.
