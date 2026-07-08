# Andela LMS — Mobile (Flutter)

Native mobile app for the **learner** experience, consuming the same Firebase
backend as the web portal (`andela-lms-dae5f`). This lives alongside the
Next.js web app in the same repo (monorepo) on the `feature/mobile-ui` branch.

## What's built (Milestone 1 — learner core)

- **Auth**: email/password sign-in, self sign-up (creates `users/{uid}` with
  `role: learner`), email-verification gate, password reset — mirrors the web
  portal's auth flow.
- **Dashboard**: published courses with per-learner access (cohort assignment
  or `availability: "all"`) and progress, search, pull-to-refresh — mirrors
  `src/app/learn/page.tsx`.
- **Course detail**: modules + lessons (ordered), per-lesson completion state,
  course progress bar.
- **Lesson viewer**: type-aware rendering (video / text / slides / doc / lab /
  quiz) with "mark complete". Video/doc open externally; text is rendered from
  `textContent`.
- **Profile**: user info, cohorts, sign out.
- **Design**: Andela "Guardrail" green theme mirrored from `tailwind.config.ts`.

### Deliberately stubbed (next milestones)
- In-app video streaming for Storage-hosted videos (needs the `getSignedUrl`
  Cloud Function + a player). External `videoUrl` lessons already open.
- Native quiz UI (grading is server-side via `gradeAttempt`).
- Interactive labs, achievements/leaderboard, spaced-repetition review.
- Precise course-% recompute on lesson completion (currently recomputed on the
  course screen from per-lesson progress).

## Architecture

```
lib/
  main.dart              # Firebase init + providers + MaterialApp.router
  firebase_options.dart  # PLACEHOLDER — regenerate with flutterfire configure
  theme/                 # Andela palette + ThemeData
  models/                # Dart mirrors of src/types.ts
  services/              # AuthService, FirestoreService
  state/                 # AuthController (ChangeNotifier)
  router/                # go_router + auth redirects
  screens/               # splash, auth, dashboard, course, lesson, profile
  widgets/               # course card, progress bar, loading/error
```

State: `provider`. Navigation: `go_router` (redirects off `AuthController`).

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

- **Firestore rules** (`../firestore.rules`) already permit learners to read
  published courses and their own enrollments/progress. No rule changes are
  required for this milestone. Confirm the mobile app's auth/App Check settings
  match — if App Check enforcement is on, register the Android/iOS apps too.
- Data model is mirrored 1:1 from `../src/types.ts`. If those types change,
  update `lib/models/` to match.

## Verify

```bash
flutter analyze
flutter test        # (no widget tests yet)
```
