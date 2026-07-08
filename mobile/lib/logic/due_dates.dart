/// Per-cohort course due-date utilities.
///
/// Pure Dart port of `src/lib/dueDates.ts`. No Firebase imports: callers adapt
/// Firestore `Timestamp`s into [DueTimestampLike] via `toMillis()`.

const int _dayMs = 24 * 60 * 60 * 1000;

/// Structural stand-in for a Firestore Timestamp — anything with toMillis().
abstract class DueTimestampLike {
  int toMillis();
}

/// The slice of a cohort doc this module cares about.
class DueDateCohort {
  final Map<String, DueTimestampLike>? courseDueDates;
  const DueDateCohort({this.courseDueDates});
}

enum DueTone { muted, warn, overdue }

class DueBadgeInfo {
  final String label;
  final DueTone tone;
  const DueBadgeInfo({required this.label, required this.tone});
}

/// Formats an epoch-millis timestamp into a short human date, e.g. "12 Jun 2026".
typedef DueDateFormatter = String Function(int millis);

const List<String> _months = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec'
];

/// Default short-date formatter — deterministic "12 Jun 2026" (mirrors the
/// web's en-GB `toLocaleDateString`), using local time.
String formatShortDate(int millis) {
  final d = DateTime.fromMillisecondsSinceEpoch(millis);
  return '${d.day} ${_months[d.month - 1]} ${d.year}';
}

/// Earliest due date (epoch millis) for a course across the user's cohorts.
/// Returns null when no cohort sets a due date for that course.
int? resolveDueDate(String courseId, List<DueDateCohort> cohorts) {
  int? earliest;
  for (final cohort in cohorts) {
    final ts = cohort.courseDueDates?[courseId];
    if (ts == null) continue;
    final millis = ts.toMillis();
    if (earliest == null || millis < earliest) earliest = millis;
  }
  return earliest;
}

/// Build the due-date badge for a course card. Returns null when there is no
/// due date OR the course is complete (progressPct >= 100).
DueBadgeInfo? dueBadge(
  int? dueMillis,
  int nowMillis,
  num progressPct, {
  DueDateFormatter format = formatShortDate,
}) {
  if (dueMillis == null || progressPct >= 100) return null;

  if (nowMillis > dueMillis) {
    return DueBadgeInfo(
      label: 'Overdue — was due ${format(dueMillis)}',
      tone: DueTone.overdue,
    );
  }

  final daysLeft = ((dueMillis - nowMillis) / _dayMs).floor();
  if (daysLeft == 0) {
    return const DueBadgeInfo(label: 'Due today', tone: DueTone.warn);
  }
  if (daysLeft <= 7) {
    return DueBadgeInfo(label: 'Due in ${daysLeft}d', tone: DueTone.warn);
  }

  return DueBadgeInfo(label: 'Due ${format(dueMillis)}', tone: DueTone.muted);
}
