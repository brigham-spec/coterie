import type { Metadata } from "next";
import type { CSSProperties, ReactNode } from "react";

import { ConnectTrigger } from "./_connect-trigger";
import { NetworkCanvas } from "./_network-canvas";

// Marketing landing for coterienmt.ai. Public, no auth. Served here at /site for
// preview; when the apex is pointed at Vercel this becomes the host-routed home.
// Client Login sends visitors to the app on app.coterienmt.ai.
export const metadata: Metadata = {
  title: "Coterie — The network is the strategy",
  description:
    "Coterie is a relationship intelligence platform — one quiet, intelligent workspace for the people, partners, and introductions that move your most important work forward.",
};

const APP_URL = "https://app.coterienmt.ai";
const CONTACT = "mailto:brigham@coterienmt.ai";

const INK = "#0d0c08"; // near-black warm base for the dark sections

function rise(delay: number): CSSProperties {
  return { animation: "coterie-rise 0.9s ease-out both", animationDelay: `${delay}ms` };
}

export default function SitePage() {
  return (
    <div style={{ background: INK }} className="text-[#f4f1eb]">
      {/* ── HERO ─────────────────────────────────────────────── */}
      <section className="relative min-h-screen overflow-hidden">
        <div
          aria-hidden
          className="absolute inset-0"
          style={{ background: `linear-gradient(180deg, #14130d 0%, ${INK} 55%, #08070400 100%)` }}
        />
        <NetworkCanvas />
        {/* Vignette + floor gradient to seat the type over the constellation. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(80% 60% at 50% 42%, rgba(13,12,8,0) 30%, rgba(13,12,8,0.72) 100%), linear-gradient(180deg, rgba(13,12,8,0.5) 0%, rgba(13,12,8,0) 22%)",
          }}
        />

        <div className="relative z-10 mx-auto flex min-h-screen w-full max-w-6xl flex-col px-6">
          <header className="flex items-center justify-between py-7">
            <ConnectTrigger className="text-[12px] font-medium tracking-[0.34em] text-[#f4f1eb] uppercase">
              Coterie
            </ConnectTrigger>
            <a
              href={APP_URL}
              className="rounded-full border border-[#d4a843]/40 px-5 py-2 text-[12px] font-medium tracking-wide text-[#f4f1eb] transition-colors hover:border-[#d4a843] hover:bg-[#d4a843]/10"
            >
              Client Login
            </a>
          </header>

          <div className="flex flex-1 flex-col items-center justify-center pb-24 text-center">
            <div
              className="text-[11px] font-medium tracking-[0.4em] text-[#d4a843] uppercase"
              style={rise(0)}
            >
              Relationship Intelligence
            </div>

            <h1
              className="mt-7 max-w-4xl font-serif leading-[1.03]"
              style={{ ...rise(90), fontSize: "clamp(2.8rem, 7vw, 5.6rem)" }}
            >
              The{" "}
              <ConnectTrigger>
                <span
                  className="bg-clip-text text-transparent italic"
                  style={{
                    backgroundImage:
                      "linear-gradient(100deg, #f0d585 0%, #d4a843 45%, #b8862f 100%)",
                  }}
                >
                  network
                </span>
              </ConnectTrigger>{" "}
              is the strategy.
            </h1>

            <p
              className="mt-7 max-w-xl text-[15.5px] leading-relaxed text-[#f4f1eb]/70"
              style={rise(170)}
            >
              Coterie brings your entire network into one quiet, intelligent
              workspace — the people, partners, and introductions that move your
              most important work forward.
            </p>

            <div
              className="mt-10 flex flex-col items-center gap-3 sm:flex-row"
              style={rise(250)}
            >
              <a
                href={APP_URL}
                className="rounded-full bg-[#d4a843] px-7 py-3 text-[13px] font-semibold tracking-wide text-[#14130d] shadow-[0_8px_30px_rgba(212,168,67,0.28)] transition-transform hover:-translate-y-0.5"
              >
                Client Login
              </a>
              <a
                href={CONTACT}
                className="rounded-full border border-[#f4f1eb]/25 px-7 py-3 text-[13px] font-medium tracking-wide text-[#f4f1eb] transition-colors hover:bg-[#f4f1eb]/10"
              >
                Request access
              </a>
            </div>
          </div>

          <div
            aria-hidden
            className="pb-8 text-center text-[10px] tracking-[0.3em] text-[#f4f1eb]/40 uppercase"
            style={rise(340)}
          >
            Scroll
          </div>
        </div>
      </section>

      {/* ── WHAT IT IS (cream) ───────────────────────────────── */}
      <section className="bg-canvas text-ink">
        <div className="mx-auto max-w-6xl px-6 py-24 sm:py-32">
          <div className="reveal-on-scroll max-w-2xl">
            <div className="text-[10px] font-medium tracking-[0.3em] text-gold uppercase">
              One workspace
            </div>
            <h2 className="mt-4 font-serif text-[clamp(1.9rem,4vw,3rem)] leading-tight text-ink">
              Your relationships, finally working for you.
            </h2>
            <p className="mt-5 text-[15px] leading-relaxed text-ink-2">
              Most networks live in inboxes, spreadsheets, and memory. Coterie
              gathers them into a single, considered system — so the value in who
              you know is never more than a glance away.
            </p>
          </div>

          <div className="mt-14 grid gap-6 sm:grid-cols-3">
            <Feature
              icon={<NetworkIcon />}
              title="Every relationship, in one place"
              body="Directors, advisors, partners, and prospects on one page — with the context that keeps each connection warm."
            />
            <Feature
              icon={<ThreadIcon />}
              title="From introduction to impact"
              body="Follow the threads that matter: introductions made, meetings held, commitments kept, and the value they create."
            />
            <Feature
              icon={<IntelIcon />}
              title="See the connections others miss"
              body="Coterie surfaces the second-degree relationships and warm paths hiding quietly inside your network."
            />
          </div>
        </div>
      </section>

      {/* ── STATEMENT band (dark) ────────────────────────────── */}
      <section style={{ background: INK }} className="text-[#f4f1eb]">
        <div className="mx-auto max-w-4xl px-6 py-24 text-center sm:py-32">
          <p className="reveal-on-scroll font-serif text-[clamp(1.7rem,3.6vw,2.6rem)] leading-snug text-[#f4f1eb]/90">
            For the firms, funds, and institutions whose advantage is{" "}
            <span className="text-[#d4a843] italic">who they know.</span>
          </p>
          <div className="reveal-on-scroll mt-10">
            <a
              href={APP_URL}
              className="inline-block rounded-full bg-[#d4a843] px-7 py-3 text-[13px] font-semibold tracking-wide text-[#14130d] transition-transform hover:-translate-y-0.5"
            >
              Client Login
            </a>
          </div>
        </div>
      </section>

      {/* ── FOOTER ───────────────────────────────────────────── */}
      <footer style={{ background: INK }} className="text-[#f4f1eb]/50">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 border-t border-[#f4f1eb]/10 px-6 py-9 text-[12px] sm:flex-row">
          <div className="tracking-[0.3em] text-[#d4a843] uppercase">Coterie</div>
          <div className="flex items-center gap-7">
            <a href={CONTACT} className="transition-colors hover:text-[#f4f1eb]">
              Contact
            </a>
            <a href={APP_URL} className="transition-colors hover:text-[#f4f1eb]">
              Client Login
            </a>
          </div>
          <div>&copy; {new Date().getFullYear()} Coterie</div>
        </div>
      </footer>
    </div>
  );
}

function Feature({
  icon,
  title,
  body,
}: {
  icon: ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="reveal-on-scroll rounded-lg border border-line bg-surface p-7 shadow-card transition-transform hover:-translate-y-1">
      <div className="flex h-10 w-10 items-center justify-center rounded-md bg-gold-bg text-gold">
        {icon}
      </div>
      <h3 className="mt-5 font-serif text-lg text-ink">{title}</h3>
      <p className="mt-2.5 text-[13.5px] leading-relaxed text-ink-2">{body}</p>
    </div>
  );
}

// Minimal line icons (no emoji), stroke follows currentColor.
function NetworkIcon() {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="5" r="2" />
      <circle cx="5" cy="18" r="2" />
      <circle cx="19" cy="18" r="2" />
      <path d="M12 7v3.5m0 0l-5 5.5m5-5.5l5 5.5" />
    </svg>
  );
}

function ThreadIcon() {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="5" cy="6" r="2" />
      <circle cx="19" cy="18" r="2" />
      <path d="M7 6h6a4 4 0 0 1 4 4v6M5 8v4a4 4 0 0 0 4 4h4" />
    </svg>
  );
}

function IntelIcon() {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3v2m0 14v2m9-9h-2M5 12H3m14.5-6.5-1.4 1.4M7.9 16.1l-1.4 1.4m0-11.6 1.4 1.4m8.2 8.2 1.4 1.4" />
      <circle cx="12" cy="12" r="3.2" />
    </svg>
  );
}
