/// Progress calculation utilities.
///
/// Pure Dart port of `src/lib/progress.ts` — no Firebase imports so it is
/// unit-testable and the numbers stay identical to the web.

/// JS `Math.round` parity: rounds half toward +Infinity for all reals
/// (Dart's `num.round()` rounds half away from zero, which differs on negative
/// halves). All inputs here are non-negative, but we keep parity explicit.
int _jsRound(num x) => (x + 0.5).floor();

/// Calculate overall course progress as a percentage (0–100, rounded).
int calcProgressPct(List<String> completedLessonIds, List<String> allLessonIds) {
  if (allLessonIds.isEmpty) return 0;
  final completedSet = completedLessonIds.toSet();
  final completed = allLessonIds.where(completedSet.contains).length;
  return _jsRound((completed / allLessonIds.length) * 100);
}

/// A video is "watched" once the learner has reached >= 80% of its duration.
bool isVideoWatched(num positionSec, num durationSec) {
  if (durationSec <= 0) return false;
  return positionSec / durationSec >= 0.8;
}

/// Throttle helper for progress writes — true once [intervalMs] has elapsed
/// since [lastSavedAt]. Defaults to 5000ms, matching the web.
bool shouldSaveProgress(int lastSavedAt, int nowMs, [int intervalMs = 5000]) {
  return nowMs - lastSavedAt >= intervalMs;
}
