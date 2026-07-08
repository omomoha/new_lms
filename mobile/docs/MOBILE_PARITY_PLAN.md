# Andela LMS — Mobile Learner Parity Plan

**Goal:** bring the Flutter app at `mobile/` to 100% feature parity with the **learner** surface of the Next.js web LMS on the `main` branch, sharing the same Firebase project (`andela-lms-dae5f`).

**Scope:** learner experience only. Admin portal is OUT. Phase-4 web features are OUT of parity (AI tutor `askTutor`, AI lab grading `gradeLab`, community forum `discussions`, Mux/HLS video, analytics dashboards) — but the architecture must leave clean seams so they port later.

**Audience:** an implementer agent who will execute each phase without re-auditing the web app. Every capability, collection, doc-ID pattern, and callable name needed is captured here.

---

## 0. Ground truth from the web audit

### 0.1 Firestore collections & doc-ID patterns the learner touches

| Collection | Doc ID | Client access (per `firestore.rules`) | Notes |
|---|---|---|---|
| `users/{uid}` | uid | read own; **create own** (role must be `"learner"`); update **only** `name` field | profile source of truth |
| `cohorts/{id}` | auto | read only if caller is a **member** (`cohortIds` contains id) | holds optional `courseDueDates: {courseId: Timestamp}` |
| `courses/{id}` | auto | learner reads any `status=="published"` doc | `availability: "cohorts"|"all"`, `moduleOrder`, `assignedCohortIds`, cert template fields |
| `courses/{id}/modules/{mid}` | auto | learner read gated by `canAccessCourse()` (cohort assignment OR availability=all) | `order`, `lessonOrder` |
| `.../modules/{mid}/lessons/{lid}` | auto | same gate as modules | see lesson types below |
| `enrollments/{uid}_{courseId}` | `${uid}_${courseId}` | read own; **write own** only if `canAccessCourse` | `progressPct 0-100`, `lastLessonId`, `cohortId`, `updatedAt` |
| `progress/{uid}_{lessonId}` | `${uid}_${lessonId}` | read/write own (`userId==uid`) | `watchedPct`, `positionSec`, `completedAt` |
| `lessonFeedback/{uid}_{lessonId}` | `${uid}_${lessonId}` | write own; `rating` int 1-5, `comment` ≤1000 | rating widget |
| `flashcards/{cardId}` | auto | read own; **update only** `interval/ease/reps/due`; create/delete server-only | SM-2-lite |
| `notifications/{id}` | auto | read own; **update only** `readAt`; create server-only | live bell |
| `assessments/{id}` | auto | read gated by `canAccessCourse` — **questions only, NO answers** | `kind: pre|post|quiz`, `passMark`, `questions[]` |
| `assessmentKeys/{id}` | — | **DENIED to all clients** | never read from mobile |
| `attempts/{uid}_{assessmentId}_{uuid}` | server | read own; **write server-only** (via `gradeAttempt`) | `score/total/passed/kind/submittedAt/durationSec` |
| `certificates/{certId}` | server | **public single `get`**; list own; write server-only | verify page |
| `labGrades`, `discussions`, `mail`, `aiUsage`, `auditLogs`, `certificateLocks`, `settings` | — | out of learner scope (labGrades/discussions are Phase-4) |

### 0.2 Callable Cloud Functions the learner UI uses (region `us-central1`)

All are `onCall` v2 with optional `enforceAppCheck` gated by server env. **Reuse these — do NOT add new functions.**

| Callable | Request | Response | Used by |
|---|---|---|---|
| `gradeAttempt` | `{assessmentId, answers:{qid:optIndex}, durationSec?}` | `{score,total,passed,perQuestion:{qid:bool}}` | every quiz/pre/post. Rate-limited (30s). Writes `attempts` server-side. |
| `getSignedVideoUrl` | `{storagePath}` (must start `videos/`) | `{url, expiresAt}` (2h TTL) | playing `videoPath` lessons. Storage denies direct `videos/**` reads. |
| `issueCertificate` | `{courseId}` | `{certId, downloadUrl}` (signed PDF URL) | certificate card. `failed-precondition` if course not complete. |
| `getCohortLeaderboard` | `{cohortId}` | `{cohortName, rows:[{name,xp,lessonsCompleted,certificates,isYou}], truncated}` | achievements. `resource-exhausted` on over-refresh; use client timeout 120s. |
| `generateFlashcards` | `{courseId}` | `{count}` | review page "Generate". Client timeout 180s; `resource-exhausted`/`failed-precondition`/`permission-denied` handled. |

