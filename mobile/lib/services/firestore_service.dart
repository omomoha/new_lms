import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_storage/firebase_storage.dart';
import 'package:flutter/foundation.dart' show debugPrint;

import '../models/app_user.dart';
import '../models/course.dart';
import '../models/course_module.dart';
import '../models/lesson.dart';
import '../models/enrollment.dart';
import '../models/lesson_progress.dart';
import '../models/attempt.dart';
import '../models/certificate.dart';
import '../models/flashcard.dart';
import '../models/cohort.dart';
import '../models/assessment.dart';
import '../models/lesson_feedback.dart';
import '../models/app_notification.dart';
import '../models/tutor.dart';
import '../models/discussion.dart';
import '../models/forum.dart';
import '../logic/forum_rules.dart'
    show maxBodyLength, maxNameLength, maxTitleLength;

/// All learner-facing Firestore reads/writes, matching the query patterns in
/// the web portal (src/app/learn/*).
class FirestoreService {
  FirestoreService({FirebaseFirestore? db, FirebaseStorage? storage})
      : _db = db ?? FirebaseFirestore.instance,
        _storage = storage ?? FirebaseStorage.instance;

  final FirebaseFirestore _db;
  final FirebaseStorage _storage;

  /// Dashboard data: published courses + the learner's access + progress.
  /// Mirrors src/app/learn/page.tsx.
  Future<List<CourseWithProgress>> loadDashboard(AppUser user) async {
    // 1) All published courses (rules allow learners to read any published doc).
    final courseSnap = await _db
        .collection('courses')
        .where('status', isEqualTo: 'published')
        .get();
    final courses = courseSnap.docs.map(Course.fromDoc).toList();

    // 2) Fresh cohort membership (cached value may be stale).
    List<String> cohortIds = user.cohortIds;
    try {
      final me = await _db.collection('users').doc(user.uid).get();
      final fresh = me.data()?['cohortIds'];
      if (fresh is List) cohortIds = List<String>.from(fresh);
    } catch (_) {
      // Keep cached membership on failure.
    }

    // 3) One query for all of the learner's enrollments.
    final enrollSnap = await _db
        .collection('enrollments')
        .where('userId', isEqualTo: user.uid)
        .get();
    final byCourse = <String, Enrollment>{};
    for (final d in enrollSnap.docs) {
      final e = Enrollment.fromDoc(d);
      if (e.courseId.isNotEmpty) byCourse[e.courseId] = e;
    }

    final result = courses.map((c) {
      final hasAccess = c.hasAccessFor(cohortIds);
      final e = hasAccess ? byCourse[c.id] : null;
      return CourseWithProgress(
        course: c,
        hasAccess: hasAccess,
        progressPct: e?.progressPct ?? 0,
        lastLessonId: e?.lastLessonId,
      );
    }).toList()
      // Accessible courses first.
      ..sort((a, b) {
        if (a.hasAccess == b.hasAccess) return 0;
        return a.hasAccess ? -1 : 1;
      });

    return result;
  }

  /// All published courses (rules allow learners to read any published doc).
  /// Single-field `where(status==published)` query.
  Future<List<Course>> getPublishedCourses() async {
    final snap = await _db
        .collection('courses')
        .where('status', isEqualTo: 'published')
        .get();
    return snap.docs.map(Course.fromDoc).toList();
  }

  /// Fresh cohort membership from users/{uid}.cohortIds. Fail-soft: returns
  /// [fallback] (the cached value) on any read error.
  Future<List<String>> getUserCohortIds(String uid,
      {List<String> fallback = const []}) async {
    try {
      final me = await _db.collection('users').doc(uid).get();
      final fresh = me.data()?['cohortIds'];
      if (fresh is List) return List<String>.from(fresh);
    } catch (_) {
      // Keep cached membership on failure.
    }
    return fallback;
  }

