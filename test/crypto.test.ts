import { describe, it, expect } from "vitest";

import { encryptSecret, decryptSecret } from "@/lib/crypto";

// Unit test for the app-layer credential encryption (build item 6, spec §3.16).
// No database — this exercises the crypto seam in isolation. INTEGRATION_ENC_KEY
// comes from .env via test/setup.ts.

describe("credential encryption", () => {
  it("round-trips a secret", () => {
    const secret = "ff-api-key-1234567890";
    const enc = encryptSecret(secret);
    expect(decryptSecret(enc)).toBe(secret);
  });

  it("round-trips unicode and empty strings", () => {
    for (const secret of ["", "🔐 tökén", "a".repeat(4096)]) {
      expect(decryptSecret(encryptSecret(secret))).toBe(secret);
    }
  });

  it("produces different ciphertext each time (random IV)", () => {
    const secret = "same-input";
    const a = encryptSecret(secret);
    const b = encryptSecret(secret);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
    // ...yet both decrypt back to the same plaintext.
    expect(decryptSecret(a)).toBe(secret);
    expect(decryptSecret(b)).toBe(secret);
  });

  it("rejects a tampered ciphertext (GCM auth tag)", () => {
    const enc = encryptSecret("do-not-tamper");
    enc[enc.length - 1] ^= 0xff; // flip a byte of the ciphertext
    expect(() => decryptSecret(enc)).toThrow();
  });

  it("rejects a truncated payload", () => {
    expect(() => decryptSecret(Buffer.alloc(4))).toThrow();
  });
});