### 0.3 Lesson types (`Lesson.type`) and how each renders

- **video** — two mutually-exclusive sources:
  - `videoUrl` (external): YouTube / Google Drive. Web converts via `toEmbedUrl()` → iframe embed. Only YouTube (`/embed/{id}`) and Drive (`/file/d/{id}/preview`) are allowed; anything else is rejected.
  - `videoPath` (Firebase Storage): resolved through `getSignedVideoUrl` callable → HTML5 `<video>` with resume. `captionsPath` (.vtt) and `transcript` optional. Quality picker (`_720p.mp4` variant) is a nice-to-have, not core parity.
- **text** — `textContent` is HTML or Markdown; rendered with ToC/collapsible sections (`TextLessonContent`).
- **slides / doc / lab** — resource file via `filePath` (preferred) or `fileUrl` (legacy). Render decision (`getDocRenderKind`):
  - `.md/.markdown/.txt` → fetch text, render natively.
  - `.pdf` → inline paged PDF viewer, downloads disabled.
  - `.docx` → web converts with mammoth in-browser.
  - `.pptx/.ppt/.doc/other Office` → web prefers a **server-converted twin at `${filePath}.pdf`** (written by `convertOfficeToPdf` Storage trigger); falls back to Office Online embed.
- **quiz** — an `assessments` doc with `kind=="quiz"` and `lessonId==thisLesson`; rendered by `QuizForm` → `gradeAttempt`. Passing marks the lesson complete.

### 0.4 Progress / completion / gamification rules (pure logic to port verbatim)

- `calcProgressPct(completedIds, allIds)` = round(completed/all*100). `isVideoWatched` ≥80%. `shouldSaveProgress` throttles writes to every 5000ms. (`src/lib/progress.ts`)
- **Mark-complete write:** `progress/{uid}_{lessonId}` set `{userId, lessonId, courseId, watchedPct:100, positionSec, completedAt: serverTimestamp()}`, then recompute pct over all lessons and update/create `enrollments/{uid}_{courseId}` `{progressPct, lastLessonId, updatedAt}`. Video also saves throttled `{positionSec, watchedPct, completedAt:null}` during playback (merge) — **must not overwrite completedAt once set** (web guards with `completedRef`).
- **Streaks** (`src/lib/streaks.ts`): `computeStreaks(completionDates, now)` → `{currentStreak, longestStreak, activeToday, thisWeekCount, weeklyGoal:5}`. Local-time calendar days; current streak counts from today or yesterday.
- **Gamification** (`src/lib/gamification.ts`): XP = lessons*10 + quizzesPassed*25 + certificates*100. `LEVEL_THRESHOLDS=[0,100,250,500,900,1500,2400,3600,5200,7500]`. 10 `BADGES` with earned/progress predicates. These XP numbers are duplicated server-side in `gamificationRules.ts` for the leaderboard — **keep the Dart port identical**.
- **Spaced repetition** (`src/lib/spacedRepetition.ts`): SM-2-lite `review(state, grade, now)`. `DEFAULT_EASE=2.5`, floor 1.3, cap 3.0; again→10min, good steps 1d/3d/×ease, easy 4d/×ease×1.3. Persist only `{interval, ease, reps, due}`.
- **Resume** (`src/lib/resume.ts`): pick most-recently-touched in-progress (0<pct<100) course by `updatedAtMillis`, else highest pct.
- **Search** (`src/lib/search.ts`): diacritic-insensitive substring over title+description.
- **Due dates** (`src/lib/dueDates.ts`): earliest `cohort.courseDueDates[courseId]` across the learner's cohorts; badge tones muted/warn/overdue; suppressed when pct≥100.

