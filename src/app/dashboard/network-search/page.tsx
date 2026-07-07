import { PageTitle } from "@/components/ui";

import { NetworkSearch } from "./_search";

// Network Search (slice 11.5) — natural-language search over the tenant's own
// companies. The page is a thin server shell; the search itself runs in the
// searchNetwork server action (so the Anthropic key never crosses to the browser),
// driven by the client component below.

export default function NetworkSearchPage() {
  return (
    <div className="mx-auto w-full max-w-4xl">
      <PageTitle
        title="Network Search"
        subtitle="Ask anything about your network in plain English."
      />
      <NetworkSearch />
    </div>
  );
}
