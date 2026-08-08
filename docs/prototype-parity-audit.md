# Prototype → Production Parity Audit

Systematic diff of the authoritative prototype (`Coterie.html`) against the shipped
Next.js app (`src/`). Goal: capture the FULL feature debt in one place instead of
discovering gaps one screen at a time.

Status legend: **Present** = full parity · **Partial** = shipped but reduced ·
**MISSING** = not in prod. Size = rough build effort (S/M/L). "Persistence" flags
whether a gap needs a schema change (migration) vs. UI-only/derived.

Modules (prototype view router): dashboard, revenue, members (→ companies+contacts),
active/current/prospects/partners, commitments, introductions, news, finder
(→ prospect-finder), email, network-search, projects, value-created, events, meetings.

---

## Events  (researched — Coterie.html event modal ~L8195–8660)

ALL 12 rows below shipped in slice S10 (a-c) — verified 2026-08-07 against
`events/page.tsx`, `events/[id]/page.tsx`, `events/actions.ts`, and
`prisma/schema.prisma`. The prod event detail is now a full pre/post-event workspace
(Details + stage/project, Cost & ROI + conversions, guest list w/ bulk attend,
Suggest guests, Find targets, Guest brief, batch Outreach w/ send tracking, Debrief:
notes + follow-ups + intros-at-event). No open Events work remains.

