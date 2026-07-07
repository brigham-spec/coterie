# Prototype Feature Inventory (parity spec)

Source of truth for the Phase-11 prototype-parity rebuild. Derived by structured
survey of `Coterie.html` (the ~18k-line single-file prototype). Read the prototype
at the cited `Coterie.html:<line>` refs to recover exact logic before building a slice.
RE-IMPLEMENT cleanly in Next/TS/Prisma — never copy prototype code.

Mapping note (prototype → production): prototype "member" = a member **org** =
production `Company`; the people on `m.contacts[]` = `Contact`; intros are between
contacts; the app is now multi-tenant (all of this is org-scoped via withOrg/RLS).

## localStorage stores (prototype) → production home
- hvedc_crm_members (M) → companies + contacts (+ many new fields, below)
- hvedc_projects → projects (+ team/services/economicImpact/funding fields)
- hvedc_events → NEW events + event_invitees tables
- hvedc_intro_log → introductions (add stage/outcome/updatedAt)
- hvedc_member_intros / hvedc_proactive_intros → AI cache (regenerate; optional cache table)
- hvedc_membership_proposals → NEW membership_proposals table
- hvedc_intro_obligations / hvedc_member_deliverables → action_items (owner-XOR exists) / commitments
- hvedc_articles → news_items (exists)
- hvedc_email_threads / hvedc_email_results → email ingest (Zapier→Sheet) — later
- hvedc_daily_agenda / hvedc_brief_state/_synthesis/_waiting/_snoozed → user-scoped brief store
- hvedc_settings → org/user settings; hvedc_ff_key/anthropic_key → integrations (encrypted, exists)

## Member (Company/Contact) fields to add
status/tier: active=Director($20k), onboard=Advisory($10k), prospect, partner, archived.
Fields: ind(industry), v(annual value $k), lk(likelihood 1-5), counties, dealSize,
lookingFor, canOffer, agencyContacts, networkTags[], owner(team member), referredById/Name,
lastContact, memberSince, tierLocked, services{ida{active,status,valueSought,valueSecured,serviceFee},
capital{active,status,amountSought,amountPlaced,serviceFee}}, statusHistory[], valueDelivered[].
Contact tags: decision_maker, hnw, family_office, lp_angel, board_candidate, gov_official.
Org tags: seeking_equity, seeking_debt, capital_campaign, capital_provider, active_project,
seeking_jv, for_sale, ida_active, needs_advocacy, hospitality_active, corporate_anchor.

## Project fields to add
stage (Concept, Pre-Development, Entitlements, Planning Board, Capital Raise, Construction Docs,
Under Construction, Stabilization, Completed, On Hold); type/industry, county, value, units,
realizedValue, developerMemberId, prospectLead, team{20 roles: architect, civilEngineer,
landUseAttorney, lender, bridgeLender, generalContractor, interiorDesigner, ownersRep,
environmental, landscapeArchitect, designArchitect, structuralEngineer, mepEngineer,
historicPreservation, equityPartner, taxCreditConsultant, hospitalityOperator, surveyor,
trafficEngineer, permittingConsultant}, hvServices{capitalSourcing, idaNavigation,
realEstateSales, grantCfa}, economicImpact{permanentJobs, constructionJobs, constructionCost,
taxAbatement{active,totalValue}, grants[]}, fundingSources[], stageHistory[].

## Views (Coterie.html line refs)
- dashView 2894 — greeting + 6 KPI pills; notification cards (intro suggestions 2985, proposal
  follow-up 3041, enrichment nudge 3066, Daily Focus 3106, Fireflies status 3116, pending intro
  detections 3181, new connections 3262); ROW3 (Active Projects/Upcoming Events/Needs-a-Call 3331),
  ROW4 (Recent Intros/Proposals Sent/Quick Actions 3388), ROW5 Revenue snapshot 3529.
  Daily Focus card renderDailyFocusCard 19582 (Today/Week/Month tabs) + generateFocusSynthesis 19454
  (sonnet, 160 tok). Cold thresholds: Director 30d / Advisory 45d (2929).
- revenueView 3580 — YTD collected, past due, due this month, ARR, target; collection rate; proposal
  pipeline; cash-flow 3-col; members-by-revenue bars; monthly canvas chart; quarterly; edit schedule.
- member tiers: membersView 4361, activeView(Director) 4386, currentView(Advisory) 4387,
  prospectsView 4390, partnersView 4413; memberTable helper; tag filter bars; owner dropdown.
- projectsView 17909 — metrics bar (pipeline value, active, under-construction, units); Kanban 8
  stage columns + rich cards (team/service/impact badges, open-role pills → intro engine); List mode.
