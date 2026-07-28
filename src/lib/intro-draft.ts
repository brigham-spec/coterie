// Warm-intro email draft (S6b, item 16 — ported from the prototype's per-result
// "copy email draft" on both intro-engine modes, Coterie.html:14843/14898). PURE
// text assembly: given the two parties, the match headline, and the model's
// talking points, produce a ready-to-paste double-opt-in email with scheduling
// slots the sender fills in. No I/O and no AI — the engine's reasoning is already
// in hand, so the draft is composed client-side and copied to the clipboard.
// Kept here (not inline in the client card) so the wording/slots are unit-tested.

export interface IntroDraftInput {
  /// The sender (the host making the connection).
  host: string;
  /// The party being introduced — "I'd like to introduce you to <introduce>".
  introduce: string;
  /// The recipient the note is addressed to (drives the subject's other side).
  recipient: string;
  /// The one-line "why" for the pairing.
  headline: string;
  /// Up to a few concrete openers; when present they become the reason bullets.
  talkingPoints: readonly string[];
  /// The current trigger — the fallback body when there are no talking points.
  whyNow: string;
}

export interface IntroDraft {
  subject: string;
  body: string;
}

// Placeholder slots the sender replaces before sending — mirrors the prototype's
// "[Date/Time Option N]" scheduling stubs.
const SCHEDULING_SLOTS = [
  "\u2022 [Date/Time Option 1]",
  "\u2022 [Date/Time Option 2]",
  "\u2022 [Date/Time Option 3]",
];

/// Compose the warm double-opt-in email. Symmetric enough to serve both engine
/// modes: the per-member scan introduces the focus to a candidate, and the
/// network scan introduces company A to company B — both map to introduce →
/// recipient. Talking points render as reason bullets; when absent, the single
/// `whyNow` line stands in.
export function buildIntroDraft(input: IntroDraftInput): IntroDraft {
  const headline = input.headline.trim();
  const whyNow = input.whyNow.trim();
  const points = input.talkingPoints
    .map((t) => t.trim())
    .filter((t) => t !== "");

  const lines: string[] = [
    "Hi there,",
    "",
    `I've been meaning to make this connection, and the timing feels right. I'd like to introduce you to ${input.introduce}.${headline ? ` ${headline}` : ""}`,
    "",
  ];

  if (points.length > 0) {
    lines.push("A few reasons I think this is a strong fit:", "");
    for (const t of points) lines.push(`- ${t}`);
    lines.push("");
  } else if (whyNow) {
    lines.push(whyNow, "");
  }

  lines.push(
    "Happy to get the three of us together \u2014 even a quick call to kick things off. A few windows that work on my end:",
    "",
    ...SCHEDULING_SLOTS,
    "",
    "Best,",
    input.host,
  );

  return {
    subject: `Intro: ${input.introduce} \u2194 ${input.recipient}`,
    body: lines.join("\n"),
  };
}
