import 'package:flutter/foundation.dart';

import '../models/app_user.dart';
import '../models/cohort.dart';
import '../models/course.dart';
import '../models/enrollment.dart';
import '../logic/due_dates.dart';
import '../logic/resume.dart';
import '../logic/search.dart';
import '../logic/streaks.dart';
import '../services/firestore_service.dart';

/// A dashboard course row: pairs a [Course] with the learner's access +
/// progress + due date. Satisfies both the resume-picker ([ResumeCandidate])
/// and the search-filter ([Searchable]) contracts so the pure-logic ports can
/// operate on it directly — mirroring the web's `CourseWithAccess` shape.
class DashboardCourse extends ResumeCandidate implements Searchable {
  final Course course;

  /// Earliest cohort due date for this course (epoch millis), or null.
  final int? dueMillis;

  @override
  final String? description;

  DashboardCourse({
    required this.course,
    required bool hasAccess,
    required num progressPct,
    int? updatedAtMillis,
    String? lastLessonId,
    this.dueMillis,
  })  : description = course.description,
        super(
          id: course.id,
          title: course.title,
          progressPct: progressPct,
          hasAccess: hasAccess,
          updatedAtMillis: updatedAtMillis,
          lastLessonId: lastLessonId,
        );

  int get progressPctInt => progressPct.round();
}

/// Loads and holds the learner-dashboard state — the mobile equivalent of the
/// `useEffect` loader in `src/app/learn/page.tsx`.
///
/// Read budget (matches web): 1 published-courses query, 1 fresh users/{uid}
/// read, N member-cohort gets (fail-soft), 1 enrollments query, 1 progress
/// query (streaks). No per-course round-trips.
class DashboardController extends ChangeNotifier {
  DashboardController({required FirestoreService firestore})
      : _fs = firestore;

  final FirestoreService _fs;

  bool _loading = true;
  String? _error;
  List<DashboardCourse> _courses = const [];
  StreakStats? _streaks;
  String _query = '';
  final Map<String, String?> _thumbCache = {};
  bool _disposed = false;

  bool get loading => _loading;
  String? get error => _error;
  List<DashboardCourse> get courses => _courses;
  StreakStats? get streaks => _streaks;
  String get query => _query;

  /// The resume selection (most recently-touched in-progress course), or null.
  ResumeSelection<DashboardCourse>? get resume => pickResumeCourse(_courses);

  /// Courses after applying the current search query (title + description,
  /// case/diacritic-insensitive).
  List<DashboardCourse> get visibleCourses => filterCourses(_courses, _query);

  bool get isSearching => _query.trim().isNotEmpty;

  String? thumbUrl(String courseId) => _thumbCache[courseId];

  void setQuery(String value) {
    _query = value;
    _safeNotify();
  }

  Future<void> load(AppUser user) async {
    _loading = true;
    _error = null;
    _safeNotify();
    try {
      // 1) All published courses.
      final published = await _fs.getPublishedCourses();

      // 2) Fresh cohort membership (cached value may be stale).
      final cohortIds =
          await _fs.getUserCohortIds(user.uid, fallback: user.cohortIds);

      // 3) Member cohort docs → per-course due dates (fail-soft: no badges).
      List<Cohort> memberCohorts = const [];
      try {
        memberCohorts = await _fs.getMemberCohorts(cohortIds);
      } catch (_) {
        memberCohorts = const [];
      }
      final dueDateCohorts =
          memberCohorts.map((c) => c.toDueDateCohort()).toList();

      // 4) ONE query for all enrollments.
      final enrollments = await _fs.getUserEnrollments(user.uid);
      final byCourse = <String, Enrollment>{};
      for (final e in enrollments) {
        if (e.courseId.isNotEmpty) byCourse[e.courseId] = e;
      }

      // 5) ONE query for all progress → streak completion dates.
      List<DateTime> completionDates = const [];
      try {
        completionDates = await _fs.completionDates(user.uid);
      } catch (_) {
        completionDates = const [];
      }

      final rows = published.map((c) {
        final hasAccess = c.hasAccessFor(cohortIds);
        final e = hasAccess ? byCourse[c.id] : null;
        final dueMillis =
            hasAccess ? resolveDueDate(c.id, dueDateCohorts) : null;
        return DashboardCourse(
          course: c,
          hasAccess: hasAccess,
          progressPct: e?.progressPct ?? 0,
          updatedAtMillis: e?.updatedAtMillis,
          lastLessonId: e?.lastLessonId,
          dueMillis: dueMillis,
        );
      }).toList()
        // Accessible first, then locked (stable).
        ..sort((a, b) {
          if (a.hasAccess == b.hasAccess) return 0;
          return a.hasAccess ? -1 : 1;
        });

      _courses = rows;
      _streaks = computeStreaks(completionDates, DateTime.now());
      _loading = false;
      _safeNotify();

      // Resolve thumbnails lazily (best-effort, cached) then repaint.
      await _resolveThumbs(rows);
    } catch (err) {
      _error = 'Failed to load courses.\n$err';
      _loading = false;
      _safeNotify();
    }
  }

  Future<void> _resolveThumbs(List<DashboardCourse> rows) async {
    var changed = false;
    for (final row in rows) {
      final path = row.course.thumbPath;
      if (path != null && path.isNotEmpty && !_thumbCache.containsKey(row.id)) {
        _thumbCache[row.id] = await _fs.resolveStorageUrl(path);
        changed = true;
      }
    }
    if (changed) _safeNotify();
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
