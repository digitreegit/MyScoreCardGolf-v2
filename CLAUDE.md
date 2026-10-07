@AGENTS.md

# MyScoreCard Golf v2

Golf scorecard app for iOS, Android and web. Successor to v1 (`../MyScoreCardGolf`), shipped as an
**update to the same store listings** — the bundle IDs and EAS project ID in `app.config.ts` must not change.
Primary market: United States. UI languages: en, ko (v1 had 11; port the rest from v1's `translations_complete.ts`).

## Stack
Expo SDK 57 + Expo Router (`src/app`), Supabase (auth, Postgres, edge functions), Vercel (web, static SPA),
i18next. Tests: Jest (`npm test`), typecheck: `npm run typecheck`.

## Architecture
- `src/domain/` — pure TypeScript, no React/Expo imports, fully unit-tested. Put logic here first.
- `src/data/` — persistence. **Platform split by file suffix**: `x.ts` is native, `x.web.ts` is web, same exports.
  - Native is offline-first: SQLite (`data/local/db.ts`) is the source of truth; every write sets `dirty = 1`;
    `data/sync/syncEngine.ts` pushes via the `sync_push` RPC and pulls by `server_updated_at` cursor.
  - Web has no local DB; `repository.web.ts` reads Supabase and writes through the same `sync_push` RPC.
  - Conflict rule: last-write-wins on client `updated_at`, **per round and per hole** (never per whole round).
  - Deletes are soft (`deleted_at`) so they sync.
  - Never import `data/local/*` from a `.web.ts` file or from shared code reachable on web.
- `src/features/` — feature modules (auth, courses, gps, voice, scan, io).
- `supabase/migrations/` — schema + RLS. `supabase/functions/` — Deno edge functions (excluded from app tsconfig).

## Rules
- **Location privacy (product promise, also in store privacy labels):** the user's position never leaves the
  device. No location in Supabase, analytics, crash reports, logs or any request. Course matching uses the
  bundled index (`assets/courses/us-index.json`). Foreground location only; background location is blocked.
  If shot tracking is added later, store only derived numbers (e.g. distances), or add explicit consent and update
  the privacy labels first.
- Guest mode must keep working without an account on native (App Store 5.1.1). Guest rows have `user_id = null`
  and are claimed on sign-in (`claimGuestData`).
- iOS offers Sign in with Apple whenever Google sign-in is offered (guideline 4.8). Account deletion lives in
  Settings (5.1.1(v)) via the `delete-account` edge function.
- LLM calls (scorecard scan) only run server-side in `supabase/functions/scan-scorecard`, behind auth and the
  monthly `consume_scan_quota`. Never ship an API key in the app.
- Spreadsheet export escapes formula-like text (`escapeCellText`); keep that for any new text column.
- Schema changes: add a new migration file; keep `src/domain/types.ts`, `data/local/db.ts` (new MIGRATIONS entry),
  `sync_push` and the spreadsheet columns in step.
