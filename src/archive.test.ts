import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { simpleGit } from "simple-git";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { findConflictPairs, type ConflictNote } from "./conflicts.js";
import { SearchIndex } from "./search.js";
import { initVault, type Vault } from "./vault.js";

let dir: string;
let vault: Vault;
const prov = { source: "test/agent", session: "s1", why: "fixture" };

async function pairs() {
  const notes = await Promise.all((await vault.listNotePaths()).map((p) => vault.readNote(p)));
  return findConflictPairs(notes as ConflictNote[]);
}
async function commits(): Promise<number> {
  return (await simpleGit({ baseDir: vault.root }).log()).total;
}

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "memex-archive-"));
  vault = await initVault(path.join(dir, "vault"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true, maxRetries: 5 });
});

describe("Vault.archiveNote / unarchiveNote", () => {
  it("archives as exactly one commit, keeps the file and history, and restores to active", async () => {
    await vault.writeNote({ title: "Throwaway", body: "a temporary thought", project: "memex" }, prov);
    const before = await commits();

    const archived = await vault.archiveNote("throwaway", { source: "web/ui", why: "no longer needed" });
    expect(archived.created).toBe(false);
    expect(archived.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(archived.note.status).toBe("archived");
    expect(await commits()).toBe(before + 1);
    // Never hard-deleted: the file is still on disk and listable.
    expect(await vault.listNotePaths()).toContain("memex/throwaway.md");
    expect((await vault.findById("throwaway"))!.status).toBe("archived");

    const head = (await simpleGit({ baseDir: vault.root }).log({ maxCount: 1 })).latest!;
    expect(head.message).toContain("archive throwaway");
    expect(head.author_name).toBe("web/ui");

    const restored = await vault.unarchiveNote("throwaway", { source: "web/ui", why: "needed again" });
    expect(restored.note.status).toBe("active");
    expect(await commits()).toBe(before + 2);
    expect((await vault.findById("throwaway"))!.status).toBe("active");
  });

  it("refuses to archive twice, to restore a note that is not archived, or to touch a missing note", async () => {
    await vault.writeNote({ title: "Keep", body: "x", project: "memex" }, prov);
    await expect(vault.unarchiveNote("keep", prov)).rejects.toThrow(/not archived/);
    await vault.archiveNote("keep", prov);
    await expect(vault.archiveNote("keep", prov)).rejects.toThrow(/already archived/);
    await expect(vault.archiveNote("nope", prov)).rejects.toThrow(/no note/);
  });
});

describe("re-remembering an archived note revives it", () => {
  it("brings the note back to active so the rewrite is actually recallable, and flags the revive", async () => {
    await vault.writeNote({ title: "Temp fact", body: "old content", project: "memex" }, prov);
    await vault.archiveNote("temp-fact", prov);

    // A plain `remember` on the archived title is an intentional rewrite: it must revive, not stay hidden.
    const r = await vault.writeNote({ title: "Temp fact", body: "new content", project: "memex" }, prov);
    expect(r.revived).toBe(true);
    expect(r.created).toBe(false);
    expect(r.note.status).toBe("active");
    expect((await vault.findById("temp-fact"))!.status).toBe("active");

    const index = new SearchIndex(vault);
    expect((await index.search("content")).map((h) => h.id)).toContain("temp-fact");
  });

  it("does not revive when the caller sets status explicitly, and a normal update sets revived=false", async () => {
    await vault.writeNote({ title: "Keep archived", body: "v1", project: "memex" }, prov);
    await vault.archiveNote("keep-archived", prov);
    // An explicit status wins over the revive-on-rewrite default.
    const kept = await vault.writeNote({ title: "Keep archived", body: "v2", project: "memex", status: "archived" }, prov);
    expect(kept.revived).toBe(false);
    expect(kept.note.status).toBe("archived");

    const plain = await vault.writeNote({ title: "Active note", body: "v1", project: "memex" }, prov);
    expect(plain.created).toBe(true);
    expect(plain.revived).toBe(false);
    const update = await vault.writeNote({ title: "Active note", body: "v2", project: "memex" }, prov);
    expect(update.created).toBe(false);
    expect(update.revived).toBe(false);
  });
});

describe("archived notes are ignored by contradiction detection", () => {
  it("drops a colliding pair when either note is archived, and restores it on un-archive", async () => {
    await vault.writeNote({ title: "Store old", body: "We use Postgres.", project: "memex", key: "storage-choice" }, prov);
    await new Promise((r) => setTimeout(r, 15));
    await vault.writeNote({ title: "Store new", body: "We use SQLite.", project: "memex", key: "storage-choice" }, prov);
    expect(await pairs()).toHaveLength(1);

    await vault.archiveNote("store-new", prov);
    expect(await pairs()).toHaveLength(0);

    await vault.unarchiveNote("store-new", prov);
    expect(await pairs()).toHaveLength(1);
  });
});

describe("archived notes are excluded from search", () => {
  it("drops out of the index on archive and returns on restore", async () => {
    await vault.writeNote({ title: "Redis cache", body: "We cache sessions in Redis.", project: "memex" }, prov);
    const index = new SearchIndex(vault);
    expect((await index.search("redis")).map((h) => h.id)).toContain("redis-cache");

    await vault.archiveNote("redis-cache", prov);
    expect((await index.search("redis")).map((h) => h.id)).not.toContain("redis-cache");

    await vault.unarchiveNote("redis-cache", prov);
    expect((await index.search("redis")).map((h) => h.id)).toContain("redis-cache");
  });

  it("does not throw when a never-indexed archived note's file is deleted and swept", async () => {
    await vault.writeNote({ title: "Born archived", body: "scratch", project: "memex", status: "archived" }, prov);
    const index = new SearchIndex(vault);
    await index.sync(); // archived from the start → never added to the MiniSearch index
    await rm(vault.abs("memex/born-archived.md"));
    const stats = await index.sync(); // the removed-file sweep must not discard a never-indexed doc
    expect(stats.removed).toBe(1);
    expect((await index.search("scratch")).map((h) => h.id)).not.toContain("born-archived");
  });
});
