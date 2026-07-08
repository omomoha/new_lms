# Mobile Phase 7 — AI Tutor + Community Forum (+ Lesson Discussions)

> Planner/architect deliverable. Brings the web LMS **Phase‑4 learner** features
> (AI Tutor, Community Forum, per‑lesson Discussions) to the existing Flutter app
> (`mobile/`). Admin moderation UI is **out of scope**; learner‑visible moderation
> states are handled.
>
> **Source of truth:** these features live on the **`recent_update`** git branch,
> NOT on `main` (the base of `feature/mobile-ui`). All web behaviour below was read
> from `recent_update` via `git show recent_update:<path>`.
>
> **Conventions carried over from `MOBILE_PARITY_PLAN.md`:** provider + `ChangeNotifier`
> controllers, `go_router`, **single‑field Firestore queries only** (no composite
> indexes), realtime `onSnapshot`/`snapshots()` where the web uses them, writes whose
> shape EXACTLY matches `firestore.rules`, App Check enforced, region `us-central1`
> for callables, offline‑tolerant loads.

---

## 0. Executive summary

Three learner features, three sub‑phases:

| Sub‑phase | Feature | Callables | Collections | Feature flag |
|---|---|---|---|---|
| **7A** | AI Tutor (per‑lesson chat + persistence + feedback) | `askTutor` (us‑central1) | `users/{uid}/tutorConversations/{id}` (read), `tutorFeedback/{id}` (write) | `tutorEnhancements` (gates persistence + thumbs only) |
| **7B** | Community Forum (categories → threads → replies, reactions, report) | none client‑side; server triggers `onForumThreadCreated`, `onForumReplyCreated` | `forumCategories`, `forumThreads`, `forumThreads/{id}/posts`, `forumReports` | `communityForum` (gates the whole feature + nav) |
| **7C** | Lesson Discussions (per‑lesson Q&A) | none | `discussions` | none (always on; already on `main`) |

**Backend deploy prerequisites (blocking):**
- `askTutor` (basic) **is already on `main`** but the **enhanced** version (conversation
  persistence, retrieval grounding, `conversationId` in the response) exists only on
  `recent_update`. 7A's persistence/feedback needs `recent_update`'s `aiTutor.ts`,
  `tutorContext.ts`, `promptSafety.ts` **and** the `tutorConversations` + `tutorFeedback`
  rules deployed.
- Forum is **entirely absent from `main`**: `functions/src/forum.ts`
  (`onForumThreadCreated`, `onForumReplyCreated`) and the `forumCategories` /
  `forumThreads` / `forumThreads/*/posts` / `forumReports` rules must be deployed.
- Discussions rules already exist on `main` — 7C works against the current backend.

---

## 1. TUTOR (web audit → mobile spec)

### 1.1 Callable: `askTutor`
- **Region:** `us-central1`. `enforceAppCheck: ENFORCE_APPCHECK`. Client timeout on web
  is **120000 ms** (long answers exceed the 70s callable default) — mobile must set the
  same.
- **Request** (`AskTutorRequest`):
  ```
  {
    courseId: string,            // required, /^[A-Za-z0-9_-]+$/
    moduleId?: string,           // optional, same regex
    lessonId?: string,           // optional, same regex
    question: string,            // required, trimmed, ≤ 2000 chars
    history?: [{ role: "user"|"assistant", content: string }],  // ≤ 8 turns × ≤ 4000 chars
    conversationId?: string      // optional; append to an existing conversation
  }
  ```
- **Response** (`AskTutorResponse`): `{ answer: string, conversationId: string }`.
- **Grounding:** server prefers the current lesson body (`content`/`textContent`/
  `transcript`/`extractedText`); if empty, retrieval‑ranks the whole course. Client does
  nothing here beyond passing `courseId`/`moduleId`/`lessonId`.
- **History contract:** the client sends the last ≤8 turns as they stood BEFORE the new
  question. Server rebuilds/fences history server‑side (client history is untrusted), so
  the mobile client only needs to trim to 8 and send `{role, content}`.

### 1.2 Persistence: `users/{uid}/tutorConversations/{conversationId}`
- **Written server‑side only** (admin SDK, inside `askTutor`). Rules: `allow read: if
  isOwner(uid) || isAdmin();  allow write: if false;`. **Mobile never writes here.**
- Doc fields: `{ userId, courseId, title (first question, ≤120 chars), turns:
  [{role, content, at}], createdAt, updatedAt }`. `turns` capped to last 100.
