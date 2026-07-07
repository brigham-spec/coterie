import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Project conventions (CLAUDE.md): strict mode, no `any`.
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      // Honor the codebase-wide `_`-prefix convention for intentionally-unused
      // bindings. Required for framework-imposed signatures such as a
      // useActionState form action that consumes neither `prevState` nor
      // `formData` — the `after-used` default only forgives leading unused args,
      // not a signature where every arg is unused.
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Prisma-generated client (gitignored, regenerated on install).
    "src/generated/**",
  ]),
]);

export default eslintConfig;
