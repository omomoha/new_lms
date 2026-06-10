"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { useEffect } from "react";

export default function LearnerShell({ children }: { children: React.ReactNode }) {
  const { user, appUser, loading, signOut } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) {
      router.replace("/auth/login");
    }
  }, [user, loading, router]);

  if (loading || !user) return null;

  return (
    <div className="min-h-screen flex flex-col bg-brand-cream">
      <header className="sticky top-0 z-30 text-white h-14 flex items-center px-4 sm:px-6 bg-brand-primary">
        <Link href="/learn" className="font-bold text-lg flex-1 text-brand-accent">
          Andela <span className="text-white font-light">LMS</span>
        </Link>
        <div className="flex items-center gap-3">
          <span className="text-xs text-white/50 hidden sm:block truncate max-w-[160px]">
            {appUser?.name || ""}
          </span>
          <button
            onClick={() => signOut().then(() => router.push("/auth/login"))}
            className="text-xs text-white/60 hover:text-white transition-colors"
          >
            Sign out
          </button>
        </div>
      </header>
      <main id="main-content" className="flex-1">{children}</main>
    </div>
  );
}
