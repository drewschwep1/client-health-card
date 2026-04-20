# Handoff — Health Card v2 Fathom Integration

**From session:** `a74fba22-7f7f-4067-a9e8-23021fb8058e`
**Frozen at:** 2026-04-20 1:36pm ET

## Done

- Fathom sync ran end-to-end: **121 meetings** extracted across Client Success + Customer Success teams
- Drew/Derek 1:1 filter applied (per standing feedback rule): 29 removed, **92 kept**
- Manifest written to `public/data/fathom/signals.json` — 11 clients, 5 weeks for CreditNinja, consistent signals across clients
- New `/signals` page added at `src/app/signals/page.tsx` — the old manual Score page had been removed (Health Card is automated, scores are computed not entered)
- `src/components/nav.tsx` updated with Signals link
- Last action: `npx tsc --noEmit` passed after renaming `meetingDate` to the real `ClientSignal` field

## Dev server

Was running on `localhost:3137`. Check if it's still alive; restart if not.

## Pick up here

1. Open `http://localhost:3137/signals` in the browser and confirm the manifest renders cleanly — Drew hadn't eyeballed it before the session ended
2. If it looks right, leave the half-migrated old pages alone and use `/signals` as the surface for the pulled Fathom data
3. Next after that: figure out how signals feed into automated scoring — deferred until display is verified

## Guardrails

- Read `AGENTS.md` before writing any Next.js code (breaking changes from training data)
- Don't touch the in-flux old pages
- Keep Drew/Derek 1:1 filter intact in the sync script
- Scores are AI-computed, not manually entered — don't add manual input UI
