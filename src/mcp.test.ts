import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { simpleGit } from "simple-git";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createServer } from "./mcp.js";
import { initVault } from "./vault.js";

let dir: string;
let client: Client;

async function call(name: string, args: Record<string, unknown>): Promise<string> {
  const res = await client.callTool({ name, arguments: args });
  const content = res.content as { type: string; text: string }[];
  return content.map((c) => c.text).join("\n");
}

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "memex-mcp-"));
  const vault = await initVault(path.join(dir, "vault"));
  const server = createServer(vault);
  const [a, b] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: "test-client", version: "1.0.0" });
  await Promise.all([server.connect(a), client.connect(b)]);
});

afterEach(async () => {
  await client.close();
  await rm(dir, { recursive: true, force: true });
});

describe("memex MCP server (in-memory transport)", () => {
  it("exposes exactly the seven tools", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(
      ["get_backlinks", "list_notes", "list_tags", "read_note", "recall", "remember", "resolve_conflict"],
    );
  });

  it("remember -> recall -> read_note, with contradiction warning and silent restatement", async () => {
    const saved = await call("remember", {
      title: "Storage decision",
      body: "We store notes in Postgres.",
      project: "memex",
      tags: ["decision"],
      key: "storage-choice",
      why: "user confirmed",
    });
    expect(saved).toContain("Saved note storage-decision");
    expect(saved).not.toContain("WARNING");

    const recalled = await call("recall", { query: "postgres" });
    expect(recalled).toContain("Storage decision");
    expect(recalled).toContain("[id: storage-decision]");

    const read = await call("read_note", { id: "storage-decision" });
    expect(read).toContain("We store notes in Postgres.");
    expect(read).toContain("why: user confirmed");
    expect(read).toContain("source: mcp/test-client");
    expect(await call("read_note", { id: "storage-decision", maxChars: 5 })).toContain("truncated");

    // Restatement of the same fact: silent.
    const restated = await call("remember", {
      title: "Where notes live",
      body: "Postgres is where all of our notes end up living.",
      project: "memex",
      key: "storage-choice",
    });
    expect(restated).toContain("Saved note where-notes-live");
    expect(restated).not.toContain("WARNING");

    // Deliberate contradiction: warns, naming the older notes.
    const contradiction = await call("remember", {
      title: "Storage switch",
      body: "We store notes in SQLite.",
      project: "memex",
      key: "storage-choice",
    });
    expect(contradiction).toContain("WARNING");
    expect(contradiction).toContain("may contradict");
    expect(contradiction).toContain("storage-decision");

    // An explicit supersede is silent.
    const superseding = await call("remember", {
      title: "Storage final",
      body: "We store notes in DuckDB.\n\nSupersedes: [[storage-decision]], [[where-notes-live]], [[storage-switch]]",
      project: "memex",
      key: "storage-choice",
    });
    expect(superseding).not.toContain("WARNING");

    expect(await call("list_tags", {})).toContain("decision (1)");
    expect(await call("list_notes", { project: "memex", tag: "decision" })).toContain("storage-decision");
    expect(await call("get_backlinks", { id: "storage-decision" })).toContain("storage-final");
  });

  it("one remember makes exactly one commit", async () => {
    const before = await countCommits();
    await call("remember", { title: "One commit", body: "hello", why: "test" });
    expect((await countCommits()) - before).toBe(1);
  });

  it("recall never returns more than 8 hits", async () => {
    for (let i = 0; i < 10; i++) await call("remember", { title: `Widget note ${i}`, body: "widget" });
    const out = await call("recall", { query: "widget", limit: 50 });
    expect(out.split("\n").filter((l) => /^\d+\. /.test(l))).toHaveLength(8);
  });

  async function countCommits(): Promise<number> {
    const log = await simpleGit({ baseDir: path.join(dir, "vault") }).log();
    return log.total;
  }
});
