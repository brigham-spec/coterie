import { describe, expect, test } from "vitest";

import {
  assertHttpUrl,
  httpUrlOrNull,
  optionalDate,
  optionalUrl,
  requiredDate,
} from "@/lib/form-fields";

// The date guards must reject a present-but-unparseable value (the Invalid Date
// that a raw `new Date(raw)` would silently persist) while still treating an empty
// optional field as null.

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

describe("optionalDate", () => {
  test("empty field → null", () => {
    expect(optionalDate(fd({ d: "" }), "d")).toBeNull();
    expect(optionalDate(fd({}), "d")).toBeNull();
  });

  test("valid YYYY-MM-DD → Date", () => {
    const d = optionalDate(fd({ d: "2026-07-09" }), "d");
    expect(d?.toISOString().slice(0, 10)).toBe("2026-07-09");
  });

  test("unparseable value throws", () => {
    expect(() => optionalDate(fd({ d: "not-a-date" }), "d")).toThrow(
      "d is not a valid date",
    );
  });
});

describe("requiredDate", () => {
  test("empty field throws", () => {
    expect(() => requiredDate(fd({ d: "" }), "d")).toThrow("d is required");
  });

  test("valid YYYY-MM-DD → Date", () => {
    const d = requiredDate(fd({ d: "2026-01-31" }), "d");
    expect(d.toISOString().slice(0, 10)).toBe("2026-01-31");
  });

  test("unparseable value throws", () => {
    expect(() => requiredDate(fd({ d: "2026-13-40" }), "d")).toThrow(
      "d is not a valid date",
    );
  });
});

// The URL guards keep a script-executing scheme (`javascript:`/`data:`) from
// reaching an href, while letting bare-domain website input through unchanged.
describe("optionalUrl", () => {
  test("empty field → null", () => {
    expect(optionalUrl(fd({ u: "" }), "u")).toBeNull();
    expect(optionalUrl(fd({}), "u")).toBeNull();
  });

  test("http(s) URL passes through trimmed", () => {
    expect(optionalUrl(fd({ u: " https://example.com/x " }), "u")).toBe(
      "https://example.com/x",
    );
    expect(optionalUrl(fd({ u: "HTTP://example.com" }), "u")).toBe(
      "HTTP://example.com",
    );
  });

  test("scheme-less bare domain passes through (common website input)", () => {
    expect(optionalUrl(fd({ u: "acme.com" }), "u")).toBe("acme.com");
  });

  test("script-executing scheme throws", () => {
    expect(() => optionalUrl(fd({ u: "javascript:alert(1)" }), "u")).toThrow(
      "u must be an http(s) URL",
    );
    expect(() =>
      optionalUrl(fd({ u: "data:text/html,<script>" }), "u"),
    ).toThrow("u must be an http(s) URL");
  });
});

describe("assertHttpUrl", () => {
  test("empty string passes through", () => {
    expect(assertHttpUrl("", "website")).toBe("");
  });

  test("http(s) URL and bare domain pass through", () => {
    expect(assertHttpUrl("https://a.co", "website")).toBe("https://a.co");
    expect(assertHttpUrl("acmelogistics.com", "website")).toBe(
      "acmelogistics.com",
    );
  });

  test("script-executing scheme throws", () => {
    expect(() => assertHttpUrl("javascript:void(0)", "website")).toThrow(
      "website must be an http(s) URL",
    );
  });
});

describe("httpUrlOrNull", () => {
  test("http(s) URL survives, everything else → null (never throws)", () => {
    expect(httpUrlOrNull("https://a.co")).toBe("https://a.co");
    expect(httpUrlOrNull("javascript:alert(1)")).toBeNull();
    expect(httpUrlOrNull("")).toBeNull();
    expect(httpUrlOrNull(null)).toBeNull();
    expect(httpUrlOrNull(undefined)).toBeNull();
  });
});