| # | Feature | Prototype behavior (line #) | Prod status | Persistence | Size |
|---|---------|-----------------------------|-------------|-------------|------|
| 1 | AI Suggest Guest List | sonnet-4-6 curates N guests from the network w/ a per-guest *reason*; prioritizes theme-fit, never-invited, active-project relevance; feeds Fireflies meeting intel. Reason stored as invitee note. (~L8210) | DONE (`suggestGuestList` + `_suggest-guests.tsx`) | No (writes invitees) | M |
| 2 | Cost & ROI | `net = Σ(conversion ARR × $1k) − cost`; `roi% = round(net/cost×100)`; "$Xk net gain/loss · +Y% ROI". (~L8330) | DONE (Cost & ROI card, `events/[id]/page.tsx`) | Derived | S |
| 3 | New Members from event (conversions) | Log attendees/prospects who joined as paying members; each carries ARR $k/yr; drives ROI + list stats. (~L8360) | DONE (`EventConversion` model; `addConversion`/`removeConversion`) | **Yes** (shipped) | M |
| 4 | Follow-up action items | `{text, person, done}` checklist per event. (~L8250) | DONE (action_items w/ eventId; `addEventActionItem` + Debrief) | **Yes** (shipped) | S |
| 5 | Introductions made at this event | Log intro between two attendees → Intro Log ("Event Introduction / Met at &lt;event&gt;") + both timelines. (~L8270) | DONE (`logIntroductionAtEvent`; introductions.eventId) | **Yes** (shipped) | M |
| 6 | Notes & debrief | Free-text event recap. | DONE (`event.notes`; `updateEventNotes` + Debrief) | **Yes** (shipped) | S |
| 7 | Outreach → Find Targets | Scans network for non-invited members connected to current guests via 4 edge types (intro history, intro obligation, shared project, referral), strength-ranked; +Add/Dismiss; stores connection chain. (~L8470–8560) | DONE (`findEventTargets` + `_find-targets.tsx`, `lib/event-targets`) | No | M |
| 8 | Outreach → Draft All + send tracking | Batch-draft invite emails for every guest; per-guest status none/draft/sent; refinement chips (Shorter/Event first/Connection first/Direct/Fresh take); Redraft/Copy/Mark Sent. (~L8570+) | DONE (`draftOutreach`/`markOutreachSent` + `_outreach.tsx`; invitee.outreachStatus/outreachDraft) | **Yes** (shipped) | L |
| 9 | Mark All Confirmed → Attended | Bulk RSVP transition. (~L8239) | DONE (`markAllAttended`) | No | S |
| 10 | Link to Project | `projectId` field on event create/detail. | DONE (`linkEventProject`; projectId on create) | **Yes** (shipped) | S |
| 11 | List stats + "Never invited" roster | 5 metrics (adds New members, Net ROI) + never-invited member chips. | DONE (5 metrics + never-invited roster, `events/page.tsx`) | Derived | S |
| 12 | External guest fields | Prototype captures external name/org/**email/title**. | DONE (externalEmail/externalTitle on `EventInvitee`) | **Yes** (shipped) | S |

**Prod has that prototype lacks:** proper RLS tenant isolation; composite-FK guest
scoping; server-side AI seams w/ rate limiting.

---

<!-- Cluster sections appended below as research agents return. -->

## Members / Companies / Contacts

Prod already reaches PARITY on the heavy profile surfaces: batch synth, enrich-from-web/
meetings, analyze-document, meeting-prep, why-join, affiliations, value-delivered,
LinkedIn parse, direction+project on commitments, structured relationship timeline. The
gaps are list-view intelligence, a few missing profile fields, and Fireflies-on-profile.

| # | Feature | Prototype behavior | Prod status | Persistence | Size |
|---|---------|--------------------|-------------|-------------|------|
| 1 | Prospect likelihood field (1–5) + pips + filter | Editable 1–5 on profile; pip dots + score filter on prospects list; drives auto-tier. (~L4306, 5113) | DONE (editable on profile details card; pip dots + likelihood filter on the companies list). Auto-tier = item 2. | **Yes** (company.likelihood) | M |
| 2 | Auto-tier from annual value + override toggle | `autoAssignTier()` Director ≥$20k else Advisory; manual-lock checkbox. (~L712, 5098) | DONE (`updateCompany`: member + unlocked → `autoAssignTier(annualValue, tierDefs)` discards submitted tier; `tierLocked` honors manual; `_details-card.tsx` live auto-preview + lock checkbox + hidden-field preservation on non-member statuses) | Derived + override flag | M |
| 3 | "Referred By" referral tracking | Dropdown links referrer member (or External); header badge → their profile. (~L4486) | DONE (S7: referredById/referredByExternal cols + CompanyReferral self-FK; edit-form in-network select + external text in `_details-card.tsx`; `updateCompany` persists w/ in-org + self-referral guards; header badge `↗ Referred by` links to referrer profile, `page.tsx`) | **Yes** (shipped) | M |
| 4 | Contact "Additional Emails" array | Chip multi-email per contact; used for Fireflies matching. (~L4931) | DONE (Slice 11.0: `Contact.additionalEmails String[]` col; `readAdditionalEmails()` in `contacts/actions.ts` splits comma/newline, lowercases, requires `@`, drops the primary + de-dupes, on both create + update; `_contact-form.tsx` field; displayed as "Also: …" on `contacts/[id]/_details.tsx` + `companies/[id]/_contacts-card.tsx`) | **Yes** (shipped) | M |
| 5 | Standalone contact detail page editable | Contacts editable inline. | DONE (S11f: `contacts/[id]/_details.tsx` `ContactDetails` toggles the read view into the shared `ContactForm` driven by `updateContact` — same editor as the company-profile Contacts card, no drift; wired `page.tsx:149`) | — (reuses `updateContact`) | M |
| 6 | Saved Articles & Links per member | Inline saved URLs/docs w/ add form, tag-to-project, remove. (~L6664) | MISSING | **Yes** (articles store) | M |
| 7 | Paste Fireflies URL/ID on profile | Fetch a specific transcript by ID, attach to member. (~L5148) | MISSING (org-level sync only) | Yes (writes meetings) | M |
| 8 | "Load from Fireflies" on profile | Pull all Fireflies meetings mentioning member's contacts/domains. (~L5244) | MISSING | Yes (writes meetings) | M |
| 9 | AI "Extract action items" per meeting on profile | Per-meeting button extracts items → deliverables. (~L5317) | MISSING (exists on global meeting, not profile) | Yes | M |
| 10 | Second-degree contacts from meeting transcripts | Names in action items not in CRM surface as "+ Add to CRM" chips. (~L5528) | MISSING | Yes (creates contacts) | L |
| 11 | Action-item extra statuses: Waiting / Skipped | ⏳ waiting + ⊘ skipped, distinct from open/done. (~L5856) | DONE (`COMMITMENT_STATUSES = open/waiting/done/dropped` in `lib/commitments.ts`; `waiting` = blocked-but-active with gold badge + left-border in `_commitments-card.tsx:256,280`; `dropped` = the prototype's "skipped" (dismissed); `updateCommitmentStatus` validates the vocab `actions.ts:2475`; tested `commitments.test.ts:117`, `commitment-action.test.ts:277`) | **Yes** (`status` text, no enum/migration) | S |
| 12 | Action-item bulk select + batch done/delete | ☑ select mode, multi-select, select-all. (~L5726) | DONE (S11S: open commitment lists get a "Select" toggle → per-row checkboxes + select-all + batch bar; `batchUpdateCommitments` marks the checked set done or deletes it (two-step confirm) in one RLS-scoped write; `_commitment-list.tsx` + `_commitment-row.tsx` selection prop; tested `commitments-global-action.test.ts`) | No (transient UI selection) | M |
| 13 | Move/reassign action item to different member | Owner chip → reassign across companies. (~L5684) | DONE (S11T: within-company owner swap shipped earlier as reassignCommitment; cross-company MOVE now ships as moveCommitment — a we-owe/staff-owned item re-homes to another tenant company (staff owner rides along), scoped {id,companyId,ownerUserId not null} so a they-owe item, foreign id, or cross-company id is refused; a they-owe item stays put (reassign to staff first). Inline MoveForm on we-owe items reusing referralOptions; tested commitment-action.test.ts) | Yes (companyId re-anchor) | M |
| 14 | List: open-action count + intro count per row | Per-row badges. (~L4308, 4320) | DONE (S11a: gold "N open" + teal "N intros" badges per row) | Derived | M |
| 15 | List: color-coded last-contact staleness | Red >90d / amber >60d / green. (~L4315) | DONE (S11a: STALE_CLASS red >90d / amber >60d / teal fresh) | Derived | S |
| 16 | List: industry quick-chips + "Open Actions" sort | Industry chip row + sort option. (~L4230, 4252) | DONE (S11a: industry quick-chip row + "Open actions" sort) | Derived | S |
| 17 | In-header status quick-change pill | Clickable pill, all statuses, logs history. (~L4502) | DONE (StatusPill: header badge → menu of all statuses → changeCompanyStatus logs an Activity) | Derived | S |
| 18 | Consulting/IDA field | `cons` field on profile, exported CSV. (~L5114) | DONE (company.consulting field editable on profile details card + "Consulting"/"IDA" list badge; prod has no member-CSV export) | **Yes** (col) | S |
| 19 | Partnership "Synthesize" AI button | Web-search + AI fills category/summary/collab. (~L4653) | DONE (P6a: synthesizePartner action + draft fold-in) | No | M |
| 20 | Their-Network: link-to-CRM / Add-to-CRM | Inline search to link relationship to a member or create prospect. (~L4781) | DONE (P6b: linkKeyRelationship + addRelationshipAsProspect; linkedCompanyId shipped) | Yes (crmLink) | M |
| 21 | Invoice/billing management UI | Add member to invoice schedule, payment schedule. (~L6761) | MISSING (Invoice model exists, no UI) | Yes (UI only) | L |
| 22 | Permanent delete company | Destructive delete from profile. (~L6821) | MISSING (archive only) | No | M |
| 23 | News-scan shortcut from profile | Footer icon opens news pre-filtered to member. (~L6754) | DONE (S8a: "Scan the web" link → /dashboard/news?company= on the Saved Articles card) | No | S |
| 24 | Relationship Timeline: Add-Note + broader sources | Add/edit/delete manual notes; timeline pulls value-delivered, events-attended, news touchpoints too. (~L6217) | DONE (Note model schema.prisma:944 already migrated; addNote/editNote/deleteNote actions companies/[id]/actions.ts:2910/2940/2971; _timeline.tsx renders the "Add note" toggle + per-note inline Edit/Delete; buildRelationshipTimeline merges meetings, intros, done-commitments, status changes, notes, value-delivered, events-attended AND news — all "broader sources" present; tested note-action.test.ts) | Yes — Note model shipped, no new migration | M |
| 25 | Inline Log-Intro + stage/edit/delete on profile intros | + Log Introduction (member pre-filled Party A); per-intro inline stage cycle / edit outcome / delete. (~L6457) | DONE (S8d IntroductionsCard: inline Log-intro form + per-row advance/edit-outcome/delete + Fireflies-detected advance confirms) | Derived | M |

**Prod has that prototype lacks:** multi-tenant RLS/auth; relational projects module;
structured Introductions w/ Fireflies-detected confirmations; value-report printable page;
DB-built relationship timeline; Zapier email sync; URL-state list filters; auto
`lastContactAt` from meetings.

## Projects / Value Created / Revenue / Dashboard

Prod has solid project CRUD + stage history + team roster + funding sources, plus
prod-only surfaces (value-report page, per-invoice detail, `lastFollowUpAt`). The debt
is concentrated in the economic-impact / revenue data model and three prototype modals.

| # | Feature | Prototype behavior | Prod status | Persistence | Size |
|---|---------|--------------------|-------------|-------------|------|
| 1 | Economic-impact data on projects | `economicImpact` JSON: construction cost, jobs created, tax abatement, state grants — feeds Value Created tiles. | MISSING | **Yes** (project.economicImpact JSON) | M |
| 2 | HV service fees on projects | `hvServices` JSON: 5 service types each w/ a fee — drives Revenue service-fee section. | MISSING | **Yes** (project.hvServices JSON) | M |
| 3 | Project `industry` field | Separate from project `type`. | MISSING | **Yes** (project.industry) | S |
| 4 | Developer/lead member FK | `developerMemberId` links a project to the member developing it. | MISSING | **Yes** (project.developerMemberId) | S |
| 5 | Daily Digest modal | AI-composed daily rollup across the network. | MISSING | No (ephemeral AI) | L |
| 6 | Proposal Tracker modal | Dedicated proposal pipeline w/ urgency + Log-Follow-up. | Partial (proposals exist on company) | Derived + urgency field | L |
| 7 | Invoice Schedule spreadsheet | Full invoice schedule grid. | Partial (invoices exist) | Derived | L |
| 8 | Daily Focus / My Agenda | AI-Prep, per-item done/snooze/waiting states. | MISSING | **Yes** (agenda item state) | M |
| 9 | Kanban card enrichment badges | Cards show enrichment/status badges. | MISSING | Derived | M |
| 10 | Referral Leaderboard | Ranks members by referrals made. | MISSING | Derived | M |
| 11 | Intro-to-Deal conversions | Tracks which intros became deals. | MISSING | **Yes** (link intro→deal) | M |
| 12 | Delete project / unlink company | Housekeeping actions. | MISSING | No | S |
| 13 | Sync-status pills | Meeting count + member pills on sync status. | DONE (S11V — summarizeRecentSync lib/sync-status.ts derives meeting count + companies-touched from meetings synced in the recency window, reusing dedupeMembers/MeetingMember/RawMeetingForView from meetings-view; dashboard SyncStatusBar page.tsx renders "N meetings this week ·" + clickable company pills → /dashboard/companies/{id}; tested sync-status.test.ts) | Derived | S |

**Prod has that prototype lacks:** value-report page, per-invoice detail page,
`lastFollowUpAt` on proposals, project stage-history timeline, professional-team table.

## Commitments / Introductions / Meetings

Prod's DATA model here is actually AHEAD of the prototype (structured Introduction stages
w/ meeting auto-detection, Fireflies attendee confidence + confirm flow, per-meeting AI
action-item extraction w/ owner review, IntroDismissal table, server-side AI email draft).
The debt is almost entirely the prototype's richer LIST/WORKSPACE surfaces on the three
global pages — filters, scans, cross-link buttons, and proactive-intro intelligence.

### Commitments (`commitmentsView`)

| # | Feature | Prototype behavior | Prod status | Persistence | Size |
|---|---------|--------------------|-------------|-------------|------|
| 1 | "Scan for Commitments" AI on the page | Reads meetings+email+Fireflies, regex-surfaces intro-language items into an editable review panel (direction toggle, member/project pickers, Save All). (~L12690) | ADAPTED (persisted per-meeting AI extraction on /dashboard/meetings + "Meetings to scan" gap card commitments/page.tsx:32-36,167-196; the in-memory aggregated review panel intentionally not duplicated) | Derived | L |
| 2 | List / Board / Completed view modes | Board = kanban by staff owner + "They Owe Us"; Completed ledger. (~L13050) | DONE (view=list\|board\|completed commitments/page.tsx:59-60,198-222; Board=groupByOwner + "They owe us" column) | Derived | M |
| 3 | Global "+ Log Commitment" button | Manual obligation modal from the page. (~L12623) | DONE (<LogCommitment staff contacts> commitments/page.tsx:163, _log.tsx) | No | S |
| 4 | Urgency + owner filter chips + search | Overdue/7+/Recent + per-staff chips + text search. (~L13007, 13027, 13061) | DONE (_filters.tsx: view tabs + debounced search + Overdue/Due-soon urgency chips + per-owner count chips; filterCommitments/ownerFacets lib/commitments) | Derived | S |
| 5 | Inline commitment text edit | ✎ swaps text to textarea, blur saves. (~L13099) | DONE (_commitment-row.tsx:41-78 editing toggle → text+due inputs → editCommitment, parity 13099) | No | S |
| 6 | Per-commitment cross-links: Search Network / ⇄ Connections / + Log Intro | Jump to network-search / intro engine pre-filled; log-intro marks done. (~L13157–13204) | DONE (toRow searchHref/connectHref/logIntroHref commitments/page.tsx:247-258 → CrossLink _commitment-row.tsx:98-104, URLSearchParams prefill) | No | M |

### Meetings (`meetingsLogView`)

| # | Feature | Prototype behavior | Prod status | Persistence | Size |
|---|---------|--------------------|-------------|-------------|------|
| 7 | Global "+ Log Meeting" modal (multi-member) | Title/date/duration/location/multi-member/summary/action-items; cross-attributes items. (~L1893) | DONE (_log-meeting.tsx global multi-attendee log: title/date/duration/location/searchable multi-select/summary → logManualMeeting; meetings/page.tsx:7) | Yes (duration+location cols) | M |
| 8 | Member / source / keyword filters | Filter list by member, Manual-vs-Fireflies, and text. (~L2173–2196) | DONE (MeetingFilters {q,source,member} → matchesMeetingFilters lib/meetings-view; meetings/page.tsx:8) | Derived | S |
| 9 | Multi-member dedup + member tags on card | One row w/ all member org tags → profile. (~L2200) | DONE (dedupeMembers → MeetingCard member tags are Links to /dashboard/companies/{id}; _meeting-card.tsx:80-86) | Derived | M |
| 10 | Stats bar + collapse/expand cards | Unique/manual/Fireflies counts; 2-sentence preview collapsed. (~L2240, 2265) | DONE (meetingStats Metric bar + meetingPreview 2-sentence collapse; MeetingCard open toggle) | Derived | S |
| 11 | Duration + location fields | Per-meeting minutes + location. (~L1919) | DONE (durationMinutes+location cols shipped; logged via _log-meeting.tsx, shown in MeetingCard header) | **Yes** (2 cols) | S |
| 12 | Cross-attribution of action items | Item mentioning another member copies to their deliverables. (~L2062) | DONE (networkOptions = contacts NOT at meeting → MeetingActionItems cross-attribution; meetings/page.tsx:12) | Yes | M |

### Introductions (`introductionsView`)

| # | Feature | Prototype behavior | Prod status | Persistence | Size |
|---|---------|--------------------|-------------|-------------|------|
| 13 | Proactive Alerts ("Urgent Signals") auto-scan | Auto-triggers on open (4h cache); AI reads recent meetings/new members/open roles → 3–5 time-sensitive pairings w/ urgencyTrigger/window/evidence/draftHook; dismissable. (~L14568) | DONE (UrgentSignalsPanel auto-fire useEffect _engine.tsx:216-222; PROACTIVE_CACHE_TTL_MS=4h proactive-cache.ts; ProactivePairing urgencyTrigger/window/clusterNote intro-engine.ts:49-71; UrgencyBanner + dismissIntro) | **Yes** (urgency fields) | M |
| 14 | Meeting-intelligence grounding in intro prompt | Feeds `buildFirefliesContext()` recent summaries; "⚡ meeting intelligence active" badge. (~L14780) | DONE (scanNetworkIntros loads recent meeting summaries→meetingContext actions.ts:67-116; PROACTIVE_SYSTEM_PROMPT treats it as freshest signal; MeetingIntelBadge _engine.tsx:986-993) | Derived | M |
| 15 | Connection Clusters (trios) | Secondary panel: trio pairings + what a 3rd link unlocks + Log Intro. (~L14903) | DONE (ConnectionClusters panel _engine.tsx:872-904 filters clusterNote pairings; ClusterCard renders unlock note + CopyDraftButton) | Derived | M |
| 16 | Copy-email-draft per result (both modes) | Clipboard warm-intro email personalized w/ talking points + slots. (~L14843, 14898) | DONE (CopyDraftButton _engine.tsx:961-981 in suggestion/pairing/cluster cards; buildIntroDraft talking-points+slot stubs intro-draft.ts:42-77) | No | M |
| 17 | Pipeline funnel bar + stage filter chips + stale warning | Per-stage counts + conversion cell (clickable), stage chips, ">30d" amber warning. (~L11831–11901) | DONE (PipelineBar per-stage cells + conv% page.tsx:458-632; stage chips 459-480; isIntroStale amber ">30d" 498/546-550; PIPELINE_STALE_DAYS=30 intro-pipeline.ts) | Derived | S |
| 18 | Intro log fields: connectionType + headline | Connection-type taxonomy + one-line "why". (~L11615, 11624) | DONE (connectionType SelectField INTRO_CONNECTION_TYPES + headline field page.tsx:408-428; schema.prisma:445/447 connection_type+headline cols) | **Yes** (2 cols) | S |
| 19 | Profile-strength bar + score legend + prospect badge | Completeness % w/ missing fields; 1–5 score key; ◈ PROSPECT badge. (~L14782, 14820, 14842) | DONE (ProfileStrengthBar + ScoreLegend _engine.tsx:1006-1053; StatusBadge prospect 472-476; introProfileStrength scoring intro-profile-strength.ts) | Derived | S |
| 20 | Members-only vs Full-network scope toggle | Sub-mode buttons on network scan. (~L14853) | DONE (SCOPES toggle _engine.tsx:673-716; introScopeStatuses members vs +prospect intro-engine.ts:73-94; scanNetworkIntros filters by scope) | No | S |
| 21 | Pipeline "Clear all" + per-row draft-email prefill + expose notes field | Bulk clear; email button prefills parties; notes textarea on create. (~L14956, 11914) | DONE — prefill DONE (draftA/draftB "Draft email" link page.tsx:499-587→_intro-email prefill), notes DONE (Textarea page.tsx:430-437); "Clear all" ADAPTED — prototype's `localStorage.removeItem(INTRO_LOG_KEY)` was a destructive demo-reset; prod ships granular deleteIntroduction (actions.ts:113) + updateIntroduction instead (a delete-every-intro button is unsafe against staged/FK'd pipeline rows) | No | S |

**Also surfaced (both L, MISSING):** (a) **Unmatched-participant panel** on the meetings
page — after Fireflies sync, external attendee emails not matched to any contact are grouped
by domain w/ per-person Add-as-Prospect / Dismiss / Dismiss-org (auto-grows the CRM). (b)
**New-intro discovery from Fireflies** — prod only detects *advancement* of already-existing
intros (both parties attended); the prototype also mines meeting titles + action-items for
*brand-new* intros (≥2 external participants). Both fold into S5/S6. Smaller: manual-log
should bump `lastContact` (S).

**Prod has that prototype lacks:** structured Introduction stages w/ meeting
auto-detection (`loadPendingIntroDetections`) + `source` (manual/detected/ai_suggested);
Fireflies attendee confidence scoring + confirm/reject flow; per-meeting AI action-item
extraction w/ owner-assignment review; transcript URL link; server-side AI intro-email
generation; `IntroDismissal` table; pre-intro stages (suggested/drafted); intro→project FK;
owner-XOR DB constraint on action items.

## News / Email / Network Search / Prospect Finder

Prospect Finder and Network Search are HIGH parity (prod even upgraded the model
sonnet→opus and added hallucination guards). News and Email carry the real debt.

### News

| # | Feature | Prototype behavior | Prod status | Persistence | Size |
|---|---------|--------------------|-------------|-------------|------|
| 1 | Google News RSS pre-fetch layer | Two-tier: RSS via CORS proxies (allorigins→rss2json→corsproxy) shown as "Google News (N)" alongside AI deep scan; top 5 auto-saved. (~L9468, 11014) | MISSING (prod is AI-web-search only) | No (ephemeral) | L |
| 2 | Multi-member batch scan + progress | Chip-select N members; "Scan N Members" runs sequential AI scans w/ 2s delay + "Scanning N of N". Quick-select All-Director/All-Advisory/Hot-Prospects. (~L10966, 11045) | Partial — batch chip-select + sequential scan + live "Scanning N of N" DONE (_news.tsx:57-219; runBatch loop); tier quick-selects (All-Director/Advisory/Hot-Prospects) not ported (only Select-all-shown/Clear) | No | M |
| 3 | Manual "Paste article URL" save row | Per-member inline URL+title row to save a link directly. (~L11140) | DONE (AddLinkForm company-picker + URL + optional title → saveNewsItem; _saved-articles.tsx:212-282) | No | S |
| 4 | Saved articles grouped per member + Touchpoint/Action-Item buttons | Per-member card w/ +Touchpoint (→ timeline) + +Action Item (→ obligation modal). (~L11083) | DONE (per-article +Timeline addNote + +Action item addCommitment via shared ArticleQuickActions _article-quick-actions.tsx, on both scan cards + saved list _saved-articles.tsx:144). Per-company grouping intentionally NOT ported — org ledger is a flat reverse-chron list w/ per-row company link | No | M |
| 5 | Article → project cross-link | Articles link `memberIds[]` AND `projectIds[]`. (~L9722) | MISSING — MIGRATION (NewsItem has companyId only; no projectId col in schema.prisma:642-666) | **Yes** (newsItem.projectId) | M |
| 6 | Article `note` + `keyFacts` fields | Free-text note + merged keyFacts on articles. | DONE — cols ALREADY shipped (schema.prisma:653 note + :654 key_facts); NoteEditor inline edit _saved-articles.tsx + keyFacts chips + scan populates them (actions.ts). NOT a pending migration | **Yes** (2 cols) | S |
| 7 | 429 retry w/ backoff | callWithRetry 2×. (~L9644) | MISSING (no-migration; prod surfaces "AI is busy, try again" gracefully via catch, no auto-retry — news-scan.ts) | No | S |

### Email

| # | Feature | Prototype behavior | Prod status | Persistence | Size |
|---|---------|--------------------|-------------|-------------|------|
| 8 | Org-level "Paste email thread" modal | Paste→AI extract {matchedMember, contact, meetingTitle/date, summary, actionItems, newProspects, insights}→save as MEETING note + create prospects. (~L16460) | DONE (extractEmailThread sonnet parse + saveEmailThread → creates a Meeting + attendee on the matched/created company, folds action items + insights into the summary, auto-creates prospects; email/actions.ts:201-436) | Derived + Company writes | M |
| 9 | Interactive email action-item checkboxes | Check/uncheck email action items (EMAIL_CHECKS_KEY). (~L16105) | DONE — col ALREADY shipped (EmailMessage.doneActionItems Int[] schema.prisma:689); toggleEmailActionItem persists per-index checked state on the company-profile email card (companies/[id]/actions.ts:1367-1402). Org inbox intentionally shows a bare count. NOT a pending migration | **Yes** (check state) | M |
| 10 | Auto-create prospect from unmatched email | Unmatched sender + newProspects[]→new prospect records. (~L16541) | DONE — saveEmailThread creates a prospect Company from an unmatched sender + each surfaced newProspect (deduped by name; email/actions.ts:338-416). Uses the existing Company table, NOT a pending migration | **Yes** (Company writes) | M |
| 11 | Full Zapier body template in setup guide | 6-step guide incl literal Anthropic API JSON body. (~L16146) | DONE (setup guide step 3 now ships the literal copy-paste Anthropic /v1/messages JSON request body + required headers; _email.tsx CLAUDE_REQUEST_BODY) | No | S |

**Prod has that prototype lacks (email):** SSRF redirect-safe CSV fetch (Google-host
allowlist), RFC-4180 quoted-field parser, `externalKey` upsert dedup, per-message delete,
sentiment badge.

### Network Search

| # | Feature | Prototype behavior | Prod status | Persistence | Size |
|---|---------|--------------------|-------------|-------------|------|
| 12 | Result quick-actions: ⇄ Intro / + Commitment | Buttons open intro-picker / add-obligation modal pre-filled. (~L15185) | DONE — S11e (2c73512): per-match ⇄ Intro Link seeds Intro Engine Party A via `?draftA=<primaryContactId>` + "+ Commitment" reuses addCommitment (we_owe, owner=current user); _search.tsx:171-228 | No | M |
| 13 | Result tier badge + ⌘↵ shortcut + intro hint | Director/Advisory badge; ⌘↵ submit; "≥2 results → open Intro Engine" hint. (~L15107, 15178, 15209) | DONE — S11d (b73b43f): tier TagBadge(slate) _search.tsx:185; ⌘↵/Ctrl+↵ onKeyDown→requestSubmit + kbd hint :59-77; ≥2-match "open the Intro Engine" hint :130-141 | No | S |

**Prod has that prototype lacks (search):** opus (was sonnet), separate grounding system
prompt, companyId hallucination guard, AI rate limiting.

### Prospect Finder

| # | Feature | Prototype behavior | Prod status | Persistence | Size |
|---|---------|--------------------|-------------|-------------|------|
| 14 | "Draft Outreach ↗" copy-to-clipboard | Generates outreach email template from target + why, copies. (~L15342) | DONE — S11c (0e6eff1): copyDraft() writes buildOutreachDraft(t, sender) (@/lib/prospect-outreach) to clipboard w/ 2s "Copied" feedback; _finder.tsx:293-362 | No | M |
| 15 | Industry/county tag badges on cards | Visual tag chips. (~L15316) | DONE — S11c: TagBadge industry(teal) + county(slate) chips on each card; _finder.tsx:311-316 | No | S |
| 16 | Persistent Dismiss + reason taxonomy | Dismiss saves to store (org never re-surfaces) w/ 4 reasons (not_relevant/already_connected/competitor/wrong_timing). (~L15292) | Partial (local useState(dismissed)→return null only, _finder.tsx:283/288/363; re-surfaces next search, no reason taxonomy) — GENUINE OPEN GAP, MIGRATION (needs a dismissal store table) | **Yes** (dismissal store) | M |

**Prod has that prototype lacks (finder):** opus recommendations model, relational Contact
row on Add-to-pipeline, score→temperature mapping, exclude-set hallucination backstop,
`max_uses:5` cap, AI rate limiting.

---

## Consolidated build backlog

Ordered by value ÷ effort, grouped into shippable slices (one gate + commit each). "Sch"
= needs a migration. Slices are roughly independent; the top four are the highest-leverage.

### Tier 1 — highest leverage

**S1 · Events workspace, part A (quick wins).** Mark-all-Confirmed→Attended, Link-to-Project
(`event.projectId`), Cost & ROI display, external guest email/title cols, 5th/6th list
metrics. Small surface, immediately visible. *Events 2,9,10,11,12.* Sch: yes (small).

**S2 · Events workspace, part B (AI + post-event).** AI Suggest Guest List (reason→invitee
note), Notes/debrief, Follow-up action items (reuse action_items+eventId), Introductions-made
-at-event (introductions+eventId). *Events 1,4,5,6.* Sch: yes.

**S3 · Economic-impact + service-fee data model.** `project.economicImpact` JSON (construction
cost / jobs / abatement / state grants) → Value Created tiles; `project.hvServices` JSON (5
service types + fees) → Revenue service-fee section; `project.industry`, `developerMemberId`.
Unblocks two whole modules' accuracy. *Projects 1,2,3,4.* Sch: yes.

**S4 · Global-page workspace filters (commitments + meetings).** Search + urgency/owner/source/
member filter chips; commitments List/Board/Completed; global "+ Log" buttons; meetings
member-tag dedup + collapse. High daily-use value, mostly derived (little schema). *Commit
2,3,4,5; Meet 8,9,10.* Sch: minimal.

### Tier 2 — strong value, medium effort

**S5 · Commitments/Meetings AI + cross-links.** "Scan for Commitments" aggregated review panel;
per-commitment Search-Network / ⇄Connections / +Log-Intro; meeting cross-attribution; duration
+location cols. *Commit 1,6; Meet 7,11,12.* Sch: small.

**S6 · Intro engine intelligence.** Proactive Urgent-Signals auto-scan (cache + urgency fields),
meeting-grounded prompt, connection clusters, copy-email-draft per result, funnel bar + stage
filters + stale warnings, connectionType/headline cols. *Intros 13–21.* Sch: yes.

**S7 · Profile field parity.** Prospect likelihood(1–5)+pips+filter, auto-tier+override, Referred-By,
contact additional-emails[], consulting/IDA, action-item Waiting/Skipped statuses. *Members
1,2,3,4,11,18.* Sch: yes.

**S8 · Fireflies-on-profile + saved articles + timeline.** Paste-Fireflies-ID, Load-from-Fireflies,
per-meeting AI extract on profile, Saved Articles & Links, news-scan shortcut, interactive
Relationship Timeline (Add-Note + value/event/news sources), inline Log-Intro on profile. *Members
6,7,8,9,23,24,25.* Sch: yes.

### Tier 3 — targeted / lower leverage

**S9 · News & Email depth.** Multi-member batch scan + progress, org-level paste-email-thread modal
(→meeting + prospects), interactive email action-item checkboxes, article note/keyFacts, manual
URL-save row. *News 1–4,6; Email 8,9,10.* Sch: some. (RSS pre-fetch = defer, low value vs web-search.)

**S10 · Events outreach batch.** Draft-All per-guest with none/draft/sent status + refinement chips
+ Find-Targets connection scan. Largest single item; do after S1/S2 prove the workspace. *Events
7,8.* Sch: yes (per-invitee draft+status).

**S11 · List/UX polish + housekeeping.** Discoverable "+ Add" buttons (replace collapsed `<details>`
across events/projects/companies), list open-action/intro counts + color staleness + quick-chips,
in-header status pill, partnership Synthesize AI, their-network link-to-CRM, permanent delete,
editable contact detail page, prospect-finder Draft-Outreach + tag badges, network-search quick
actions. *Members 5,13,14,15,16,17,19,20,22; Finder 14,15; Search 12,13.* Sch: minimal.

**Deferred (low value / prod-only-superset):** Daily Digest modal, Proposal Tracker / Invoice
Schedule spreadsheets, kanban badges, Referral Leaderboard, Google-News RSS layer, action-item
bulk-select, second-degree-contact detection, invoice-management UI, Zapier full-body guide text.

### Suggested execution order
S1 → S3 → S4 → S2 → S7 → S6 → S5 → S8 → S9 → S10 → S11. (Events-first honors the trigger for
this audit; S3 early because it silently corrupts Revenue/Value numbers until fixed.)