  Future<Course?> getCourse(String courseId) async {
    final snap = await _db.collection('courses').doc(courseId).get();
    if (!snap.exists) return null;
    return Course.fromDoc(snap);
  }

  /// Modules for a course, ordered by `order`.
  Future<List<CourseModule>> getModules(String courseId) async {
    final snap = await _db
        .collection('courses')
        .doc(courseId)
        .collection('modules')
        .orderBy('order')
        .get();
    return snap.docs.map(CourseModule.fromDoc).toList();
  }

  /// Lessons for a module, ordered by `order`.
  Future<List<Lesson>> getLessons(String courseId, String moduleId) async {
    final snap = await _db
        .collection('courses')
        .doc(courseId)
        .collection('modules')
        .doc(moduleId)
        .collection('lessons')
        .orderBy('order')
        .get();
    return snap.docs.map(Lesson.fromDoc).toList();
  }

  /// ALL of the learner's progress docs — a single-field `where(userId==uid)`
  /// query (rules-provable, no composite index). Callers filter/sort in Dart.
  Future<List<LessonProgress>> getUserProgress(String uid) async {
    final snap = await _db
        .collection('progress')
        .where('userId', isEqualTo: uid)
        .get();
    return snap.docs.map(LessonProgress.fromDoc).toList();
  }

  /// The learner's progress across a whole course, keyed by lessonId.
  ///
  /// Deliberately a SINGLE-FIELD `where(userId==uid)` query with client-side
  /// filtering by courseId — mirrors the web to avoid composite indexes and
  /// stay provable under firestore.rules.
  Future<Map<String, LessonProgress>> getCourseProgress(
      String uid, String courseId) async {
    final all = await getUserProgress(uid);
    final map = <String, LessonProgress>{};
    for (final p in all) {
      if (p.courseId == courseId) map[p.lessonId] = p;
    }
    return map;
  }

  /// All of the learner's completion dates (from progress.completedAt) — used
  /// by streak/gamification computations. Single-field query.
  Future<List<DateTime>> completionDates(String uid) async {
    final all = await getUserProgress(uid);
    return all
        .where((p) => p.completedAt != null)
        .map((p) => p.completedAt!)
        .toList();
  }

  /// The learner's enrollment for one course, by doc id (rules allow read of
  /// own enrollment by the `{uid}_{courseId}` prefix). Null when not enrolled.
  Future<Enrollment?> getEnrollment(String uid, String courseId) async {
    final snap = await _db
        .collection('enrollments')
        .doc(Enrollment.docId(uid, courseId))
        .get();
    if (!snap.exists) return null;
    return Enrollment.fromDoc(snap);
  }

  /// All of the learner's enrollments — single-field `where(userId==uid)`.
  Future<List<Enrollment>> getUserEnrollments(String uid) async {
    final snap = await _db
        .collection('enrollments')
        .where('userId', isEqualTo: uid)
        .get();
    return snap.docs.map(Enrollment.fromDoc).toList();
  }

  /// All of the learner's assessment attempts — single-field query. Callers
  /// filter (e.g. by courseId/kind/passed) and sort client-side.
  Future<List<Attempt>> getUserAttempts(String uid) async {
    final snap = await _db
        .collection('attempts')
        .where('userId', isEqualTo: uid)
        .get();
    return snap.docs.map(Attempt.fromDoc).toList();
  }

  /// All of the learner's certificates — single-field query.
  Future<List<Certificate>> getUserCertificates(String uid) async {
    final snap = await _db
        .collection('certificates')
        .where('userId', isEqualTo: uid)
        .get();
    return snap.docs.map(Certificate.fromDoc).toList();
  }

  /// All of the learner's flashcards — single-field query. Callers split
  /// due/future client-side by `due`.
  Future<List<Flashcard>> getUserFlashcards(String uid) async {
    final snap = await _db
        .collection('flashcards')
        .where('userId', isEqualTo: uid)
        .get();
    return snap.docs.map(Flashcard.fromDoc).toList();
  }

