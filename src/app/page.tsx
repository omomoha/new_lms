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
      router.replace("/admin");
    } else {
      router.replace("/learn");
    }
  }, [user, appUser, loading, router]);

  // Inline styles ON PURPOSE: this splash can render during the brief
  // post-deploy window where the hashed CSS chunk 404s (CDN propagation).
  // Inline styles keep it branded even with zero stylesheets loaded.
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "#13403A",
        fontFamily: "Inter, system-ui, sans-serif",
      }}
    >
      <style>{`@keyframes andela-spin { to { transform: rotate(360deg); } }`}</style>
      <div style={{ textAlign: "center", color: "#ffffff" }}>
        <div
          aria-hidden="true"
          style={{
            width: "2.5rem",
            height: "2.5rem",
            margin: "0 auto 1rem",
            borderRadius: "9999px",
            border: "2px solid #8FB85C",
            borderTopColor: "transparent",
            animation: "andela-spin 0.8s linear infinite",
          }}
        />
        <p style={{ fontSize: "1.25rem", fontWeight: 700 }}>
          <span style={{ color: "#8FB85C" }}>Andela</span>{" "}
          <span style={{ fontWeight: 300 }}>LMS</span>
        </p>
        <p style={{ fontSize: "0.875rem", color: "rgba(255,255,255,0.6)", marginTop: "0.25rem" }}>
          Loading Andela Learn…
        </p>
      </div>
    </div>
  );
}
