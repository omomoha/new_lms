/// Resume ("Continue learning") selection logic.
///
/// Pure Dart port of `src/lib/resume.ts`.

/// Minimal shape the picker needs — dashboard course rows satisfy this.
class ResumeCandidate {
  final String id;
  final String title;
  final num progressPct;
  final bool hasAccess;

  /// Enrollment `updatedAt` as epoch milliseconds, when available.
  final int? updatedAtMillis;

  /// Enrollment `lastLessonId`, when available.
  final String? lastLessonId;

  const ResumeCandidate({
    required this.id,
    required this.title,
    required this.progressPct,
    required this.hasAccess,
    this.updatedAtMillis,
    this.lastLessonId,
  });
}

/// How the resume course was chosen — drives the card label.
enum ResumeBasis { recency, progress }

class ResumeSelection<T extends ResumeCandidate> {
  final T course;
  final ResumeBasis basis;
  const ResumeSelection({required this.course, required this.basis});
}

bool _hasTimestamp(ResumeCandidate c) =>
    c.updatedAtMillis != null && c.updatedAtMillis! > 0;

/// Pick the course a learner should resume:
///  - only accessible courses in progress (0 < progressPct < 100)
///  - prefer the most recently touched enrollment (updatedAtMillis desc)
///  - otherwise fall back to the highest progressPct
/// Ties keep the first candidate (stable with the caller's ordering).
/// Returns null when nothing is in progress.
ResumeSelection<T>? pickResumeCourse<T extends ResumeCandidate>(
    List<T> candidates) {
  final inProgress = candidates
      .where((c) => c.hasAccess && c.progressPct > 0 && c.progressPct < 100)
      .toList();
  if (inProgress.isEmpty) return null;

  final withTime = inProgress.where(_hasTimestamp).toList();
  if (withTime.isNotEmpty) {
    final course = withTime.reduce((best, c) =>
        (c.updatedAtMillis ?? 0) > (best.updatedAtMillis ?? 0) ? c : best);
    return ResumeSelection(course: course, basis: ResumeBasis.recency);
  }

  final course = inProgress
      .reduce((best, c) => c.progressPct > best.progressPct ? c : best);
  return ResumeSelection(course: course, basis: ResumeBasis.progress);
}