  /// Persist a flashcard's new scheduling state after a review grade. Writes
  /// ONLY the {interval, ease, reps, due} fields (firestore.rules restricts a
  /// learner's flashcard update to exactly these keys) via updateDoc, matching
  /// the web's FlashcardReview.
  Future<void> updateFlashcardSchedule(
      String cardId, Map<String, dynamic> scheduleUpdate) async {
    await _db.collection('flashcards').doc(cardId).update(scheduleUpdate);
  }

  /// Live subscription to the learner's own notifications — a single equality
  /// filter, NO orderBy (avoids a composite index). Callers sort desc + cap
  /// client-side, mirroring the web NotificationsBell.
  Stream<List<AppNotification>> notificationsStream(String uid) {
    return _db
        .collection('notifications')
        .where('userId', isEqualTo: uid)
        .snapshots()
        .map((snap) => snap.docs.map(AppNotification.fromDoc).toList());
  }

  /// Mark one notification read. Writes ONLY readAt (the only field the learner
  /// may update per firestore.rules).
  Future<void> markNotificationRead(String id) async {
    await _db
        .collection('notifications')
        .doc(id)
        .update({'readAt': FieldValue.serverTimestamp()});
  }

  /// Mark many notifications read in one batch. Each update writes ONLY readAt.
  Future<void> markNotificationsRead(Iterable<String> ids) async {
    final batch = _db.batch();
    for (final id in ids) {
      batch.update(_db.collection('notifications').doc(id),
          {'readAt': FieldValue.serverTimestamp()});
    }
    await batch.commit();
  }

  /// Public single-doc read of a certificate (the /verify/{certId} page). The
  /// web upper-cases the path param before lookup — do the same.
  Future<Certificate?> getCertificate(String certId) async {
    final snap =
        await _db.collection('certificates').doc(certId.toUpperCase()).get();
    if (!snap.exists) return null;
    return Certificate.fromDoc(snap);
  }

  /// All assessments for a course — SINGLE-FIELD `where(courseId==id)` query.
  /// Callers filter by `kind` (pre/post/quiz) and `lessonId` client-side to
  /// avoid composite indexes. Questions only — never any answer keys.
  Future<List<Assessment>> getCourseAssessments(String courseId) async {
    final snap = await _db
        .collection('assessments')
        .where('courseId', isEqualTo: courseId)
        .get();
    return snap.docs.map(Assessment.fromDoc).toList();
  }

  /// Read the learner's own lessonFeedback/{uid}_{lessonId} doc (prefill).
  /// Fail-soft: returns null on any error (feedback must never break a lesson).
  Future<LessonFeedback?> getLessonFeedback(String uid, String lessonId) async {
    try {
      final snap = await _db
          .collection('lessonFeedback')
          .doc(LessonFeedback.docId(uid, lessonId))
          .get();
      if (!snap.exists) return null;
      return LessonFeedback.fromDoc(snap);
    } catch (_) {
      return null;
    }
  }

  /// Write the learner's lessonFeedback/{uid}_{lessonId} doc. Only the fields
  /// firestore.rules validates are written (userId, rating 1-5 int, comment
  /// <=1000). `courseId` is written for admin analytics parity with the web.
  Future<void> saveLessonFeedback({
    required String uid,
    required String lessonId,
    required String courseId,
    required int rating,
    required String comment,
  }) async {
    final trimmed = comment.trim();
    final clampedComment =
        trimmed.length > 1000 ? trimmed.substring(0, 1000) : trimmed;
    await _db
        .collection('lessonFeedback')
        .doc(LessonFeedback.docId(uid, lessonId))
        .set({
      'userId': uid,
      'lessonId': lessonId,
      'courseId': courseId,
      'rating': rating,
      'comment': clampedComment,
      'updatedAt': FieldValue.serverTimestamp(),
    });
  }