### 0.5 Auth model (must match web exactly for account parity)

- Self-signup: create Auth user, `updateProfile(displayName)`, create `users/{uid}` `{uid,email,name,role:"learner",cohortIds:[],status:"active",createdAt:serverTimestamp()}`, send verification email, then **sign out** until verified.
- Role resolution: JWT custom claim `role` wins, fall back to Firestore doc `role`. Claim is set server-side by `syncRoleClaim`.
- Email-verification gate: enforced **only for accounts created on/after `2026-06-11T00:00:00Z`** (`VERIFICATION_ENFORCED_FROM`). Older accounts are grandfathered. On blocked sign-in, resend the link then sign out.
- Inactive accounts: if `users/{uid}.status == "inactive"`, force sign-out immediately.
- App Check: web uses reCAPTCHA v3 gated by env; callables enforce only when `ENFORCE_APPCHECK=true`.

---

## 1. Existing mobile scaffold — what to build on (deltas, not rewrites)

Present under `mobile/lib/`: `main.dart`, `router/app_router.dart` (go_router with redirect on `AuthStatus`), `state/auth_controller.dart`, `services/auth_service.dart`, `services/firestore_service.dart`, `theme/app_theme.dart`, models (`app_user, course, course_module, lesson, enrollment, lesson_progress`), screens (`splash, auth/{login,register,verify_email}, dashboard/{home,dashboard}, course/course_detail, lesson/lesson_screen, profile/profile`), widgets (`course_card, progress_bar, loading`). Deps: firebase_core/auth/firestore/functions/storage, provider, go_router, google_fonts, cached_network_image, url_launcher.

**Parity gaps / bugs already found in the scaffold (fix in Phase 1):**
1. `auth_service.register` writes `status: 'pending'` — web writes **`'active'`**. Must change (breaks admin analytics parity and status semantics).
2. `auth_controller` blocks **all** unverified users — must apply the `VERIFICATION_ENFORCED_FROM` grandfather rule and the `status=="inactive"` force-signout, and resolve role from JWT claim (fallback to doc).
3. `firestore_service.getCourseProgress` uses a **composite** `where(userId)+where(courseId)` query — the web deliberately queries **single-field `where(userId)`** and filters client-side to avoid composite indexes and stay provable under rules. Change to single-field everywhere (progress, enrollments, attempts, certificates, flashcards).
4. No `CallableService`, no signed-video/resource/file service, no App Check init. Models for Assessment/Attempt/Certificate/Cohort/Flashcard/Notification/LessonFeedback and the pure-logic ports are missing.

**Missing deps to add to `pubspec.yaml`** (Phase 1): `firebase_app_check`, `flutter_markdown` (text lessons), `syncfusion_flutter_pdfviewer` **or** `pdfx` (PDF lessons), `video_player` + `chewie` (Storage video), `webview_flutter` (external video embeds), `flutter_secure_storage` (token/secret handling if needed), `intl` (date formatting). Pin versions compatible with the existing Firebase BoM.

---

## 2. Target mobile architecture (deltas)

- **State management:** keep `provider` + `ChangeNotifier`. Add per-screen controllers (`ChangeNotifier`) for dashboard, course, lesson, achievements, review, notifications — each owns its load/refresh + error state, mirroring the web pages' `useEffect` loaders. Keep `AuthController` as the single auth source feeding the router.
- **Navigation:** convert the flat go_router to a `StatefulShellRoute` with a **bottom navigation bar** (Home, Review, Achievements, Profile) plus a notifications icon + sign-out in the `AppBar`. Course/lesson/verify are pushed on top (full-screen). Preserve the existing `redirect` on `AuthStatus`. Add a public `/verify/:certId` route reachable without auth.
- **Services layer (`mobile/lib/services/`):**
  - `auth_service.dart` (exists) — fix parity items.
  - `firestore_service.dart` (exists) — extend; keep single-field queries.
  - `callable_service.dart` (**new**) — thin wrapper over `FirebaseFunctions.instanceFor(region:'us-central1')` exposing `gradeAttempt`, `getSignedVideoUrl`, `issueCertificate`, `getCohortLeaderboard`, `generateFlashcards`, each with typed request/response and mapped `FirebaseFunctionsException` codes.
  - `file_service.dart` (**new**) — `resourceUrl(path)` (Storage getDownloadURL), `officePdfTwinUrl(filePath)` (try `${filePath}.pdf`), `captionsUrl(path)`; `getDocRenderKind(name)` and `toEmbedUrl(url)` ports.
  - `video_service.dart` (**new**) — interface mirroring web `VideoService`; default impl calls `getSignedVideoUrl` with an in-memory cache refreshed 5min before `expiresAt`. Seam for future Mux impl.
