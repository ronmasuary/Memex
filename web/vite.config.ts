import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig, type Plugin } from "vite";

/**
 * Dev only: mount the SAME read-only handler that `memex serve` uses, so `npm run dev` is one
 * process with no proxy and no CORS. Non-/api requests fall through to Vite via `next`.
 * Point it at a vault with MEMEX_VAULT (defaults to ../memex-vault).
 *
 * `src/serve.ts` (and its root-only deps like markdown-it) are imported lazily inside
 * `configureServer`, so `vite build` never pulls them into the config graph — the web build
 * stays self-contained and a fresh `cd web && npm i && npm run build` works without a root install.
 */
function memexApi(): Plugin {
  return {
    name: "memex-api",
    apply: "serve",
    async configureServer(server) {
      const { createHandler } = await import("../src/serve.ts");
      const { Vault } = await import("../src/vault.ts");
      const root = path.resolve(process.env.MEMEX_VAULT ?? "../memex-vault");
      // Note: running `vite dev --host` binds the dev server to the LAN, which exposes this
      // read API (unauthenticated) to the local network. Writes stay safe — the resolve route
      // enforces a loopback peer check regardless of bind address — but keep a private vault on
      // the default localhost bind. `memex serve` (production) listens on 127.0.0.1 only.
      server.middlewares.use(createHandler({ vault: new Vault(root) }));
      server.config.logger.info(`  memex API reading vault: ${root}`);
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), memexApi()],
});