  /// Throttled video-progress save (mirrors the web VideoPlayer.saveProgress).
  /// Writes {watchedPct, positionSec, completedAt:null} with merge. NEVER call
  /// this once a lesson is completed — the caller guards with a completedRef so
  /// completedAt is not clobbered back to null.
  Future<void> saveVideoProgress({
    required String uid,
    required String courseId,
    required String lessonId,
    required int positionSec,
    required int watchedPct,
  }) async {
    final progRef =
        _db.collection('progress').doc(LessonProgress.docId(uid, lessonId));
    await progRef.set(
      {
        'userId': uid,
        'lessonId': lessonId,
        'courseId': courseId,
        'watchedPct': watchedPct,
        'positionSec': positionSec,
        'completedAt': null,
      },
      SetOptions(merge: true),
    );
    // Keep the enrollment's lastLessonId fresh during playback (merge).
    final enrollRef =
        _db.collection('enrollments').doc(Enrollment.docId(uid, courseId));
    await enrollRef.set(
      {
        'lastLessonId': lessonId,
        'updatedAt': FieldValue.serverTimestamp(),
      },
      SetOptions(merge: true),
    );
  }

  /// Fetch a learner's member cohort docs (fail-soft — a denied/missing cohort
  /// is skipped rather than throwing). Used for courseDueDates.
  Future<List<Cohort>> getMemberCohorts(List<String> cohortIds) async {
    final cohorts = <Cohort>[];
    for (final id in cohortIds) {
      try {
        final snap = await _db.collection('cohorts').doc(id).get();
        if (snap.exists) cohorts.add(Cohort.fromDoc(snap));
      } catch (_) {
        // Not a member / offline — skip.
      }
    }
    return cohorts;
  }

  /// Marks a lesson complete and bumps course-level enrollment progress.
  Future<void> markLessonComplete({
    required String uid,
    required String courseId,
    required String lessonId,
    required String cohortId,
    required double courseProgressPct,
  }) async {
    final batch = _db.batch();

    final progRef =
        _db.collection('progress').doc(LessonProgress.docId(uid, lessonId));
    batch.set(
      progRef,
      {
        'userId': uid,
        'lessonId': lessonId,
        'courseId': courseId,
        'watchedPct': 100,
        // LOW-1 (Phase 1 QA): write positionSec:0 for exact web doc-shape
        // parity — the web's mark-complete set() writes positionSec: 0.
        'positionSec': 0,
        'completedAt': FieldValue.serverTimestamp(),
      },
      SetOptions(merge: true),
    );

    final enrollRef =
        _db.collection('enrollments').doc(Enrollment.docId(uid, courseId));
    batch.set(
      enrollRef,
      {
        'userId': uid,
        'courseId': courseId,
        'cohortId': cohortId,
        'progressPct': courseProgressPct,
        'lastLessonId': lessonId,
        'updatedAt': FieldValue.serverTimestamp(),
      },
      SetOptions(merge: true),
    );

    await batch.commit();
  }

  // ── Tutor (Phase 7A) ──────────────────────────────────────────────────────

  /// The learner's most recent tutor conversations (id/title/time + turns) —
  /// `users/{uid}/tutorConversations` `orderBy(updatedAt desc) limit(20)`.
  /// SINGLE-FIELD orderBy (no composite index). Read-only: these docs are
  /// written server-side by the askTutor callable; the client NEVER writes here
  /// (firestore.rules: `allow write: if false`). Only used for the optional
  /// enhanced history list.
  Future<List<TutorConversation>> getTutorConversations(String uid,
      {int max = 20}) async {
    final snap = await _db
        .collection('users')
        .doc(uid)
        .collection('tutorConversations')
        .orderBy('updatedAt', descending: true)
        .limit(max)
        .get();
    return snap.docs.map(TutorConversation.fromDoc).toList();
  }

