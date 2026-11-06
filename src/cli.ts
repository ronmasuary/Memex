#!/usr/bin/env node
import { existsSync, realpathSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { gitFor, type CommitAuthor } from "./git.js";
import { DEFAULT_LIMIT, SearchIndex } from "./search.js";
import { DEFAULT_PORT, DEFAULT_WEB_DIST, startServer } from "./serve.js";
import { slugify } from "./slug.js";
import { initVault, Vault } from "./vault.js";

const USAGE = `memex <command>

  init [dir] [--remote <url>] [--name <n> --email <e> | --author "<n> <e>"]
                                         create a vault (default dir: ./memex-vault)
  reindex [--vault <dir>]                rebuild the search index from markdown
  find <query> [--vault <dir>] [--project <p>] [--limit <n>]
  serve [--vault <dir>] [--port <n>]     browse the vault in the browser (default port 4321)
  mcp-config [--vault <dir>] [--host claude|cursor] [--name <n>]
                                         print ready-to-paste MCP host config (resolved absolute paths)

The vault is --vault, else $MEMEX_VAULT, else the current directory.
init stamps the committer identity onto the new vault's git config; without a flag it
takes your git config (or $GIT_AUTHOR_NAME / $GIT_AUTHOR_EMAIL), else a Memex default.`;

export interface Io {
  out(text: string): void;
  err(text: string): void;
}

// CLI results go to stdout, diagnostics to stderr. Written without console.* so the
// no-console lint rule (which protects the future MCP stdio channel) stays strict.
const processIo: Io = {
  out: (text) => void process.stdout.write(`${text}\n`),
  err: (text) => void process.stderr.write(`${text}\n`),
};

/**
 * The identity `memex init` should pin, from explicit flags or git's GIT_AUTHOR_* env vars.
 * `--author "Name <email>"` is one flag; `--name`/`--email` must be given together. Returns
 * undefined when nothing is set, leaving the vault to inherit the ambient git identity.
 */
function resolveInitIdentity(values: { name?: string; email?: string; author?: string }): CommitAuthor | undefined {
  if (values.author !== undefined) {
    const match = /^\s*(.+?)\s*<([^<>]+)>\s*$/.exec(values.author);
    if (!match?.[1] || !match[2]) throw new Error(`--author must look like "Your Name <you@example.com>"`);
    return { name: match[1], email: match[2].trim() };
  }
  const pick = (flag: string | undefined, env: string | undefined) => (flag ?? env ?? "").trim() || undefined;
  const name = pick(values.name, process.env.GIT_AUTHOR_NAME);
  const email = pick(values.email, process.env.GIT_AUTHOR_EMAIL);
  if (name && email) return { name, email };
  if (name || email) throw new Error(`set both --name and --email (or use --author "Your Name <you@example.com>")`);
  return undefined;
}

type McpHost = "claude" | "cursor";

/** Absolute path to the built MCP stdio entry (`dist/mcp.js`), which sits next to this CLI file. */
function mcpEntryPath(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "mcp.js");
}

/** Where the given host reads its MCP server config — a concrete path for this OS. */
function hostConfigPath(host: McpHost): string {
  const home = os.homedir();
  if (host === "cursor") return path.join(home, ".cursor", "mcp.json");
  switch (process.platform) {
    case "win32":
      return path.join(process.env.APPDATA ?? path.join(home, "AppData", "Roaming"), "Claude", "claude_desktop_config.json");
    case "darwin":
      return path.join(home, "Library", "Application Support", "Claude", "claude_desktop_config.json");
    default:
      return path.join(home, ".config", "Claude", "claude_desktop_config.json");
  }
}

function resolveVault(flag: string | undefined): Vault {
  const root = path.resolve(flag ?? process.env.MEMEX_VAULT ?? process.cwd());
  if (!existsSync(path.join(root, "memex.json"))) {
    throw new Error(`${root} is not a Memex vault (no memex.json). Run \`memex init\` first.`);
  }
  return new Vault(root);
}

