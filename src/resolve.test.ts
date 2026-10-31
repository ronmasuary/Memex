import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { simpleGit } from "simple-git";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { findConflictPairs, type ConflictNote } from "./conflicts.js";
import { createServer } from "./mcp.js";
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
  dir = await mkdtemp(path.join(tmpdir(), "memex-resolve-"));
  vault = await initVault(path.join(dir, "vault"));
  await vault.writeNote({ title: "Storage old", body: "We store notes in Postgres.", project: "memex", key: "storage-choice" }, prov);
  await new Promise((r) => setTimeout(r, 15));
  await vault.writeNote({ title: "Storage new", body: "We store notes in SQLite.", project: "memex", key: "storage-choice" }, prov);
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("conflict detection over a vault", () => {
  it("lists the colliding pair, older note first, with the differing values", async () => {
    const found = await pairs();
    expect(found).toHaveLength(1);
    expect(found[0]!.a.id).toBe("storage-old");
    expect(found[0]!.b.id).toBe("storage-new");
    expect(found[0]!.aValues).toContain("postgres");
    expect(found[0]!.bValues).toContain("sqlite");
  });
});

describe("Vault.resolveConflict", () => {
  it("keep_a: one commit, a stays active, b is superseded, conflict cleared", async () => {
    const before = await commits();
    const r = await vault.resolveConflict("storage-old", "storage-new", "keep_a", prov);
    expect(await commits()).toBe(before + 1);
    expect(r.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(r.files.sort()).toEqual(["memex/storage-new.md", "memex/storage-old.md"]);
    const a = (await vault.findById("storage-old"))!;
    const b = (await vault.findById("storage-new"))!;
    expect(a.status).toBe("active");
    expect(a.body).toContain("Supersedes: [[storage-new]]");
    expect(b.status).toBe("superseded");
    expect(b.body).toContain("Superseded by: [[storage-old]]");
    expect(await pairs()).toHaveLength(0);
    const head = (await simpleGit({ baseDir: vault.root }).log({ maxCount: 1 })).latest!;
    expect(head.message).toContain("resolve conflict storage-old / storage-new (keep a)");
    expect(head.author_name).toBe("test/agent");
  });

  it("keep_b: the older note is superseded", async () => {
    await vault.resolveConflict("storage-old", "storage-new", "keep_b", prov);
    expect((await vault.findById("storage-old"))!.status).toBe("superseded");
    expect((await vault.findById("storage-new"))!.status).toBe("active");
    expect(await pairs()).toHaveLength(0);
  });

  it("keep_both: needs a note, makes one commit with a reconciliation note, keeps both active", async () => {
    await expect(vault.resolveConflict("storage-old", "storage-new", "keep_both", prov)).rejects.toThrow(/reconciliation note/);
    const before = await commits();
    const r = await vault.resolveConflict("storage-old", "storage-new", "keep_both", prov, "Postgres on the server, SQLite on laptops.");
    expect(await commits()).toBe(before + 1);
    expect(r.files).toHaveLength(3);
    const rec = (await vault.findById(r.reconciliation!))!;
    expect(rec.body).toContain("[[storage-old]]");
    expect(rec.body).toContain("Postgres on the server");
    expect((await vault.findById("storage-old"))!.status).toBe("active");
    expect((await vault.findById("storage-new"))!.status).toBe("active");
    expect(await pairs()).toHaveLength(0);
  });

  it("clears an explicit status: conflict flag", async () => {
    await vault.writeNote({ title: "Storage new", body: "We store notes in SQLite.", project: "memex", key: "storage-choice", status: "conflict" }, prov);
    expect((await vault.findById("storage-new"))!.status).toBe("conflict");
    await vault.resolveConflict("storage-old", "storage-new", "keep_b", prov);
    expect((await vault.findById("storage-new"))!.status).toBe("active");
  });

  it("refuses a pair that is not in conflict, and a second resolution, without committing", async () => {
    await vault.resolveConflict("storage-old", "storage-new", "keep_a", prov);
    const before = await commits();
    await expect(vault.resolveConflict("storage-old", "storage-new", "keep_b", prov)).rejects.toThrow(/not in conflict/);
    await expect(vault.resolveConflict("storage-old", "nope", "keep_a", prov)).rejects.toThrow(/no note/);
    expect(await commits()).toBe(before);
  });
});

describe("resolve_conflict MCP tool", () => {
  it("resolves via the tool as one commit and reports it", async () => {
    const server = createServer(vault);
    const [x, y] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "1.0.0" });
    await Promise.all([server.connect(x), client.connect(y)]);
    try {
      const before = await commits();
      const res = await client.callTool({ name: "resolve_conflict", arguments: { a: "storage-old", b: "storage-new", action: "keep_b", why: "user confirmed SQLite" } });
      const out = (res.content as { text: string }[]).map((c) => c.text).join("\n");
      expect(res.isError).toBeFalsy();
      expect(out).toContain("Kept storage-new");
      expect(out).toMatch(/Commit: [0-9a-f]{7}/);
      expect(await commits()).toBe(before + 1);
      expect(await pairs()).toHaveLength(0);
      const again = await client.callTool({ name: "resolve_conflict", arguments: { a: "storage-old", b: "storage-new", action: "keep_a" } });
      expect(again.isError).toBe(true);
    } finally {
      await client.close();
    }
  });
});
