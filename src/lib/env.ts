import "server-only";

import { encKeyProblem } from "@/lib/crypto";

// Fail-fast environment validation, run once at server startup from
// instrumentation.ts. A missing or malformed secret otherwise surfaces as a
// confusing error deep inside a request — or, worse, as a silently disabled
// security control (e.g. Inngest signature verification, which the SDK skips
// when its signing key is unset). Checking everything at boot turns those into
// one clear startup failure that lists every problem at once.
//
// Policy: in production a missing REQUIRED var throws — the server must not
// serve traffic in a broken or insecure state. Outside production the same
// problems are warnings, since a local checkout legitimately runs without the
// Inngest or Anthropic keys (see .env.example).

type EnvCheck = {
  name: string;
  // Optional format validator; only runs when the var is present. Returns an
  // error fragment (appended after the name), or null when well-formed.
  validate?: (value: string) => string | null;
};

// Every var the app runtime needs. Secrets consumed only by third-party SDKs
// (Clerk, Anthropic) are listed too, so a bad deploy fails at boot rather than
// on the first request that reaches through to them.
const REQUIRED: readonly EnvCheck[] = [
  { name: "DATABASE_URL" },
  { name: "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY" },
  { name: "CLERK_SECRET_KEY" },
  { name: "ANTHROPIC_API_KEY" },
  { name: "INTEGRATION_ENC_KEY", validate: encKeyProblem },
  { name: "INNGEST_SIGNING_KEY" },
  { name: "INNGEST_EVENT_KEY" },
];

type EnvSource = Record<string, string | undefined>;

export function collectEnvProblems(env: EnvSource = process.env): string[] {
  const problems: string[] = [];
  for (const check of REQUIRED) {
    const value = env[check.name];
    if (value == null || value === "") {
      problems.push(`${check.name} is not set`);
      continue;
    }
    const formatError = check.validate?.(value);
    if (formatError) problems.push(`${check.name} ${formatError}`);
  }
  return problems;
}

// Throws in production when anything is missing/malformed; warns otherwise.
export function validateEnv(env: EnvSource = process.env): void {
  const problems = collectEnvProblems(env);
  if (problems.length === 0) return;

  const message = ["Environment validation failed:", ...problems.map((p) => `  - ${p}`)].join(
    "\n",
  );

  if (env.NODE_ENV === "production") throw new Error(message);
  console.warn(`${message}\n(warnings only outside production)`);
}
