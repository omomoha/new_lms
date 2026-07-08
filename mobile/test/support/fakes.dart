// Shared hand-written fakes for controller + widget tests.
//
// FirestoreService and CallableService are concrete classes whose real
// constructors touch FirebaseStorage.instance / FirebaseFunctions.instanceFor,
// which throw without a live Firebase app. We therefore `implements` them (no
// super-constructor call) and override only the methods each test exercises,
// with a noSuchMethod fallback for everything else. This keeps the suite
// runnable with the existing dev_dependencies (no firebase_core init needed).

import 'dart:async';

import 'package:andela_lms_mobile/models/app_notification.dart';
import 'package:andela_lms_mobile/models/assessment.dart';
import 'package:andela_lms_mobile/models/attempt.dart';
import 'package:andela_lms_mobile/models/certificate.dart';
import 'package:andela_lms_mobile/models/cohort.dart';
import 'package:andela_lms_mobile/models/course.dart';
import 'package:andela_lms_mobile/models/course_module.dart';
import 'package:andela_lms_mobile/models/enrollment.dart';
import 'package:andela_lms_mobile/models/flashcard.dart';
import 'package:andela_lms_mobile/models/lesson.dart';
import 'package:andela_lms_mobile/models/lesson_progress.dart';
import 'package:andela_lms_mobile/services/callable_service.dart';
import 'package:andela_lms_mobile/services/firestore_service.dart';

/// Captured arguments from a markLessonComplete call.
class MarkCompleteCall {
  final String uid;
  final String courseId;
  final String lessonId;
  final String cohortId;
  final double courseProgressPct;
  const MarkCompleteCall({
    required this.uid,
    required this.courseId,
    required this.lessonId,
    required this.cohortId,
    required this.courseProgressPct,
  });
}

class FakeFirestoreService implements FirestoreService {
  // ── Fixtures ──────────────────────────────────────────────────────────────
  List<Course> published = const [];
  List<String>? cohortIds;
  List<Cohort> memberCohorts = const [];
  List<Enrollment> enrollments = const [];
  List<DateTime> dates = const [];
  List<LessonProgress> progress = const [];
  List<Attempt> attempts = const [];
  List<Certificate> certificates = const [];
  List<Flashcard> flashcards = const [];
  List<Assessment> assessments = const [];

  Course? course;
  List<CourseModule> modules = const [];
  Map<String, List<Lesson>> lessonsByModule = const {};
  Enrollment? enrollment;
  Map<String, LessonProgress> courseProgress = const {};
  Certificate? Function(String requestedUpper)? certificateResolver;

  Object? modulesThrow; // set to throw from getModules (e.g. permission-denied)

  final _notesController = StreamController<List<AppNotification>>.broadcast();

  // ── Call counters / captures ────────────────────────────────────────────
  int enrollmentsQueries = 0;
  int progressQueries = 0;
  int publishedQueries = 0;
  MarkCompleteCall? markCall;
  int markCallCount = 0;
  final List<Map<String, dynamic>> flashcardUpdates = [];
  final List<List<String>> markAllReadCalls = [];
  final List<String> certificateLookups = [];

  void emitNotifications(List<AppNotification> items) =>
      _notesController.add(items);

  // ── Overrides ─────────────────────────────────────────────────────────────
  @override
  Future<List<Course>> getPublishedCourses() async {
    publishedQueries++;
    return published;
  }

  @override
  Future<List<String>> getUserCohortIds(String uid,
          {List<String> fallback = const []}) async =>
      cohortIds ?? fallback;

  @override
  Future<List<Cohort>> getMemberCohorts(List<String> ids) async =>
      memberCohorts;

  @override
  Future<List<Enrollment>> getUserEnrollments(String uid) async {
    enrollmentsQueries++;
    return enrollments;
  }

  @override
  Future<List<DateTime>> completionDates(String uid) async {
    progressQueries++;
    return dates;
  }

  @override
  Future<List<LessonProgress>> getUserProgress(String uid) async {
    progressQueries++;
    return progress;
  }

