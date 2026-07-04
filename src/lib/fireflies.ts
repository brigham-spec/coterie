import "server-only";

// Fireflies GraphQL client (build item 6, spec §3.16). Fireflies records and
// transcribes meetings; we pull transcripts to create Meeting rows, match
// attendees to contacts, and lift action items. This module is transport only —
// it knows how to talk to Fireflies with a given token and returns typed data.
// It does NOT decide which org it is acting for: the caller (the Inngest sync)
// decrypts the per-org token via getCredential and scopes the writes withOrg.
//
// Auth is a per-org Bearer token (a Fireflies API key), stored encrypted in
// integration_credentials and passed in here already decrypted. The token never
// lives in this module beyond the request.

const ENDPOINT = "https://api.fireflies.ai/graphql";

// Shape of a transcript as we request it below. Fireflies exposes far more, but
// we ask only for what the sync needs. `date` is epoch milliseconds (a number).
export type FirefliesAttendee = {
  displayName: string | null;
  email: string | null;
  name: string | null;
};

export type FirefliesTranscript = {
  id: string;
  title: string | null;
  date: number | null;
  transcript_url: string | null;
  summary: {
    overview: string | null;
    action_items: string | null;
  } | null;
  meeting_attendees: FirefliesAttendee[] | null;
};

// Thrown when Fireflies rejects the request (bad/expired token, rate limit, or a
// GraphQL error). The sync maps this to a retry or a surfaced connection error.
export class FirefliesError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message);
    this.name = "FirefliesError";
  }
}

async function firefliesQuery<T>(
  token: string,
  query: string,
  variables: Record<string, unknown>,
): Promise<T> {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!res.ok) {
    throw new FirefliesError(
      `Fireflies request failed with HTTP ${res.status}`,
      res.status,
    );
  }

  const body = (await res.json()) as {
    data?: T;
    errors?: Array<{ message: string }>;
  };

  if (body.errors != null && body.errors.length > 0) {
    throw new FirefliesError(
      body.errors.map((e) => e.message).join("; "),
      res.status,
    );
  }
  if (body.data == null) {
    throw new FirefliesError("Fireflies returned no data", res.status);
  }
  return body.data;
}

const TRANSCRIPTS_QUERY = `
  query Transcripts($limit: Int) {
    transcripts(limit: $limit) {
      id
      title
      date
      transcript_url
      summary {
        overview
        action_items
      }
      meeting_attendees {
        displayName
        email
        name
      }
    }
  }
`;

// Most recent transcripts for the account behind `token`, newest first (as
// Fireflies orders them). `limit` caps how many we pull per sync run.
export async function listTranscripts(
  token: string,
  limit = 25,
): Promise<FirefliesTranscript[]> {
  const data = await firefliesQuery<{ transcripts: FirefliesTranscript[] }>(
    token,
    TRANSCRIPTS_QUERY,
    { limit },
  );
  return data.transcripts;
}
