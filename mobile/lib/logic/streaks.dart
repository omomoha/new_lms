/// Streak calculation utilities.
///
/// Pure Dart port of `src/lib/streaks.ts`. A "streak" is a run of consecutive
/// local-calendar days on which the learner completed at least one lesson. The
/// current streak counts back from today, or from yesterday when nothing has
/// been completed yet today (so a live streak isn't shown broken mid-day).

const int kWeeklyGoal = 5;

class StreakStats {
  /// Consecutive active days ending today (or yesterday if today inactive).
  final int currentStreak;

  /// Longest run of consecutive active days ever.
  final int longestStreak;

  /// True when at least one lesson was completed today (local time).
  final bool activeToday;

  /// Number of lesson completions since Monday 00:00 local time.
  final int thisWeekCount;

  /// Weekly lesson-completion goal (constant, 5).
  final int weeklyGoal;

  const StreakStats({
    required this.currentStreak,
    required this.longestStreak,
    required this.activeToday,
    required this.thisWeekCount,
    required this.weeklyGoal,
  });
}

/// Local-time midnight for the calendar day containing [d].
DateTime _localMidnight(DateTime d) => DateTime(d.year, d.month, d.day);

/// Local midnight [n] days after [midnight] (DST-safe, matches web `addDays`).
DateTime _addDays(DateTime midnight, int n) =>
    DateTime(midnight.year, midnight.month, midnight.day + n);

/// Compute streak statistics from raw lesson-completion timestamps.
/// Duplicate completions on the same calendar day count as ONE day for streak
/// purposes, but each counts toward the weekly total.
StreakStats computeStreaks(List<DateTime> completionDates, DateTime now) {
  // DateTime instances are always valid in Dart (no NaN), so the web's
  // `!Number.isNaN` guard is a no-op here.
  final valid = List<DateTime>.from(completionDates);

  // Unique active days keyed by local-midnight epoch millis.
  final daySet = <int>{
    for (final d in valid) _localMidnight(d).millisecondsSinceEpoch
  };
  final days = daySet.toList()..sort();

  // Longest streak.
  int longestStreak = 0;
  int run = 0;
  for (int i = 0; i < days.length; i++) {
    final isConsecutive = i > 0 &&
        _addDays(DateTime.fromMillisecondsSinceEpoch(days[i - 1]), 1)
                .millisecondsSinceEpoch ==
            days[i];
    run = isConsecutive ? run + 1 : 1;
    if (run > longestStreak) longestStreak = run;
  }

  // Current streak.
  final today = _localMidnight(now);
  final activeToday = daySet.contains(today.millisecondsSinceEpoch);

  DateTime? cursor;
  if (activeToday) {
    cursor = today;
  } else if (daySet.contains(_addDays(today, -1).millisecondsSinceEpoch)) {
    cursor = _addDays(today, -1);
  }

  int currentStreak = 0;
  while (cursor != null && daySet.contains(cursor.millisecondsSinceEpoch)) {
    currentStreak++;
    cursor = _addDays(cursor, -1);
  }

  // This week (Monday 00:00 local → now). Dart weekday: Mon=1..Sun=7, so
  // `weekday - 1` gives 0=Monday..6=Sunday (matches JS `(getDay()+6)%7`).
  final dowFromMonday = today.weekday - 1;
  final weekStart = _addDays(today, -dowFromMonday).millisecondsSinceEpoch;
  final thisWeekCount = valid.where((d) {
    final day = _localMidnight(d).millisecondsSinceEpoch;
    return day >= weekStart && day <= today.millisecondsSinceEpoch;
  }).length;

  return StreakStats(
    currentStreak: currentStreak,
    longestStreak: longestStreak,
    activeToday: activeToday,
    thisWeekCount: thisWeekCount,
    weeklyGoal: kWeeklyGoal,
  );
}