  /// Load one tutor conversation owned by [uid]. Null if missing. Read-only.
  Future<TutorConversation?> getTutorConversation(
      String uid, String conversationId) async {
    final snap = await _db
        .collection('users')
        .doc(uid)
        .collection('tutorConversations')
        .doc(conversationId)
        .get();
    if (!snap.exists) return null;
    return TutorConversation.fromDoc(snap);
  }

  /// Write thumbs up/down (+ optional reason) for a tutor answer into
  /// `tutorFeedback/{uid}_{conversationId}_{turnIndex}` (re-rating overwrites,
  /// never duplicates).
  ///
  /// Writes ONLY the fields firestore.rules validates on write (see rule
  /// `match /tutorFeedback/{feedbackId}`, recent_update lines 214-219):
  ///   allow write: if isAuthed()
  ///     && feedbackId.matches(request.auth.uid + "_.+")
  ///     && request.resource.data.userId == request.auth.uid
  ///     && request.resource.data.rating in ["up", "down"]
  ///     && request.resource.data.reason is string
  ///     && request.resource.data.reason.size() <= 1000;
  /// So the exact write field-set is:
  ///   { userId, conversationId, turnIndex, courseId, rating, reason, createdAt }.
  /// (`conversationId`/`turnIndex`/`courseId`/`createdAt` are unconstrained by
  /// the rule but written for admin-analytics parity with the web.)
  Future<void> submitTutorFeedback({
    required String uid,
    required String conversationId,
    required int turnIndex,
    required String courseId,
    required String rating, // "up" | "down"
    String reason = '',
  }) async {
    final clampedReason =
        reason.length > 1000 ? reason.substring(0, 1000) : reason;
    final id = '${uid}_${conversationId}_$turnIndex';
    await _db.collection('tutorFeedback').doc(id).set({
      'userId': uid,
      'conversationId': conversationId,
      'turnIndex': turnIndex,
      'courseId': courseId,
      'rating': rating,
      'reason': clampedReason,
      'createdAt': FieldValue.serverTimestamp(),
    });
  }

  // ── Discussions (Phase 7C) ──────────────────────────────────────────────────

  /// Per-lesson Q&A for a lesson. The read MUST filter by BOTH `courseId` AND
  /// `lessonId` equalities: the rule resolves course access from
  /// `resource.data.courseId`, provable for list queries only when courseId is
  /// pinned by the query — a lessonId-only query is DENIED for learners. This is
  /// a two-equality query on distinct fields, served WITHOUT a composite index
  /// (equality-only). `courseId` is re-filtered client-side for safety (web
  /// does the same).
  Future<List<Discussion>> fetchDiscussions(
      String courseId, String lessonId) async {
    final snap = await _db
        .collection('discussions')
        .where('courseId', isEqualTo: courseId)
        .where('lessonId', isEqualTo: lessonId)
        .get();
    return snap.docs
        .map(Discussion.fromDoc)
        .where((d) => d.courseId == courseId) // client-side course filter
        .toList();
  }

  /// Create a discussion post (question when [parentId] is null, else a reply).
  ///
  /// Writes ONLY the fields firestore.rules validates on create (see rule
  /// `match /discussions/{postId}`, recent_update lines 294-304):
  ///   allow create: if isAuthed()
  ///     && request.resource.data.userId == request.auth.uid
  ///     && request.resource.data.body is string (size 1..2000)
  ///     && request.resource.data.userName is string (size <= 100)
  ///     && (parentId == null || parentId is string)
  ///     && (isAdmin() || canAccessCourse(request.resource.data.courseId));
  /// Exact write field-set:
  ///   { courseId, lessonId, userId, userName, body, parentId, createdAt }.
  Future<void> createDiscussion({
    required String courseId,
    required String lessonId,
    required String uid,
    required String userName,
    required String body,
    required String? parentId,
  }) async {
    final trimmed = body.trim();
    final clampedBody =
        trimmed.length > 2000 ? trimmed.substring(0, 2000) : trimmed;
    final clampedName =
        userName.length > 100 ? userName.substring(0, 100) : userName;
    await _db.collection('discussions').add({
      'courseId': courseId,
      'lessonId': lessonId,
      'userId': uid,
      'userName': clampedName,
      'body': clampedBody,
      'parentId': parentId,
      'createdAt': FieldValue.serverTimestamp(),
    });
  }

