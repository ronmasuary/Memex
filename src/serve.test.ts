import { mkdtemp, rm } from "node:fs/promises";
import type http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startServer } from "./serve.js";
import { Vault } from "./vault.js";

let dir: string;
let server: http.Server;
let base: string;

const prov = { source: "test/agent", session: "s1", why: "fixture" };

beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "memex-serve-"));
  const vault = new Vault(dir);
  await vault.writeNote({ title: "Alpha", body: "See [[beta]] and [[Missing Note]] and <b>raw</b>.", project: "p1" }, prov, { commit: false });
  await vault.writeNote({ title: "Beta", body: "Back to [[alpha|the alpha]].", project: "p2" }, prov, { commit: false });
  await vault.writeNote({ title: "Clash", body: "x", project: "p2", status: "conflict", key: "k" }, prov, { commit: false });
  await vault.writeNote({ title: "Db old", body: "We use Postgres.", project: "p1", key: "db" }, prov, { commit: false });
  await new Promise((r) => setTimeout(r, 15));
  await vault.writeNote({ title: "Db new", body: "We use SQLite.", project: "p1", key: "db" }, prov, { commit: false });
  server = await startServer({ vault, port: 0, webDist: path.join(dir, "no-dist") });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise((r) => server.close(r));
  await rm(dir, { recursive: true, force: true });
});

const get = async (p: string) => {
  const res = await fetch(base + p);
  return { status: res.status, json: (await res.json()) as Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any
};

describe("read API", () => {
  it("lists and groups notes by project", async () => {
    const { json } = await get("/api/notes?group=project");
    expect(json.notes).toHaveLength(5);
    expect(json.groups.map((g: { project: string }) => g.project)).toEqual(["p1", "p2"]);
    expect((await get("/api/notes?project=p2")).json.notes).toHaveLength(2);
  });

  it("renders a note with resolved wikilinks, backlinks and provenance", async () => {
    const { json } = await get("/api/note/alpha");
    expect(json.html).toContain('href="/note/beta"');
    expect(json.html).toContain("wikilink missing");
    expect(json.html).not.toContain("<b>");
    expect(json.provenance.source).toBe("test/agent");
    expect(json.backlinks).toEqual([{ id: "beta", title: "Beta", project: "p2" }]);
  });

  it("serves graph data and conflicts, and rejects bad requests", async () => {
    const graph = (await get("/api/graph")).json;
    expect(graph.edges).toEqual(expect.arrayContaining([{ source: "alpha", target: "beta" }, { source: "beta", target: "alpha" }]));
    expect(graph.edges).toHaveLength(2);
    const inbox = (await get("/api/conflicts")).json;
    expect(inbox.conflicts.map((c: { id: string }) => c.id)).toEqual(["db-old~db-new"]);
    expect(inbox.conflicts[0].a.body).toContain("Postgres");
    expect(inbox.conflicts[0].b.provenance.source).toBe("test/agent");
    expect(inbox.conflicts[0].aValues).toContain("postgres");
    expect(inbox.flagged.map((c: { id: string }) => c.id)).toEqual(["clash"]);
    expect((await get("/api/note/nope")).status).toBe(404);
    expect((await get("/api/note/..%2f..%2fetc")).status).toBe(404);
    expect((await fetch(`${base}/api/notes`, { method: "POST" })).status).toBe(405);
  });
});

describe("POST /api/conflicts/resolve (the one write route)", () => {
  const post = (body: unknown, headers: Record<string, string> = {}) =>
    fetch(`${base}/api/conflicts/resolve`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });

  it("rejects wrong content-type, cross-origin posts, bad input and non-conflicts", async () => {
    const good = { a: "db-old", b: "db-new", action: "keep_a" };
    expect((await fetch(`${base}/api/conflicts/resolve`, { method: "POST", headers: { "content-type": "text/plain" }, body: JSON.stringify(good) })).status).toBe(403);
    expect((await post(good, { origin: "https://evil.example" })).status).toBe(403);
    expect((await post({ a: "db-old", b: "db-new", action: "delete_all" })).status).toBe(400);
    expect((await post({ a: "../x", b: "db-new", action: "keep_a" })).status).toBe(400);
    expect((await post({ a: "alpha", b: "beta", action: "keep_a" })).status).toBe(409);
    expect((await post({ a: "db-old", b: "db-new", action: "keep_both" })).status).toBe(409); // needs a note
    expect((await get("/api/conflicts")).json.conflicts).toHaveLength(1);
    expect((await fetch(`${base}/api/conflicts/resolve`)).status).toBe(404);
    expect((await fetch(`${base}/api/notes`, { method: "POST" })).status).toBe(405);
  });

  it("resolves a conflict and clears it from the inbox", async () => {
    const res = await post({ a: "db-old", b: "db-new", action: "keep_b" }, { origin: base });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { superseded: string }).superseded).toBe("db-old");
    expect((await get("/api/conflicts")).json.conflicts).toHaveLength(0);
    expect((await get("/api/note/db-old")).json.note.status).toBe("superseded");
  });
});
