import { defineConfig } from "vitest/config";

export default defineConfig({
  // Resolve the tsconfig `@/*` path alias (native in Vite 4+).
  resolve: { tsconfigPaths: true },
  test: {
    // DB integration tests share one Neon database; run files serially so
    // concurrent suites don't race on the same rows.
    fileParallelism: false,
    setupFiles: ["./test/setup.ts"],
  },
});
