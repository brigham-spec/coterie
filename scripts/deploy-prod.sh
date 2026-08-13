#!/usr/bin/env bash
# Production deploy + Inngest registration in one step.
#
# Vercel deploys do NOT auto-sync the Inngest serve endpoint with Inngest Cloud
# (there is no Inngest-Vercel marketplace integration installed — that flow needs
# a browser OAuth and would rotate INNGEST_EVENT_KEY/INNGEST_SIGNING_KEY). Without
# a sync, Inngest Cloud has no registered endpoint to invoke, so durable jobs like
# coterie/fireflies.sync silently never run even though inngest.send() succeeds.
#
# This wrapper deploys, then PUTs the serve endpoint — exactly what the Inngest
# dashboard "Sync" button does — so Cloud (re)registers the app + its functions on
# every deploy. It uses the EXISTING keys already in Vercel env (no key rotation,
# no billing change). Idempotent: re-running just re-registers.
#
# Usage (from repo root, with node on PATH):
#   ./scripts/deploy-prod.sh
#
# A successful sync prints: {"message":"Successfully registered","modified":...}
set -euo pipefail

INNGEST_URL="https://app.coterienmt.ai/api/inngest"

echo "==> Deploying to production (vercel --prod)"
vercel --prod --yes

echo "==> Registering Inngest app with Inngest Cloud (PUT ${INNGEST_URL})"
# The freshly-aliased deployment may take a moment to serve; retry a few times.
attempt=1
max_attempts=5
while true; do
  http_code=$(curl -s -o /tmp/inngest-sync-body -w "%{http_code}" -X PUT "${INNGEST_URL}")
  body=$(cat /tmp/inngest-sync-body)
  if [ "${http_code}" = "200" ]; then
    echo "==> Inngest sync OK (HTTP 200): ${body}"
    rm -f /tmp/inngest-sync-body
    exit 0
  fi
  echo "    attempt ${attempt}/${max_attempts}: HTTP ${http_code} ${body}"
  if [ "${attempt}" -ge "${max_attempts}" ]; then
    echo "==> Inngest sync FAILED after ${max_attempts} attempts — run 'curl -X PUT ${INNGEST_URL}' manually." >&2
    rm -f /tmp/inngest-sync-body
    exit 1
  fi
  attempt=$((attempt + 1))
  sleep 3
done
