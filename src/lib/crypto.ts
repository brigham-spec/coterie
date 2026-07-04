import "server-only";

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";

// App-layer encryption for integration credentials (build item 6, spec §3.16;
// cardinal rule #4 — tokens live only as ciphertext at rest). We encrypt here,
// in the app, so the database never sees a plaintext token even in a dump or a
// replica. AES-256-GCM gives us confidentiality AND integrity: a tampered
// ciphertext fails the auth-tag check on decrypt and throws.
//
// Wire format of the returned Buffer (what goes in the Bytes column):
//   [ 12-byte IV | 16-byte GCM auth tag | ciphertext ]
// The key is INTEGRATION_ENC_KEY (base64 of exactly 32 bytes). Rotating it
// orphans every stored token, so it is treated as permanent (see .env.example).

const IV_LEN = 12; // 96-bit nonce, the GCM standard
const TAG_LEN = 16;

let cachedKey: Buffer | null = null;

function key(): Buffer {
  if (cachedKey != null) return cachedKey;
  const raw = process.env.INTEGRATION_ENC_KEY;
  if (!raw) throw new Error("INTEGRATION_ENC_KEY is not set");
  const buf = Buffer.from(raw, "base64");
  if (buf.length !== 32)
    throw new Error(
      `INTEGRATION_ENC_KEY must decode to 32 bytes, got ${buf.length}`,
    );
  cachedKey = buf;
  return buf;
}

// Returns a fresh Uint8Array (not a Node Buffer) so it drops straight into a
// Prisma `Bytes` column, whose type is `Uint8Array<ArrayBuffer>`.
export function encryptSecret(plaintext: string): Uint8Array<ArrayBuffer> {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  // Assemble over a fresh ArrayBuffer so the return type is
  // Uint8Array<ArrayBuffer> — what a Prisma `Bytes` column expects.
  const out = new Uint8Array(iv.length + tag.length + ciphertext.length);
  out.set(iv, 0);
  out.set(tag, iv.length);
  out.set(ciphertext, iv.length + tag.length);
  return out;
}

export function decryptSecret(payload: Uint8Array): string {
  if (payload.length < IV_LEN + TAG_LEN)
    throw new Error("ciphertext is too short to be valid");
  const iv = payload.subarray(0, IV_LEN);
  const tag = payload.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const ciphertext = payload.subarray(IV_LEN + TAG_LEN);
  const decipher = createDecipheriv("aes-256-gcm", key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString(
    "utf8",
  );
}
