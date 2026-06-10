import { describe, it, expect } from "vitest";
import { validateGeneratedCourse } from "../functions/src/courseOutlineSchema";

const lesson = (over: Record<string, unknown> = {}) => ({
  title: "Intro to containers",
  type: "text",
  content: "## Containers\nSome drafted body.",
  ...over,
});

const course = (over: Record<string, unknown> = {}) => ({
  title: "Docker for Engineers",
  description: "A hands-on Docker course.",
  modules: [{ title: "Week 1", lessons: [lesson()] }],
  ...over,
});

describe("validateGeneratedCourse", () => {
  it("accepts a valid course and rebuilds it cleanly", () => {
    const r = validateGeneratedCourse(course());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.course.title).toBe("Docker for Engineers");
      expect(r.course.modules[0].lessons[0].content).toContain("Containers");
    }
  });

  it("rejects non-objects", () => {
    expect(validateGeneratedCourse(null).ok).toBe(false);
    expect(validateGeneratedCourse([]).ok).toBe(false);
    expect(validateGeneratedCourse("x").ok).toBe(false);
  });

  it("rejects missing/empty/oversized titles", () => {
    expect(validateGeneratedCourse(course({ title: "" })).ok).toBe(false);
    expect(validateGeneratedCourse(course({ title: "x".repeat(201) })).ok).toBe(false);
    expect(validateGeneratedCourse(course({ title: 7 })).ok).toBe(false);
  });

  it("allows a missing description (defaults to empty)", () => {
    const { description: _drop, ...noDesc } = course();
    const r = validateGeneratedCourse(noDesc);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.course.description).toBe("");
  });

  it("bounds module and lesson counts", () => {
    expect(validateGeneratedCourse(course({ modules: [] })).ok).toBe(false);
    const tooManyModules = Array.from({ length: 13 }, (_, i) => ({
      title: `M${i}`,
      lessons: [lesson()],
    }));
    expect(validateGeneratedCourse(course({ modules: tooManyModules })).ok).toBe(false);
    const tooManyLessons = [{
      title: "M",
      lessons: Array.from({ length: 16 }, () => lesson()),
    }];
    expect(validateGeneratedCourse(course({ modules: tooManyLessons })).ok).toBe(false);
  });

  it("rejects invalid lesson types", () => {
    const bad = course({ modules: [{ title: "M", lessons: [lesson({ type: "podcast" })] }] });
    expect(validateGeneratedCourse(bad).ok).toBe(false);
  });

  it("strips content from video/quiz lessons but keeps it for text/lab", () => {
    const c = course({
      modules: [{
        title: "M",
        lessons: [
          lesson({ type: "video", content: "should be dropped" }),
          lesson({ type: "lab", content: "exercise brief" }),
        ],
      }],
    });
    const r = validateGeneratedCourse(c);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.course.modules[0].lessons[0].content).toBeUndefined();
      expect(r.course.modules[0].lessons[1].content).toBe("exercise brief");
    }
  });

  it("rejects prototype-pollution keys", () => {
    const polluted = JSON.parse(
      '{"title":"T","description":"d","modules":[{"title":"M","lessons":[{"title":"L","type":"text"}]}],"__proto__":{"x":1}}'
    );
    expect(validateGeneratedCourse(polluted).ok).toBe(false);
  });

  it("rejects oversized lesson content", () => {
    const big = course({
      modules: [{ title: "M", lessons: [lesson({ content: "x".repeat(12001) })] }],
    });
    expect(validateGeneratedCourse(big).ok).toBe(false);
  });
});
