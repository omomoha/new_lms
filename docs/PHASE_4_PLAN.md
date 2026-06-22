# Andela LMS — Phase 4 Plan

Status: **draft for review** · Branch: `recent_update` · Target project: `andela-lms-dae5f` (prod)

Phase 3 is complete and the codebase has already absorbed several "known gaps"
from the go-live checklist (in-app notifications, per-lesson discussions, a
learner profile page, due dates). Phase 4 builds on that with four workstreams:

1. **AI Tutor — perfect it** (quality, latency, memory, grounding, trust)
2. **Community forum** — a space where all users can chat across cohorts
3. **Adaptive video (Mux/HLS)** — the long-deferred "Phase 2" provider swap
4. **Deeper analytics & reporting** — engagement, at-risk detection, scheduled reports

Each workstream below is grounded in the current code, lists what exists today,
what changes, the data/rules/function impact, and a testing + rollout note.
Open decisions are collected at the end.

---

## Workstream A — Perfect the AI Tutor

### What exists today
`functions/src/aiTutor.ts` (`askTutor` callable) is already security-hardened:
fixed server-side system prompt, every untrusted input run through
`fenceUntrusted()`, client history rebuilt and validated server-side, per-uid
quota (20/hour) via `consumeQuota`, and `requireCourseAccess` gating. Grounding
uses the current lesson's text/transcript/extracted-file text, falling back to
the whole course (`collectCourseText`, capped at 20k chars). The UI is
`src/components/tutor/TutorPanel.tsx`. Model is `claude-sonnet-4-6`.

### Gaps that keep it from feeling "perfect"
- **Plain text only.** The system prompt forbids markdown because the UI can't
  render it — so code answers have no formatting, no syntax highlighting.
- **No streaming.** `callClaude` awaits the full response, so the learner stares
  at a spinner for multi-second answers. The repo already uses `highlight.js`.
- **No conversation persistence.** History lives only in component state; a
  refresh loses the thread and there's no record for quality review.
- **Grounding is blunt for large courses.** A 20k-char whole-course dump is
  lossy; there's no retrieval (RAG) to pull the *most relevant* passages, and
  video lessons without transcripts contribute nothing.
- **No feedback signal.** There's a `LessonFeedback` pattern but no thumbs
  up/down on tutor answers, so we can't measure or improve quality.
- **No evaluation harness.** Quality changes can't be regression-tested.

### Plan
- **Markdown + code rendering** in `TutorPanel`: render assistant turns with a
  safe markdown renderer (DOMPurify is already a dep) + `highlight.js`; relax
  the "plain text only" clause in `SYSTEM_PROMPT` accordingly.
- **Streaming responses**: add a streaming variant of `callClaude`
  (`messages.stream`) surfaced via an SSE/`onRequest` endpoint or chunked
  callable; render tokens as they arrive. Keep the non-streaming path as a
  fallback. Re-verify the prompt-injection fences are unchanged.
- **Retrieval-grounded context (RAG)**: precompute lesson-chunk embeddings on
  content change (new Firestore-triggered function writing a `lessonChunks`
  collection or a vector index), then select top-K chunks per question instead
  of dumping the whole course. Cuts tokens/cost and improves answer relevance.
  *Decision needed:* embeddings provider (Voyage via Anthropic ecosystem vs.
  Vertex) and vector store (Firestore + cosine in-function for small N, vs. a
  managed vector DB).
- **Conversation persistence**: store threads under
  `users/{uid}/tutorConversations/{id}` (learner-private; rules mirror existing
  per-user collections). Enables resume, history, and a future admin
  quality-review view.
- **Answer feedback**: thumbs up/down + optional reason written to
  `tutorFeedback`; surfaces in analytics (Workstream D) and seeds the eval set.
- **Suggested follow-ups & "explain like I'm new"** quick actions in the UI.
- **Eval harness**: a small fixture set of (course-context, question,
  expected-property) cases run in CI against a recorded/mocked model, plus an
  offline scoring script for grounded-ness and refusal behavior.
- **Cost/quota**: make the 20/hour limit configurable in `settings`; track
  per-uid token spend in `aiUsage` for the analytics dashboard.

### Testing
Unit-test the new context-selection/RAG ranking and markdown sanitization;
extend the prompt-injection spot checks; add the eval harness to CI (mocked
model). No change to the security model — fences and server-rebuilt history stay.

---

## Workstream B — Community forum (all users chat)

### What exists today
`src/lib/discussions.ts` + `DiscussionPanel.tsx` implement **per-lesson** Q&A:
single-level threads (`parentId === null` is a question, one level of replies),
create + delete only (no edit), author-or-admin delete, newest-first questions /
oldest-first replies, deterministic sorting, orphan replies dropped. Firestore
`discussions` rules already enforce create/delete-only and the author/admin
model. This is a solid, well-tested foundation to generalize from.

