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
      const handler = createHandler({ vault: new Vault(root) });
      // `vite dev --host` binds the dev server to the LAN. Writes are already gated to a loopback
      // peer, but the READ API would otherwise serve note bodies and provenance unauthenticated to
      // the whole network. Gate every /api request on a loopback peer too, so `--host` can preview
      // the UI on another device without also exposing the vault's contents. `memex serve`
      // (production) listens on 127.0.0.1 only and never reaches this path.
      const isLoopback = (addr: string | undefined) =>
        addr === "127.0.0.1" || addr === "::1" || addr === "::ffff:127.0.0.1";
      server.middlewares.use((req, res, next) => {
        const isApi = req.url === "/api" || req.url?.startsWith("/api/") || req.url?.startsWith("/api?");
        if (isApi && !isLoopback(req.socket.remoteAddress ?? undefined)) {
          res.statusCode = 403;
          res.setHeader("content-type", "application/json; charset=utf-8");
          res.end(JSON.stringify({ error: "the memex dev API is only served to loopback clients" }));
          return;
        }
        handler(req, res, next);
      });
      server.config.logger.info(`  memex API reading vault: ${root}`);
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), memexApi()],
});