  @override
  Future<Map<String, LessonProgress>> getCourseProgress(
          String uid, String courseId) async =>
      courseProgress;

  @override
  Future<Course?> getCourse(String courseId) async => course;

  @override
  Future<List<CourseModule>> getModules(String courseId) async {
    if (modulesThrow != null) throw modulesThrow!;
    return modules;
  }

  @override
  Future<List<Lesson>> getLessons(String courseId, String moduleId) async =>
      lessonsByModule[moduleId] ?? const [];

  @override
  Future<Enrollment?> getEnrollment(String uid, String courseId) async =>
      enrollment;

  @override
  Future<List<Attempt>> getUserAttempts(String uid) async => attempts;

  @override
  Future<List<Certificate>> getUserCertificates(String uid) async =>
      certificates;

  @override
  Future<List<Flashcard>> getUserFlashcards(String uid) async => flashcards;

  @override
  Future<List<Assessment>> getCourseAssessments(String courseId) async =>
      assessments;

  @override
  Future<void> updateFlashcardSchedule(
      String cardId, Map<String, dynamic> scheduleUpdate) async {
    flashcardUpdates.add(scheduleUpdate);
  }

  @override
  Stream<List<AppNotification>> notificationsStream(String uid) =>
      _notesController.stream;

  @override
  Future<void> markNotificationRead(String id) async {}

  @override
  Future<void> markNotificationsRead(Iterable<String> ids) async {
    markAllReadCalls.add(ids.toList());
  }

  @override
  Future<Certificate?> getCertificate(String certId) async {
    final upper = certId.toUpperCase();
    certificateLookups.add(upper);
    if (certificateResolver != null) return certificateResolver!(upper);
    return null;
  }

  @override
  Future<void> markLessonComplete({
    required String uid,
    required String courseId,
    required String lessonId,
    required String cohortId,
    required double courseProgressPct,
  }) async {
    markCallCount++;
    markCall = MarkCompleteCall(
      uid: uid,
      courseId: courseId,
      lessonId: lessonId,
      cohortId: cohortId,
      courseProgressPct: courseProgressPct,
    );
  }

  @override
  Future<String?> resolveStorageUrl(String? path) async => null;

  void dispose() => _notesController.close();

  @override
  dynamic noSuchMethod(Invocation invocation) =>
      super.noSuchMethod(invocation);
}

class FakeCallableService implements CallableService {
  GradeAttemptResult? gradeResult;
  CallableException? gradeThrow;
  Map<String, int>? lastAnswers;
  String? lastAssessmentId;
  int? lastDurationSec;
  int gradeCalls = 0;

  LeaderboardResult? board;
  CallableException? boardThrow;

  GenerateFlashcardsResult? genResult;
  CallableException? genThrow;

  IssueCertificateResult? certResult;
  CallableException? certThrow;

  @override
  Future<GradeAttemptResult> gradeAttempt({
    required String assessmentId,
    required Map<String, int> answers,
    int? durationSec,
  }) async {
    gradeCalls++;
    lastAssessmentId = assessmentId;
    lastAnswers = answers;
    lastDurationSec = durationSec;
    if (gradeThrow != null) throw gradeThrow!;
    return gradeResult!;
  }

  @override
  Future<SignedVideoUrl> getSignedVideoUrl(String storagePath) async =>
      const SignedVideoUrl(url: 'https://x/y', expiresAt: 0);

  @override
  Future<IssueCertificateResult> issueCertificate(String courseId) async {
    if (certThrow != null) throw certThrow!;
    return certResult!;
  }

  @override
  Future<LeaderboardResult> getCohortLeaderboard(String cohortId) async {
    if (boardThrow != null) throw boardThrow!;
    return board!;
  }

  @override
  Future<GenerateFlashcardsResult> generateFlashcards(String courseId) async {
    if (genThrow != null) throw genThrow!;
    return genResult!;
  }

  @override
  dynamic noSuchMethod(Invocation invocation) =>
      super.noSuchMethod(invocation);
}