### Target
A standalone community space ("forum") where **all users (learners + admins,
across cohorts)** can start topics and chat — distinct from lesson-scoped Q&A,
which stays as-is.

### Plan — data model
- `forumCategories/{categoryId}`: `name`, `description`, `order`,
  `visibility: "all" | "cohort"`, optional `cohortIds`, `postCount`,
  `lastActivityAt`. Admin-managed.
- `forumThreads/{threadId}`: `categoryId`, `authorId`, `authorName`, `title`,
  `body`, `pinned`, `locked`, `replyCount`, `createdAt`, `lastReplyAt`,
  `tags?`. 
- `forumThreads/{threadId}/posts/{postId}`: `authorId`, `authorName`, `body`,
  `createdAt`, `editedAt?`, `reactions?`. (Reuse the proven threading/sort
  helpers from `discussions.ts`, lifted into a shared module.)

### Plan — features
- Category list → thread list → thread view, with **pin/lock** (admin),
  **reactions**, **edit window** (author, time-boxed), and **search** over
  titles/bodies.
- **Real-time** updates via Firestore listeners (same pattern as discussions).
- **Notifications**: reuse the existing `notifications` collection + `notify.ts`
  / `NotificationsBell` so replies and @mentions notify participants.
- **Moderation**: report action; admin moderation queue; optional **AI
  pre-moderation** of new posts reusing `aiCommon` (toxicity/spam check before
  publish, fenced like all other AI inputs).
- **Visibility/authZ**: Firestore rules modeled on `discussions` — any
  authenticated user reads `visibility:"all"` categories; cohort-scoped
  categories gated on `cohortIds` membership; author-or-admin edit/delete;
  admin-only category management; locked threads reject new posts at the rules
  layer.

### Decisions needed
- Scope of v1: global categories only, or cohort-scoped from day one?
- Anonymity/identity: always real name (current pattern) — confirm.
- Rich text/images in posts (needs Storage + sanitization) or text-only v1?
- AI moderation on by default, or admin-opt-in per category?

### Testing
Lift and reuse the `discussions.test.ts` threading/sort/permission tests for the
shared module; add `firestore.rules.test.ts` cases for category visibility, lock
enforcement, and cross-cohort denial.

---

## Workstream C — Adaptive video (Mux / HLS)

### What exists today
The video layer is already abstracted exactly for this swap. `VideoService`
(interface) → currently `SignedUrlVideoService` (playback via the
`getSignedVideoUrl` callable issuing 2h V4 signed URLs; Storage rules deny direct
client reads of `videos/**`). `transcodeVideo` makes a single 720p MP4 variant
with ffmpeg; the player offers source-vs-720p. `src/lib/video/index.ts` is the
one-line provider switch. `VideoPlayer.tsx` consumes a plain URL.

### Plan
- **`MuxVideoService implements VideoService`**:
  - `uploadVideo` → request a **Mux Direct Upload** URL from a new callable
    (`createMuxUpload`, admin-gated), upload the file to it, and persist the
    returned **asset/playback ID** as `Lesson.videoPath` (the seam already
    treats this as an opaque string, so no schema change is forced — but we add
    explicit `muxAssetId` / `muxPlaybackId` fields for clarity).
  - `getPlaybackUrl` → return a **signed HLS playback URL** (Mux signed playback
    keys), minted server-side by a `getMuxPlaybackToken` callable that reuses
    the same `requireCourseAccess` gate as `getSignedVideoUrl`.
- **Player**: swap the HTML5 `<video>` for **`mux-player`** (or `hls.js` over the
  existing element) so adaptive bitrate, quality ladder, and captions are
  automatic. Keep `VideoPlayer.tsx`'s resume/position-save behavior.
- **Webhooks**: a `muxWebhook` (`onRequest`, signature-verified) marks lessons
  `ready` when the asset finishes encoding; surfaces status in the builder.
