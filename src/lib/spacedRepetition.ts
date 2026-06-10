/**
 * spacedRepetition — pure SM-2-lite scheduling for flashcards.
 *
 * No Firebase imports: card state in/out is plain data so this module is
 * trivially unit-testable and shared between UI and any future server code.
 *
 * Scheduling model:
 *   state = { interval: days, ease: multiplier, reps: successful reviews }
 *
 *   again → relearn: interval 0, due in 10 minutes, reps reset to 0,
 *           ease −0.20 (floored at 1.3)
 *   hard  → interval ×1.2 (min 1 day), ease −0.15 (floored at 1.3)
 *   good  → first good: 1 day; second good: 3 days; after that interval ×ease
 *   easy  → first easy: 4 days; after that interval ×ease ×1.3,
 *           ease +0.15 (capped at 3.0)
 */

export type ReviewGrade = "again" | "hard" | "good" | "easy";

/** Persisted scheduling state for one card. */
export interface CardSchedule {
  /** Current inter-review interval in days (0 = new / relearning). */
  interval: number;
  /** Ease multiplier, 1.3–3.0. */
  ease: number;
  /** Count of consecutive successful reviews (reset by "again"). */
  reps: number;
}

export interface ReviewResult extends CardSchedule {
  /** When the card is next due. */
  due: Date;
}

export const EASE_FLOOR = 1.3;
export const EASE_CAP = 3.0;
export const DEFAULT_EASE = 2.5;

const DAY_MS = 24 * 60 * 60 * 1000;
const AGAIN_DELAY_MS = 10 * 60 * 1000; // 10 minutes

/** Fresh state for a newly created card (due immediately). */
export function initialState(): CardSchedule {
  return { interval: 0, ease: DEFAULT_EASE, reps: 0 };
}

function clampEase(ease: number): number {
  if (!Number.isFinite(ease)) return DEFAULT_EASE;
  return Math.min(EASE_CAP, Math.max(EASE_FLOOR, ease));
}

/** Round intervals to 2 decimal places to keep stored values tidy. */
function roundInterval(days: number): number {
  return Math.round(days * 100) / 100;
}

/**
 * Apply one review grade to a card's scheduling state.
 * Pure: never mutates `state`; `now` is injectable for tests.
 */
export function review(
  state: CardSchedule,
  grade: ReviewGrade,
  now: Date = new Date()
): ReviewResult {
  const ease = clampEase(state.ease);
  const interval = Number.isFinite(state.interval) && state.interval > 0 ? state.interval : 0;
  const reps = Number.isInteger(state.reps) && state.reps > 0 ? state.reps : 0;

  switch (grade) {
    case "again": {
      return {
        interval: 0,
        ease: clampEase(ease - 0.2),
        reps: 0,
        due: new Date(now.getTime() + AGAIN_DELAY_MS),
      };
    }
    case "hard": {
      const nextInterval = roundInterval(Math.max(1, interval * 1.2));
      return {
        interval: nextInterval,
        ease: clampEase(ease - 0.15),
        reps: reps + 1,
        due: new Date(now.getTime() + nextInterval * DAY_MS),
      };
    }
    case "good": {
      // Graduating steps: first good = 1 day, second good = 3 days,
      // afterwards multiply the current interval by ease.
      const nextInterval =
        reps === 0 ? 1 : reps === 1 ? 3 : roundInterval(Math.max(1, interval * ease));
      return {
        interval: nextInterval,
        ease, // good leaves ease unchanged
        reps: reps + 1,
        due: new Date(now.getTime() + nextInterval * DAY_MS),
      };
    }
    case "easy": {
      const nextInterval =
        reps === 0 ? 4 : roundInterval(Math.max(1, interval * ease * 1.3));
      return {
        interval: nextInterval,
        ease: clampEase(ease + 0.15),
        reps: reps + 1,
        due: new Date(now.getTime() + nextInterval * DAY_MS),
      };
    }
  }
}

/** True when the card's due date is at or before `now`. */
export function isDue(card: { due: Date }, now: Date = new Date()): boolean {
  return card.due.getTime() <= now.getTime();
}
