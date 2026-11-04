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
    // A read-only route rejects POST with 405 (the write routes are handled before this branch).
    expect((await fetch(`${base}/api/graph`, { method: "POST" })).status).toBe(405);
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
    expect((await fetch(`${base}/api/graph`, { method: "POST" })).status).toBe(405);
  });

  it("resolves a conflict and clears it from the inbox", async () => {
    const res = await post({ a: "db-old", b: "db-new", action: "keep_b" }, { origin: base });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { superseded: string }).superseded).toBe("db-old");
    expect((await get("/api/conflicts")).json.conflicts).toHaveLength(0);
    expect((await get("/api/note/db-old")).json.note.status).toBe("superseded");
  });
});

describe("POST /api/notes (create / update) and archive routes", () => {
  const post = (route: string, body: unknown, headers: Record<string, string> = {}) =>
    fetch(`${base}${route}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });

  it("enforces the same write gate as resolve", async () => {
    const good = { title: "Gate note", body: "x", project: "w1" };
    expect((await fetch(`${base}/api/notes`, { method: "POST", headers: { "content-type": "text/plain" }, body: JSON.stringify(good) })).status).toBe(403);
    expect((await post("/api/notes", good, { origin: "https://evil.example" })).status).toBe(403);
    expect((await post("/api/notes/archive", { id: "x" }, { origin: "https://evil.example" })).status).toBe(403);
  });

  it("returns 400 on malformed or non-object bodies and bad fields", async () => {
    expect((await fetch(`${base}/api/notes`, { method: "POST", headers: { "content-type": "application/json" }, body: "not json" })).status).toBe(400);
    expect((await post("/api/notes", [1, 2, 3])).status).toBe(400); // array, not an object
    expect((await post("/api/notes", { title: "   ", body: "x" })).status).toBe(400); // empty title
    expect((await post("/api/notes", { title: "No body" })).status).toBe(400);
    expect((await post("/api/notes", { title: "Bad tags", body: "x", tags: ["ok", 5] })).status).toBe(400);
    expect((await post("/api/notes/archive", { id: "../etc" })).status).toBe(400); // not a valid id
    expect((await post("/api/notes/archive", {})).status).toBe(400); // missing id
  });

  it("creates a note as one call and lists it; a colliding key surfaces a contradiction warning", async () => {
    const first = await post("/api/notes", { title: "Store A", body: "We use Redis.", project: "w1", key: "wkey", why: "first" });
    expect(first.status).toBe(200);
    const firstJson = (await first.json()) as { created: boolean; note: { id: string }; warnings: unknown[] };
    expect(firstJson.created).toBe(true);
    expect(firstJson.note.id).toBe("store-a");
    expect(firstJson.warnings).toHaveLength(0);
    expect((await get("/api/notes")).json.notes.map((n: { id: string }) => n.id)).toContain("store-a");

    const second = await post("/api/notes", { title: "Store B", body: "We use Memcached.", project: "w1", key: "wkey", why: "second" });
    const secondJson = (await second.json()) as { warnings: { id: string }[] };
    expect(secondJson.warnings.map((w) => w.id)).toContain("store-a");

    // Re-using a title updates in place (created: false).
    const update = await post("/api/notes", { title: "Store A", body: "We use Redis Cluster.", project: "w1" });
    expect(((await update.json()) as { created: boolean }).created).toBe(false);
    expect((await get("/api/note/store-a")).json.note.body).toContain("Redis Cluster");
  });

  it("archives (never deletes) and restores a note, with the Archived view and the graph honouring it", async () => {
    await post("/api/notes", { title: "Throwaway", body: "temporary thought", project: "w2" });
    const arch = await post("/api/notes/archive", { id: "throwaway" }, { origin: base });
    expect(arch.status).toBe(200);
    expect(((await arch.json()) as { note: { status: string } }).note.status).toBe("archived");

    // Hidden from the default list and the graph, but still readable and listable on demand.
    expect((await get("/api/notes")).json.notes.map((n: { id: string }) => n.id)).not.toContain("throwaway");
    expect((await get("/api/notes?includeArchived=1")).json.notes.map((n: { id: string }) => n.id)).toContain("throwaway");
    expect((await get("/api/note/throwaway")).json.note.status).toBe("archived");
    expect((await get("/api/graph")).json.nodes.map((n: { id: string }) => n.id)).not.toContain("throwaway");

    // Archiving twice is a no-op error; restoring brings it back to active.
    expect((await post("/api/notes/archive", { id: "throwaway" })).status).toBe(409);
    expect((await post("/api/notes/unarchive", { id: "nope" })).status).toBe(409);
    const restored = await post("/api/notes/unarchive", { id: "throwaway" }, { origin: base });
    expect(((await restored.json()) as { note: { status: string } }).note.status).toBe("active");
    expect((await get("/api/notes")).json.notes.map((n: { id: string }) => n.id)).toContain("throwaway");
  });
});