- Doc‑id: server‑generated when `conversationId` omitted; reused when supplied. Client
  keeps the returned `conversationId` in memory for the session and passes it back to
  append (only when `tutorEnhancements` is ON — see gating).
- **Reading history (optional, enhanced):** mirrors `src/lib/tutorConversations.ts`
  — `orderBy("updatedAt","desc") limit(20)` for a list, `getDoc` for one. This is a
  single‑field orderBy (no composite index).

### 1.3 Feedback (thumbs): `tutorFeedback/{uid_conversationId_turnIndex}`
- **Learner writes** directly. Doc‑id pattern: `${uid}_${conversationId}_${turnIndex}`
  (re‑rating overwrites, never duplicates).
- Rules require: `feedbackId.matches(uid + "_.+")`, `userId == uid`, `rating in
  ["up","down"]`, `reason is string && size ≤ 1000`. Write shape:
  `{ userId, conversationId, turnIndex, courseId, rating, reason, createdAt: serverTimestamp() }`.
- Feedback is only offered when `tutorEnhancements` is ON **and** a `conversationId`
  exists (matches web).

### 1.4 Markdown rendering + safety
- Assistant answers are **GitHub‑flavoured Markdown** and are considered potentially
  prompt‑injected model output. Web uses a strict escape‑first renderer + DOMPurify
  allow‑list (`tutorMarkdown.ts`); **user turns render as plain text.**
- **Mobile:** render assistant turns with **`flutter_markdown`** (already a dependency).
  `flutter_markdown` does not execute HTML/JS and ignores raw HTML by default, giving us
  the same "inert markup" guarantee. Render code fences with a monospace style; **do not
  make links tappable / launch URLs from tutor output** (web deliberately strips links to
  kill the `javascript:`/`data:` URL class — mirror that by leaving `onTapLink` unset or
  a no‑op). User turns: plain `Text` / `SelectableText`, never Markdown.

### 1.5 Prompt‑safety / rate‑limit behaviours the client must handle
- Per‑uid quota **20 calls/hour** (`settings/ai.tutorHourlyLimit`, default 20). Over‑quota
  → `resource-exhausted`. `CallableService._friendly` already maps this to a friendly
  message — surface it verbatim in the tutor error line.