  /// Delete a discussion post (author or admin per rules; gate the button with
  /// canDelete). Clients NEVER update discussion docs (`allow update: if false`).
  Future<void> deleteDiscussion(String id) async {
    await _db.collection('discussions').doc(id).delete();
  }

  // ── Community Forum (Phase 7B) ──────────────────────────────────────────────
  //
  // All queries are single-field / equality-only (no composite indexes). Reads
  // use realtime snapshots() exactly where the web does (thread list + posts);
  // categories + single thread doc are one-shot getDoc/getDocs. Every write
  // below writes ONLY the fields firestore.rules validates — see the cited rule
  // line numbers. Server triggers (onForumThreadCreated / onForumReplyCreated)
  // own the counters (postCount/replyCount/lastReplyAt bumps), mentions and AI
  // pre-moderation — the client NEVER writes those.

  /// All forum categories (one-shot). Rules (firestore.rules lines 400-408)
  /// enforce read access; the client re-filters visibility via
  /// logic/forum_rules.visibleCategories so it never surfaces a denied category.
  Future<List<ForumCategory>> fetchForumCategories() async {
    final snap = await _db.collection('forumCategories').get();
    return snap.docs.map(ForumCategory.fromDoc).toList();
  }

  /// One category by id (used to gate a category screen). Null if missing.
  Future<ForumCategory?> fetchForumCategory(String id) async {
    final snap = await _db.collection('forumCategories').doc(id).get();
    if (!snap.exists) return null;
    return ForumCategory.fromDoc(snap);
  }

  /// Realtime threads in a category — a SINGLE equality filter
  /// `where(categoryId==)` (firestore.rules line 425 allows any authed read;
  /// no composite index). Callers sort/search/paginate + hide pending threads
  /// client-side (mirrors the web `subscribeThreads`).
  Stream<List<ForumThread>> forumThreadsStream(String categoryId) {
    return _db
        .collection('forumThreads')
        .where('categoryId', isEqualTo: categoryId)
        .snapshots()
        .map((snap) => snap.docs.map(ForumThread.fromDoc).toList());
  }

  /// Realtime single thread doc (single-doc snapshot — no index). Keeps
  /// replyCount/locked/moderation fresh as the server trigger bumps them. Null
  /// while the doc does not exist.
  Stream<ForumThread?> forumThreadStream(String id) {
    return _db
        .collection('forumThreads')
        .doc(id)
        .snapshots()
        .map((snap) => snap.exists ? ForumThread.fromDoc(snap) : null);
  }

  /// One thread by id (one-shot). Null if missing.
  Future<ForumThread?> fetchForumThread(String id) async {
    final snap = await _db.collection('forumThreads').doc(id).get();
    if (!snap.exists) return null;
    return ForumThread.fromDoc(snap);
  }

  /// Realtime posts (replies) for a thread (firestore.rules line 472 allows any
  /// authed read). Mirrors the web `subscribePosts` — the WHOLE posts
  /// subcollection is streamed for parity. Callers apply a client render cap
  /// (see forum_thread_screen). If threads grow large, the single-field-safe
  /// upgrade is `.orderBy('createdAt').limit(N)` + a "load more" cursor here;
  /// orderBy(createdAt) is a single-field order requiring no composite index.
  Stream<List<ForumPost>> forumPostsStream(String threadId) {
    return _db
        .collection('forumThreads')
        .doc(threadId)
        .collection('posts')
        .snapshots()
        .map((snap) => snap.docs.map(ForumPost.fromDoc).toList());
  }