- eventsView 7324 — Event Intelligence AI panel (suggestions, EVENT_INTEL_KEY, 8h cache); eventModal
  8078 (fields + guest list from CRM/external, RSVP states Invited/Confirmed/Declined/Attended/NoShow,
  per-guest notes); Guest Brief AI 7785 (sonnet 250 tok); outreach email draft.
- valueCreatedView 16185 — facilitated deal value, multi-member deals, service-fee revenue, network
  multiplier, active pipeline; economic-impact rollups; active services; multi-member deals w/ stage history.
- commitmentsView 12617 — merge deliverables (DELIVS, regex intro/connect filter) + manual obligations;
  group by member, most-overdue first; checkoff/dismiss/log-intro; scan button 12690 (mines meetings).
- introductionsView 14566 — 3 modes: member (doIntroForMember 18823), roles (doOpenRolesScan 13714),
  network scan; Layer-0 proactive panel doProactiveAlertScan 14444 (4h cache). See "Intro Engine" below.
- networkSearchView 15094 / searchNetwork 15003 — NL search over member profiles (sonnet 1500 tok),
  returns memberId/why/relevance/keyDetail; actions Intro/Profile/Commitment.
- finderView 15215 / fetchProspectTargets 14961 — EXTERNAL prospect discovery via web_search tool;
  Mode A recommendations (sonnet), Mode B targeted (haiku); +Prospect/+Contact.
- newsView 10966 — RSS quick scan fetchGoogleNewsRSS 9468 (Google News RSS via CORS proxies
  allorigins→rss2json→corsproxy) + AI scan fetchMemberNews 9628 (sonnet + web_search); auto-save
  articles 9507 → ARTICLES_KEY (memberIds/projectIds tags).
- meetingsLogView 2145 — dedup by Fireflies id (2200); filters; extract action items 5344 (sonnet
  700 tok) → deliverables; pre-meeting brief 17267 (sonnet 120 tok). (Fireflies sync already built.)
- emailView 16116 — Zapier(Outlook→haiku→Sheet)→CSV ingest; match to member; grouped display. (Later.)

## Introduction Engine — the scoring logic (CRITICAL)
Proactive scan (doProactiveAlertScan 14444, sonnet 6000 tok): context = new members (60d),
active projects+open roles, open committed intros (deliverables+Fireflies promises), exclusions
(intro log), high-signal members (lookingFor/canOffer/urgent tags, up to 30 via buildParticipantProfile),
Fireflies context. Score 5 = named project need + recent meeting evidence, or a promised intro;
4 = expressed need + match; 3 = new member should meet key contacts; 2 = fit, no trigger. Output
array: memberA/B ids+names+orgs, score, connectionType, headline, urgencyTrigger, window, whyNow,
talkingPoints[3], draftHook, evidence, isProspect.
Per-member (doIntroForMember 18823): focus profile + pool profiles; excludes dismissed pairs
(DISMISSED_KEY), already-introduced (intro log), and DISCIPLINE-CONFLICT (18855: infer focus
discipline from ind+canOffer+title; exclude pool members whose projects already have it filled).
Rubric 5 = removes named barrier / fills open role; 4 = specific needed capability w/ evidence;
3 = complementary fit; 2 = alignment no hook. Output: memberId/name/org, score, connectionType,
headline, whatItAdvances, whyNow, talkingPoints[3], isProspect.
Intro log stages: Made, Connected, Meeting Set, Collaborating, Value Created, Dormant. Skip reasons:
not_relevant/already_connected/competitor/wrong_timing. Dashboard scanner runIntroScannerOnCachedData
2825 (throttle 5min) mines Fireflies for the dashboard suggestion card.

## AI feature catalog (all sonnet unless noted; pattern = server-only lib + "use server" action + client)
why-join pitch 1489 · meeting action-item extract 5344 · batch profile synth ~6077 · event outreach
7773 · guest brief 7873(250) · enrich-from-meetings ~8066 · profile synth 9109 · analyze PDF 9120 ·
AI news 10475(+web) · commitments scan 11513 · network search 15003(1500) · proactive intro 14444(6000) ·
per-member intro 18919(6000) · daily focus 19498(160) · pre-meeting brief 17267(120) · prospect finder
recs 14961(+web) & targeted (haiku+web) · event suggestions ~13783 · open-roles scan 13714 · draft intro
email ~16432 · linkedin parse ~16497 · quick capture ~16619 · email paste ~16740 · zapier email (haiku).

## Sidebar IA (nav groups)
Overview: Dashboard, Revenue · Network: All Members, Director Level, Advisory Level, Partners ·
Pipeline: Prospects, Projects, Events, Value Created · Intelligence: Commitments, Introduction Engine,
Network Search, News Intelligence, Prospect Finder, Email Intelligence, Meetings Log.
</content>
</invoke>
