import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_storage/firebase_storage.dart';

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

  /// Public single-doc read of a certificate (the /verify/{certId} page). The
  /// web upper-cases the path param before lookup — do the same.
  Future<Certificate?> getCertificate(String certId) async {
    final snap =
        await _db.collection('certificates').doc(certId.toUpperCase()).get();
    if (!snap.exists) return null;
    return Certificate.fromDoc(snap);
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