  /// Create a thread. Writes ONLY the fields firestore.rules validates on
  /// create (firestore.rules lines 426-439):
  ///   authorId == uid, categoryId string, title string 1..200,
  ///   body string 1..5000, authorName string <=100,
  ///   pinned == false, locked == false, replyCount == 0.
  /// Exact write field-set (matches web forumClient.createThread):
  ///   { categoryId, authorId, authorName(<=100), title(trim,<=200),
  ///     body(trim,<=5000), pinned:false, locked:false, replyCount:0,
  ///     tags(<=8), createdAt, lastReplyAt }.
  /// Returns the new thread id. NEVER sets pinned/locked/moderation to a
  /// non-default (admin-only fields).
  /// Returns the new thread id synchronously (the ref id is known before the
  /// server ack) so navigation works even when the create is queued offline,
  /// AND the write's `ack` Future so the caller can distinguish a genuine
  /// (rules/validation) failure from an offline-queued write. Offline
  /// persistence applies the write to the local cache immediately and syncs
  /// later; awaiting the ack would block the UI while offline. The realtime
  /// threads stream shows the new thread from the local cache.
  ///
  /// The `ack` completes when the server acknowledges the write, or throws for a
  /// real failure. While offline it simply doesn't complete until reconnect, so
  /// the caller should race it against a short timeout (see util/offline.dart)
  /// rather than block on it.
  ({String id, Future<void> ack}) createForumThread({
    required String categoryId,
    required String authorId,
    required String authorName,
    required String title,
    required String body,
    List<String> tags = const [],
  }) {
    final ref = _db.collection('forumThreads').doc();
    final ack = ref.set({
      'categoryId': categoryId,
      'authorId': authorId,
      'authorName': _clamp(authorName, maxNameLength),
      'title': _clamp(title.trim(), maxTitleLength),
      'body': _clamp(body.trim(), maxBodyLength),
      'pinned': false,
      'locked': false,
      'replyCount': 0,
      'tags': tags.take(8).toList(),
      'createdAt': FieldValue.serverTimestamp(),
      'lastReplyAt': FieldValue.serverTimestamp(),
    });
    return (id: ref.id, ack: ack);
  }

  /// Author edit of a thread. Writes ONLY title/body/editedAt — the exact keys
  /// firestore.rules' `threadAuthorEditKeys()` allows (firestore.rules lines
  /// 420-447: author update diff hasOnly ["title","body","editedAt"], bounds
  /// re-checked). Denied server-side once the 15-min author window closes /
  /// caller not the author.
  Future<void> editForumThread({
    required String id,
    required String title,
    required String body,
  }) async {
    await _db.collection('forumThreads').doc(id).update({
      'title': _clamp(title.trim(), maxTitleLength),
      'body': _clamp(body.trim(), maxBodyLength),
      'editedAt': FieldValue.serverTimestamp(),
    });
  }

  /// Delete a thread (author or admin per firestore.rules lines 448-449; gate
  /// the button with logic/forum_rules.canModerate).
  Future<void> deleteForumThread(String id) async {
    await _db.collection('forumThreads').doc(id).delete();
  }

  /// Create a reply. Writes ONLY the fields firestore.rules validates on create
  /// (firestore.rules lines 473-482): authorId == uid, body string 1..5000,
  /// authorName string <=100, parentId null|string, AND parentThread().locked
  /// == false (lock enforced at the rules layer). Exact write field-set:
  ///   { authorId, authorName(<=100), body(trim,<=5000), parentId, createdAt }.
  /// (reactions is intentionally NOT set on create.)
  Future<void> createForumReply({
    required String threadId,
    required String authorId,
    required String authorName,
    required String body,
    required String? parentId,
  }) async {
    await _db.collection('forumThreads').doc(threadId).collection('posts').add({
      'authorId': authorId,
      'authorName': _clamp(authorName, maxNameLength),
      'body': _clamp(body.trim(), maxBodyLength),
      'parentId': parentId,
      'createdAt': FieldValue.serverTimestamp(),
    });
  }

