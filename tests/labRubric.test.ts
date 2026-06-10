/**
 * Unit tests — labRubric.validateLabGrade (model-output validation gate)
 */

import { describe, it, expect } from "vitest";
import { validateLabGrade } from "../functions/src/labRubric";

const validGrade = {
  score: 85,
  summary: "Solid solution with clear structure.",
  strengths: ["Good naming", "Handles edge cases"],
  improvements: ["Add input validation"],
};

describe("validateLabGrade — valid input", () => {
  it("accepts a well-formed grade", () => {
    const res = validateLabGrade(validGrade);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.grade.score).toBe(85);
      expect(res.grade.summary).toBe("Solid solution with clear structure.");
      expect(res.grade.strengths).toEqual(["Good naming", "Handles edge cases"]);
      expect(res.grade.improvements).toEqual(["Add input validation"]);
    }
  });

  it("accepts boundary scores 0 and 100", () => {
    expect(validateLabGrade({ ...validGrade, score: 0 }).ok).toBe(true);
    expect(validateLabGrade({ ...validGrade, score: 100 }).ok).toBe(true);
  });

  it("trims whitespace from summary and list items", () => {
    const res = validateLabGrade({
      ...validGrade,
      summary: "  padded  ",
      strengths: ["  also padded  "],
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.grade.summary).toBe("padded");
      expect(res.grade.strengths).toEqual(["also padded"]);
    }
  });

  it("accepts the maximum of 5 items per list", () => {
    const five = ["a", "b", "c", "d", "e"];
    const res = validateLabGrade({ ...validGrade, strengths: five, improvements: five });
    expect(res.ok).toBe(true);
  });
});

describe("validateLabGrade — score out of range", () => {
  it("rejects negative scores", () => {
    expect(validateLabGrade({ ...validGrade, score: -1 }).ok).toBe(false);
  });

  it("rejects scores above 100", () => {
    expect(validateLabGrade({ ...validGrade, score: 101 }).ok).toBe(false);
  });

  it("rejects non-integer scores", () => {
    expect(validateLabGrade({ ...validGrade, score: 72.5 }).ok).toBe(false);
  });

  it("rejects non-numeric scores", () => {
    expect(validateLabGrade({ ...validGrade, score: "90" }).ok).toBe(false);
    expect(validateLabGrade({ ...validGrade, score: NaN }).ok).toBe(false);
  });
});

describe("validateLabGrade — missing or malformed arrays", () => {
  it("rejects when strengths is missing", () => {
    const { strengths: _omit, ...rest } = validGrade;
    expect(validateLabGrade(rest).ok).toBe(false);
  });

  it("rejects when improvements is missing", () => {
    const { improvements: _omit, ...rest } = validGrade;
    expect(validateLabGrade(rest).ok).toBe(false);
  });

  it("rejects empty arrays", () => {
    expect(validateLabGrade({ ...validGrade, strengths: [] }).ok).toBe(false);
  });

  it("rejects arrays with more than 5 items", () => {
    const six = ["a", "b", "c", "d", "e", "f"];
    expect(validateLabGrade({ ...validGrade, improvements: six }).ok).toBe(false);
  });

  it("rejects arrays containing non-string items", () => {
    expect(validateLabGrade({ ...validGrade, strengths: ["ok", 42] }).ok).toBe(false);
  });

  it("rejects arrays containing empty/whitespace strings", () => {
    expect(validateLabGrade({ ...validGrade, strengths: ["ok", "   "] }).ok).toBe(false);
  });

  it("rejects a string where an array is expected", () => {
    expect(validateLabGrade({ ...validGrade, strengths: "great work" }).ok).toBe(false);
  });
});

describe("validateLabGrade — oversized strings", () => {
  it("rejects a summary longer than 800 chars", () => {
    expect(
      validateLabGrade({ ...validGrade, summary: "x".repeat(801) }).ok
    ).toBe(false);
  });

  it("accepts a summary of exactly 800 chars", () => {
    expect(
      validateLabGrade({ ...validGrade, summary: "x".repeat(800) }).ok
    ).toBe(true);
  });

  it("rejects list items longer than 300 chars", () => {
    expect(
      validateLabGrade({ ...validGrade, improvements: ["y".repeat(301)] }).ok
    ).toBe(false);
  });

  it("rejects an empty summary", () => {
    expect(validateLabGrade({ ...validGrade, summary: "" }).ok).toBe(false);
    expect(validateLabGrade({ ...validGrade, summary: "   " }).ok).toBe(false);
  });
});

describe("validateLabGrade — extra keys", () => {
  it("rejects objects with unknown keys", () => {
    const res = validateLabGrade({ ...validGrade, isAdmin: true });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("isAdmin");
  });

  it("rejects prompt-injection style extra fields", () => {
    expect(
      validateLabGrade({ ...validGrade, __proto__pollution: "x" }).ok
    ).toBe(false);
  });
});

describe("validateLabGrade — non-object input", () => {
  it("rejects null and undefined", () => {
    expect(validateLabGrade(null).ok).toBe(false);
    expect(validateLabGrade(undefined).ok).toBe(false);
  });

  it("rejects primitives", () => {
    expect(validateLabGrade("a grade").ok).toBe(false);
    expect(validateLabGrade(95).ok).toBe(false);
    expect(validateLabGrade(true).ok).toBe(false);
  });

  it("rejects arrays", () => {
    expect(validateLabGrade([validGrade]).ok).toBe(false);
  });
});
