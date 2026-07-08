import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/foundation.dart';

import '../models/assessment.dart';
import '../models/attempt.dart';
import '../models/certificate.dart';
import '../models/course.dart';
import '../models/course_module.dart';
import '../models/enrollment.dart';
import '../models/lesson.dart';
import '../models/lesson_progress.dart';
import '../services/callable_service.dart';
import '../services/firestore_service.dart';

/// Loads and holds the course-detail state — mirrors the `useEffect` loader in
/// `src/app/learn/course/[courseId]/page.tsx`.
class CourseController extends ChangeNotifier {
  CourseController({
    required FirestoreService firestore,
    required CallableService callable,
    required this.courseId,
    required this.uid,
  })  : _fs = firestore,
        _callable = callable;

  final FirestoreService _fs;
  final CallableService _callable;
  final String courseId;
  final String uid;

  bool _loading = true;
  String? _error;
  bool _permissionDenied = false;
  bool _notFound = false;
  bool _disposed = false;

  Course? _course;
  List<CourseModule> _modules = const [];
  final Map<String, List<Lesson>> _lessonsByModule = {};
  final Map<String, LessonProgress> _progress = {};
  Enrollment? _enrollment;

  Assessment? _preAssessment;
  Assessment? _postAssessment;
  Attempt? _preAttempt;
  Attempt? _postAttempt;

  Certificate? _certificate;
  bool _certLoading = false;
  String? _certError;

  // getters ------------------------------------------------------------------
  bool get loading => _loading;
  String? get error => _error;
  bool get permissionDenied => _permissionDenied;
  bool get notFound => _notFound;
  Course? get course => _course;
  List<CourseModule> get modules => _modules;
  List<Lesson> lessonsFor(String moduleId) =>
      _lessonsByModule[moduleId] ?? const [];
  LessonProgress? progressFor(String lessonId) => _progress[lessonId];
  Enrollment? get enrollment => _enrollment;

  Assessment? get preAssessment => _preAssessment;
  Assessment? get postAssessment => _postAssessment;
  Attempt? get preAttempt => _preAttempt;
  Attempt? get postAttempt => _postAttempt;

  Certificate? get certificate => _certificate;
  bool get certLoading => _certLoading;
  String? get certError => _certError;

  List<Lesson> get allLessons =>
      _modules.expand((m) => lessonsFor(m.id)).toList();

  Lesson? get firstLesson => allLessons.isEmpty ? null : allLessons.first;

  int get progressPct => (_enrollment?.progressPct ?? 0).round();
  bool get courseComplete => progressPct >= 100;

  /// The lesson id the Start/Continue button should target.
  String? get continueLessonId => _enrollment?.lastLessonId ?? firstLesson?.id;
  bool get hasStarted => _enrollment?.lastLessonId != null;

  /// Certificate available once lessons are done AND (no post OR post passed).
  bool get certEligible =>
      courseComplete && (_postAssessment == null || (_postAttempt?.passed ?? false));

  /// Post is gated behind an untaken pre-assessment when both exist.
  bool get postLockedByPre =>
      _postAssessment != null &&
      courseComplete &&
      _postAttempt == null &&
      _preAssessment != null &&
      _preAttempt == null;

  /// Post banner shows when course complete, not yet attempted, and pre (if any)
  /// is done.
  bool get showPostBanner =>
      _postAssessment != null &&
      courseComplete &&
      _postAttempt == null &&
      (_preAssessment == null || _preAttempt != null);

  Future<void> load() async {
    _loading = true;
    _error = null;
    _permissionDenied = false;
    _notFound = false;
    _safeNotify();
    try {
      final course = await _fs.getCourse(courseId);
      if (course == null) {
        _notFound = true;
        _loading = false;
        _safeNotify();
        return;
      }
      _course = course;

      // Modules + lessons are cohort-gated by rules. permission-denied → locked.
      List<CourseModule> mods;
      try {
        mods = await _fs.getModules(courseId);
      } on FirebaseException catch (e) {
        if (e.code == 'permission-denied') {
          _permissionDenied = true;
          _loading = false;
          _safeNotify();
          return;
        }
        rethrow;
      }
      _modules = mods;

      _lessonsByModule.clear();
      await Future.wait(mods.map((m) async {
        _lessonsByModule[m.id] = await _fs.getLessons(courseId, m.id);
      }));

      _enrollment = await _fs.getEnrollment(uid, courseId);

      // Single-field progress query, filtered client-side by course.
      _progress
        ..clear()
        ..addAll(await _fs.getCourseProgress(uid, courseId));

      // Assessments (single-field where courseId), filter kind client-side.
      final assessments = await _fs.getCourseAssessments(courseId);
      _preAssessment = _firstOfKind(assessments, AssessmentKind.pre);
      _postAssessment = _firstOfKind(assessments, AssessmentKind.post);

      // Latest own attempts (single-field where userId), filter by assessment.
      final attempts = await _fs.getUserAttempts(uid);
      _preAttempt = _latestAttemptFor(attempts, _preAssessment?.id);
      _postAttempt = _latestAttemptFor(attempts, _postAssessment?.id);

      // Existing certificate (single-field where userId), filter by course.
      final certs = await _fs.getUserCertificates(uid);
      for (final c in certs) {
        if (c.courseId == courseId) {
          _certificate = c;
          break;
        }
      }

      _loading = false;
      _safeNotify();
    } catch (err) {
      _error = 'Failed to load course. Please try again.\n$err';
      _loading = false;
      _safeNotify();
    }
  }

  Assessment? _firstOfKind(List<Assessment> list, AssessmentKind kind) {
    for (final a in list) {
      if (a.kind == kind) return a;
    }
    return null;
  }

  Attempt? _latestAttemptFor(List<Attempt> attempts, String? assessmentId) {
    if (assessmentId == null) return null;
    final matching =
        attempts.where((a) => a.assessmentId == assessmentId).toList()
          ..sort((a, b) {
            final ta = a.submittedAt?.millisecondsSinceEpoch ?? 0;
            final tb = b.submittedAt?.millisecondsSinceEpoch ?? 0;
            return tb.compareTo(ta);
          });
    return matching.isEmpty ? null : matching.first;
  }

  /// Issue (or re-download) the certificate via the callable. Returns the
  /// download URL to open, or null on failure (error surfaced via [certError]).
  Future<String?> issueCertificate() async {
    _certLoading = true;
    _certError = null;
    _safeNotify();
    try {
      final res = await _callable.issueCertificate(courseId);
      // Reflect the freshly-issued cert locally (issuedAt filled on reload).
      _certificate ??= Certificate(
        certId: res.certId,
        userId: uid,
        learnerName: '',
        courseId: courseId,
        courseTitle: _course?.title ?? '',
      );
      _certLoading = false;
      _safeNotify();
      return res.downloadUrl;
    } on CallableException catch (e) {
      _certError = e.code == 'failed-precondition'
          ? e.message
          : 'Could not issue your certificate. Please try again.';
      _certLoading = false;
      _safeNotify();
      return null;
    } catch (_) {
      _certError = 'Could not issue your certificate. Please try again.';
      _certLoading = false;
      _safeNotify();
      return null;
    }
  }

  void _safeNotify() {
    if (!_disposed) notifyListeners();
  }

  @override
  void dispose() {
    _disposed = true;
    super.dispose();
  }
}
