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
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-6">
        <div className="flex-1">
          <h1 className="text-xl font-semibold text-gray-900">Users</h1>
          <p className="text-sm text-gray-500">
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
        <div className="text-center py-20 text-gray-400">
          <p className="text-4xl mb-2">👤</p>
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
                  <span className="font-medium text-gray-900 truncate">
                    {u.name || u.email}
                  </span>
                  <Badge
                    label={u.role}
                    variant={u.role === "admin" ? "success" : "default"}
                  />
                </div>
                <p className="text-xs text-gray-500 truncate">{u.email}</p>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {cohorts.length === 0 ? (
                  <span className="text-xs text-gray-400">
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
                          on
                            ? "text-white"
                            : "text-gray-600 bg-white border-gray-300 hover:border-gray-400"
                        }`}
                        style={
                          on
                            ? { backgroundColor: c.color || "#2C7A6B", borderColor: c.color || "#2C7A6B" }
                            : {}
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
