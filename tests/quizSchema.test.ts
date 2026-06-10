/**
 * Unit tests — AI quiz output validation (pure, no firebase)
 */

import { describe, it, expect } from "vitest";
import { validateGeneratedQuiz } from "../functions/src/quizSchema";

function makeQuestion(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    text: "What is the capital of France?",
    options: ["Paris", "London", "Berlin", "Madrid"],
    correctIndex: 0,
    ...overrides,
  };
}

function makeQuiz(n: number): Array<Record<string, unknown>> {
  return Array.from({ length: n }, (_, i) =>
    makeQuestion({ text: `Question number ${i + 1}?` })
  );
}

describe("validateGeneratedQuiz", () => {
  it("accepts a valid quiz and rebuilds clean question objects", () => {
    const result = validateGeneratedQuiz(
      [
        makeQuestion({ explanation: "Paris is the capital." }),
        makeQuestion({ text: "  Is water wet?  " }),
      ],
      10
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.questions).toHaveLength(2);
    expect(result.questions[0].explanation).toBe("Paris is the capital.");
    expect(result.questions[1].text).toBe("Is water wet?"); // trimmed
    expect(result.questions[1].explanation).toBeUndefined();
    expect(Object.keys(result.questions[0]).sort()).toEqual([
      "correctIndex",
      "explanation",
      "options",
      "text",
    ]);
  });

  it("rejects non-array input", () => {
    expect(validateGeneratedQuiz({ questions: makeQuiz(3) }, 10).ok).toBe(false);
    expect(validateGeneratedQuiz("[]", 10).ok).toBe(false);
    expect(validateGeneratedQuiz(null, 10).ok).toBe(false);
    expect(validateGeneratedQuiz(undefined, 10).ok).toBe(false);
  });

  it("rejects too few questions (< 2)", () => {
    expect(validateGeneratedQuiz([], 10).ok).toBe(false);
    expect(validateGeneratedQuiz(makeQuiz(1), 10).ok).toBe(false);
  });

  it("rejects more than maxQuestions", () => {
    expect(validateGeneratedQuiz(makeQuiz(5), 4).ok).toBe(false);
    expect(validateGeneratedQuiz(makeQuiz(4), 4).ok).toBe(true);
  });

  it("rejects bad correctIndex values", () => {
    const cases: unknown[] = [4, -1, 1.5, "2", null, undefined, NaN];
    for (const correctIndex of cases) {
      const result = validateGeneratedQuiz(
        [makeQuestion({ correctIndex }), makeQuestion()],
        10
      );
      expect(result.ok).toBe(false);
    }
  });

  it("rejects unknown extra keys", () => {
    const result = validateGeneratedQuiz(
      [makeQuestion({ difficulty: "easy" }), makeQuestion()],
      10
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("difficulty");
  });

  it("rejects prototype-pollution keys", () => {
    // JSON.parse creates "__proto__" as an OWN property (no setter invoked).
    const polluted = JSON.parse(
      '[{"text":"Q?","options":["a","b","c","d"],"correctIndex":0,"__proto__":{"isAdmin":true}},' +
        '{"text":"Q2?","options":["a","b","c","d"],"correctIndex":1}]'
    ) as unknown;
    expect(validateGeneratedQuiz(polluted, 10).ok).toBe(false);
  });

  it("rejects non-string / empty / oversized text", () => {
    expect(validateGeneratedQuiz([makeQuestion({ text: 42 }), makeQuestion()], 10).ok).toBe(false);
    expect(validateGeneratedQuiz([makeQuestion({ text: "   " }), makeQuestion()], 10).ok).toBe(false);
    expect(
      validateGeneratedQuiz([makeQuestion({ text: "x".repeat(501) }), makeQuestion()], 10).ok
    ).toBe(false);
  });

  it("rejects options that are not exactly 4 strings", () => {
    expect(
      validateGeneratedQuiz([makeQuestion({ options: ["a", "b", "c"] }), makeQuestion()], 10).ok
    ).toBe(false);
    expect(
      validateGeneratedQuiz(
        [makeQuestion({ options: ["a", "b", "c", "d", "e"] }), makeQuestion()],
        10
      ).ok
    ).toBe(false);
    expect(
      validateGeneratedQuiz([makeQuestion({ options: ["a", "b", "c", 4] }), makeQuestion()], 10).ok
    ).toBe(false);
    expect(
      validateGeneratedQuiz([makeQuestion({ options: "abcd" }), makeQuestion()], 10).ok
    ).toBe(false);
  });

  it("rejects duplicate options (case-insensitive)", () => {
    expect(
      validateGeneratedQuiz(
        [makeQuestion({ options: ["Paris", "paris", "Berlin", "Madrid"] }), makeQuestion()],
        10
      ).ok
    ).toBe(false);
  });

  it("rejects empty or oversized options", () => {
    expect(
      validateGeneratedQuiz(
        [makeQuestion({ options: ["a", "  ", "c", "d"] }), makeQuestion()],
        10
      ).ok
    ).toBe(false);
    expect(
      validateGeneratedQuiz(
        [makeQuestion({ options: ["a", "b", "c", "x".repeat(201)] }), makeQuestion()],
        10
      ).ok
    ).toBe(false);
  });

  it("rejects non-string explanation and oversized explanation", () => {
    expect(
      validateGeneratedQuiz([makeQuestion({ explanation: 7 }), makeQuestion()], 10).ok
    ).toBe(false);
    expect(
      validateGeneratedQuiz(
        [makeQuestion({ explanation: "x".repeat(501) }), makeQuestion()],
        10
      ).ok
    ).toBe(false);
  });

  it("rejects non-object items", () => {
    expect(validateGeneratedQuiz([makeQuestion(), "not an object"], 10).ok).toBe(false);
    expect(validateGeneratedQuiz([makeQuestion(), null], 10).ok).toBe(false);
    expect(validateGeneratedQuiz([makeQuestion(), [1, 2, 3]], 10).ok).toBe(false);
  });

  it("sanitizes a bogus maxQuestions to the minimum of 2", () => {
    // maxQuestions of 0/NaN still allows 2 questions through.
    expect(validateGeneratedQuiz(makeQuiz(2), 0).ok).toBe(true);
    expect(validateGeneratedQuiz(makeQuiz(2), NaN).ok).toBe(true);
    expect(validateGeneratedQuiz(makeQuiz(3), 0).ok).toBe(false);
  });
});
