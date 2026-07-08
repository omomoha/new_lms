import 'package:flutter/foundation.dart';

import '../logic/progress.dart';
import '../models/assessment.dart';
import '../models/attempt.dart';
import '../models/course.dart';
import '../models/course_module.dart';
import '../models/enrollment.dart';
import '../models/lesson.dart';
import '../models/lesson_progress.dart';
import '../services/firestore_service.dart';

/// Loads and holds lesson-viewer state — mirrors the loader in
/// `src/app/learn/course/[courseId]/lesson/[lessonId]/page.tsx`.
class LessonController extends ChangeNotifier {
  LessonController({
    required FirestoreService firestore,
    required this.courseId,
    required this.lessonId,
    required this.uid,
    required this.cohortId,
  }) : _fs = firestore;

  final FirestoreService _fs;
  final String courseId;
  final String lessonId;
  final String uid;
  final String cohortId;

  bool _loading = true;
  String? _error;
  bool _notFound = false;
  bool _disposed = false;

  Course? _course;
  List<CourseModule> _modules = const [];
  final Map<String, List<Lesson>> _lessonsByModule = {};
  final Map<String, LessonProgress> _progress = {};
  Enrollment? _enrollment;
  Lesson? _lesson;

  Assessment? _quizAssessment;
  Attempt? _quizAttempt;

  bool _marking = false;
  String? _markError;

  // getters ------------------------------------------------------------------
  bool get loading => _loading;
  String? get error => _error;
  bool get notFound => _notFound;
  Course? get course => _course;
  List<CourseModule> get modules => _modules;
  List<Lesson> lessonsFor(String moduleId) =>
      _lessonsByModule[moduleId] ?? const [];
  Enrollment? get enrollment => _enrollment;
  Lesson? get lesson => _lesson;
  Assessment? get quizAssessment => _quizAssessment;
  Attempt? get quizAttempt => _quizAttempt;
  bool get marking => _marking;
  String? get markError => _markError;

  bool isCompleted(String id) => _progress[id]?.isCompleted ?? false;
  bool get currentCompleted => isCompleted(lessonId);
  int? get resumePositionSec => _progress[lessonId]?.positionSec;

  List<Lesson> get allLessons =>
      _modules.expand((m) => lessonsFor(m.id)).toList();
  List<String> get allLessonIds => allLessons.map((l) => l.id).toList();

  int get enrollmentPct => (_enrollment?.progressPct ?? 0).round();

  /// The id of the lesson after the current one (flattened order), or null.
  String? get nextLessonId {
    final flat = allLessons;
    final idx = flat.indexWhere((l) => l.id == lessonId);
    if (idx == -1 || idx + 1 >= flat.length) return null;
    return flat[idx + 1].id;
  }

  Future<void> load() async {
    _loading = true;
    _error = null;
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

      _modules = await _fs.getModules(courseId);
      _lessonsByModule.clear();
      await Future.wait(_modules.map((m) async {
        _lessonsByModule[m.id] = await _fs.getLessons(courseId, m.id);
      }));

      _lesson = _firstWhereOrNull(allLessons, (l) => l.id == lessonId);

      _enrollment = await _fs.getEnrollment(uid, courseId);

      _progress
        ..clear()
        ..addAll(await _fs.getCourseProgress(uid, courseId));

      // Quiz lesson: load assessment (courseId + lessonId + quiz) + latest attempt.
      if (_lesson?.type == LessonType.quiz) {
        final assessments = await _fs.getCourseAssessments(courseId);
        _quizAssessment = _firstWhereOrNull(
            assessments,
            (a) =>
                a.kind == AssessmentKind.quiz && a.lessonId == lessonId);
        if (_quizAssessment != null) {
          final attempts = await _fs.getUserAttempts(uid);
          final matching = attempts
              .where((a) => a.assessmentId == _quizAssessment!.id)
              .toList()
            ..sort((a, b) {
              final ta = a.submittedAt?.millisecondsSinceEpoch ?? 0;
              final tb = b.submittedAt?.millisecondsSinceEpoch ?? 0;
              return tb.compareTo(ta);
            });
          _quizAttempt = matching.isEmpty ? null : matching.first;
        }
      }

      _loading = false;
      _safeNotify();
    } catch (err) {
      _error = 'Failed to load lesson. Please try again.\n$err';
      _loading = false;
      _safeNotify();
    }
  }

  /// Marks the current lesson complete: writes the progress doc (with the
  /// completedAt guard — never re-completes) and recomputes the enrollment
  /// progressPct over ALL course lessons. Mirrors the web mark-complete.
  Future<void> markComplete() async {
    if (_marking || currentCompleted) return;
    _marking = true;
    _markError = null;
    _safeNotify();
    try {
      // Recompute pct over ALL lessons: previously-completed + this one.
      final completedIds = _progress.values
          .where((p) => p.isCompleted)
          .map((p) => p.lessonId)
          .toList();
      final pct = calcProgressPct([...completedIds, lessonId], allLessonIds);

      // Preserve an existing enrollment's cohortId; only fall back to the
      // learner's primary cohort when creating a fresh enrollment (mirrors web,
      // whose update path never rewrites cohortId).
      final existingCohort = _enrollment?.cohortId ?? '';
      final effectiveCohortId =
          existingCohort.isNotEmpty ? existingCohort : cohortId;

      await _fs.markLessonComplete(
        uid: uid,
        courseId: courseId,
        lessonId: lessonId,
        cohortId: effectiveCohortId,
        courseProgressPct: pct.toDouble(),
      );

      // Reflect locally so the tree ticks + progress update immediately.
      _progress[lessonId] = LessonProgress(
        userId: uid,
        lessonId: lessonId,
        courseId: courseId,
        watchedPct: 100,
        positionSec: 0,
        completedAt: DateTime.now(),
      );
      _enrollment = Enrollment(
        userId: uid,
        courseId: courseId,
        cohortId: _enrollment?.cohortId ?? cohortId,
        progressPct: pct.toDouble(),
        lastLessonId: lessonId,
        updatedAt: DateTime.now(),
      );
      _marking = false;
      _safeNotify();
    } catch (_) {
      _markError = 'Could not mark lesson complete. Please try again.';
      _marking = false;
      _safeNotify();
    }
  }

  static T? _firstWhereOrNull<T>(Iterable<T> items, bool Function(T) test) {
    for (final item in items) {
      if (test(item)) return item;
    }
    return null;
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
