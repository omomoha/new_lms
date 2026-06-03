/**
 * Unit tests — role guard / route protection helper
 */

import { describe, it, expect } from "vitest";
import { resolveRedirect, hasRole } from "../src/lib/roleGuard";

const admin = { role: "admin" as const };
const learner = { role: "learner" as const };

describe("resolveRedirect", () => {
  // Unauthenticated user
  it("redirects unauthenticated user away from /admin routes", () => {
    expect(resolveRedirect("/admin/courses", null)).toBe("/auth/login");
  });

  it("redirects unauthenticated user away from /learn routes", () => {
    expect(resolveRedirect("/learn", null)).toBe("/auth/login");
  });

  it("allows unauthenticated user on public routes", () => {
    expect(resolveRedirect("/auth/login", null)).toBeNull();
    expect(resolveRedirect("/", null)).toBeNull();
  });

  // Admin user
  it("allows admin on /admin routes", () => {
    expect(resolveRedirect("/admin/courses", admin)).toBeNull();
    expect(resolveRedirect("/admin/onboarding", admin)).toBeNull();
  });

  it("allows admin on /learn routes (preview)", () => {
    expect(resolveRedirect("/learn", admin)).toBeNull();
  });

  // Learner user
  it("redirects learner away from /admin routes", () => {
    expect(resolveRedirect("/admin/courses", learner)).toBe("/learn");
  });

  it("allows learner on /learn routes", () => {
    expect(resolveRedirect("/learn", learner)).toBeNull();
    expect(resolveRedirect("/learn/course/abc", learner)).toBeNull();
  });

  it("allows authenticated learner on public routes", () => {
    expect(resolveRedirect("/auth/login", learner)).toBeNull();
  });
});

describe("hasRole", () => {
  it("returns true when user has the specified role", () => {
    expect(hasRole(admin, "admin")).toBe(true);
    expect(hasRole(learner, "learner")).toBe(true);
  });

  it("returns false when user has a different role", () => {
    expect(hasRole(admin, "learner")).toBe(false);
    expect(hasRole(learner, "admin")).toBe(false);
  });

  it("returns false when user is null", () => {
    expect(hasRole(null, "admin")).toBe(false);
    expect(hasRole(null, "learner")).toBe(false);
  });
});
