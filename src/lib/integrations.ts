import "server-only";

import { withOrg } from "@/lib/tenant";
import { encryptSecret, decryptSecret } from "@/lib/crypto";

// Per-org integration credentials (build item 6, spec §3.16). This is the only
// place tokens are written or read: they are encrypted on the way in and
// decrypted on the way out (see @/lib/crypto), so the rest of the app — and the
// database — only ever handle ciphertext. All access is withOrg-scoped, so one
// org can never read another's tokens (RLS + the unique (org_id, provider)).

export type Provider = "fireflies" | "gmail" | "gcal" | "quickbooks";

export type CredentialInput = {
  accessToken: string;
  refreshToken?: string | null;
  scopes?: string[];
  expiresAt?: Date | null;
};

export type Credential = {
  accessToken: string;
  refreshToken: string | null;
  scopes: string[];
  expiresAt: Date | null;
};

export async function storeCredential(
  orgId: string,
  provider: Provider,
  input: CredentialInput,
): Promise<void> {
  const accessTokenEnc = encryptSecret(input.accessToken);
  const refreshTokenEnc =
    input.refreshToken == null ? null : encryptSecret(input.refreshToken);

  await withOrg(orgId, (tx) =>
    tx.integrationCredential.upsert({
      where: { orgId_provider: { orgId, provider } },
      create: {
        orgId,
        provider,
        accessTokenEnc,
        refreshTokenEnc,
        scopes: input.scopes ?? [],
        expiresAt: input.expiresAt ?? null,
      },
      update: {
        accessTokenEnc,
        refreshTokenEnc,
        scopes: input.scopes ?? [],
        expiresAt: input.expiresAt ?? null,
      },
    }),
  );
}

export async function getCredential(
  orgId: string,
  provider: Provider,
): Promise<Credential | null> {
  const row = await withOrg(orgId, (tx) =>
    tx.integrationCredential.findUnique({
      where: { orgId_provider: { orgId, provider } },
    }),
  );
  if (row == null) return null;

  return {
    accessToken: decryptSecret(row.accessTokenEnc),
    refreshToken:
      row.refreshTokenEnc == null
        ? null
        : decryptSecret(row.refreshTokenEnc),
    scopes: row.scopes,
    expiresAt: row.expiresAt,
  };
}

// Whether a credential exists, without decrypting it — for connection-state UI
// that only needs a yes/no and should never touch the plaintext token.
export async function hasCredential(
  orgId: string,
  provider: Provider,
): Promise<boolean> {
  const row = await withOrg(orgId, (tx) =>
    tx.integrationCredential.findUnique({
      where: { orgId_provider: { orgId, provider } },
      select: { provider: true },
    }),
  );
  return row != null;
}

export async function deleteCredential(
  orgId: string,
  provider: Provider,
): Promise<void> {
  await withOrg(orgId, (tx) =>
    tx.integrationCredential.deleteMany({ where: { provider } }),
  );
}