- **Pure logic (`mobile/lib/logic/`):** Dart ports of `progress, streaks, gamification, spacedRepetition, resume, search, dueDates, videoEmbed`. No Firebase imports → unit-testable. Keep numbers identical to web.
- **Offline / caching:** enable Firestore local persistence (`Settings(persistenceEnabled: true)`) so reads are cached and re-reads are cheap; `cached_network_image` for thumbnails; in-memory signed-URL cache in `video_service`. Do NOT cache assessment content beyond session. No write-queue needed for parity (Firestore SDK already queues offline writes); surface a "saved offline / will sync" affordance where progress writes fail.
- **Error handling:** each controller exposes `error`/`loading`; map `permission-denied` on module/lesson reads to a "not in your cohort yet" locked state (mirrors web). Never crash a lesson page on a widget (feedback, transcript) failure.
- **Security posture:** never query `assessmentKeys`; grade only via `gradeAttempt`; obtain video URLs only via `getSignedVideoUrl`; write only the fields rules allow (readAt on notifications; scheduling fields on flashcards; name on users). Init App Check (`AndroidProvider.playIntegrity` / `AppleProvider.deviceCheck`) before other Firebase calls, with debug provider under a debug flag.

---

## 3. Phases

Each phase is independently shippable and testable. File paths are under `mobile/lib/` unless noted.

### Phase 1 — Foundations, account parity, services & models

**Goal:** a hardened base that logs in/registers with true web parity, initializes App Check, and provides the service + model + logic layer every later phase needs.

**Add / modify:**
- `pubspec.yaml` — add deps listed in §1.
- `main.dart` — after `Firebase.initializeApp`, call `FirebaseAppCheck.instance.activate(...)`; enable Firestore persistence.
- `services/app_check.dart` (**new**) — activate Play Integrity/DeviceCheck; debug provider behind `kDebugMode` flag; no-op safe.
- `services/auth_service.dart` — set `status:'active'` on register; expose `changePassword(current,new)` (reauthenticate + updatePassword) and `updateDisplayName(name)`+`users/{uid}.name` write for profile.
- `state/auth_controller.dart` — port `VERIFICATION_ENFORCED_FROM` grandfather logic; resolve role from `getIdTokenResult().claims['role']` with doc fallback; force sign-out when `status=='inactive'`; keep `refreshVerification()`.
- `services/callable_service.dart`, `services/file_service.dart`, `services/video_service.dart` (**new**, see §2).
- `models/` (**new**): `cohort.dart` (incl. `courseDueDates`), `assessment.dart` (+`AssessmentQuestion`), `attempt.dart`, `certificate.dart`, `flashcard.dart`, `app_notification.dart`, `lesson_feedback.dart`, `gamification_stats.dart`. Extend `course.dart` with `availability`, cert fields; `lesson.dart` already has the union fields — verify `captionsPath`, `transcript`.
- `logic/` (**new**): `progress.dart, streaks.dart, gamification.dart, spaced_repetition.dart, resume.dart, search.dart, due_dates.dart, video_embed.dart`.

**Firestore/callable interactions:** none new beyond auth reads/writes.

**Security & optimization:** App Check active; single-field queries only; role from claim; no `assessmentKeys` access anywhere.

