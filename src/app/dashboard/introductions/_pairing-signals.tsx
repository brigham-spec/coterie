// Shared presentational bits for a proactive pairing's time-sensitivity + cluster
// signals (S6c, items 13/15 — the prototype's Urgent Signals trigger/window line at
// Coterie.html:14670 and Connection Clusters at :14903). The engine's Urgent Signals
// panel and the dashboard's Possible Introductions panel both surface the same
// urgencyTrigger/window/clusterNote fields, so the rendering lives here once.
//
// Pure JSX — no hooks, no data access. Callers decide when to render (both gate on
// `p.urgencyTrigger !== "" || p.window !== ""` for the banner and on
// `p.clusterNote.trim().length > CLUSTER_NOTE_MIN` for the note). ClusterNote is kept
// FLUSH (no rounding/border) so a caller can either drop it into an already-rounded
// overflow-hidden card (engine ClusterCard) or wrap it in its own bordered box
// (dashboard PairingCard).

/** A clusterNote shorter than this is treated as noise and not surfaced. */
export const CLUSTER_NOTE_MIN = 10;

/** PURE: the 3–5 match-strength score as a plain quality word, so a pairing badge
 * reads as a rating ("Strong") rather than a count ("5/5"). Production clamps the
 * score to 3–5; anything at/above each rung takes that word. */
export function fitLabel(score: number): string {
  if (score >= 5) return "Strong";
  if (score === 4) return "Good";
  return "Possible";
}

// Rendered only when the scan flagged the pair as time-sensitive, so a gold-accented
// card reads as "act now" while ordinary high-value pairs stay unadorned.
export function UrgencyBanner({
  trigger,
  window: timeWindow,
}: {
  trigger: string;
  window: string;
}) {
  return (
    <div className="mt-1.5 rounded-sm border border-gold-line bg-gold-bg/50 px-2 py-1 text-[10px] leading-relaxed text-ink-2">
      {trigger ? (
        <span>
          <span className="font-semibold tracking-[0.04em] text-gold-ink uppercase">
            Trigger
          </span>{" "}
          {trigger}
        </span>
      ) : null}
      {trigger && timeWindow ? <span className="text-ink-3"> · </span> : null}
      {timeWindow ? (
        <span>
          <span className="font-semibold tracking-[0.04em] text-gold-ink uppercase">
            Window
          </span>{" "}
          {timeWindow}
        </span>
      ) : null}
    </div>
  );
}

// The teal "complete the cluster" note: a THIRD network company would complete a
// powerful triad. Flush by design (see file header).
export function ClusterNote({ note }: { note: string }) {
  return (
    <div className="bg-teal-bg/40 px-3.5 py-2.5">
      <div className="mb-1 text-[9.5px] font-semibold tracking-[0.06em] text-teal-ink uppercase">
        Complete the cluster
      </div>
      <p className="text-[11px] leading-relaxed text-ink-2">{note}</p>
    </div>
  );
}
