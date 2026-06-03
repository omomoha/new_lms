"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { useEffect } from "react";

const NAV = [
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
    <div className="min-h-screen flex flex-col bg-gray-50">
      {/* Top nav */}
      <header className="bg-brand-primary text-white h-14 flex items-center px-4 sm:px-6 gap-4 sticky top-0 z-30">
        <Link href="/admin/courses" className="font-bold text-brand-accent text-lg mr-2">
          Andela <span className="text-white font-light">Learn</span>
        </Link>
        <span className="text-white/30 hidden sm:block">|</span>
        <nav className="flex gap-1 flex-1">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                pathname.startsWith(item.href)
                  ? "bg-white/10 text-white"
                  : "text-white/70 hover:text-white hover:bg-white/5"
              }`}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-3">
          <span className="text-xs text-white/50 hidden sm:block">
            {appUser?.name || appUser?.email}
          </span>
          <button
            onClick={() => signOut().then(() => router.push("/auth/login"))}
            className="text-xs text-white/60 hover:text-white transition-colors"
          >
            Sign out
          </button>
        </div>
      </header>

      <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 py-6">
        {children}
      </main>
    </div>
  );
}
