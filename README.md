# Night-Shift Handover Service — Lumen Boutique Hotel

Generates an **action-first, fully grounded** morning handover from two inputs:
structured front-desk events (`data/events.json`) and a free-text relief-staff night
log (`data/night-logs.md`, partly non-English). Every line traces back to a source
reference; contradictions, prompt-injection attempts, and gaps are flagged, not
papered over.

See [`BRIEF.md`](BRIEF.md) for the task and [`DECISIONS.md`](DECISIONS.md) for the
design rationale and tradeoffs. Architecture and rules live in [`CLAUDE.md`](CLAUDE.md).

## Run locally

```bash
npm install
npm run dev          # starts on http://localhost:3000
```

```bash
# JSON (handover + structured log)
curl 'http://localhost:3000/handover?night=2026-05-28'

# Human-readable views
curl 'http://localhost:3000/handover.txt?night=2026-05-28'
open  'http://localhost:3000/handover.html?night=2026-05-28'   # or just visit /
```

`night` is optional and defaults to the most recent shift morning in the data.

```bash
npm test             # reconciliation + grounding + injection-containment tests
```

## The LLM

The free-text night log is parsed by `claude-haiku-4-5` (temperature 0, forced tool
schema) — it only **extracts/translates/clusters** claims that cite line numbers; it
never writes the handover or decides resolution. Set `ANTHROPIC_API_KEY` (e.g. in `.env`)
to use a live call.

Without a key (or on an API error) the service falls back to a **content-addressed cache**
(`fixtures/nightlog-claims.json`) — but only if its stored hash matches the current
`night-logs.md`. Against an unseen night log the cache is refused, the free-text stage is
skipped, and the handover is rendered from structured events with a visible "not processed"
flag — never with stale summaries pinned to the wrong lines. Refresh the cache from a live
call with `ANTHROPIC_API_KEY=... npm run extract`, and verify the live path with
`npm run check:llm`.

## Pipeline

```
extract ─► validate (drop unsourced) ─► reconcile (state machine) ─► render (buckets)
```

- 🔴 **Act Now** — deadlines, safety/health, unsettled exposure before checkout
- 🟡 **Pending** — open, no same-day urgency
- ℹ️ **FYI** — resolved / informational
- ⚠ **Flagged for review** — contradictions, prompt-injection (verbatim), low-confidence
  merges, gaps with no recent update

## Deploy (Railway)

Plain Node/Express, no build step (runs via `tsx`), listens on `$PORT`. Config is committed
in `railway.json` (Nixpacks builder, start `npm start`, health check `/healthz`).

```bash
railway login                      # one-time, opens a browser
railway init                       # create/select a project
railway up                         # build + deploy this directory
railway variables --set ANTHROPIC_API_KEY=sk-ant-...   # set the secret
railway domain                     # generate a public URL
curl 'https://<your-app>.up.railway.app/handover?night=2026-05-30'
```

Or via the dashboard: **New Project → Deploy from GitHub repo** → pick this repo → add the
`ANTHROPIC_API_KEY` variable → **Settings → Networking → Generate Domain**.

Notes:
- Without `ANTHROPIC_API_KEY` set, the deploy still runs but free-text extraction degrades
  to the content-addressed cache (and to a visible "not processed" flag on unseen input).
- The endpoint calls the LLM per request, so set a spend cap on the Anthropic account.
