#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { randomBytes } from "node:crypto";
import { existsSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { detectConflicts, toConflictNote } from "./conflicts.js";
import { suggestExistingKey } from "./keys.js";
import { slugify } from "./slug.js";
import { SearchIndex } from "./search.js";
import { Vault, type Note } from "./vault.js";

// Output caps: a memory tool must never dump tens of KB into the host's context window.
export const CAPS = {
  recallMax: 8,
  snippetChars: 200,
  readDefaultChars: 6000,
  readMaxChars: 20000,
  listDefault: 50,
  listMax: 100,
  tagsMax: 200,
  backlinksMax: 50,
} as const;

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };

const text = (t: string): ToolResult => ({ content: [{ type: "text", text: t }] });
const fail = (t: string): ToolResult => ({ content: [{ type: "text", text: t }], isError: true });

function clamp(value: number | undefined, fallback: number, max: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.max(1, Math.min(max, Math.floor(value)));
}

function newSessionId(): string {
  return `${new Date().toISOString().slice(0, 10)}-${randomBytes(3).toString("hex")}`;
}

/** Build the Memex MCP server (seven tools) over `vault`. Transport-agnostic so tests can use in-memory. */
export function createServer(vault: Vault): McpServer {
  const server = new McpServer({ name: "memex", version: "0.1.0" });
  const index = new SearchIndex(vault);
  const session = newSessionId();

  server.registerTool(
    "remember",
    {
      description:
        "Save or update a note in the user's persistent memory. Re-using a title updates that note. " +
        "Pass a stable `key` for a fact that should have one current value (e.g. 'storage-choice'); " +
        "if a different active note already holds a different value for that key, the result warns you. " +
        "If the project already uses a different-but-similar key, the result nudges you to reuse it. " +
        "To replace an older note on purpose, add a line 'Supersedes: [[old-id]]' to the body.",
      inputSchema: {
        title: z.string().min(1).describe("Short descriptive title; also determines the note id."),
        body: z.string().min(1).describe("Markdown body. Link other notes with [[note-id]]."),
        project: z.string().optional().describe("Project namespace, e.g. 'memex'. Defaults to 'general'."),
        tags: z.array(z.string()).optional(),
        key: z.string().optional().describe("Conflict-grouping key: one current value per key."),
        why: z.string().optional().describe("Why this is being saved (recorded as provenance)."),
      },
    },
    async ({ title, body, project, tags, key, why }) => {
      try {
        const client = server.server.getClientVersion()?.name;
        const source = client ? `mcp/${slugify(client) || "client"}` : "mcp/agent";
        const result = await vault.writeNote(
          { title, body, project, tags, key },
          { source, session, why },
        );
        // `writeNote` already read the whole vault to resolve the id; reuse those notes for
        // contradiction detection instead of scanning the vault a second time.
        const others = result.others.map(toConflictNote);
        const warnings = detectConflicts(toConflictNote(result.note), others);
        const verb = result.created ? "Saved" : result.revived ? "Restored from archive and updated" : "Updated";
        const lines = [`${verb} note ${result.note.id} (${result.note.path}).`];
        if (result.commit) lines.push(`Commit: ${result.commit.slice(0, 7)}`);
        for (const w of warnings) {
          lines.push("", `WARNING: ${w.message}`);
          lines.push(`Once the user decides, settle it with resolve_conflict (a: "${w.id}", b: "${result.note.id}").`);
        }
        // Key hygiene: if this project already uses a different-but-similar key, nudge toward it so
        // same-topic notes share a key and the detector can pair them. Advisory; the save stands.
        // Only when the author PASSES a key in this call — a body-only update inherits the stored key
        // and must not re-emit the nudge on every unrelated edit.
        const similar = key === undefined ? null : suggestExistingKey(key, others, result.note.project);
        if (similar) {
          lines.push(
            "",
            `NUDGE: this project already uses key "${similar}" for related notes; reusing it lets Memex catch contradictions. ` +
              `Re-save with key "${similar}" if they mean the same thing.`,
          );
        }
        return text(lines.join("\n"));
      } catch (err) {
        return fail(`remember failed: ${(err as Error).message}`);
      }
    },
  );

  server.registerTool(
    "recall",
    {
      description: `Search memory. Returns up to ${CAPS.recallMax} ranked hits as title, id and a short snippet. Use read_note for the full text.`,
      inputSchema: {
        query: z.string().min(1),
        project: z.string().optional(),
        limit: z.number().int().optional().describe(`Max hits (default ${CAPS.recallMax}, hard cap ${CAPS.recallMax}).`),
      },
    },
    async ({ query, project, limit }) => {
      try {
        const hits = await index.search(query, {
          project: project ? slugify(project) : undefined,
          limit: clamp(limit, CAPS.recallMax, CAPS.recallMax),
        });
        if (hits.length === 0) return text("No matching notes.");
        return text(
          hits
            .map((h, i) => `${i + 1}. ${h.title} [id: ${h.id}] (${h.project})\n   ${h.snippet.slice(0, CAPS.snippetChars + 2)}`)
            .join("\n"),
        );
      } catch (err) {
        return fail(`recall failed: ${(err as Error).message}`);
      }
    },
  );

  server.registerTool(
    "read_note",
    {
      description: "Read one note's full body by id.",
      inputSchema: {
        id: z.string().min(1),
        maxChars: z.number().int().optional().describe(`Truncate the body (default ${CAPS.readDefaultChars}, max ${CAPS.readMaxChars}).`),
      },
    },
    async ({ id, maxChars }) => {
      try {
        const note = await vault.findById(slugify(id));
        if (!note) return fail(`No note with id "${id}".`);
        const limit = clamp(maxChars, CAPS.readDefaultChars, CAPS.readMaxChars);
        const truncated = note.body.length > limit;
        const header = [
          `# ${note.title}`,
          `id: ${note.id} | project: ${note.project} | tags: ${note.tags.join(", ") || "-"}` +
            (note.key ? ` | key: ${note.key}` : "") +
            ` | status: ${note.status}`,
          `source: ${note.source ?? "-"} | session: ${note.session ?? "-"} | why: ${note.why ?? "-"} | updated: ${note.updated}`,
          "",
        ];
        const body = truncated ? `${note.body.slice(0, limit)}\n… [truncated ${note.body.length - limit} of ${note.body.length} chars]` : note.body;
        return text(`${header.join("\n")}\n${body}`);
      } catch (err) {
        return fail(`read_note failed: ${(err as Error).message}`);
      }
    },
  );

  server.registerTool(
    "get_backlinks",
    {
      description: "List the notes that link to the given note id via [[wikilinks]].",
      inputSchema: { id: z.string().min(1) },
    },
    async ({ id }) => {
      try {
        const target = slugify(id);
        const ids = await index.backlinks(target);
        if (ids.length === 0) return text(`No notes link to ${target}.`);
        const shown = ids.slice(0, CAPS.backlinksMax);
        const more = ids.length > shown.length ? `\n… and ${ids.length - shown.length} more` : "";
        return text(`${ids.length} note(s) link to ${target}:\n${shown.map((s) => `- ${s}`).join("\n")}${more}`);
      } catch (err) {
        return fail(`get_backlinks failed: ${(err as Error).message}`);
      }
    },
  );

  server.registerTool(
    "list_notes",
    {
      description: "List notes (id, title, project, tags), optionally filtered by project and/or tag.",
      inputSchema: {
        project: z.string().optional(),
        tag: z.string().optional(),
        limit: z.number().int().optional().describe(`Default ${CAPS.listDefault}, max ${CAPS.listMax}.`),
      },
    },
    async ({ project, tag, limit }) => {
      try {
        const wantProject = project ? slugify(project) : undefined;
        const wantTag = tag?.trim().toLowerCase();
        const notes = (await loadAll(vault)).filter(
          (n) =>
            (!wantProject || n.project === wantProject) &&
            (!wantTag || n.tags.some((t) => t.toLowerCase() === wantTag)),
        );
        if (notes.length === 0) return text("No notes.");
        const cap = clamp(limit, CAPS.listDefault, CAPS.listMax);
        notes.sort((a, b) => b.updated.localeCompare(a.updated));
        const shown = notes.slice(0, cap);
        const lines = shown.map((n) => `- ${n.title} [id: ${n.id}] (${n.project})${n.tags.length ? ` #${n.tags.join(" #")}` : ""}`);
        if (notes.length > shown.length) lines.push(`… ${notes.length - shown.length} more (raise limit, max ${CAPS.listMax})`);
        return text(lines.join("\n"));
      } catch (err) {
        return fail(`list_notes failed: ${(err as Error).message}`);
      }
    },
  );

  server.registerTool(
    "list_tags",
    {
      description: "List tags with note counts, optionally within one project.",
      inputSchema: { project: z.string().optional() },
    },
    async ({ project }) => {
      try {
        const wantProject = project ? slugify(project) : undefined;
        const counts = new Map<string, number>();
        for (const n of await loadAll(vault)) {
          if (wantProject && n.project !== wantProject) continue;
          for (const t of n.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
        }
        if (counts.size === 0) return text("No tags.");
        const sorted = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
        const lines = sorted.slice(0, CAPS.tagsMax).map(([t, c]) => `${t} (${c})`);
        if (sorted.length > CAPS.tagsMax) lines.push(`… ${sorted.length - CAPS.tagsMax} more`);
        return text(lines.join("\n"));
      } catch (err) {
        return fail(`list_tags failed: ${(err as Error).message}`);
      }
    },
  );

  server.registerTool(
    "resolve_conflict",
    {
      description:
        "Resolve a contradiction between two notes (ids from a `remember` WARNING, or the Conflicts page). " +
        "Only do this when the user has told you which side is right; if unsure, ask them. " +
        "`a` is the older note, `b` the newer. Actions: keep_a (b is marked superseded), keep_b (a is marked superseded), " +
        "or keep_both (requires `note`, a reconciliation explaining how both hold; both stay active). " +
        "Each resolution is exactly one git commit. Nothing is deleted.",
      inputSchema: {
        a: z.string().min(1).describe("Id of the first (older) note."),
        b: z.string().min(1).describe("Id of the second (newer) note."),
        action: z.enum(["keep_a", "keep_b", "keep_both"]),
        note: z.string().optional().describe("Reconciliation text; required for keep_both."),
        why: z.string().optional().describe("Why this resolution (recorded as provenance)."),
      },
    },
    async ({ a, b, action, note, why }) => {
      try {
        const client = server.server.getClientVersion()?.name;
        const source = client ? `mcp/${slugify(client) || "client"}` : "mcp/agent";
        const r = await vault.resolveConflict(slugify(a), slugify(b), action, { source, session, why }, note);
        const lines = [
          action === "keep_both"
            ? `Kept both ${slugify(a)} and ${slugify(b)}; reconciliation note ${r.reconciliation}.`
            : `Kept ${r.kept}; ${r.superseded} is now superseded (history preserved).`,
        ];
        if (r.commit) lines.push(`Commit: ${r.commit.slice(0, 7)}`);
        return text(lines.join("\n"));
      } catch (err) {
        return fail(`resolve_conflict failed: ${(err as Error).message}`);
      }
    },
  );

  return server;
}

async function loadAll(vault: Vault): Promise<Note[]> {
  return Promise.all((await vault.listNotePaths()).map((p) => vault.readNote(p)));
}

/** stdio entry point. stdout is the protocol channel: log to stderr only. */
export async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
  const root = path.resolve(argv[0] ?? process.env.MEMEX_VAULT ?? process.cwd());
  if (!existsSync(path.join(root, "memex.json"))) {
    console.error(`memex-mcp: ${root} is not a Memex vault (no memex.json). Set MEMEX_VAULT or pass the vault path.`);
    process.exit(1);
  }
  const server = createServer(new Vault(root));
  await server.connect(new StdioServerTransport());
  console.error(`memex-mcp: serving vault ${root}`);
}

const entry = process.argv[1];
if (entry && realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url))) {
  main().catch((err) => {
    console.error("memex-mcp: fatal:", err);
    process.exit(1);
  });
}