**Acceptance criteria / tester checks:**
- Register on mobile → `users/{uid}` doc has `role:"learner"`, `status:"active"`, `cohortIds:[]`; verification email sent; app lands on verify screen; after verifying + sign-in, session established. The **same account logs into the web app** and vice-versa.
- A pre-2026-06-11 unverified account can still sign in (grandfathered); a new unverified account cannot.
- Setting `status:"inactive"` in Firestore signs the user out within a session.
- Unit tests green for all `logic/` ports.

**Testing strategy:** unit tests for every `logic/*` file (parity with web test values: streaks, gamification XP/levels/badges, spacedRepetition intervals, resume, search, dueDates, videoEmbed accept/reject). Widget test for login/register/verify flows with fake `AuthService`. Manual on-device: register + cross-login parity, App Check token issuance.

---

### Phase 2 — Dashboard parity

**Goal:** the learner home matches `src/app/learn/page.tsx` exactly.

**Add / modify:**
- `state/dashboard_controller.dart` (**new**) — load: query `courses where status==published`; fresh `users/{uid}.cohortIds`; fetch member `cohorts` docs for `courseDueDates` (fail-soft); one `enrollments where userId==uid` query; compute `hasAccess` (availability=all OR cohort overlap), progressPct, lastLessonId, dueMillis; sort accessible-first.
- `screens/dashboard/home_screen.dart` — hero greeting; `StreakCard`; `ResumeCard`; search field; course grid with locked cards (padlock + "ask your admin"); due-date badges; empty/error/loading states.
- `widgets/streak_card.dart`, `widgets/resume_card.dart`, `widgets/course_search.dart`, `widgets/due_badge.dart` (**new**); extend `widgets/course_card.dart` for locked/badge variants.
- `services/firestore_service.dart` — add `streakDates(uid)` (single `progress where userId` query → completedAt list), reuse `loadDashboard`.

**Firestore interactions:** `courses`(published), `users/{uid}`, `cohorts/{id}` (members), `enrollments`(userId), `progress`(userId for streak). All single-field.

**Security & optimization:** one enrollments query + one progress query (no N+1); thumbnails via `cached_network_image`; cohort/due-date reads fail-soft to no badges.

**Acceptance criteria / tester checks:**
- Accessible vs locked courses render correctly per cohort/availability; locked cards are non-tappable.
- Resume card points to the most-recently-touched in-progress course; hidden when none.
- Streak card shows current streak + weekly N/5; search filters case/diacritic-insensitively; due badges match tone/label logic.
- Data written by mobile progress appears identically on the web dashboard.

**Testing strategy:** widget tests with a fake `FirestoreService` returning fixture courses/enrollments/cohorts covering access, locked, due, resume, search. Golden-ish checks on card states.

---

### Phase 3 — Course detail + full lesson viewer + assessments + certificate

**Goal:** parity with `src/app/learn/course/[courseId]/page.tsx` and `.../lesson/[lessonId]/page.tsx` for all in-scope lesson types, assessments, and certificate issuance.

**Add / modify:**
- `state/course_controller.dart` (**new**) — load course, modules (ordered), lessons per module (parallel), enrollment, progress (single `progress where userId` filtered client-side by course lessons), pre/post `assessments` (by courseId+kind) and latest own `attempts` (single `attempts where userId`, filter+sort client-side). Handle `permission-denied` → locked state.
- `screens/course/course_detail_screen.dart` — header + progress; pre-assessment banner/score + retake; Start/Continue button; pre-before-post gating; post-assessment banner/score; certificate card; module→lesson tree with completion ticks + current highlight.
- `state/lesson_controller.dart` (**new**) — load course/modules/lessons/enrollment/progress; for quiz lessons load assessment + latest attempt; next-lesson navigation; `markComplete` (progress write + enrollment recompute) with the completedAt guard.
- `screens/lesson/lesson_screen.dart` — sidebar/drawer contents (module tree); type switch:
  - video/external → `widgets/lesson/external_video.dart` (webview_flutter for YouTube/Drive `toEmbedUrl`; invalid → message) + transcript + mark-complete.
  - video/storage → `widgets/lesson/storage_video.dart` (video_player+chewie; URL via `video_service`→`getSignedVideoUrl`; resume from positionSec; throttled progress save 5s + on pause; auto mark-complete on ended; captions optional).
  - text → `widgets/lesson/text_lesson.dart` (flutter_markdown; if HTML, render via a lightweight HTML widget) + mark-complete.
  - slides/doc/lab → `widgets/lesson/document_viewer.dart`: `.md/.txt`→fetch+markdown; `.pdf`→PDF viewer; office→try `${filePath}.pdf` twin in PDF viewer, else `url_launcher` external open (docx has no in-app renderer → external open; document this gap) + mark-complete.
  - quiz → `widgets/quiz_form.dart`.
