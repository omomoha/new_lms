"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";

/**
 * Root page — redirects based on auth state.
 * Admins → /admin/courses
 * Learners → /learn
 * Unauthenticated → /auth/login
 */
export default function HomePage() {
  const { user, appUser, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.replace("/auth/login");
    } else if (appUser?.role === "admin") {
      router.replace("/admin/courses");
    } else {
      router.replace("/learn");
    }
  }, [user, appUser, loading, router]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-brand-primary">
      <div className="text-center text-white">
        <div className="w-10 h-10 border-2 border-brand-accent border-t-transparent rounded-full animate-spin mx-auto mb-4" />
        <p className="text-sm text-white/60">Loading Andela Learn…</p>
      </div>
    </div>
  );
}
