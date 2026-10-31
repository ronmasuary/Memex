import { mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SearchIndex } from "./search.js";
import { Vault } from "./vault.js";

let dir: string;
let vault: Vault;
const prov = { source: "test/agent" };

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "memex-search-"));
  vault = new Vault(dir);
  await vault.writeNote(
    { title: "Storage decision", body: "We chose markdown files in git as the source of truth.", project: "memex", tags: ["decision"] },
    prov,
  );
  await vault.writeNote(
    { title: "Weekly notes", body: "Mentioned storage once, in passing, while discussing lunch and many other unrelated things.", project: "misc" },
    prov,
  );
  await vault.writeNote(
    { title: "Graph view", body: "Force directed graph. Links to [[storage-decision]] and [[weekly-notes]].", project: "memex" },
    prov,
  );
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true, maxRetries: 5 });
});

describe("search", () => {
  it("ranks a title/tag match above a passing body mention and returns snippets", async () => {
    const index = new SearchIndex(vault);
    const hits = await index.search("storage");
    expect(hits[0]?.id).toBe("storage-decision");
    expect(hits.map((h) => h.id)).toContain("weekly-notes");
    expect(hits[0]?.snippet.length).toBeLessThanOrEqual(202);
    expect(hits[0]?.snippet).toContain("markdown");
    expect((await index.search("storage", { project: "misc" })).map((h) => h.id)).toEqual(["weekly-notes"]);
    expect(await index.backlinks("storage-decision")).toEqual(["graph-view"]);
  });

  it("re-parses only changed files on sync and persists the index", async () => {
    const index = new SearchIndex(vault);
    expect(await index.sync()).toMatchObject({ added: 3, parsed: 3 });
    expect(await index.sync()).toMatchObject({ added: 0, updated: 0, removed: 0, parsed: 0 });

    await vault.writeNote({ title: "Graph view", body: "Now about zebras.", project: "memex" }, prov);
    expect(await index.sync()).toMatchObject({ updated: 1, parsed: 1 });
    expect((await index.search("zebras"))[0]?.id).toBe("graph-view");
    expect(await index.search("directed")).toEqual([]);

    await rm(vault.abs("misc/weekly-notes.md"));
    expect(await index.sync()).toMatchObject({ removed: 1 });

    // A fresh instance loads the persisted file and finds nothing to re-parse.
    expect(JSON.parse(await readFile(index.indexFile, "utf8")).version).toBe(1);
    expect(await new SearchIndex(vault).sync()).toMatchObject({ parsed: 0 });
  });

  it("does not re-index a touched file whose normalized content is unchanged", async () => {
    const index = new SearchIndex(vault);
    await index.sync();
    const file = vault.abs("memex/graph-view.md");
    const text = await readFile(file, "utf8");
    await writeFile(file, text.replace(/\n/g, "\r\n"));
    const future = new Date(Date.now() + 5000);
    await utimes(file, future, future);
    expect(await index.sync()).toMatchObject({ parsed: 1, updated: 0 });
  });
});
