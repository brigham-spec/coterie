# Company-profile parity gap — prototype member modal vs. `companies/[id]`

Reconciles the prototype's `viewModal` member profile (`Coterie.html:4440–6835`)
against the current company detail page (`src/app/dashboard/companies/[id]/page.tsx`).
Authored 2026-07-10 after a full read of both.

## Framing

The prototype crams the entire member lifecycle into ONE 780px editable modal.
The production build split most of that surface area into dedicated routes
(Commitments, Value Created, the Introduction engine, Meetings, Events). So
"missing from the profile" ≠ "missing from the product." Three honest buckets:

- **A — the profile is read-only.** Biggest divergence. The prototype edits every
  field, contact, and the tier/status in place; the current profile only displays.
- **B — sections modeled/surfaced elsewhere, not embedded on the profile.**
  Reachable today, just not on the profile the way the prototype co-located them.
- **C — genuinely absent from the product.**

## Schema reality (grounds the sequencing)

- `Company` already carries every editable field the prototype exposes (status,
  tier, temperature, industry, annualValue, website, emailDomain, source, notes,
  counties, dealSize, lookingFor, canOffer, agencyContacts, networkTags,
  ownerUserId, memberSince). Editing = **new action, no migration.**
- `Contact` already has name/title/email/phone/notes/linkedin/tags/isPrimary.
  CRUD = **no migration.** Only the prototype's per-contact *additional emails*
  array would need one.
- `MembershipProposal` table **already exists** (tier/amount/status/sentOn/
  driveUrl/notes). Proposals ledger = **UI + actions only, no migration.**
- `EmailMessage`, `ActionItem`, `NewsItem`, `Activity`, `MeetingAttendee` are all
  modeled; email/action-items/articles/timeline live on their own pages.
- Genuinely un-modeled: **Affiliations**, per-company **ValueDelivered** ledger,
  partner **keyRelationships**. Each needs a table + RLS migration.

## Existing mutation seams on the profile

Only `createCompany` (list level) + AI actions + `confirmIntroAdvance` +
`applyMeetingEnrichment`. **No plain `updateCompany` / contact CRUD exists.**

---

## Proposed slices (sequenced)

### P1 — Editable company profile + lifecycle  ·  no migration  ·  RECOMMENDED FIRST
Closes bucket A, the most visible gap.
- New `updateCompany(formData)` action: whitelist `status` (company-statuses),
  free-set tier/temperature/industry/annualValue/website/emailDomain/source/notes/
  counties/dealSize/lookingFor/canOffer/agencyContacts/networkTags/memberSince/owner.
  Re-load inside `withOrg` so RLS refuses foreign ids; validate closed vocab before tx.
- Details card → "Edit" toggle exposing the fields as a form (keep read view default).
- Lifecycle buttons: Convert prospect→member, Archive (status=former), Restore.
  Each status change logs an `Activity` so the relationship timeline reflects it.
- Tests: `updateCompany` integration (field write + status whitelist + RLS refusal);
  lifecycle status transitions.

### P2 — Contact CRUD on the profile  ·  no migration (unless additional-emails)
- `addContact` / `updateContact` / `removeContact` / `setPrimaryContact` actions,
  each re-verifying `companyId` inside `withOrg`.
- Inline edit of name/title/email/phone/linkedin/notes/tags/isPrimary.
- New `src/lib/contact-tags.ts` = CONTACT_TAGS vocabulary (capacity chips).
- DECISION: per-contact additional emails → add `emails String[]` to Contact
  (small migration) or defer. Recommend defer to keep P2 migration-free.
- Tests: contact CRUD + tenant isolation.

### P3 — Membership Proposals ledger  ·  no migration (table exists)
- `createProposal` / `updateProposalStatus` / `deleteProposal` actions.
- Profile card: list (tier + amount/yr + status + drive link) + "Log Proposal" +
  status cycle (draft → sent → negotiating → won → lost). "Won" nudges company status.
- Tests: proposal CRUD + status transitions + RLS.

### P4 — Per-company Value Delivered ledger  ·  migration
- No `ValueDelivered` model today (value lives on projects → Value Created page).
- New table (org_id + RLS ENABLE/FORCE + tenant_isolation) or reuse `Activity`
  with a typed `value` event — DECISION NEEDED. Prototype wants typed entries w/ $.
- Lower priority; Value Created page already gives the org-level rollup.

### P5 — Affiliations (additional companies)  ·  migration
- New table; company/role/industry/website/offer/need/counties/dealSize sub-records.
- Lower priority.

### P6 — Partner-only sections  ·  migration + AI
- Partnership (category/summary/collaboration + AI Synthesize) and Their Network
  (`keyRelationships` → CRM-link / add-as-prospect) for strategic_partner companies.
- New keyRelationships table + a synthesize action. Lower priority.

### Not planned (already covered elsewhere)
Email correspondence (`EmailMessage`), Action items (`ActionItem` + Commitments
page), Meetings (own page + cards), Saved articles (`NewsItem`), Relationship
timeline (already on profile via `buildRelationshipTimeline`), web-enrich banner
(EnrichFromMeetings exists; web-enrich deferred). Auto-tier could be a small pure
helper folded into P1 if wanted (`TIER_THRESHOLDS`), but tier is free-text today.

## Recommendation

Ship **P1 → P2 → P3** as the core "make the profile feel like the prototype" arc —
all migration-free, all high-visibility. Then decide P4–P6 individually (each is a
table + RLS migration and lower marginal value given the dedicated pages).
