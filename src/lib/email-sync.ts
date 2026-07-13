import "server-only";

// Server-only fetch seam for Email Intelligence (slice 11.12). Isolated from the
// pure parser/matcher (@/lib/email-intel) so the network call is the only thing an
// integration test needs to mock. The caller validates the URL with
// isPublishedSheetUrl before handing it here (SSRF guard).
//
// The initial-host allowlist alone is not enough: with redirect:"follow" the
// runtime would chase a 3xx to ANY location, so a redirect off the allowlisted
// host could reach an internal address. We follow redirects MANUALLY instead and
// re-validate every hop against the same Google-owned allowlist. Published Google
// sheets legitimately 307 from docs.google.com to a *.googleusercontent.com host,
// so both are permitted; anything else (or a non-https hop) is refused.

const MAX_REDIRECTS = 5;

function isAllowedHost(url: URL): boolean {
  if (url.protocol !== "https:") return false;
  return (
    url.hostname === "docs.google.com" ||
    url.hostname.endsWith(".googleusercontent.com")
  );
}

export async function fetchEmailCsv(url: string): Promise<string> {
  let current = url;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    let parsed: URL;
    try {
      parsed = new URL(current);
    } catch {
      throw new Error("sheet fetch failed (invalid redirect target)");
    }
    if (!isAllowedHost(parsed))
      throw new Error("sheet fetch failed (redirect left the allowed host)");

    const resp = await fetch(current, { redirect: "manual" });

    if (resp.status >= 300 && resp.status < 400) {
      const location = resp.headers.get("location");
      if (location === null)
        throw new Error(`sheet fetch failed (${resp.status} without location)`);
      // Resolve relative redirects against the current URL, then re-validate on
      // the next loop iteration before any further fetch.
      current = new URL(location, parsed).toString();
      continue;
    }

    if (!resp.ok) throw new Error(`sheet fetch failed (${resp.status})`);
    return resp.text();
  }

  throw new Error("sheet fetch failed (too many redirects)");
}
