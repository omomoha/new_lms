# Andela Learn — LMS

An internal Learning Management System built on Next.js 14 + Firebase, developed for Andela.

---

## Phase 3 Scope (current)

- [x] **Hardened video delivery** — `getSignedVideoUrl` Cloud Function issues 2-hour V4 signed URLs after a server-side cohort/enrollment check; Storage rules now deny direct client reads on `videos/**` (the old long-lived download-token URLs are dead). Swapped in behind the `VideoService` seam — zero component changes.
- [x] **Certificates** — auto-designed, auto-issued, auto-distributed:
  - Issued automatically when a learner reaches 100% (and passes the post-assessment, if one exists) via Firestore triggers; also available on demand from the course page. Completion is **recomputed server-side** — the client-writable `progressPct` is never trusted.
  - Branded PDF (pdf-lib) with verifiable ID; emailed to the learner via the Trigger Email extension (7-day download link) and downloadable in-app.
  - **Admin-designable**: upload a custom A4-landscape PNG/JPG background per course (Course Builder → Certificate), choose dark/light overlay text, and preview a sample PDF. Falls back to a global template (`settings/certificate`) then the built-in design.
  - Public verification at `/verify/{certId}` — no sign-in required.
- [x] **Captions & transcripts** — upload a `.vtt` per video lesson (rendered as a `<track>`, CORS-safe via blob URL) plus an optional transcript panel below the player.
- [x] **WCAG 2.1 AA pass** — skip link, landmarks, `aria-current` nav, keyboard-operable mobile sidebar with Escape-to-close, AA-compliant text contrast, `prefers-reduced-motion`.
- [x] **Edge JWT verification** — middleware now cryptographically verifies the `__session` ID token (jose, Google JWKS, iss/aud/exp) and gates `/admin/*` on the verified `role` claim.
- [x] **App Check** — reCAPTCHA v3 wiring, enabled by env (`NEXT_PUBLIC_FIREBASE_APPCHECK_SITE_KEY`); callables enforce via `ENFORCE_APPCHECK=true` in `functions/.env`.
- [x] **Load testing** — k6 harness (`loadtest/`) targeting the 5k-learner profile.
- [x] **Next.js security patch bisection** — now on **14.2.8**, the newest 14.2.x that builds (see Maintenance below).
- [ ] SSO — deliberately excluded from this phase.

### Phase 3 deployment prerequisites (one-time)

1. **Signed URLs IAM grant** — V4 signing uses the IAM signBlob API; the functions runtime service account must be able to sign as itself:

   ```bash
   PROJECT_ID=andela-lms-dae5f
   PROJECT_NUMBER=$(gcloud projects describe $PROJECT_ID --format='value(projectNumber)')
   gcloud iam service-accounts add-iam-policy-binding \
     $PROJECT_NUMBER-compute@developer.gserviceaccount.com \
     --member="serviceAccount:$PROJECT_NUMBER-compute@developer.gserviceaccount.com" \
     --role="roles/iam.serviceAccountTokenCreator" --project=$PROJECT_ID
   ```

   Without this, `getSignedVideoUrl` / certificate downloads fail with an internal error.

2. **functions/.env** — add:

   ```
   PUBLIC_APP_URL=https://andela-lms-dae5f.web.app   # used in certificate verify links + emails
   ENFORCE_APPCHECK=false                             # flip to true only after App Check rollout
   ```

3. **Trigger Email extension** — certificate emails reuse the existing `mail/` collection setup (see bottom of this README). If the extension isn't installed, certificates still issue; only the email is skipped.

4. **App Check rollout** (optional, recommended): register the web app with reCAPTCHA v3 in the Firebase console → set `NEXT_PUBLIC_FIREBASE_APPCHECK_SITE_KEY` (locally and in GitHub secrets) → monitor unenforced → then enforce in the console for Firestore/Storage and set `ENFORCE_APPCHECK=true` for functions. **Run load tests before enforcing.**

5. Deploy indexes + rules with everything else: `firebase deploy` (CI does this on push).

6. **Storage CORS (required for the document viewer + captions)** — browsers block
   `fetch()` of Storage files from the app origin until the bucket has a CORS policy
   (media tags like `<video>`/`<iframe>` work without it, which is why videos played
   while documents failed). One-time:

   ```bash
   gcloud storage buckets update gs://andela-lms-dae5f.firebasestorage.app \
     --cors-file=cors.json --project=andela-lms-dae5f
   # If your default bucket is the older style, use gs://andela-lms-dae5f.appspot.com
   # (check: Firebase console → Storage → bucket name shown at the top)
   ```

   `cors.json` lives in the repo root and allows GET from the app domains + localhost.

