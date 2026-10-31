#!/usr/bin/env node
import { existsSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { DEFAULT_LIMIT, SearchIndex } from "./search.js";
import { DEFAULT_PORT, DEFAULT_WEB_DIST, startServer } from "./serve.js";
import { initVault, Vault } from "./vault.js";

const USAGE = `memex <command>

  init [dir] [--remote <url>]            create a vault (default dir: ./memex-vault)
  reindex [--vault <dir>]                rebuild the search index from markdown
  find <query> [--vault <dir>] [--project <p>] [--limit <n>]
  serve [--vault <dir>] [--port <n>]     browse the vault in the browser (default port 4321)

The vault is --vault, else $MEMEX_VAULT, else the current directory.`;

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
          options: { remote: { type: "string" } },
        });
        const vault = await initVault(positionals[0] ?? "memex-vault", { remote: values.remote });
        io.out(`Initialized Memex vault at ${vault.root}`);
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
          project: values.project,
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
        const port = values.port ? Number(values.port) : DEFAULT_PORT;
        if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("--port must be 0-65535");
        const server = await startServer({ vault: resolveVault(values.vault), port, webDist: DEFAULT_WEB_DIST });
        const addr = server.address();
        const actual = typeof addr === "object" && addr ? addr.port : port;
        io.out(`Memex UI + API on http://127.0.0.1:${actual}  (Ctrl+C to stop)`);
        if (!existsSync(DEFAULT_WEB_DIST)) io.err("web/dist not found: only /api is served. Run `npm --prefix web run build`.");
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
