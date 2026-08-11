import { afterEach, describe, expect, it, vi } from "vitest";

import { collectEnvProblems, validateEnv } from "@/lib/env";

// Boot-time env validation. collectEnvProblems is pure over a supplied env, so
// most assertions pass a plain object; validateEnv's throw-vs-warn branch keys
// off NODE_ENV.

// A base env with every required var present and well-formed.
const VALID = {
  DATABASE_URL: "postgresql://app_user:pw@host/db?sslmode=verify-full",
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_xxx",
  CLERK_SECRET_KEY: "sk_test_xxx",
  ANTHROPIC_API_KEY: "sk-ant-xxx",
  INTEGRATION_ENC_KEY: Buffer.alloc(32).toString("base64"),
  INNGEST_SIGNING_KEY: "signkey-xxx",
  INNGEST_EVENT_KEY: "eventkey-xxx",
};

describe("collectEnvProblems", () => {
  it("reports nothing when every required var is present and valid", () => {
    expect(collectEnvProblems(VALID)).toEqual([]);
  });

  it("flags a missing required var", () => {
    const { DATABASE_URL: _omit, ...env } = VALID;
    void _omit;
    expect(collectEnvProblems(env)).toContain("DATABASE_URL is not set");
  });

  it("treats an empty string as missing", () => {
    expect(collectEnvProblems({ ...VALID, CLERK_SECRET_KEY: "" })).toContain(
      "CLERK_SECRET_KEY is not set",
    );
  });

  it("flags an encryption key that does not decode to 32 bytes", () => {
    const problems = collectEnvProblems({
      ...VALID,
      INTEGRATION_ENC_KEY: Buffer.alloc(16).toString("base64"),
    });
    expect(problems).toContainEqual(
      expect.stringContaining("INTEGRATION_ENC_KEY must decode to 32 bytes"),
    );
  });

  it("collects every problem at once", () => {
    expect(collectEnvProblems({}).length).toBe(7);
  });
});

describe("validateEnv", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("throws in production when a required var is missing", () => {
    expect(() => validateEnv({ NODE_ENV: "production" })).toThrow(
      /Environment validation failed/,
    );
  });

  it("only warns outside production", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(() => validateEnv({ NODE_ENV: "development" })).not.toThrow();
    expect(warn).toHaveBeenCalledOnce();
  });

  it("is silent when everything is valid", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(() =>
      validateEnv({ ...VALID, NODE_ENV: "production" }),
    ).not.toThrow();
    expect(warn).not.toHaveBeenCalled();
  });
});
