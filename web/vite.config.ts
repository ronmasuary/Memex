import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig, type Plugin } from "vite";
import { createHandler } from "../src/serve.ts";
import { Vault } from "../src/vault.ts";


/**
 * Dev only: mount the SAME read-only handler that `memex serve` uses, so `npm run dev` is one
 * process with no proxy and no CORS. Non-/api requests fall through to Vite via `next`.
 * Point it at a vault with MEMEX_VAULT (defaults to ../memex-vault).
 */
function memexApi(): Plugin {
  return {
    name: "memex-api",
    apply: "serve",
    configureServer(server) {
      const root = path.resolve(process.env.MEMEX_VAULT ?? "../memex-vault");
      server.middlewares.use(createHandler({ vault: new Vault(root) }));
      server.config.logger.info(`  memex API reading vault: ${root}`);
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), memexApi()],
});