- `widgets/quiz_form.dart` (**new**) — render questions (radios), submit via `callable_service.gradeAttempt`, results screen with per-question correct/incorrect, retake; `durationSec` from form-open time. **Never** shows correct answers except via server `perQuestion`.
- `widgets/lesson/lesson_feedback.dart` (**new**) — write `lessonFeedback/{uid}_{lessonId}` (`rating` 1-5 int, `comment` ≤1000, `updatedAt`); prefill existing; fail-soft.
- `widgets/certificate_card.dart` (**new**) — when eligible (pct≥100 AND (no post OR post passed)) or already issued: call `issueCertificate`, open `downloadUrl` (url_launcher), show certId + verify link; map `failed-precondition`.

**Firestore/callable interactions:** reads as above; writes `progress` + `enrollments` (mark complete), `lessonFeedback`; callables `gradeAttempt`, `getSignedVideoUrl`, `issueCertificate`. **Attempts are never written client-side.**

**Security & optimization:** parallel module-lesson fetch; single-field progress/attempts queries filtered client-side; signed-URL cache; completedAt overwrite guard; assessment answers only ever from callable; `permission-denied`→locked UI.

**Acceptance criteria / tester checks:**
- Each lesson type renders and can be completed; completion updates the tree, enrollment `progressPct`, and `lastLessonId`; values match web for the same account.
- Storage video resumes at saved position and auto-completes at end; external YouTube/Drive embeds play; unsupported URL shows message.
- Pre/post gating and quiz pass→lesson-complete behave as web; `attempts` docs appear (written by function) and show on web.
- Certificate issues only when eligible; PDF opens; `/verify/{certId}` resolves; a copy is emailed (function side-effect).
- All mobile-written progress/attempts/feedback appear in existing admin dashboards with no admin changes.

**Testing strategy:** unit tests for `markComplete` pct recompute and completedAt guard (fake Firestore); `quiz_form` widget test with fake callable (pass/fail/retake, all-answered validation); `document_viewer` render-kind selection tests; manual on-device for video/PDF/webview.

---

### Phase 4 — Gamification (achievements + leaderboard) & spaced-repetition review

**Goal:** parity with `src/app/learn/achievements/page.tsx` and `src/app/learn/review/page.tsx`.

**Add / modify:**
- `state/achievements_controller.dart` (**new**) — parallel single-field queries: `progress where userId` (completion dates → streak + lessonsCompleted), `attempts where userId & passed==true` (quizzesPassed) [note: two equality filters on attempts is acceptable, but prefer `where userId` + client filter `passed` to avoid a composite index], `certificates where userId` (count). Compute XP/level/badges via `logic/gamification.dart`. Leaderboard via `getCohortLeaderboard(cohortId)` for `cohortIds[0]` (+ selector when >1); map `resource-exhausted`.
- `screens/achievements/achievements_screen.dart` — level+XP bar, stats row, badge grid (earned/locked with progress), cohort leaderboard table with medals + "you" highlight + truncation note.
- `state/review_controller.dart` (**new**) — load `flashcards where userId` (single field), split due/future client-side by `due`; accessible published courses for the generate selector; `generateFlashcards(courseId)` (timeout 180s) then reload; map error codes.
- `screens/review/review_screen.dart` — hero; due-session host; all-caught-up/no-cards states; generate section.
- `widgets/flashcard_review.dart` (**new**) — one card at a time, flip, four grades (Again/Hard/Good/Easy); apply `logic/spaced_repetition.dart`; persist **only** `{interval,ease,reps,due}` via `updateDoc`.

