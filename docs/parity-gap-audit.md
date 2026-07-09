# Parity Gap Audit (built vs. prototype)

Reconciliation of the production build against `docs/prototype-parity-inventory.md`
and `Coterie.html`. Every prototype feature is marked **Built / Partial / Missing**
with its prototype line ref. This is the authoritative pre-launch checklist — update
it as slices land. Produced 2026-07-09 after "New Connections Detected" was found
missing, to catch anything else the numbered 11.x roadmap under-counted.

Legend: ✅ built · ⚠️ partial · ❌ missing

**Last reconciled 2026-07-09 (v2).** Since v1, five items flipped ❌→✅:
New Connections Detected (`new-connections.ts`), meeting action-item extraction
(`action-items.ts`), pre-meeting brief (`meeting-prep.ts`), pending intro
detections (`intro-detection.ts` + dashboard card), and Event suggestions
(`event-ideas.ts`). The Fireflies-data cluster (A) is complete.

## Verification basis
Built surface enumerated from `src/app/dashboard/**/page.tsx` (15 routes),
`src/lib/*.ts` (30 engines), and `prisma/schema.prisma` (20 models). Each row below
was checked against the actual route/engine on 2026-07-09, not assumed from the roadmap.

---

## 1. Views (top-level screens)

| Prototype view | Ref | Status | Notes |
|---|---|---|---|
| Dashboard overview | `2894` | ⚠️ | Shell + 6 KPIs + ROW3/4/5 built. Notification-card family mostly missing — see §2. |
| Revenue (rich) | `3580` | ❌ | Nav item inert. = slice **11.11**. YTD/past-due/ARR/target/collection-rate/proposal-pipeline/cash-flow/member-revenue-bars/monthly+quarterly charts/edit-schedule. |
| Companies (list + detail) | `4361` | ✅ | Status segments + filters + rich profile + AI brief. |
| Member tier views (Director/Advisory/Partners) | `4386`/`4387` | ⚠️ | Collapsed into Companies status-segments. Director/Advisory split **not populated** — tier data lost in item-8 migration. Structural divergence, not just missing UI. |
| Projects (kanban + detail) | `17909` | ✅ | 8-stage kanban, rich cards, open-role pills → intro engine. |
| Introductions engine | `14566` | ✅ | member / open-roles / network-scan modes + Layer-0 proactive panel + lifecycle stages. |
| Network Search | `15094` | ✅ | NL search over profiles. |
| Prospect Finder | `15215` | ✅ | External discovery via web_search, 2 modes. |
| Events | `7324` | ⚠️ | Event modal + RSVP + guest brief AI + **event-ideas suggestions** (`event-ideas.ts`) built. Only outreach-email draft still missing — see §3. |
| Value Created | `16185` | ✅ | Facilitated value + economic-impact rollups. |
| Commitments | `12617` | ❌ | = slice **11.10**. Merge deliverables + manual obligations, group-by-member, scan-meetings button. |
| News Intelligence | `10966` | ❌ | = slice **11.9**. RSS quick-scan + AI scan; `NewsItem` table exists, no ingest/UI. |
| Meetings Log | `2145` | ⚠️ | List/summary/attendee-confirm built. Action-item extraction + pre-meeting brief missing — see §3. |
| Email Intelligence | `16116` | ❌ | = slice **11.12**. Zapier→Sheet→CSV ingest, match-to-member. |

## 2. Dashboard notification-card family (the under-counted cluster)

The prototype dashboard renders seven notification cards. Built 3 of 7:

| Card | Ref | Status | Notes |
|---|---|---|---|
| Intro suggestions ("Possible Introductions") | `2985` | ✅ | `_intro-scan.tsx`, manual Scan button. |
| New Connections Detected | `2589`/`3262` | ✅ | `_new-connections.tsx` + `new-connections.ts`. Unmatched Fireflies attendees now stored (`UnmatchedAttendee`) + triaged (create prospect / attach / dismiss). |
| Pending intro detections from Fireflies | `3181` | ✅ | Dashboard "Pending Introductions" card + per-company section (`intro-detection.ts`). Proposes advancing the ledger from a later meeting where both parties met. |
| **Daily Focus (AI Today/Week/Month)** | `3106`/`19582`/`19454` | ❌ | `generateFocusSynthesis` prioritized task list. **Still missing** — no lib, no dashboard card. |
| Proposal follow-up nudge | `3041` | ❌ | "Membership Proposals" panel exists, but not the nudge that flags sent-but-unanswered proposals. |
| Enrichment nudge | `3066` | ❌ | Prompts to fill thin member profiles. |
| Fireflies sync status | `3116` | ❌ | Last-sync / connection health surface on dashboard. |

