/**
 * Next.js Middleware — route protection.
 *
 * Runs on the Edge before every request. Checks for a Firebase session cookie
 * (set after login) to protect /admin/* and /learn/* routes.
 *
 * NOTE: Full Firebase ID-token verification on the Edge requires the
 * firebase-admin SDK or a lightweight JWT verifier. For Phase 1 we use a
 * simple "presence of __session cookie" check here, and rely on Firestore
 * rules + server components for authoritative enforcement.
 *
 * To harden: verify the JWT with `jose` (no Node crypto needed on Edge) and
 * decode the custom claims to gate /admin routes strictly.
 */

import { NextRequest, NextResponse } from "next/server";

const PROTECTED_PREFIXES = ["/admin", "/learn"];
const AUTH_COOKIE = "__session"; // Firebase Auth sets this via getIdToken()

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const isProtected = PROTECTED_PREFIXES.some((p) => pathname.startsWith(p));
  if (!isProtected) return NextResponse.next();

  const sessionCookie = request.cookies.get(AUTH_COOKIE)?.value;

  // No session cookie → redirect to login
  if (!sessionCookie) {
    const loginUrl = new URL("/auth/login", request.url);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Cookie present — allow through. Firestore rules & client AuthProvider
  // perform the authoritative role check.
  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*", "/learn/:path*"],
};