/** Runs the CLI and returns the process exit code. */
export async function run(argv: string[], io: Io = processIo): Promise<number> {
  const [command, ...rest] = argv;
  try {
    switch (command) {
      case "init": {
        const { values, positionals } = parseArgs({
          args: rest,
          allowPositionals: true,
          options: {
            remote: { type: "string" },
            name: { type: "string" },
            email: { type: "string" },
            author: { type: "string" },
          },
        });
        const identity = resolveInitIdentity(values);
        const vault = await initVault(positionals[0] ?? "memex-vault", { remote: values.remote, identity });
        io.out(`Initialized Memex vault at ${vault.root}`);
        const who = await gitFor(vault.root).getIdentity();
        io.out(`Commits in this vault are authored by ${who.name} <${who.email}>.`);
        if (!identity) {
          io.out(`  Change it for this vault with:`);
          io.out(`    git -C "${vault.root}" config user.name "Your Name"`);
          io.out(`    git -C "${vault.root}" config user.email you@example.com`);
        }
        if (values.remote) io.out(`Remote "origin" -> ${values.remote} (nothing is pushed automatically)`);
        return 0;
      }
      case "reindex": {
        const { values } = parseArgs({ args: rest, options: { vault: { type: "string" } } });
        const stats = await new SearchIndex(resolveVault(values.vault)).rebuild();
        io.out(`Indexed ${stats.added} notes`);
        return 0;
      }
      case "find": {
        const { values, positionals } = parseArgs({
          args: rest,
          allowPositionals: true,
          options: {
            vault: { type: "string" },
            project: { type: "string" },
            limit: { type: "string" },
          },
        });
        const query = positionals.join(" ").trim();
        if (!query) throw new Error("find needs a query");
        const limit = values.limit ? Number.parseInt(values.limit, 10) : DEFAULT_LIMIT;
        if (!Number.isInteger(limit) || limit < 1) throw new Error("--limit must be a positive integer");
        const hits = await new SearchIndex(resolveVault(values.vault)).search(query, {
          // Stored notes live under a slugified project dir, so match the way the write path and the
          // `recall` MCP tool slugify; otherwise `--project "My Project"` matches nothing.
          project: values.project ? slugify(values.project) : undefined,
          limit,
        });
        if (hits.length === 0) io.err("No matches.");
        for (const hit of hits) {
          io.out(`${hit.id}  [${hit.project}]  ${hit.title}  (${hit.score.toFixed(2)})`);
          io.out(`    ${hit.snippet}`);
        }
        return 0;
      }
      case "serve": {
        const { values } = parseArgs({
          args: rest,
          options: { vault: { type: "string" }, port: { type: "string" } },
        });
        const port = values.port ? Number.parseInt(values.port, 10) : DEFAULT_PORT;
        if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("--port must be 0-65535");
        const server = await startServer({ vault: resolveVault(values.vault), port, webDist: DEFAULT_WEB_DIST });
        const addr = server.address();
        const actual = typeof addr === "object" && addr ? addr.port : port;
        io.out(`Memex UI + API on http://127.0.0.1:${actual}  (Ctrl+C to stop)`);
        if (!existsSync(DEFAULT_WEB_DIST)) io.err("web/dist not found: only /api is served. Run `npm --prefix web run build`.");
        return 0;
      }
      case "mcp-config": {
        const { values } = parseArgs({
          args: rest,
          options: {
            vault: { type: "string" },
            host: { type: "string" },
            name: { type: "string" },
          },
        });
        const host = (values.host ?? "claude") as McpHost;
        if (host !== "claude" && host !== "cursor") throw new Error(`--host must be claude or cursor`);
        const name = (values.name ?? "").trim() || "memex";
        const vault = path.resolve(values.vault ?? process.env.MEMEX_VAULT ?? path.join(os.homedir(), "memex-vault"));
        const mcpJs = mcpEntryPath();
        // `command` is the absolute node binary and `args[0]` the absolute server path, because
        // desktop hosts can't resolve `npx` or a PATH `bin`. JSON.stringify escapes Windows backslashes.
        const block = {
          mcpServers: {
            [name]: { command: process.execPath, args: [mcpJs], env: { MEMEX_VAULT: vault } },
          },
        };
        io.out(JSON.stringify(block, null, 2));
        const hostLabel = host === "cursor" ? "Cursor" : "Claude Desktop";
        io.err("");
        io.err(`Merge the block above into ${hostLabel}'s MCP config, then fully restart ${hostLabel}:`);
        io.err(`  ${hostConfigPath(host)}`);
        if (!existsSync(mcpJs)) io.err(`WARNING: ${mcpJs} does not exist yet — run \`npm run build\` first.`);
        if (!existsSync(path.join(vault, "memex.json"))) io.err(`Note: ${vault} is not a Memex vault yet — run \`memex init "${vault}"\` first.`);
        return 0;
      }
      case undefined:
      case "help":
      case "--help":
      case "-h":
        io.out(USAGE);
        return command === undefined ? 1 : 0;
      default:
        io.err(`Unknown command: ${command}\n\n${USAGE}`);
        return 1;
    }
  } catch (err) {
    io.err(`memex: ${(err as Error).message}`);
    return 1;
  }
}

function isMain(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMain()) {
  process.exitCode = await run(process.argv.slice(2));
}