  /// Author edit of a reply. Writes ONLY body/editedAt — the exact keys
  /// firestore.rules' `postAuthorEditKeys()` allows (firestore.rules lines
  /// 464-489, hasOnly ["body","editedAt"], bounds re-checked).
  Future<void> editForumPost({
    required String threadId,
    required String postId,
    required String body,
  }) async {
    await _db
        .collection('forumThreads')
        .doc(threadId)
        .collection('posts')
        .doc(postId)
        .update({
      'body': _clamp(body.trim(), maxBodyLength),
      'editedAt': FieldValue.serverTimestamp(),
    });
  }

  /// Delete a reply (author or admin per firestore.rules lines 490-491).
  Future<void> deleteForumPost(String threadId, String postId) async {
    await _db
        .collection('forumThreads')
        .doc(threadId)
        .collection('posts')
        .doc(postId)
        .delete();
  }

  /// Toggle a single emoji reaction by [uid] on a post. Reads the current map,
  /// adds/removes the uid, and writes ONLY the `reactions` field — the
  /// reactions-only diff any authed user may make per firestore.rules'
  /// `reactionOnlyChange()` (firestore.rules lines 468-489). Empty lists are
  /// removed from the map. Mirrors the web forumClient.toggleReaction (same
  /// read-modify-write race caveat).
  Future<void> toggleForumReaction({
    required String threadId,
    required String postId,
    required String emoji,
    required String uid,
  }) async {
    final ref = _db
        .collection('forumThreads')
        .doc(threadId)
        .collection('posts')
        .doc(postId);
    final snap = await ref.get();
    if (!snap.exists) return;
    final raw = (snap.data()?['reactions']);
    final current = <String, List<String>>{};
    if (raw is Map) {
      raw.forEach((k, v) {
        if (v is List) current[k.toString()] = List<String>.from(v);
      });
    }
    final list = List<String>.from(current[emoji] ?? const []);
    if (list.contains(uid)) {
      list.remove(uid);
    } else {
      list.add(uid);
    }
    final next = <String, List<String>>{...current};
    if (list.isNotEmpty) {
      next[emoji] = list;
    } else {
      next.remove(emoji);
    }
    await ref.update({'reactions': next});
  }

  /// Report a thread or post for moderation. Writes ONLY the fields
  /// firestore.rules validates on create (firestore.rules lines 502-508):
  ///   reporterId == uid, threadId string, reason string 1..1000,
  ///   resolved == false. Exact write field-set:
  ///   { reporterId, reporterName(<=100), threadId, postId ?? null,
  ///     reason(trim,<=1000), resolved:false, createdAt }.
  /// Learners cannot read the report's resolution (rules lines 500-501).
  Future<void> reportForumContent({
    required String reporterId,
    required String reporterName,
    required String threadId,
    String? postId,
    required String reason,
  }) async {
    await _db.collection('forumReports').add({
      'reporterId': reporterId,
      'reporterName': _clamp(reporterName, maxNameLength),
      'threadId': threadId,
      'postId': postId,
      'reason': _clamp(reason.trim(), 1000),
      'resolved': false,
      'createdAt': FieldValue.serverTimestamp(),
    });
  }

  static String _clamp(String s, int max) =>
      s.length > max ? s.substring(0, max) : s;

  /// Resolves a Firebase Storage path (e.g. thumbPath) to a download URL.
  Future<String?> resolveStorageUrl(String? path) async {
    if (path == null || path.isEmpty) return null;
    try {
      return await _storage.ref(path).getDownloadURL();
    } catch (_) {
      return null;
    }
  }
}
