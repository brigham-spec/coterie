import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  // Resolve the tsconfig `@/*` path alias (native in Vite 4+).
  resolve: {
    tsconfigPaths: true,
    // `server-only` throws when imported outside a client/server bundle split.
    // Under Vitest (plain Node) there is no bundle, so stub it to a no-op.
    alias: {
      "server-only": fileURLToPath(
        new URL("./test/stubs/server-only.ts", import.meta.url),
      ),
    },
  },
  test: {
    // DB integration tests share one Neon database; run files serially so
    // concurrent suites don't race on the same rows.
    fileParallelism: false,
    setupFiles: ["./test/setup.ts"],
  },
});