---

## Phase 1 Scope (this repo)

- [x] Firebase Auth (email/password) with role-based access (admin / learner)
- [x] AuthProvider React context — user + role available throughout the app
- [x] Route protection: `/admin/*` requires admin; `/learn/*` requires auth
- [x] Firestore data model: users, cohorts, courses, modules, lessons, enrollments, progress
- [x] TypeScript types mirroring Firestore schema (`src/types.ts`)
- [x] VideoService abstraction — swap Firebase Storage for Mux/Bunny/etc. in one file
- [x] FirebaseStorageVideoService — resumable upload, getDownloadURL playback
- [x] HTML5 video player with resume (saves positionSec every 5s + on pause)
- [x] "Mark complete" → writes completedAt, recalculates enrollments progressPct
- [x] Course sidebar: module→lesson tree with done/current state
- [x] Admin: Course builder (create course, add modules, add lessons, upload video)
- [x] Admin: Bulk onboarding — CSV upload → calls bulkOnboard Cloud Function
- [x] `bulkOnboard` Cloud Function: creates Auth users, sets custom claims, writes Firestore, sends mail docs
- [x] Firestore security rules (role-based, custom claims)
- [x] Firebase Storage security rules (auth read, admin write)
- [x] CI/CD: GitHub Actions (lint → typecheck → test → build → deploy)
- [x] Vitest unit tests: CSV parsing, progress calc, role guard
- [x] Andela-branded UI (deep green #13403A, moss #8FB85C), mobile-first

---

## Local Setup

### Prerequisites

- Node.js 20+
- npm 10+
- Firebase CLI: `npm install -g firebase-tools`

### 1. Clone and install

```bash
git clone https://github.com/omomoh/andela_lms.git
cd andela_lms
npm install
cd functions && npm install && cd ..
```

### 2. Set up environment variables

```bash
cp .env.example .env.local
# Edit .env.local — fill in all NEXT_PUBLIC_FIREBASE_* values from your Firebase console
```

Find your config: Firebase Console → Project Settings → Your apps → Web app → Config.

### 3. Run the development server

```bash
npm run dev
# App runs at http://localhost:3000
```

### 4. Run against Firebase Emulators (recommended for local dev)

```bash
# Start all emulators
firebase emulators:start

# In a separate terminal
npm run dev
```

The emulator UI is at http://localhost:4000.

---

## Environment Variables

All required variables are in `.env.example`. Copy to `.env.local` for local dev.

| Variable | Description |
|---|---|
| `NEXT_PUBLIC_FIREBASE_API_KEY` | Firebase Web API key |
| `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` | e.g. `andela-lms-dae5f.firebaseapp.com` |
| `NEXT_PUBLIC_FIREBASE_PROJECT_ID` | `andela-lms-dae5f` |
| `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET` | e.g. `andela-lms-dae5f.appspot.com` |
| `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID` | From Firebase console |
| `NEXT_PUBLIC_FIREBASE_APP_ID` | From Firebase console |

---

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start Next.js dev server |
| `npm run build` | Production build |
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Vitest unit tests |

---

## Push to GitHub

```bash
cd andela_lms
git init
git remote add origin https://github.com/omomoh/andela_lms.git
git add .
git commit -m "feat: Phase 1 vertical slice"
git branch -M main
git push -u origin main
```

---

## Deployment

### CI/CD (automatic on push to main)

1. Add the following **GitHub Secrets** in your repo (Settings → Secrets → Actions):

   | Secret name | Value |
   |---|---|
   | `FIREBASE_SERVICE_ACCOUNT` | JSON content of a Firebase Admin service account key |
   | `NEXT_PUBLIC_FIREBASE_API_KEY` | Firebase API key |
   | `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` | Firebase auth domain |
   | `NEXT_PUBLIC_FIREBASE_PROJECT_ID` | `andela-lms-dae5f` |
   | `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET` | Storage bucket |
   | `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID` | Sender ID |
   | `NEXT_PUBLIC_FIREBASE_APP_ID` | App ID |

2. Push to `main` — the workflow in `.github/workflows/deploy.yml` runs automatically.

### Manual deploy

```bash
# Login (one-time)
firebase login

# Deploy everything
firebase deploy --project andela-lms-dae5f

# Or deploy individually:
firebase deploy --only hosting
firebase deploy --only functions
firebase deploy --only firestore:rules
firebase deploy --only storage
```

### Generating a service account key

Firebase Console → Project Settings → Service Accounts → Generate new private key.
Download the JSON and paste it as the `FIREBASE_SERVICE_ACCOUNT` GitHub secret.

---

## Video Abstraction (important for Phase 2)

The `src/lib/video/` directory contains a thin interface (`VideoService.ts`) that
decouples all video upload and playback logic from the UI.

**Current implementation:** `FirebaseStorageVideoService` — stores MP4/WebM in
Firebase Storage, serves via `getDownloadURL`. Simple, no CDN transcoding, no HLS.

**To swap to adaptive streaming (Phase 2):**
1. Create `src/lib/video/MuxVideoService.ts` implementing `VideoService`.
2. Change one line in `src/lib/video/index.ts`:
   ```ts
   export const videoService: VideoService = new MuxVideoService();
   ```
3. No component or page changes are needed.

---

## Bulk Onboarding — Custom Claims Note

The `bulkOnboard` Cloud Function sets a Firebase custom claim `{ role: "admin" | "learner" }`
on each newly created user. This claim is:

- Read by **Firestore rules** as `request.auth.token.role`
- Read by **Storage rules** as `request.auth.token.role`
- Available **client-side** via `user.getIdTokenResult(true).then(r => r.claims.role)`

After onboarding, users must sign in (or call `getIdToken(true)` to force-refresh) before
the claim takes effect. The `AuthContext` reads role from the Firestore `users/{uid}` doc
as a fallback for immediate UI rendering.

---

## Maintenance

### Next.js security patch — bisection result (Phase 3)

The deferred 14.2.35 upgrade was bisected: **14.2.9 is the first broken version** — Next's vendored App Router prerender runtime (`app-page.runtime.prod.js`) crashes with `Element type is invalid … got: undefined` on every route at build time with this app's React 18.3.1. The breakage is upstream (vendored runtime bump), not in app code, and persists through 14.2.35.

**Current pin: `next@14.2.8` + `eslint-config-next@14.2.8`** — the newest version on the 14.2.x security line that builds. Remaining advisories between .9 and .35 stay on the books; the real fix is the planned **Next 15 migration** (which pairs with React 19), tracked as a future task. Do not bump 14.2.x past .8 without re-testing `npm run build`.

### June 2025 dependency upgrades

| Package | Old | New |
|---|---|---|
| `next` (root) | 14.2.5 | 14.2.35 |
| `eslint-config-next` (root) | 14.2.5 | 14.2.35 |
| `firebase-functions` (functions/) | ^5.0.1 | ^6.0.0 |
| `firebase-admin` (functions/) | ^12.2.0 | ^13.0.0 |
| Node runtime (functions engine) | 20 | 22 |
| CI runner node-version | 20 | 22 |

After pulling these changes you **must** run `npm install` in both the root and the functions directory:

```bash
npm install
cd functions && npm install && cd ..
```

The `next` bump stays on the 14.2.x patch line (security fixes only — no breaking changes). The `firebase-functions` v6 and `firebase-admin` v13 upgrades are compatible with all existing code: all Cloud Functions already use the stable `firebase-functions/v2/*` modular imports and no v1 `functions.` namespace is used anywhere.

---

## Firebase Trigger Email Extension

Credentials emails written to the `mail/` Firestore collection are delivered by the
[Firebase Trigger Email](https://extensions.dev/extensions/firebase/firestore-send-email) extension.

To activate:
1. Install the extension in the Firebase console.
2. Configure SMTP settings (e.g. SendGrid, Mailgun).
3. Set the collection to `mail`.

No code changes are needed — the `bulkOnboard` function already writes the correct format.

## AI features setup

The AI tutor, quiz generation, lab grading, flashcards and admin copilot are
powered by the Claude API. They are **disabled gracefully** until you set:

```
# functions runtime env (e.g. functions/.env or Cloud Console)
ANTHROPIC_API_KEY=sk-ant-...
AI_MODEL=claude-sonnet-4-6   # optional override
```

Without a key, the callables return `failed-precondition` and the UI shows a
friendly "not configured" message. All AI endpoints are rate-limited per user
(aiUsage collection), require auth + course access (or admin), fence all
user/lesson content against prompt injection, and validate model JSON output
before it is stored or returned.
