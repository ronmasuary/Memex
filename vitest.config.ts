import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    // The "git provenance (real repo)" suites spawn real git subprocesses; a cold Windows CI
    // runner exceeds the 5s default. Give them headroom on all OSes.
    testTimeout: 20000,
  },
});