**Firestore/callable interactions:** reads `progress/attempts/certificates/flashcards` (single-field, own); writes flashcard scheduling fields only; callables `getCohortLeaderboard`, `generateFlashcards`.

**Security & optimization:** derive gamification client-side from own-readable data (no server round-trip except leaderboard); flashcard query is single-field (client-side due filter) — no composite index; respect the update-fields-only rule.

**Acceptance criteria / tester checks:**
- XP/level/badges match web for the same account (identical numbers).
- Leaderboard loads for the primary cohort; over-refresh shows the rate-limit message; "you" row highlighted.
- Generating flashcards creates the count returned; due cards appear; grading updates `due` and reschedules (verify on web too).

**Testing strategy:** unit tests already cover gamification/spacedRepetition (Phase 1). Widget tests: achievements rendering from fixture stats; flashcard grade → correct scheduling call (fake Firestore); review empty/caught-up states. Callable errors via fake `CallableService`.

---

### Phase 5 — Notifications, profile & public certificate verification

**Goal:** parity with `NotificationsBell`, `src/app/learn/profile/page.tsx`, and `src/app/verify/[certId]/page.tsx`.

**Add / modify:**
- `widgets/notifications_bell.dart` (**new**) — `snapshots()` on `notifications where userId==uid` (single equality, no orderBy); sort desc + cap 20 client-side; unread badge; mark-one/mark-all via `updateDoc {readAt: serverTimestamp()}` (only field allowed); tap opens `link` (in-app route or url_launcher).
- `screens/profile/profile_screen.dart` — account card (email/role/joined); display-name form (updateProfile + `users/{uid}.name` single-field write); change-password form (reauthenticate + updatePassword, friendly error codes); my-cohorts list (member reads).
- `screens/verify/verify_certificate_screen.dart` (**new**) + route `/verify/:certId` (public, no auth) — `get certificates/{certId.toUpperCase()}`; valid/not-found/error states.
- Wire the bell into the shell `AppBar`; ensure profile is a bottom-nav tab.

**Firestore interactions:** `notifications` (subscribe + readAt), `users/{uid}` (name), `cohorts` (member), `certificates/{id}` (public get). Auth: reauthenticate + updatePassword.

**Security & optimization:** notifications write only `readAt`; profile writes only `name`; single equality subscription (no composite index); verify uses public `get` only (never `list`).

**Acceptance criteria / tester checks:**
- Bell shows unread count live; marking read updates instantly and persists (visible on web).
- Name change reflects on web; password change requires correct current password; wrong password shows friendly error.
- `/verify/{certId}` shows a valid certificate without sign-in; unknown ID shows not-found.

**Testing strategy:** widget tests with fake Firestore stream for the bell (unread count, mark-all); profile validation tests (name length, password mismatch); verify screen states from fake doc reads.

---

### Phase 6 — Cross-cutting polish, optimization & release hardening

**Goal:** production-ready parity: offline behavior, App Check enforcement readiness, performance, and full test pass.

**Add / modify:**
- Offline: confirm Firestore persistence + cache-first reads; graceful "offline — will sync" affordance on failed progress writes; skeleton loaders everywhere.
- Optimization pass: verify no N+1 reads remain (dashboard/course/lesson/achievements each do the minimum queries the web does); image caching; lazy PDF/video loading; dispose controllers/streams.
- App Check enforcement: verify callables succeed with tokens; document enabling `ENFORCE_APPCHECK` server-side once mobile tokens are clean (monitoring→enforce).
- Deep links for notification `link` and `/verify/:certId`.
- Accessibility & theme parity with Andela brand.

**Acceptance criteria / tester checks:** app functions on flaky/no network (cached content, queued writes); no duplicate/read storms in Firestore usage; all unit + widget tests green; App Check tokens present on all backend calls.

**Testing strategy:** integration smoke (login→dashboard→lesson complete→quiz→certificate→review→achievements→notifications) on a real device; Firestore usage inspection; regression run of all unit/widget suites.

---

## 4. Testing strategy summary (per layer)

