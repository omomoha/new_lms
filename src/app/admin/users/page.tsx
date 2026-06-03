"use client";

/**
 * Users — Admin
 * View all users and manage their cohort membership. Role promotion to admin
 * happens out-of-band (setAdmin script / Cloud Function), never from the UI.
 */

import { useEffect, useState, useCallback } from "react";
import {
  collection,
  getDocs,
  updateDoc,
  doc,
  arrayUnion,
  arrayRemove,
} from "firebase/firestore";
import db from "@/lib/firebase/firestore";
import type { AppUser, Cohort } from "@/types";
import AdminShell from "@/components/layout/AdminShell";
import { Spinner } from "@/components/ui/Spinner";
import { Badge } from "@/components/ui/Badge";

export default function UsersPage() {
  const [users, setUsers] = useState<AppUser[]>([]);
  const [cohorts, setCohorts] = useState<Cohort[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyUid, setBusyUid] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [uSnap, cSnap] = await Promise.all([
        getDocs(collection(db, "users")),
        getDocs(collection(db, "cohorts")),
      ]);
      setUsers(uSnap.docs.map((d) => ({ ...(d.data() as AppUser), uid: d.id })));
      setCohorts(cSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Cohort)));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const toggleCohort = async (u: AppUser, cohortId: string) => {
    setBusyUid(u.uid);
    setError(null);
    try {
      const has = (u.cohortIds ?? []).includes(cohortId);
      await updateDoc(doc(db, "users", u.uid), {
        cohortIds: has ? arrayRemove(cohortId) : arrayUnion(cohortId),
      });
      setUsers((prev) =>
        prev.map((x) =>
          x.uid === u.uid
            ? {
                ...x,
                cohortIds: has
                  ? (x.cohortIds ?? []).filter((id) => id !== cohortId)
                  : [...(x.cohortIds ?? []), cohortId],
              }
            : x
        )
      );
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to update cohort");
    } finally {
      setBusyUid(null);
    }
  };

  const filtered = users.filter(
    (u) =>
      !search ||
      u.name?.toLowerCase().includes(search.toLowerCase()) ||
      u.email?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <AdminShell>
      {/* Page hero band */}
      <div className="page-hero flex flex-col sm:flex-row sm:items-end gap-4">
        <div className="flex-1">
          <span className="kicker">ADMIN · USERS</span>
          <h1 className="font-serif-brand text-2xl sm:text-3xl font-normal text-white leading-tight">
            Users
          </h1>
          <p className="mt-1 text-sm" style={{ color: "#CFE0D5" }}>
            Toggle cohort chips to add or remove a learner from a cohort.
          </p>
        </div>
        <input
          className="input-field sm:max-w-xs"
          placeholder="Search name or email…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-20">
          <Spinner />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-20" style={{ color: "#5E6E69" }}>
          <div className="mx-auto w-8 h-8 rounded-sm rotate-45 mb-4" style={{ backgroundColor: "#8FB85C" }} />
          <p>No users found.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((u) => (
            <div
              key={u.uid}
              className="card flex flex-col sm:flex-row sm:items-center gap-3"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium truncate" style={{ color: "#1E302C" }}>
                    {u.name || u.email}
                  </span>
                  <Badge
                    label={u.role}
                    variant={u.role === "admin" ? "success" : "default"}
                  />
                </div>
                <p className="text-xs truncate" style={{ color: "#5E6E69" }}>{u.email}</p>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {cohorts.length === 0 ? (
                  <span className="text-xs" style={{ color: "#5E6E69" }}>
                    No cohorts yet — create one first.
                  </span>
                ) : (
                  cohorts.map((c) => {
                    const on = (u.cohortIds ?? []).includes(c.id);
                    return (
                      <button
                        key={c.id}
                        disabled={busyUid === u.uid}
                        onClick={() => toggleCohort(u, c.id)}
                        className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                          on ? "text-white" : "bg-white hover:border-brand-teal"
                        }`}
                        style={
                          on
                            ? { backgroundColor: c.color || "#2C7A6B", borderColor: c.color || "#2C7A6B" }
                            : { borderColor: "#DDE6DF", color: "#5E6E69" }
                        }
                        title={on ? `Remove from ${c.name}` : `Add to ${c.name}`}
                      >
                        {c.name}
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </AdminShell>
  );
}
