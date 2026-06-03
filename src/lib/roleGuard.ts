/**
 * Role guard helpers — pure functions, no React dependency.
 * Used both in middleware and in tests.
 */

import type { UserRole } from "@/types";

export type RoutePrefix = "/admin" | "/learn" | "/auth" | "/";

/**
 * Given a pathname and user state, decide where the user should be redirected.
 * Returns null if access is allowed.
 */
export function resolveRedirect(
  pathname: string,
  user: { role: UserRole } | null
): string | null {
  const isAdminRoute = pathname.startsWith("/admin");
  const isLearnRoute = pathname.startsWith("/learn");

  // Unauthenticated — redirect to login for protected routes
  if (!user) {
    if (isAdminRoute || isLearnRoute) return "/auth/login";
    return null;
  }

  // Admin routes — require admin role
  if (isAdminRoute && user.role !== "admin") return "/learn";

  // Learn routes — any authenticated user is fine (learner or admin)
  // (admins may preview learner views)

  return null; // access granted
}

/**
 * Check if a user has a specific role.
 */
export function hasRole(user: { role: UserRole } | null, role: UserRole): boolean {
  return user?.role === role;
}
