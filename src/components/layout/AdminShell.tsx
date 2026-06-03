"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { useEffect } from "react";

const NAV = [
  { href: "/admin", label: "Dashboard" },
  { href: "/admin/courses", label: "Courses" },
  { href: "/admin/cohorts", label: "Cohorts" },
  { href: "/admin/users", label: "Users" },
  { href: "/admin/onboarding", label: "Bulk Onboard" },
];

export default function AdminShell({ children }: { children: React.ReactNode }) {
  const { user, appUser, loading, signOut } = useAuth();
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (!loading && (!user || appUser?.role !== "admin")) {
      router.replace("/auth/login");
    }
  }, [user, appUser, loading, router]);

  if (loading || !user) return null;

  return (
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: "#F5F7F4" }}>
      {/* Top nav */}
      <header className="sticky top-0 z-30 text-white" style={{ backgroundColor: "#13403A" }}>
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 flex items-center gap-3 flex-wrap sm:flex-nowrap">
          {/* Wordmark */}
          <Link href="/admin" className="font-bold text-lg mr-2 flex-shrink-0" style={{ color: "#8FB85C" }}>
            Andela <span className="text-white font-light">LMS</span>
          </Link>
          <span className="text-white/30 hidden sm:block flex-shrink-0">|</span>
          {/* Nav — wraps on mobile */}
          <nav className="flex flex-wrap gap-1 flex-1 min-w-0">
            {NAV.map((item) => {
              // Use exact match for the Dashboard root to avoid highlighting it
              // on every other /admin/* page.
              const isActive =
                item.href === "/admin"
                  ? pathname === "/admin"
                  : pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors flex-shrink-0 ${
                    isActive
                      ? "text-brand-primary font-semibold"
                      : "text-white/70 hover:text-white hover:bg-white/5"
                  }`}
                  style={isActive ? { backgroundColor: "#E7F1DE", color: "#13403A" } : {}}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
          <div className="flex items-center gap-3 flex-shrink-0">
            <span className="text-xs text-white/50 hidden sm:block truncate max-w-[140px]">
              {appUser?.name || appUser?.email}
            </span>
            <button
              onClick={() => signOut().then(() => router.push("/auth/login"))}
              className="text-xs text-white/60 hover:text-white transition-colors"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 py-6">
        {children}
      </main>
    </div>
  );
}
