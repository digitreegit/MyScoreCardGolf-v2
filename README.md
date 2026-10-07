# MyScoreCard Golf v2

Golf scorecard for iOS, Android and web — accounts and cloud sync (Supabase), landscape score entry,
on-device GPS distances, scorecard photo scan, voice entry, and spreadsheet import/export.

Architecture and project rules: see [CLAUDE.md](CLAUDE.md).

## Run locally

```bash
npm install
cp .env.example .env   # optional — without it the app runs in guest/local-only mode
npx expo run:ios       # or: npx expo run:android  (development build; Expo Go lacks the native modules)
npm run web            # web app (requires Supabase config to sign in)
npm test               # unit tests (domain logic)
npm run typecheck
```

## Supabase setup

1. Create a project at supabase.com, then link and push the schema:
   ```bash
   npx supabase login
   npx supabase init            # creates supabase/config.toml (keeps existing migrations/functions)
   npx supabase link --project-ref <ref>
   npx supabase db push
   ```
2. Deploy edge functions and set secrets:
   ```bash
   npx supabase functions deploy delete-account
   npx supabase functions deploy scan-scorecard
   npx supabase secrets set ANTHROPIC_API_KEY=... SCAN_MONTHLY_LIMIT=10
   ```
   `SCAN_MODEL` defaults to `claude-opus-5-5`; set it to trade quality for cost after testing on real cards.
3. Put the project URL and publishable key in `.env` (and in Vercel / EAS environment variables).
4. Auth → Email: enable confirmations; set a custom SMTP sender (e.g. Resend) — the built-in sender is rate-limited.

### Auth providers

- **Google**: Google Cloud console → create OAuth client IDs for *Web*, *iOS* (bundle `com.skyface.myscorecard.ios`)
  and *Android* (package `com.skyface.myscorecard.golf` + SHA-1 of the EAS signing key).
  Supabase → Auth → Providers → Google: add the web client ID and secret, and add the iOS/Android client IDs to
  *Authorized Client IDs*. Enable *Skip nonce check* (the native Google SDK does not send a nonce).
- **Apple** (iOS app + web): enable *Sign in with Apple* on the App ID; Supabase → Providers → Apple: add the
  bundle ID (native) and a Services ID + key (web OAuth).
- Supabase → Auth → URL configuration: add the Vercel domain and `http://localhost:8081` as redirect URLs.

## Web deploy (Vercel)

Import the GitHub repo in Vercel; `vercel.json` already sets the build (`expo export --platform web`), output
(`dist`) and SPA rewrites. Add the `EXPO_PUBLIC_*` variables in the Vercel project settings.

## Course data

- `assets/courses/us-index.json` — on-device list of ~12.9k named US courses (id, name, city, state, lat, lng)
  used for search and "nearby courses". Rebuild from OpenStreetMap with `npm run build:course-index`
  (queries one state at a time; takes ~45 min on the public Overpass server).
- Hole geometry (par, green front/center/back) is built on demand by the `course-geometry` edge function:
  the first request for a course fetches its `golf=hole` / `golf=green` features from Overpass, computes
  targets (`supabase/functions/_shared/courseGeometry.ts`), and caches them in `courses` / `course_holes`.
  Courses with no mapped holes are re-checked after 30 days. The phone caches geometry in SQLite for offline use.
- Public Overpass servers are shared and rate-limited, so a first lookup can fail; it is retried on the next
  request. For production scale, self-host Overpass or pre-import popular courses.
- OpenStreetMap data is © OpenStreetMap contributors under ODbL — attribution is shown in Settings.

## Migrating v1 users

v2 keeps v1's bundle IDs, so v1's AsyncStorage data is still on the device after the store update.
On first launch `src/data/v1Import.ts` converts it into the local database (v1 keys are kept as a backup).
Signing in later uploads those rounds to the account.
