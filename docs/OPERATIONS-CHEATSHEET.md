# Coterie — Founder's Cheat Sheet ("Break Glass")

Last updated: 2026-08-23

This is the map of what Coterie is built on and where everything lives, so you can
operate or recover it WITHOUT depending on Claude. It contains NO passwords — only
the names of things and where to find/reset the real values. Keep a copy somewhere
safe (email it to yourself, print it). Do NOT paste this file's real secret values
anywhere public — the secrets themselves live only in `.env` (your Mac) and in
Vercel (the host).

---

## 1. The one thing that matters most: THE CODE

All of Coterie is one project (a "repository" / "repo") on GitHub.

- **GitHub repo:** https://github.com/brigham-spec/coterie
- **Main branch:** `main` (this is the live code)
- **On your Mac it lives at:** `/Users/brighamfarrand/Desktop/dev/coterie`

To download a fresh copy of the code anywhere (this is "pulling the code"):
```
git clone https://github.com/brigham-spec/coterie.git
```
That's the entire application. Anyone you hire can start from that link.

If you ever lose access to GitHub, the folder on your Desktop above is also a full
copy of the code and its history.

---

## 2. The accounts (the "map")

Coterie is stitched together from a handful of services. Each is a separate login.
Write your usernames next to each; NEVER write the passwords in this file.

| Service | What it does | Where to log in | Your login |
|---|---|---|---|
| **GitHub** | Stores the code | github.com | brigham-spec |
| **Vercel** | Hosts/runs the website | vercel.com | (team: coterie-nmt) |
| **Neon** | The database (all your data) | neon.tech | ______ |
| **Clerk** | User login/accounts | clerk.com | ______ |
| **Sentry** | Emails you when errors happen | sentry.io | brigham@coterienmt.ai |
| **Inngest** | Runs background jobs (syncs) | app.inngest.com | ______ |
| **Fireflies** | Meeting transcripts (per client) | fireflies.ai | (client's key) |
| **Anthropic** | The AI ("Claude") in the app | console.anthropic.com | ______ |
| **Domain registrar** | Owns coterienmt.ai | (where you bought it) | ______ |

> Fill in the blanks the first time you have this open. Future-you will thank you.

---

## 3. The website addresses (domains)

- **The app (what clients use):** https://app.coterienmt.ai
- **Marketing landing page:** https://coterienmt.ai
- **Health check (is it alive?):** https://app.coterienmt.ai/api/health
  - Should return `{"status":"ok","db":"ok"}`. If it says "degraded" or won't
    load, the app or database has a problem.
- **Login system's own domain:** clerk.coterienmt.ai (this is Clerk, not a page
  you visit — it's wired into the app).

---

## 4. Where the secrets live (and how to reset them)

The real secret values are in TWO places only:
1. **`.env`** — a hidden file in the code folder on your Mac (for running locally).
2. **Vercel → Project "coterie" → Settings → Environment Variables** (for the live site).

The secrets (names only — get the actual values from each service's dashboard):

| Secret name | What it's for | Where to reset it |
|---|---|---|
| `DATABASE_URL` / `DIRECT_URL` | Connects to the database | Neon dashboard |
| `APP_DB_PASSWORD` | Database app-user password | Neon dashboard |
| `CLERK_SECRET_KEY` | User login (server) | Clerk dashboard |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | User login (browser) | Clerk dashboard |
| `ANTHROPIC_API_KEY` | The AI features | Anthropic console |
| `INTEGRATION_ENC_KEY` | Encrypts stored client keys (Fireflies etc.) | **DO NOT CHANGE** — rotating this makes existing stored integration keys unreadable |
| `INNGEST_EVENT_KEY` / `INNGEST_SIGNING_KEY` | Background jobs | Inngest dashboard (in Vercel env, not local) |
| `NEXT_PUBLIC_SENTRY_DSN` | Error reporting (optional; a default is built into the code) | Sentry dashboard |

> ⚠️ `INTEGRATION_ENC_KEY` is special: it must stay the same forever, or any
> API keys clients have connected (like Fireflies) will stop working.

---

## 5. The database — two of them

Both live in your **Neon** account, same server, two separate databases:

- **`neondb`** = **PRODUCTION** (your real client data — HVEDC, etc.). Be careful.
- **`coterie_dev`** = **DEVELOPMENT** (a safe sandbox for testing).

The `.env` on your Mac points at `coterie_dev` by default, so local testing can't
touch real data. The live site uses `neondb`.

Your data is in Neon. If you ever need a backup, Neon keeps automatic point-in-time
backups — that's your safety net.

**HVEDC's account ID (their "org"):** `f0000000-0000-4000-8000-000000000001`

---

## 6. How to run it on your Mac (for a developer)

From the code folder (`/Users/brighamfarrand/Desktop/dev/coterie`):
```
npm install        # one-time: install the building blocks
npm run dev         # start it locally at http://localhost:3000
```
Node.js version **24** is required (see the `.nvmrc` file).

Useful commands:
```
npm run lint        # check code style
npm run typecheck   # check for type errors
npm run test         # run the automated tests
npm run build        # make sure it compiles
```

---

## 7. How the live site gets updated (deploy)

```
npm run deploy
```
This runs `./scripts/deploy-prod.sh`, which:
1. Builds and publishes to Vercel (the live site), and
2. Re-registers the background jobs with Inngest.

Only do this when you intend to push changes live.

---

## 8. Monitoring — how you find out something broke

- **Errors:** **Sentry** automatically emails **brigham@coterienmt.ai** whenever the
  app hits an error (a crash, a failed action, or a background job that gives up).
  This is already set up and tested.
- **Background job failures** (like a Fireflies sync failing) are forwarded into
  Sentry too, so they also reach your email.
- **Is it up at all?** Load https://app.coterienmt.ai/api/health — "ok" = healthy.
  (No automatic outage pinger is set up yet — optional to add later via a free
  service like Better Uptime pointed at that health URL.)

---

## 9. Common problems → first thing to check

| Symptom | First check |
|---|---|
| Whole site won't load | Vercel dashboard → is the latest deployment "Ready"? Load `/api/health`. |
| A specific page shows an error | Check Sentry for the error details (it emails you too). |
| "Can't log in" | Clerk dashboard → is the service up / are keys valid? |
| A new feature 500s after a deploy | Usually a database migration wasn't applied to production. A developer runs `prisma migrate deploy` against `neondb`. |
| Fireflies sync not importing | Inngest dashboard → is the "coterie" app synced and are jobs running? Is the client's Fireflies key still valid? |
| AI features failing | Anthropic console → is the API key valid / any billing issue? |

---

## 10. If you need to bring in a human engineer

Hand them THIS document plus:
- The GitHub link (section 1) — that's the whole codebase.
- Access to the accounts in section 2 (add them as members, don't share passwords).
- The repo also contains its own technical docs in the `docs/` folder, and a
  `CLAUDE.md` file at the root that explains the architecture and rules.

The stack in one sentence: **Next.js app, hosted on Vercel, data in Neon Postgres
(with per-client data isolation), logins via Clerk, AI via Anthropic, background
jobs via Inngest, meeting transcripts via Fireflies, error alerts via Sentry.**

---

*This file lives in two places: here on your Desktop, and inside the code repo at
`docs/OPERATIONS-CHEATSHEET.md`. Update both if things change.*