- **Captions/transcripts**: use Mux auto-generated captions; keep the existing
  manual `.vtt`/`transcript` path as override (and feed transcripts into the
  tutor's RAG from Workstream A).
- **Migration**: a backfill function (pattern: `backfillOfficeConversions`)
  pushes existing Storage `videos/**` into Mux and rewrites lesson docs; run once,
  idempotent. Retire `transcodeVideo` after cutover (keep behind a flag during
  transition).
- **Secrets**: `MUX_TOKEN_ID`, `MUX_TOKEN_SECRET`, `MUX_SIGNING_KEY_ID`,
  `MUX_SIGNING_PRIVATE_KEY` added to GitHub Actions secrets and written into
  `functions/.env` at deploy (same mechanism as `ANTHROPIC_API_KEY`).

### Decisions needed
- Confirm **Mux** vs. Bunny/Cloudflare Stream (Mux assumed; interface makes this
  cheap to change). 
- Cost: Mux bills on encoding + streaming minutes — needs a quick estimate
  against the 5k-learner profile before cutover.
- Cutover: new uploads to Mux immediately, migrate old ones in the background, or
  big-bang migrate?

### Testing
Unit-test the playback-ID parsing and signed-token TTL logic; smoke-test upload
→ ready webhook → signed playback in a staging Mux environment; verify the access
gate denies non-enrolled users exactly as `getSignedVideoUrl` does today.

---

## Workstream D — Deeper analytics & reporting

### What exists today
Admin dashboard (`src/app/admin/page.tsx`), roster, audit log (`/admin/audit`),
assessment insights with pre/post charts (`PairedBarChart`), CSV export
(`csvExport.ts` + `DownloadCsvButton`), and a cohort leaderboard
(`leaderboard.ts`). Solid, but mostly point-in-time and computed via direct
client reads.

### Plan
- **Engagement & progress metrics**: time-on-task, lessons completed/week,
  active learners (DAU/WAU), completion funnels per course, and cohort-vs-cohort
  comparison.
- **At-risk detection**: flag learners with stalled progress / missed due dates
  / low quiz scores (builds on `dueDates.ts` + `progress` + `attempts`); feeds a
  retention view and optional nudge emails (extend `learnerReminders`).
- **AI usage analytics**: tutor volume, token spend, and the new tutor-answer
  feedback (Workstream A) — quality + cost visibility.
- **Pre-aggregation**: a **scheduled aggregation function** (pattern:
  `weeklyDigest`/`dailySignupAlert`) rolls metrics into an `analytics/`
  collection so dashboards read cheap pre-computed docs instead of scanning
  enrollments/progress live (critical at 5k learners). 
- **Dashboards**: new `/admin/analytics` with charts (reuse the existing chart
  components; add Chart.js only if needed). Drill-down to per-cohort and
  per-learner.
- **Scheduled reports**: optional weekly leadership email/PDF summary (reuse the
  certificate `pdf-lib` path + the `mail` collection).
- **Exports**: extend `csvExport` for the new datasets; keep everything
  Excel/Sheets-friendly.

### Decisions needed
- Which 5–8 metrics matter most to Andela leadership for v1 (so we build the
  aggregation around them, not everything)?
- Real-time-ish (hourly aggregation) vs. daily is enough?
- Is a scheduled emailed report in-scope for Phase 4 or a fast-follow?

### Testing
Unit-test the aggregation math (completion %, at-risk thresholds, rollups) the
way `progress.ts`/`gamification.ts` are tested; verify rules keep the new
`analytics/` docs admin-only.

---

## Cross-cutting concerns

**Sequencing (proposed).** They're largely independent, but a sensible order:
1. **AI Tutor** quick wins (markdown + streaming + persistence) — high
   perceived value, low risk, no new infra.
2. **Forum** — self-contained, reuses discussions + notifications.
3. **Analytics** — depends on aggregation infra; benefits from tutor-feedback
   and forum-activity signals existing first.
4. **Mux** — most external dependency (account, secrets, cost sign-off, data
   migration); do it deliberately with a staged cutover.

The tutor RAG piece (embeddings) can run in parallel as a longer track since it
also benefits Mux transcripts and analytics.

**Deployment.** `recent_update` now auto-deploys to prod via
`.github/workflows/deploy.yml` (committed). New secrets required before the Mux
work deploys: the four `MUX_*` values. Everything else deploys with existing
secrets. Recommend feature-flagging each workstream (a `settings/features` doc)
so half-built features never reach learners on a prod deploy from `recent_update`.

**Risks.**
- Deploying `recent_update` straight to prod means unfinished work can go live —
  feature flags + green CI gate are the mitigation. (Consider a staging Firebase
  target if appetite exists.)
- Mux cost and the migration of existing videos are the biggest unknowns.
- RAG adds an embeddings provider + storage; start simple (in-function cosine
  over a capped chunk set) before reaching for a vector DB.
- `next@14.2.8` is still pinned for security reasons; none of these workstreams
  require bumping it, but the Next 15 migration remains a separate future track.

**Testing/CI.** Every workstream extends the existing Vitest + Firestore-rules
suites. The deploy job already runs lint → typecheck → test → rules-emulator
before any deploy; keep that gate green.

---

## Decisions needed from Abraham (blocking detailed build-out)

1. **Forum v1 scope**: global categories only or cohort-scoped too? Rich
   text/images or text-only? AI moderation default-on or opt-in?
2. **Analytics**: the top 5–8 metrics leadership actually wants; daily vs hourly
   aggregation; emailed reports in-scope now?
3. **Video**: confirm Mux (vs. Bunny/Cloudflare); cutover strategy; who owns the
   Mux account + cost sign-off.
4. **AI Tutor RAG**: embeddings provider + vector store preference, or start with
   the simple in-function approach and revisit.
5. **Staging**: stay with `recent_update → prod` + feature flags, or stand up a
   separate staging Firebase target for safer iteration?

Once these are settled I'll turn each workstream into a task breakdown and start
implementing on `recent_update`.
