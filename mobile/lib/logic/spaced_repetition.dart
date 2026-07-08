import 'dart:math' as math;

/// Spaced repetition — pure SM-2-lite scheduling for flashcards.
///
/// Pure Dart port of `src/lib/spacedRepetition.ts`. No Firebase imports: card
/// state in/out is plain data. Constants and steps are identical to the web.

enum ReviewGrade { again, hard, good, easy }

/// Persisted scheduling state for one card.
class CardSchedule {
  /// Current inter-review interval in days (0 = new / relearning).
  final num interval;

  /// Ease multiplier, 1.3–3.0.
  final num ease;

  /// Count of consecutive successful reviews (reset by "again").
  final int reps;

  const CardSchedule({
    required this.interval,
    required this.ease,
    required this.reps,
  });
}

class ReviewResult {
  final num interval;
  final num ease;
  final int reps;

  /// When the card is next due.
  final DateTime due;

  const ReviewResult({
    required this.interval,
    required this.ease,
    required this.reps,
    required this.due,
  });
}

const double kEaseFloor = 1.3;
const double kEaseCap = 3.0;
const double kDefaultEase = 2.5;

const int _dayMs = 24 * 60 * 60 * 1000;
const int _againDelayMs = 10 * 60 * 1000; // 10 minutes

/// Fresh state for a newly created card (due immediately).
CardSchedule initialState() =>
    const CardSchedule(interval: 0, ease: kDefaultEase, reps: 0);

double _clampEase(num ease) {
  if (!ease.isFinite) return kDefaultEase;
  return math.min(kEaseCap, math.max(kEaseFloor, ease.toDouble()));
}

/// Round intervals to 2 decimal places (JS `Math.round(days*100)/100`).
num _roundInterval(num days) => (days * 100 + 0.5).floor() / 100;

DateTime _dueAfter(DateTime now, num intervalDays) {
  // JS: new Date(now.getTime() + days * DAY_MS). Date truncates the float
  // millis toward zero (ToInteger) — replicate with toInt().
  final ms = (now.millisecondsSinceEpoch + intervalDays * _dayMs).toInt();
  return DateTime.fromMillisecondsSinceEpoch(ms, isUtc: now.isUtc);
}

/// Apply one review grade to a card's scheduling state.
/// Pure: never mutates [state]; [now] is injectable for tests.
ReviewResult review(CardSchedule state, ReviewGrade grade, [DateTime? nowArg]) {
  final now = nowArg ?? DateTime.now();
  final ease = _clampEase(state.ease);
  final num interval =
      (state.interval.isFinite && state.interval > 0) ? state.interval : 0;
  final reps = state.reps > 0 ? state.reps : 0;

  switch (grade) {
    case ReviewGrade.again:
      return ReviewResult(
        interval: 0,
        ease: _clampEase(ease - 0.2),
        reps: 0,
        due: DateTime.fromMillisecondsSinceEpoch(
          now.millisecondsSinceEpoch + _againDelayMs,
          isUtc: now.isUtc,
        ),
      );
    case ReviewGrade.hard:
      final nextInterval = _roundInterval(math.max(1, interval * 1.2));
      return ReviewResult(
        interval: nextInterval,
        ease: _clampEase(ease - 0.15),
        reps: reps + 1,
        due: _dueAfter(now, nextInterval),
      );
    case ReviewGrade.good:
      // Graduating steps: first good = 1 day, second good = 3 days, then ×ease.
      final num nextInterval = reps == 0
          ? 1
          : reps == 1
              ? 3
              : _roundInterval(math.max(1, interval * ease));
      return ReviewResult(
        interval: nextInterval,
        ease: ease, // good leaves ease unchanged
        reps: reps + 1,
        due: _dueAfter(now, nextInterval),
      );
    case ReviewGrade.easy:
      final num nextInterval =
          reps == 0 ? 4 : _roundInterval(math.max(1, interval * ease * 1.3));
      return ReviewResult(
        interval: nextInterval,
        ease: _clampEase(ease + 0.15),
        reps: reps + 1,
        due: _dueAfter(now, nextInterval),
      );
  }
}

/// True when the card's due date is at or before [now].
bool isDue(DateTime due, [DateTime? nowArg]) {
  final now = nowArg ?? DateTime.now();
  return due.millisecondsSinceEpoch <= now.millisecondsSinceEpoch;
}
