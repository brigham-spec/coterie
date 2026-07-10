import "server-only";

// Server-only fetch seam for Email Intelligence (slice 11.12). Isolated from the
// pure parser/matcher (@/lib/email-intel) so the network call is the only thing an
// integration test needs to mock. The caller validates the URL with
// isPublishedSheetUrl before handing it here (SSRF guard).
export async function fetchEmailCsv(url: string): Promise<string> {
  const resp = await fetch(url, { redirect: "follow" });
  if (!resp.ok)
    throw new Error(`sheet fetch failed (${resp.status})`);
  return resp.text();
}
