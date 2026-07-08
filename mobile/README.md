# Andela LMS — Mobile (Flutter)

Native mobile app for the **learner** experience, consuming the same Firebase
backend as the web portal (`andela-lms-dae5f`). This lives alongside the
Next.js web app in the same repo (monorepo) on the `feature/mobile-ui` branch.

Full learner parity with the web portal is complete — **Phases 1–6 done**
(see `docs/MOBILE_PARITY_PLAN.md`). Admin, AI tutor, AI-lab grading, community
forum and Mux/HLS video are intentionally out of scope (clean seams left for
later).

## What's built (learner parity — Phases 1–6)

- **Auth & account parity (P1)**: email/password sign-in, self sign-up that
  writes the identical `users/{uid}` shape (`role: "learner"`, `status:
  "active"`, `cohortIds: []`), email-verification grandfather rule
  (`VERIFICATION_ENFORCED_FROM = 2026-06-11`), `status: "inactive"`
  force-signout, role resolved from the JWT claim with Firestore-doc fallback.
  A mobile-created account works on web and vice-versa. App Check activated at
  launch. Pure-logic ports (`lib/logic/`) match the web numbers exactly.
- **Dashboard (P2)**: published courses with per-learner access (cohort
  assignment or `availability: "all"`), progress, resume card, streak card,
  diacritic-insensitive search, due-date badges. One `enrollments` + one
  `progress` query (no N+1); thumbnails via `cached_network_image`.
- **Course detail + lesson viewer + assessments + certificate (P3)**: ordered
  module→lesson tree with completion ticks; pre/post assessment gating; quiz →
  `gradeAttempt`; per-lesson-type rendering — external video (webview), Storage
  video (`getSignedVideoUrl` + resume + auto-complete), text (Markdown), PDF
  (inline `pdfx`), Office (server `${filePath}.pdf` twin else external open);
  lesson feedback; certificate via `issueCertificate`.
- **Gamification & spaced repetition (P4)**: achievements (XP/level/badges
  derived client-side), cohort leaderboard (`getCohortLeaderboard`),
  flashcard review (SM-2-lite, `generateFlashcards`).
- **Notifications, profile & public verify (P5)**: live notifications bell
  (`readAt`-only writes), profile (display-name `name`-only write, change
  password), public `/verify/:certId` (cold-start, no auth).
- **Cross-cutting polish & hardening (P6)**: Firestore offline persistence +
  offline-write affordance, optimization/leak audit, deep links, accessibility,
  App Check enforcement readiness.

## Offline behavior (Phase 6)

- **Persistence**: `main.dart` enables Firestore local persistence
  (`Settings(persistenceEnabled: true, cacheSizeBytes: UNLIMITED)`), so reads
  are cache-first and re-reads are cheap. The Firestore SDK also **queues
  writes** made while offline and syncs them automatically on reconnect.
- **"Saved offline" affordance**: learner writes never block the UI. A shared
  helper (`lib/util/offline.dart`) applies an optimistic UI update, then runs
  the write with a short timeout. A timeout or an `unavailable`/network error
  is treated as *queued offline* (success, not error) and surfaces a
  non-blocking snackbar: **"Saved offline — will sync when you're back
  online."** A genuine (non-network) failure is reverted and shows an error.
  Wired into: **lesson mark-complete** (`LessonController.markComplete`),
  **video progress** (`StorageVideo`, one-shot notice), **lesson feedback**,
  and **flashcard grading**.
- Assessment content is not cached beyond the session; grading is always
  server-side (`gradeAttempt`).

## App Check enablement (staged monitoring → enforce)

App Check is activated at launch in `lib/services/app_check.dart` — Play
Integrity (Android) / DeviceCheck (iOS) in release, debug providers under
`kDebugMode`. Activation is best-effort and never blocks startup. To turn on
enforcement safely:

1. **Register the apps** in Firebase console → App Check: enable **Play
   Integrity** for the Android app and **DeviceCheck** (or App Attest) for the
   iOS app.
2. **Ship debug tokens for dev**: run a debug build, copy the printed debug
   token from the console log, and add it under App Check → *Manage debug
   tokens*. Do this for every developer device/emulator.
3. **Monitor first**: keep the server flag `ENFORCE_APPCHECK=false` (current
   default) and watch the App Check metrics until mobile + web traffic shows
   healthy verified-token rates.
4. **Flip enforcement**: once tokens are clean, set `ENFORCE_APPCHECK=true`
   server-side. The callables (`gradeAttempt`, `getSignedVideoUrl`,
   `issueCertificate`, `getCohortLeaderboard`, `generateFlashcards`) then
   reject unattested calls.

