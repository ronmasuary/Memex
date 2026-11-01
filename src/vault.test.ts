import { execFileSync } from "node:child_process";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { hashText, initVault, normalizeText, parseNote, serializeNote, Vault } from "./vault.js";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "memex-vault-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true, maxRetries: 5 });
});

const prov = { source: "test/agent", session: "s1", why: "testing" };
const gitIn = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

describe("frontmatter", () => {
  it("round-trips every field, writes LF, and leaves no temp files", async () => {
    const vault = new Vault(dir);
    const { note } = await vault.writeNote(
      {
        title: "Storage decision",
        body: "Use markdown.\n\nSee [[graph]].",
        project: "memex",
        tags: ["decision", "storage"],
        key: "storage-choice",
      },
      prov,
    );
    const raw = await readFile(vault.abs(note.path), "utf8");
    expect(raw).not.toContain("\r");
    expect(raw.startsWith("---\nid: storage-decision\ntitle: Storage decision\nproject: memex\n")).toBe(true);

    const back = await vault.readNote("memex/storage-decision.md");
    expect(back).toEqual(note);
    expect(back).toMatchObject({
      tags: ["decision", "storage"],
      key: "storage-choice",
      status: "active",
      source: "test/agent",
      session: "s1",
      why: "testing",
    });
    expect(await readdir(path.join(dir, "memex"))).toEqual(["storage-decision.md"]);
  });

  it("normalizes CRLF so the same content hashes and parses identically", () => {
    const lf = serializeNote({
      id: "x",
      title: "X",
      project: "p",
      tags: [],
      status: "active",
      created: "2026-01-01T00:00:00.000Z",
      updated: "2026-01-01T00:00:00.000Z",
      body: "one\ntwo",
    });
    const crlf = lf.replace(/\n/g, "\r\n");
    expect(hashText(crlf)).toBe(hashText(lf));
    expect(normalizeText(String.fromCharCode(0xfeff) + crlf)).toBe(lf);
    expect(parseNote("p/x.md", crlf)).toEqual(parseNote("p/x.md", lf));
  });

  it("accepts hand-edited unquoted timestamps (YAML dates)", () => {
    const note = parseNote("p/x.md", "---\ntitle: X\ncreated: 2026-10-29T10:00:00Z\n---\nbody\n");
    expect(note.created).toBe("2026-10-29T10:00:00.000Z");
  });
});

describe("filename collisions", () => {
  it("treats Storage and storage as one note: the second write updates", async () => {
    const vault = new Vault(dir);
    const first = await vault.writeNote({ title: "Storage", body: "v1", project: "memex", tags: ["a"] }, prov);
    const second = await vault.writeNote({ title: "storage", body: "v2", project: "memex" }, prov);
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.note.id).toBe(first.note.id);
    expect(second.note.created).toBe(first.note.created);
    expect(second.note.tags).toEqual(["a"]);
    expect(await vault.listNotePaths()).toEqual(["memex/storage.md"]);
    expect((await vault.readNote("memex/storage.md")).body).toBe("v2");
  });

  it("keeps ids unique across projects by suffixing, and updates the suffixed note on rewrite", async () => {
    const vault = new Vault(dir);
    await vault.writeNote({ title: "Storage", body: "a", project: "alpha" }, prov);
    const b = await vault.writeNote({ title: "Storage", body: "b", project: "beta" }, prov);
    expect(b.note.id).toBe("storage-2");
    const again = await vault.writeNote({ title: "Storage", body: "b2", project: "beta" }, prov);
    expect(again.created).toBe(false);
    expect(await vault.listNotePaths()).toEqual(["alpha/storage.md", "beta/storage-2.md"]);
  });

  it("rejects reserved titles and project names", async () => {
    const vault = new Vault(dir);
    await expect(vault.writeNote({ title: "NUL", body: "x" }, prov)).rejects.toThrow(/reserved/);
    await expect(vault.writeNote({ title: "ok", body: "x", project: "com1" }, prov)).rejects.toThrow(/reserved/);
  });
});

describe("git provenance (real repo)", () => {
  it("one write = exactly one commit with the agent author, note id and why", async () => {
    const target = path.join(dir, "vault");
    const vault = await initVault(target);
    expect(gitIn(target, "rev-list", "--count", "HEAD")).toBe("1");

    const agent = { source: "claude-opus/mcp", session: "2026-10-29-a", why: "user confirmed in review" };
    const { note, commit } = await vault.writeNote(
      { title: "Storage decision", body: "Markdown wins.", project: "memex" },
      agent,
    );

    expect(gitIn(target, "rev-list", "--count", "HEAD")).toBe("2");
    expect(gitIn(target, "rev-parse", "HEAD")).toBe(commit);
    expect(gitIn(target, "log", "-1", "--format=%an <%ae>")).toBe("claude-opus/mcp <claude-opus-mcp@memex.local>");
    const message = gitIn(target, "log", "-1", "--format=%B");
    expect(message).toContain(note.id);
    expect(message).toContain("user confirmed in review");
    expect(message).toContain(`source: ${agent.source}`);
    expect(message).toContain(`session: ${agent.session}`);
    expect(gitIn(target, "show", "--name-only", "--format=", "HEAD")).toBe("memex/storage-decision.md");
    expect(note).toMatchObject({ source: agent.source, session: agent.session, why: agent.why });
  });

  it("init scaffolds .gitattributes, .gitignore, memex.json, a seed note and one commit", async () => {
    const target = path.join(dir, "vault");
    const vault = await initVault(target, { remote: "https://example.invalid/me/vault.git" });
    expect(await readFile(path.join(target, ".gitattributes"), "utf8")).toBe("* text=auto eol=lf\n");
    expect(await readFile(path.join(target, ".gitignore"), "utf8")).toBe(".memex/\n");
    expect(JSON.parse(await readFile(path.join(target, "memex.json"), "utf8"))).toMatchObject({ version: 1 });
    expect(await vault.listNotePaths()).toEqual(["memex/welcome-to-memex.md"]);
    expect(gitIn(target, "rev-list", "--count", "HEAD")).toBe("1");
    expect(gitIn(target, "status", "--porcelain")).toBe("");
    expect(gitIn(target, "remote", "get-url", "origin")).toBe("https://example.invalid/me/vault.git");
    await expect(initVault(target)).rejects.toThrow(/already/);
  });

  it("pins a provided identity to the vault's git config and authors the initial commit with it", async () => {
    const target = path.join(dir, "vault");
    await initVault(target, { identity: { name: "Ada Lovelace", email: "ada@example.com" } });
    expect(gitIn(target, "config", "user.name")).toBe("Ada Lovelace");
    expect(gitIn(target, "config", "user.email")).toBe("ada@example.com");
    expect(gitIn(target, "log", "-1", "--format=%an <%ae>")).toBe("Ada Lovelace <ada@example.com>");
    expect(gitIn(target, "log", "-1", "--format=%cn <%ce>")).toBe("Ada Lovelace <ada@example.com>");
  });
});
