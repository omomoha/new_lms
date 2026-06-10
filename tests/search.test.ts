/**
 * Unit tests — course search filtering
 */

import { describe, it, expect } from "vitest";
import { filterCourses, normalizeForSearch } from "../src/lib/search";

const COURSES = [
  { id: "1", title: "Intro to TypeScript", description: "Types, generics and more" },
  { id: "2", title: "Café Culture & Communication", description: "Soft skills résumé builder" },
  { id: "3", title: "C++ (Advanced)", description: "Pointers, RAII, templates" },
  { id: "4", title: "Data Engineering", description: "" },
  { id: "5", title: "No description course" },
];

describe("normalizeForSearch", () => {
  it("lowercases", () => {
    expect(normalizeForSearch("HeLLo")).toBe("hello");
  });

  it("strips diacritics", () => {
    expect(normalizeForSearch("Café Résumé")).toBe("cafe resume");
  });
});

describe("filterCourses", () => {
  it("returns all items for an empty query", () => {
    expect(filterCourses(COURSES, "")).toEqual(COURSES);
  });

  it("returns all items for a whitespace-only query", () => {
    expect(filterCourses(COURSES, "   ")).toEqual(COURSES);
  });

  it("matches title case-insensitively", () => {
    const result = filterCourses(COURSES, "tYpEsCrIpT");
    expect(result.map((c) => c.id)).toEqual(["1"]);
  });

  it("matches description text", () => {
    const result = filterCourses(COURSES, "generics");
    expect(result.map((c) => c.id)).toEqual(["1"]);
  });

  it("is diacritic-insensitive in both directions", () => {
    // plain query matches accented content…
    expect(filterCourses(COURSES, "cafe").map((c) => c.id)).toEqual(["2"]);
    // …and accented query matches too
    expect(filterCourses(COURSES, "café").map((c) => c.id)).toEqual(["2"]);
    // accented query against plain-but-accent-bearing description
    expect(filterCourses(COURSES, "résumé").map((c) => c.id)).toEqual(["2"]);
  });

  it("returns an empty array when nothing matches", () => {
    expect(filterCourses(COURSES, "quantum basket weaving")).toEqual([]);
  });

  it("does not break on special regex characters", () => {
    expect(() => filterCourses(COURSES, "c++ (")).not.toThrow();
    expect(filterCourses(COURSES, "C++ (Advanced)").map((c) => c.id)).toEqual(["3"]);
    expect(() => filterCourses(COURSES, ".*[a-z](")).not.toThrow();
    // regex metacharacters are matched literally, not as patterns
    expect(filterCourses(COURSES, ".*")).toEqual([]);
  });

  it("handles items without a description", () => {
    expect(filterCourses(COURSES, "no description").map((c) => c.id)).toEqual(["5"]);
  });

  it("trims surrounding whitespace from the query", () => {
    expect(filterCourses(COURSES, "  typescript  ").map((c) => c.id)).toEqual(["1"]);
  });
});
