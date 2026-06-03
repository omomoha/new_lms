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
    <div className="min-h-screen flex flex-col bg-gray-50">
      <header className="bg-brand-primary text-white h-14 flex items-center px-4 sm:px-6 sticky top-0 z-30">
        <Link href="/learn" className="font-bold text-brand-accent text-lg flex-1">
          Andela <span className="text-white font-light">Learn</span>
        </Link>
        <div className="flex items-center gap-3">
          <span className="text-xs text-white/50 hidden sm:block">
            {appUser?.name || ""}
          </span>
          <button
            onClick={() => signOut().then(() => router.push("/auth/login"))}
            className="text-xs text-white/60 hover:text-white"
          >
            Sign out
          </button>
        </div>
      </header>
      <main className="flex-1">{children}</main>
    </div>
  );
}
