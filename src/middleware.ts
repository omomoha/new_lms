/**
 * Next.js Middleware — route protection (Phase 3: full JWT verification).
 *
 * Phase 1 only checked that the "__session" cookie existed. Now the cookie's
 * Firebase ID token is cryptographically VERIFIED on the Edge with `jose`:
 *   - RS256 signature against Google's securetoken JWKS (cached by jose)
 *   - issuer:   https://securetoken.google.com/{projectId}
 *   - audience: {projectId}
 *   - expiry, with 60 s clock tolerance
 *
 * Additionally, /admin/* now requires the `role: "admin"` custom claim in the
 * verified token — a learner with a valid session is redirected to /learn.
 *
 * The cookie is set/refreshed by AuthContext on onIdTokenChanged (hourly
 * rotation), so a healthy client session always carries a fresh token.
 * Firestore rules remain the authoritative data-access enforcement; this is
 * the perimeter layer.
 */

import { NextRequest, NextResponse } from "next/server";
import { jwtVerify, createRemoteJWKSet } from "jose";

const AUTH_COOKIE = "__session";
const PROJECT_ID = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID!;

// Google's public JWKS for Firebase ID tokens. jose caches the keys and
// respects cache headers, so this does NOT refetch on every request.
const JWKS = createRemoteJWKSet(
  new URL(
    "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com"
  )
);

async function verifySession(token: string): Promise<{ role?: string } | null> {
  try {
    const { payload } = await jwtVerify(token, JWKS, {
      issuer: `https://securetoken.google.com/${PROJECT_ID}`,
      audience: PROJECT_ID,
      algorithms: ["RS256"],
      clockTolerance: 60,
    });
    // A Firebase ID token always carries a non-empty sub (the uid).
    if (!payload.sub) return null;
    return { role: typeof payload.role === "string" ? payload.role : undefined };
  } catch {
    return null; // invalid signature, expired, wrong iss/aud, malformed…
  }
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const needsAuth = pathname.startsWith("/admin") || pathname.startsWith("/learn");
  if (!needsAuth) return NextResponse.next();

  const token = request.cookies.get(AUTH_COOKIE)?.value;
  if (!token) {
    const loginUrl = new URL("/auth/login", request.url);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  const session = await verifySession(token);
  if (!session) {
    const loginUrl = new URL("/auth/login", request.url);
    loginUrl.searchParams.set("next", pathname);
    const res = NextResponse.redirect(loginUrl);
    // Clear the bad/stale cookie so we don't redirect-loop
    res.cookies.set(AUTH_COOKIE, "", { maxAge: 0, path: "/" });
    return res;
  }

  // Admin area requires the verified admin claim
  if (pathname.startsWith("/admin") && session.role !== "admin") {
    return NextResponse.redirect(new URL("/learn", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*", "/learn/:path*"],
};
