# Andela Learn — LMS

An internal Learning Management System built on Next.js 14 + Firebase, developed for Andela.

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