## Deep links & universal links (Phase 6)

Two link surfaces are handled in-app:

- **Notification `link`** (`lib/widgets/notifications_bell.dart`): if it starts
  with `/` it is treated as an in-app route (`go_router` `context.push`);
  otherwise it opens externally via `url_launcher`.
- **Public certificate verification** `/verify/:certId`: a public `go_router`
  route (no auth, reachable cold-start; `certId` is upper-cased before the
  single public `get`, matching the web).

To make these open from *outside* the app (OS-level deep links), configure
native App Links / Universal Links (documentation only — no native files are
required for the in-app routing above):

- **Android App Links** — add an `intent-filter` with
  `android:autoVerify="true"` for the `https` scheme + your verify host (e.g.
  `https://<your-domain>/verify/…` and notification link hosts) in
  `android/app/src/main/AndroidManifest.xml`, and host a
  `/.well-known/assetlinks.json` listing the app's package name + SHA-256
  signing fingerprint.
- **iOS Universal Links** — add the `applinks:<your-domain>` Associated Domains
  entitlement in Xcode, and host `/.well-known/apple-app-site-association`
  (JSON) mapping the `/verify/*` and notification paths to the app's App ID.
- On open, forward the incoming path to `go_router` (its parser already routes
  `/verify/:certId` publicly and other `/…` paths through the auth redirect).

## Architecture

```
lib/
  main.dart              # Firebase init + App Check + Firestore persistence + providers
  firebase_options.dart  # regenerate with flutterfire configure
  theme/                 # Andela "Guardrail" palette + ThemeData
  models/                # Dart mirrors of src/types.ts
  logic/                 # pure ports (progress, streaks, gamification, SM-2, …)
  services/              # Auth, Firestore, Callables, File, Video, App Check
  state/                 # ChangeNotifier controllers (auth, dashboard, course, lesson, …)
  router/                # go_router shell + auth redirects + public /verify/:certId
  screens/               # splash, auth, dashboard, course, lesson, review, achievements, profile, verify
  widgets/               # cards, quiz form, lesson widgets, notifications bell, flashcard review
  util/                  # offline.dart (offline-aware writes + "saved offline" affordance)
```

State: `provider`. Navigation: `go_router` (redirects off `AuthController`).

### Optimization & security posture (verified Phase 6)

- **Minimal reads / no N+1**: dashboard, course, lesson and achievements each
  use single-field `where(userId==uid)` queries (filtered client-side), parallel
  module→lesson fetches, one aggregate `enrollments`/`progress` query per
  screen. Signed-video URLs are cached in-memory (refresh 5 min pre-expiry);
  thumbnails use `cached_network_image`; PDF/video load lazily.
- **Disposal**: every screen controller, `StreamSubscription` (notifications,
  auth), `VideoPlayer`/`Chewie` and `PdfControllerPinch` is disposed.
- **Least privilege**: never reads `assessmentKeys`; `attempts`/`certificates`
  are written only by Cloud Functions; flashcards write only
  `{interval,ease,reps,due}`; notifications write only `{readAt}`; users write
  only `{name}`; video URLs come only from `getSignedVideoUrl`.

## Setup

Prerequisites: Flutter SDK 3.3+ (`flutter doctor`), and access to the
`andela-lms-dae5f` Firebase project.

```bash
cd mobile

# 1) Install packages
flutter pub get

# 2) Generate real Firebase config (writes firebase_options.dart +
#    native google-services.json / GoogleService-Info.plist)
dart pub global activate flutterfire_cli
flutterfire configure --project=andela-lms-dae5f

# 3) Run
flutter run
```

> Until `flutterfire configure` is run, `firebase_options.dart` holds
> placeholders and the app won't connect to Firebase.

## Backend notes

- **Firestore rules** (`../firestore.rules`) already permit learners the reads
  and constrained writes this app performs. No rule changes are required.
- Data model is mirrored 1:1 from `../src/types.ts`. If those types change,
  update `lib/models/` to match.

## Verify

```bash
flutter analyze
flutter test
```

### Still requires on-device / emulator verification

- Real offline sync round-trip (queue writes airplane-mode → reconnect → confirm
  they land, and the "saved offline" snackbar appears).
- App Check token issuance (register debug tokens first).
- Storage video signed-URL playback, external video webview, PDF rendering.
- OS-level deep links once App Links / Universal Links are configured.