- **Unit (no device):** all `logic/*` (progress, streaks, gamification, spacedRepetition, resume, search, dueDates, videoEmbed), model `fromDoc`/`toMap` round-trips, service request/response mapping and error-code translation (fake FirebaseFunctions).
- **Widget (no device):** each screen with fake services (login/register/verify, dashboard states, course tree, quiz form, document render-kind switch, flashcard review, achievements, notifications bell, profile forms, verify screen).
- **Requires device/emulator (manual or `integration_test`):** real Firebase auth + cross-platform account parity, storage video signed-URL playback, external video webview, PDF rendering, App Check token issuance, offline sync, push/deep links.
- **Cannot be automated cheaply:** email delivery (verification/certificate), Cloud Function internals (rate limits, PDF generation) — assert via observable outputs (attempt docs, certificate docs, returned counts).

---

## 5. Top cross-cutting decisions (carry through every phase)

1. **Consolidated backend, reuse callables.** Same project `andela-lms-dae5f`, region `us-central1`. No new Cloud Functions. Grade via `gradeAttempt`, video via `getSignedVideoUrl`, certs via `issueCertificate`, leaderboard via `getCohortLeaderboard`, flashcards via `generateFlashcards`.
2. **Account parity is a hard invariant.** Register writes the identical `users/{uid}` shape with `status:"active"`; email-verification grandfather date and inactive-status sign-out match web; role from JWT claim with doc fallback. A mobile-created account must work on web and vice-versa.
3. **Admin reporting comes free by writing the exact same docs.** Same collections and doc-ID patterns (`enrollments/{uid}_{courseId}`, `progress/{uid}_{lessonId}`, `lessonFeedback/{uid}_{lessonId}`, notifications `readAt`, flashcard scheduling fields). Attempts/certificates are written only by functions. No admin-side changes required.
4. **Security: least privilege + provable queries.** Never read `assessmentKeys`; never write `attempts`/`certificates`/`notifications`(beyond readAt)/`flashcards`(beyond scheduling). Only single-field `where(userId==uid)` list queries (rules-provable, no composite indexes); filter/sort client-side as the web does. App Check active from launch.
5. **Optimization: minimize reads.** One aggregate `enrollments` query and one `progress` query per screen (no per-course/per-lesson `get`); parallel module-lesson fetches; in-memory signed-URL cache (refresh 5min pre-expiry); Firestore local persistence; `cached_network_image`.

---

## 6. Open risks & assumptions

- **docx lesson rendering:** the web uses in-browser mammoth; no equivalent Flutter renderer. Mitigation: prefer the server `${filePath}.pdf` twin where it exists (only produced for pptx/ppt/doc, **not** docx); for docx fall back to `url_launcher` external open. Flag as the one lesson sub-type without an in-app viewer.
- **External video embeds** rely on `webview_flutter`; YouTube/Drive embed policies and autoplay differ on mobile. Progress for external videos is manual "mark complete" (web has no watch tracking for embeds either) — parity preserved.
- **App Check** requires registering Android (Play Integrity) and iOS (DeviceCheck/App Attest) apps in the Firebase console and shipping debug tokens for dev; until done, keep server `ENFORCE_APPCHECK=false` (current default) so callables don't reject.
- **`getSignedVideoUrl` IAM prerequisite** (serviceAccountTokenCreator) is already required by web; assumed configured. If Storage video playback fails with a signing error, it is a backend IAM config issue, not mobile.
- **Composite-index assumption:** the plan avoids composite indexes by single-field queries + client filtering. If any query is changed to multi-field later, add the index in `firestore.indexes.json`.
- **Certificate/verify `certId` casing:** web upper-cases the path param before lookup; mobile must do the same.
- **Phase-4 seams:** `discussions`, `askTutor`, `gradeLab`, Mux video are intentionally excluded; keep `video_service` swappable and leave the lesson-viewer type switch open so a `discussion`/`tutor` panel and an HLS player can be added without refactor.
- **Scaffold bug fixes (Phase 1)** must land before later phases build on the services, or parity defects (status pending, verification over-blocking, composite query) will propagate.