- `invalid-argument` (empty/oversize question) and `internal` ("could not produce an
  answer") must show inline, non‑fatal; the composer stays usable. Enforce `maxLength:
  2000` on the input so we rarely hit `invalid-argument`.
- Persistence is best‑effort server‑side: a persistence failure does NOT fail the call —
  the answer still returns. Client must not assume `conversationId` implies a durable doc.

### 1.6 Surfacing
- Web renders `<TutorPanel courseId moduleId lessonId />` inside the **lesson page**
  (collapsible "Ask the AI tutor"). Mobile mirrors: a collapsible tutor panel on the
  **lesson screen** (`screens/lesson/lesson_screen.dart`), passing the current
  `courseId`/`moduleId`/`lessonId`. Starter‑question chips (3 canned prompts) like web.
- Not global — tutor is per‑lesson/course context.

### 1.7 Feature‑flag gating (`tutorEnhancements`)
- The **base tutor chat works without any flag** (send question → render answer).
- `tutorEnhancements` **only** gates: (a) sending/persisting `conversationId`, and
  (b) the thumbs up/down feedback controls. With the flag OFF the panel behaves as a
  stateless chat (exactly web behaviour).

---

## 2. FORUM (web audit → mobile spec)

Navigation: **forum home (categories) → category (threads) → thread (posts/replies)**.

### 2.1 Collections, doc‑ids, fields
- **`forumCategories/{id}`** — `{ name, description, order, visibility: "all"|"cohort",
  cohortIds[], aiModeration?, postCount, lastActivityAt, createdAt }`. Read‑only for
  learners; admin‑managed.
- **`forumThreads/{id}`** — `{ categoryId, authorId, authorName, title, body,
  pinned:bool, locked:bool, replyCount, tags[]?, moderation?, moderationReason?,
  createdAt, lastReplyAt, editedAt? }`.
- **`forumThreads/{id}/posts/{postId}`** (replies) — `{ authorId, authorName, body,
  parentId: string|null, reactions?: {emoji: [uid]}, createdAt, editedAt? }`.
  Single‑level threading: `parentId==null` = top‑level; else attach to that top‑level
  post; replies‑to‑replies / orphans are dropped in the UI.
- **`forumReports/{id}`** — `{ reporterId, reporterName, threadId, postId: string|null,
  reason, resolved:false, createdAt }`.
- **No `votes` collection.** "Voting" = the fixed **reactions** palette
  (`["👍","❤️","🎉","👀"]`) stored as a map on each post.

### 2.2 Learner‑allowed reads / writes / updatable fields (from `firestore.rules`)
- **Categories:** `read` if admin OR learner where `visibility=="all"` OR the caller's
  `cohortIds` intersect the category `cohortIds`. Write: admin only. → Mobile must
  filter/gate exactly this (mirror `canViewCategory`). Category list is a plain
  `getDocs(forumCategories)` then client‑side visibility filter + `order` sort.
- **Threads:** `read` = any authed user (bodies are deliberately cross‑cohort; category
  visibility is enforced in the UI/query). `create` = author‑as‑self with fixed initial
  shape: `pinned==false, locked==false, replyCount==0`, `title` 1–200, `body` 1–5000,
  `authorName` ≤100, `categoryId` string. `update` (learner) = author may change **only**
  `["title","body","editedAt"]` (bounds re‑checked). `delete` = author or admin.
  Pin/lock/moderation = admin only → **not built** (out of scope) but respected read‑side.
- **Posts (replies):** `read` = any authed. `create` = author‑as‑self, `body` 1–5000,
  `authorName` ≤100, `parentId` null|string, **and the parent thread must not be locked**
  (`parentThread().locked == false` — lock enforced at the rules layer). `update` = author
  may change only `["body","editedAt"]`, OR **any authed user may change only
  `["reactions"]`** (this is how reaction toggles are allowed). `delete` = author or admin.
- **Reports:** `create` = any authed, `reporterId==uid`, `threadId` string, `reason`
  1–1000, `resolved==false`. `read` = admin or the reporter. No client update/delete.

### 2.3 Write shapes (must match rules exactly — mirror `src/lib/forumClient.ts`)
- `createThread`: `{ categoryId, authorId, authorName(≤100), title(trim,≤200),
  body(trim,≤5000), pinned:false, locked:false, replyCount:0, tags(≤8), createdAt:
  serverTimestamp(), lastReplyAt: serverTimestamp() }`.
- `createReply`: add to `forumThreads/{id}/posts` `{ authorId, authorName(≤100),
  body(trim,≤5000), parentId, createdAt: serverTimestamp() }`. (Do NOT set `reactions`
  on create — a reactions‑bearing create would still pass rules but keep it minimal.)
- `editThread`: `{ title(≤200), body(≤5000), editedAt: serverTimestamp() }` — nothing else.
- `editPost`: `{ body(≤5000), editedAt: serverTimestamp() }` — nothing else.
- `toggleReaction`: read post → mutate the single emoji's uid list → `updateDoc({
  reactions: nextMap })` (reactions‑only diff). Empty lists are removed from the map.
- `reportContent`: add to `forumReports` `{ reporterId, reporterName(≤100), threadId,
  postId: postId ?? null, reason(trim,≤1000), resolved:false, createdAt }`.
- `deleteThread` / `deletePost`: `deleteDoc` (author‑or‑admin only; gate the button with
  `isAuthorOrAdmin`).

### 2.4 Callables / server triggers
- **No client callables.** Two Firestore triggers run server‑side (mobile relies on their
  side‑effects, does not call them):
  - `onForumThreadCreated` — bumps category `postCount`/`lastActivityAt`; if the category
    has `aiModeration==true`, runs AI pre‑moderation and, when flagged, sets
    `moderation:"pending"` + `moderationReason`; fans out `@mention` notifications.
  - `onForumReplyCreated` — bumps thread `replyCount`/`lastReplyAt`; notifies the thread
    author + `@mentioned` users (writes to `notifications`, surfaced by the existing
    mobile `NotificationsBell`).
- **`@mentions`:** client just types `@handle`; resolution/notification is server‑side.
  Optional nicety: mirror `extractMentions` for a highlight, but not required.

### 2.5 Threading model (`src/lib/threading.ts`)
- Single level. `buildThreadTree(docs)`: top‑level (`parentId==null`) newest‑first;
  replies oldest‑first under their parent; orphans/reply‑to‑reply dropped. Port verbatim
  as a pure Dart helper (`logic/threading.dart`). Comparators: null `createdAtMillis`
  sorts last; ties break on `id`.
- Thread ordering in a category (`sortThreads`): pinned first, then by
  `lastReplyAt ?? createdAt` newest‑first.

### 2.6 Pagination / reads
- Web uses **realtime** `subscribeThreads` (single `where(categoryId==)` — no index) and
  `subscribePosts` (whole `posts` subcollection). Categories fetched once with `getDocs`.
- Mobile mirrors: `snapshots()` streams for threads‑in‑category and posts‑in‑thread;
  one‑shot `getDocs` for categories and single thread doc.
- **Optimization:** the web reads the entire `posts` subcollection per thread. For mobile,
  keep the same for parity now, but cap initial render and lazy‑expand long threads client
  side; a future `orderBy(createdAt) limit(N)` + "load more" is the single‑field‑safe path
  if threads grow large. Search over threads (`searchThreads`) is client‑side over the
  already‑subscribed list — port it.

### 2.7 relativeTime formatting (`src/components/forum/relativeTime.ts`)
- `just now` (<60s) / `Nm ago` (<60m) / `Nh ago` (<24h) / `Nd ago` (<7d) / locale date
  otherwise; `null` → "just now". Port verbatim (`logic/relative_time.dart`, use `intl`
  for the fallback date). Same helper reused by discussions (7C).

### 2.8 Moderation / resolved states learners see (read‑side only)
- `moderation:"pending"` threads are **hidden from non‑admins** by the web UI. Mobile must
  do the same: filter out threads where `moderation == "pending"` unless the viewer is an
  admin. (There is no rule‑level hide — it's a client filter, so we must replicate it.)
- Author's own edits within a **15‑minute edit window** (`EDIT_WINDOW_MS`) — mirror
  `canEdit` (admin always; author within 15 min of `createdAt`; pending write = editable).
- Locked threads: hide/disable the reply composer (rules also enforce it).
- Reports: after submitting, show a confirmation; learners cannot see resolution state
  (only admins/reporter can read the report). No moderation queue on mobile.

### 2.9 Feature‑flag gating (`communityForum`)
- The forum tab/entry and every forum screen are gated behind `communityForum`. With the
  flag OFF, show "not available yet" (web) and do not surface the nav entry. Flag read
  once via the feature‑flag service.

---

## 3. DISCUSSIONS (per‑lesson Q&A) — 7C

- **Is a separate learner feature to port?** Yes — small, and it already has backend
  support on `main` (rules present, no callables). Good low‑risk closer.
- **Collection:** `discussions/{id}` — `{ courseId, lessonId, userId, userName, body,
  parentId: string|null, createdAt }`. Single‑level threading (same `threading.dart`).
- **Rules:** `read` = admin OR learner with `canAccessCourse(courseId)`. `create` =
  author‑as‑self, `body` 1–2000, `userName` ≤100, `parentId` null|string, and
  `canAccessCourse(courseId)`. `delete` = author or admin. **`update: if false`** — no
  edits; delete‑and‑repost.
- **CRITICAL query shape:** the read MUST filter by **both** `courseId` AND `lessonId`
  equalities (`where(courseId==).where(lessonId==)`). A `lessonId`‑only query is DENIED
  for learners because the rule resolves course access from `resource.data.courseId`,
  provable only when `courseId` is pinned by the query. This is a **two‑equality query**
  but on distinct fields — Firestore serves it **without a composite index** (equality‑
  only). Then client‑side re‑filter `courseId` for safety (web does this).
- **Callables:** none.
- **Surfacing:** collapsible "Discussion (N)" panel on the lesson screen, below the tutor
  panel — exactly the web layout (`TutorPanel` then `DiscussionPanel` in the lesson page).
- **No feature flag** — always on.

---

## 4. MOBILE ARCHITECTURE DELTAS

### 4.1 New models (`mobile/lib/models/`)
- `tutor_conversation.dart` — `TutorTurn {role, content, at?}`, `TutorConversation
  {id, title?, courseId?, turns[], updatedAt}`. `fromDoc` coercing (mirror
  `normalizeTurns`). (Read‑only; only needed for the optional history list.)
- `forum_category.dart` — `ForumCategory` + `canViewFor(role, cohortIds)` +
  `fromDoc`.
- `forum_thread.dart` — `ForumThread` (+ `moderation`, `pinned`, `locked`, `replyCount`,
  `lastReplyAtMillis`, `createdAtMillis`, `editedAtMillis`, `tags`).
- `forum_post.dart` — `ForumPost` (+ `parentId`, `reactions: Map<String,List<String>>`).
- `forum_report.dart` — optional (write‑only; can inline).
- `discussion.dart` — `Discussion {id, courseId, lessonId, userId, userName, body,
  parentId, createdAtMillis}`.
- Reuse existing `AppNotification` (forum/tutor produce notifications server‑side; no
  new model needed there).

### 4.2 Pure logic (`mobile/lib/logic/`) — ported verbatim, unit‑tested
- `threading.dart` — `buildThreadTree`, `compareNewestFirst`, `compareOldestFirst`,
  `isAuthorOrAdmin` (port of `src/lib/threading.ts`).
- `forum_rules.dart` — `canViewCategory`, `visibleCategories`, `sortThreads`,
  `searchThreads`, `canEdit` (15‑min window), `canModerate`, reaction palette + max
  lengths (port of `src/lib/forum.ts`, minus firebase). Include the **pending‑moderation
  filter** helper.
- `relative_time.dart` — port of `relativeTime.ts` (used by forum + discussions).
- `discussions.dart` — `buildThreads` (delegates to `threading.dart`), `canDelete`.

### 4.3 `firestore_service.dart` additions (single‑field/equality queries; realtime where web is)
- **Tutor (enhanced reads, optional):** `Stream`/`Future` for
  `users/{uid}/tutorConversations` `orderBy(updatedAt desc) limit(20)`; `getDoc` one.
- **Tutor feedback (write):** `submitTutorFeedback({uid, conversationId, turnIndex,
  courseId, rating, reason})` → `setDoc(tutorFeedback/${uid}_${conversationId}_${turnIndex})`
  with exact rule shape.
- **Forum:**
  - `Future<List<ForumCategory>> fetchForumCategories()` (`getDocs`).
  - `Stream<List<ForumThread>> forumThreadsStream(categoryId)` — `where(categoryId==)`
    `.snapshots()`.
  - `Future<ForumThread?> fetchThread(id)` / `Future<ForumCategory?> fetchCategory(id)`.
  - `Stream<List<ForumPost>> forumPostsStream(threadId)` — `posts.snapshots()`.
  - `Future<String> createThread(...)`, `createReply(...)`, `editThread(...)`,
    `editPost(...)`, `deleteThread(...)`, `deletePost(...)`, `toggleReaction(...)`,
    `reportForumContent(...)` — all matching §2.3 shapes.
- **Discussions:**
  - `Future<List<Discussion>> fetchDiscussions(courseId, lessonId)` —
    `where(courseId==).where(lessonId==)` (two‑equality, no composite index), client
    re‑filter `courseId`.
  - `Future<void> createDiscussion(...)`, `deleteDiscussion(id)`.

### 4.4 `callable_service.dart` additions (region `us-central1`, existing `_call` + error map)
- `Future<AskTutorResult> askTutor({courseId, moduleId?, lessonId?, question, history,
  conversationId?})` with **timeout 120000 ms**, returning `AskTutorResult{answer,
  conversationId}`. Reuses the existing `_friendly` map (already handles
  `resource-exhausted`, `invalid-argument`, `deadline-exceeded`, `internal`).

### 4.5 New controllers (`mobile/lib/state/`)
- `tutor_controller.dart` (`ChangeNotifier`) — holds `messages`, `loading`, `error`,
  `conversationId`, `feedback` map, `enhanced` flag; `send(question)`,
  `rate(turnIndex, rating)`. Trims history to 8 before each call.
- `forum_home_controller.dart` — loads categories, computes visible list.
- `forum_category_controller.dart` — subscribes threads for a category, search text,
  create‑thread; filters pending moderation for non‑admins.
- `forum_thread_controller.dart` — subscribes posts, `buildThreadTree`, reply/edit/delete/
  react/report, lock handling.
- `discussion_controller.dart` — loads discussions for a lesson, post/reply/delete.
  (Or fold discussions into the existing `LessonController` since it already owns lesson
  context — recommended to avoid an extra provider.)

### 4.6 New screens/widgets + shell wiring
- **Tutor:** `widgets/lesson/tutor_panel.dart` (collapsible), rendered inside
  `screens/lesson/lesson_screen.dart` (pass `courseId`/`moduleId`/`lessonId`). Assistant
  turns via `flutter_markdown`.
- **Discussions:** `widgets/lesson/discussion_panel.dart` in `lesson_screen.dart`, below
  the tutor panel (matches web order).
- **Forum:** three routed screens pushed on the root navigator:
  - `screens/forum/forum_home_screen.dart` → `/forum`
  - `screens/forum/forum_category_screen.dart` → `/forum/category/:categoryId`
  - `screens/forum/forum_thread_screen.dart` → `/forum/thread/:threadId`
  Widgets: `widgets/forum/thread_tile.dart`, `post_tile.dart` (reactions row, report,
  edit/delete when permitted), `reaction_bar.dart`, `report_sheet.dart`,
  `new_thread_sheet.dart`.
- **Router (`app_router.dart`):** add the three `/forum*` routes with
  `parentNavigatorKey: _rootNavigatorKey` (full‑screen, like course/lesson).
- **Bottom‑nav shell:** the web puts Forum in the learner nav gated by `communityForum`.
  Mobile keeps the 4 existing bottom tabs; add a **Forum entry point** that only appears
  when the flag is ON. Two acceptable options — pick one at build time:
  1. Add a 5th bottom‑nav destination ("Community") + a `StatefulShellBranch` for
     `/forum` (nav item conditionally shown). Cleaner discovery.
  2. Add a **Forum icon/action in the `AppShell` AppBar** (next to the notifications
     bell) + a "Community forum" card on the Home screen. Lower churn to the tab bar.
  Recommendation: **option 2** (AppBar action + Home card) to keep the indexed‑stack tab
  count stable; revisit a dedicated tab later.

### 4.7 Feature‑flag service (read `settings/features` once, expose flags)
- New `services/feature_flags_service.dart` + `state/feature_flags_controller.dart`:
  read `settings/features` **once** at app start (or first learner screen), cache the
  booleans, expose `tutorEnhancements`, `communityForum` (and the existing
  `analyticsDashboard`, `muxVideo` for future). Missing doc/key → `false`.
- Rules already allow any authed user to read `settings/features` (the `settingId ==
  "features"` exception). Provide via `Provider` so tutor panel, forum nav, and forum
  screens read synchronously without re‑fetching (web re‑reads per component; mobile
  should read once and share).

### 4.8 Dependencies
- No new packages required. `flutter_markdown` (tutor), `intl` (relative time),
  `cloud_firestore`/`cloud_functions`/`firebase_app_check` already present.

---

## 5. CONSOLIDATED BACKEND • ACCOUNT PARITY • ADMIN REPORTING • SECURITY

- **Shared backend, one source of truth.** Mobile reuses the **same** collections,
  callable, and rules as web + admin. No mobile‑specific collections. This keeps
  web/mobile/admin interoperable: a thread posted on mobile appears on web and in the
  admin moderation queue; tutor feedback and forum reports feed the same admin analytics.
- **Account parity.** Same Firebase Auth project (`andela-lms-dae5f`), same `users/{uid}`
  roles/cohorts. Category visibility and course‑access checks use the same cohort model.
- **Write only rule‑allowed fields.** Every mobile write mirrors the exact key sets in
  §1.3 / §2.3 / §3. In particular: never write thread `pinned`/`locked`/`moderation`
  (admin‑only), never write to `tutorConversations` (server‑only), reaction toggles must
  be a **reactions‑only diff**, edits must be title/body(+editedAt) or body(+editedAt)
  only.
- **Prompt safety / moderation respected.** Tutor answers rendered as inert Markdown, no
  tappable links (matches web's link‑stripping). Forum/discussion user content rendered as
  **plain text** (web renders user content as plain text everywhere). Learner‑visible
  moderation state = hide `moderation:"pending"` threads for non‑admins.
- **App Check.** All Firestore + callable traffic goes through the app's existing App
  Check attestation (`services/app_check.dart`); `askTutor` enforces App Check.
- **Single‑field / equality queries only.** Forum threads: `where(categoryId==)`.
  Discussions: `where(courseId==).where(lessonId==)` (equality‑only, no composite index).
  Tutor conversation list: `orderBy(updatedAt)` (single field). No `firestore.indexes.json`
  changes needed for these features (confirmed: no forum/tutor/discussion composite
  indexes exist on `recent_update`).
- **Pagination to minimize reads.** Categories one‑shot; threads/posts realtime but with
  client‑side render caps and a documented `limit()+load‑more` upgrade path if volumes
  grow.

### 5.1 Backend deploy prerequisites (must merge `recent_update` → main and deploy)
> These currently exist **only on `recent_update`**. Without them the mobile features
> either fail (forum) or silently lack persistence (tutor enhancements).

**Cloud Functions to deploy** (`functions/src/`):
- `aiTutor.ts` — **enhanced** version (persistence + `conversationId` response +
  retrieval grounding). (Basic `askTutor` is on `main`; the enhanced one is not.)
- `tutorContext.ts` — retrieval‑grounding helper imported by `aiTutor.ts` (absent on main).
- `promptSafety.ts` — `fenceUntrusted`/`capText` (absent on main; imported via `aiCommon`).
- `forum.ts` — `onForumThreadCreated`, `onForumReplyCreated` (absent on main). Must be
  exported from `functions/src/index.ts` (recent_update already exports them).

**Firestore rules to deploy** (`firestore.rules`) — add on top of what's on main:
- `users/{uid}/tutorConversations/{id}` (owner/admin read; write:false).
- `tutorFeedback/{feedbackId}` (owner create/overwrite; admin read).
- `forumCategories/{id}` (visibility read; admin write).
- `forumThreads/{id}` + `forumThreads/{id}/posts/{postId}` (read authed; scoped
  create/update/delete; lock + reactions‑only + author‑edit rules).
- `forumReports/{id}` (create authed self; read admin/reporter).
- `discussions/{id}` — **already on main**; no change.

**Settings docs to configure:**
- `settings/features`: set `tutorEnhancements` and `communityForum` to `true` when ready
  to expose (default false → hidden). `settings/ai.tutorHourlyLimit` optional (default 20).
- Seed at least one `forumCategories` doc so the forum isn't empty (admin task).

**Runtime:** `askTutor` needs the Anthropic API key/secret configured in the functions
env (same as other AI functions). AI pre‑moderation is fail‑open and only runs for
categories with `aiModeration:true`.

---

## 6. SUB‑PHASES (shippable) with task lists, acceptance criteria, tester checks

### Sub‑phase 7A — AI Tutor
**Goal:** per‑lesson tutor chat with Markdown answers; persistence + thumbs behind
`tutorEnhancements`.

**Tasks (file‑level):**
- `models/tutor_conversation.dart` (read model; optional history).
- `logic/` — none new (tutor has no pure threading logic).
- `services/callable_service.dart` — add `askTutor(...)` + `AskTutorResult` (timeout 120s).
- `services/firestore_service.dart` — add `submitTutorFeedback(...)`, and optional
  `tutorConversationsStream/getConversation`.
- `services/feature_flags_service.dart` + `state/feature_flags_controller.dart` (shared;
  also used by 7B) — read `settings/features` once.
- `state/tutor_controller.dart`.
- `widgets/lesson/tutor_panel.dart` (collapsible; starter chips; `flutter_markdown`
  assistant rendering; plain‑text user turns; thumbs when `tutorEnhancements`).
- Wire panel into `screens/lesson/lesson_screen.dart`.

**Acceptance criteria:**
- Sending a question returns and renders a Markdown answer; code fences are monospace;
  no tappable links from tutor output; user turns are plain text.
- Over‑quota shows the friendly `resource-exhausted` message; input capped at 2000 chars.
- With `tutorEnhancements` ON: follow‑ups reuse the returned `conversationId`; thumbs
  up/down write `tutorFeedback/${uid}_${conversationId}_${turnIndex}` and reflect state.
- With flag OFF: chat still works, no thumbs, no `conversationId` sent.

**Tester checks:**
- Unit: history truncation to 8; request‑payload shape; `AskTutorResult` parsing;
  feedback doc‑id + rating/reason bounds.
- Widget: markdown renders lists/code/inline‑code; raw HTML in an answer renders inert;
  error line appears on thrown `CallableException`.
- Rules/manual: feedback write succeeds only with matching uid prefix + valid rating;
  a client write to `tutorConversations` is denied.

---

### Sub‑phase 7B — Community Forum
**Goal:** browse categories → threads → posts; create thread/reply; edit (15‑min) /
delete own; reactions; report; realtime; gated by `communityForum`.

**Tasks (file‑level):**
- `models/forum_category.dart`, `forum_thread.dart`, `forum_post.dart`.
- `logic/threading.dart`, `logic/forum_rules.dart`, `logic/relative_time.dart`.
- `services/firestore_service.dart` — category fetch, threads stream, thread/category get,
  posts stream, create/edit/delete thread & post, `toggleReaction`, `reportForumContent`.
- `state/forum_home_controller.dart`, `forum_category_controller.dart`,
  `forum_thread_controller.dart`.
- `screens/forum/forum_home_screen.dart`, `forum_category_screen.dart`,
  `forum_thread_screen.dart`.
- `widgets/forum/thread_tile.dart`, `post_tile.dart`, `reaction_bar.dart`,
  `report_sheet.dart`, `new_thread_sheet.dart`.
- `router/app_router.dart` — add `/forum`, `/forum/category/:id`, `/forum/thread/:id`.
- Shell: conditional Forum entry point (AppBar action + Home card) gated by
  `communityForum`.

**Acceptance criteria:**
- Only visible categories shown (all + cohort‑intersect); sorted by `order`.
- Threads realtime; pinned first then last‑activity; `moderation:"pending"` hidden for
  non‑admins; client search filters title/body/tags.
- Create thread/reply write the exact rule shapes; locked thread disables reply composer.
- Author can edit own within 15 min and delete own; reactions toggle (reactions‑only
  write); report writes `forumReports` and confirms.
- Relative times match web thresholds.
- Whole feature hidden + nav entry absent when `communityForum` is OFF.

**Tester checks:**
- Unit: `buildThreadTree` orphan‑drop + ordering; `canViewCategory`/`visibleCategories`;
  `sortThreads`; `searchThreads`; `canEdit` window; pending filter; `relativeTime`.
- Rules/manual: reply to locked thread denied; editing keys beyond title/body denied;
  reaction‑only diff allowed by another user; setting `pinned/locked` from client denied;
  report create requires `resolved==false` + self reporterId.
- Integration: post on mobile → thread `replyCount`/`lastReplyAt` bump (trigger) → thread
  author gets a `notifications` doc (existing bell).

---

### Sub‑phase 7C — Lesson Discussions
**Goal:** per‑lesson Q&A panel (create/reply/delete, single‑level), always on.

**Tasks (file‑level):**
- `models/discussion.dart`; reuse `logic/threading.dart` + `logic/discussions.dart` +
  `relative_time.dart`.
- `services/firestore_service.dart` — `fetchDiscussions(courseId, lessonId)` (two‑equality
  query), `createDiscussion`, `deleteDiscussion`.
- Fold state into `LessonController` (or `state/discussion_controller.dart`).
- `widgets/lesson/discussion_panel.dart`; wire below the tutor panel in `lesson_screen.dart`.

**Acceptance criteria:**
- Panel shows "Discussion (N)", loads with the two‑equality query, groups into single‑level
  threads (newest questions, oldest replies).
- Post question / reply write the exact rule shape (`courseId, lessonId, userId, userName,
  body, parentId, createdAt`); author/admin can delete; no edit affordance (rules forbid).
- User content is plain text.

**Tester checks:**
- Unit: `buildThreads` grouping; `canDelete` author/admin.
- Rules/manual: a `lessonId`‑only query is denied; the `courseId+lessonId` query succeeds
  for an enrolled learner and is denied for a non‑member course; update is denied.
- Widget: post → reload shows new item; delete confirm → removed.

---

## 7. Risks & assumptions
- **Backend not yet merged/deployed.** 7B is fully blocked and 7A's persistence/feedback
  are blocked until `recent_update`'s functions + rules ship to the shared project. 7C and
  base‑tutor work against `main` today. **Coordinate the merge/deploy before/with 7A‑7B.**
- **Reaction race.** `toggleReaction` is read‑modify‑write of the whole `reactions` map;
  concurrent reactors can clobber each other (web has the same limitation). Acceptable;
  note as known.
- **Whole‑subcollection reads** for posts/discussions can grow; mitigated by client caps
  now, `limit()+load‑more` later (single‑field safe).
- **Nav placement (5th tab vs AppBar action)** is a product/UX call — plan recommends the
  AppBar action + Home card to avoid destabilizing the indexed‑stack tab bar; confirm with
  design.
- **Pending‑moderation hiding is client‑side** (no rule hide). Any client that ignores it
  could see pending threads (they still can't act as admin). Matches web; acceptable.
- **`@mention` resolution** is best‑effort server‑side; mobile does no resolution.
- **Admin capabilities (pin/lock/moderation queue)** are intentionally excluded; mobile
  respects the states read‑side only.
