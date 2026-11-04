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
});