## 3. AI features (catalog cross-check)

Pattern for all = server-only lib + `"use server"` action + client. Built 10 of ~22:

| AI feature | Ref | Status |
|---|---|---|
| Company profile synth / AI brief | `9109` | ✅ (`companies/[id]/_brief.tsx`) |
| Guest brief | `7873` | ✅ (`event-brief.ts`) |
| Network search | `15003` | ✅ (`network-search.ts`) |
| Proactive intro scan | `14444` | ✅ (`intro-engine.ts`) |
| Per-member intro | `18919` | ✅ (`intro-engine.ts`) |
| Open-roles scan | `13714` | ✅ (`open-roles-engine.ts`) |
| Prospect finder (recs + targeted) | `14961` | ✅ (`prospect-finder.ts`) |
| Meeting action-item extraction | `5344` | ✅ (`action-items.ts`) |
| Pre-meeting brief | `17267` | ✅ (`meeting-prep.ts`) |
| Event suggestions | `7174` | ✅ (`event-ideas.ts`) |
| **Daily Focus synthesis** | `19498` | ❌ |
| **AI news scan** (+web) | `10475` | ❌ (11.9) |
| **Commitments scan** | `11513` | ❌ (11.10) |
| **Event outreach email draft** | `7773` | ❌ |
| **Draft intro email** | `16432` | ❌ (engine emits `draftHook` text, no email action) |
| Enrich-from-meetings | `8066` | ❌ |
| Batch profile synth | `6077` | ❌ |
| Analyze PDF | `9120` | ❌ |
| Why-join pitch | `1489` | ❌ |
| LinkedIn parse | `16497` | ❌ |
| Quick capture | `16619` | ❌ |
| Email paste / Zapier email | `16740` | ❌ (11.12) |

## 4. Data model
All 20 tables present incl. `Event`/`EventInvitee`/`MembershipProposal`/`NewsItem`/
`IntroDismissal`/`ActionItem`. Gaps are behavioral, not schema — notably `ActionItem`
is unpopulated (no extraction) and there is **no store for unmatched Fireflies
attendees** (New Connections needs a new table).

## 5. Nav / IA divergence
Prototype IA: Overview(Dashboard, Revenue) · Network(All/Director/Advisory/Partners) ·
Pipeline(Prospects, Projects, Events, Value Created) · Intelligence(Commitments, Intro
Engine, Network Search, News, Prospect Finder, Email, Meetings).
Production IA: Overview(Dashboard, Revenue-inert) · Network(Companies, Contacts,
Projects, Introductions) · Intelligence(Network Search, Prospect Finder) ·
Operations(Events, Meetings, Invoices, Value Created).
Missing nav entries: **Revenue** (inert), **Commitments**, **News**, **Email**; member
tier views collapsed to Companies.

---

## Remaining work (re-sequenced, current as of 2026-07-09 v2)

**A. Fireflies-data cluster — ✅ COMPLETE** (New Connections, action-item
extraction, pending intro detections, pre-meeting brief all shipped).

**B. Dashboard completion (NEXT):**
- **Daily Focus synthesis** — AI Today/Week/Month prioritized task list. The most
  visible remaining dashboard gap.
- Proposal follow-up nudge · Enrichment nudge · Fireflies sync-status card.

**C. Remaining major views:**
- 11.9 News · 11.10 Commitments · 11.11 Rich Revenue · 11.12 Email.

**D. Events polish:** only the outreach email draft remains (suggestions shipped).

**E. Micro AI helpers** (low priority, ship opportunistically): why-join pitch,
LinkedIn parse, quick capture, PDF analyze, enrich-from-meetings, draft-intro-email,
batch profile synth.

**F. Known divergence to decide (not a build task yet):** member Director/Advisory
tier data was lost in migration — either backfill tier from a source of truth or
formally accept status-segments as the model.
