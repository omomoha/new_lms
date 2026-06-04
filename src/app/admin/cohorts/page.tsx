"use client";

/**
 * Cohorts — Admin
 * Create cohorts and see member counts. Courses are granted to cohorts from
 * the course builder; learners are added to cohorts from the Users page.
 * Click "Manage →" on any cohort card to edit members and courses.
 */

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  collection,
  getDocs,
  addDoc,
  updateDoc,
  doc,
  serverTimestamp,
} from "firebase/firestore";
import db from "@/lib/firebase/firestore";
import type { Cohort, AppUser } from "@/types";
import AdminShell from "@/components/layout/AdminShell";
import { Spinner } from "@/components/ui/Spinner";

const COLORS = ["#2C7A6B", "#7FB069", "#13403A", "#C9772F", "#5E6E69"];

export default function CohortsPage() {
  const router = useRouter();
  const [cohorts, setCohorts] = useState<Cohort[]>([]);
  const [memberCounts, setMemberCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [tag, setTag] = useState("");
  const [color, setColor] = useState(COLORS[0]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const snap = await getDocs(collection(db, "cohorts"));
      setCohorts(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Cohort)));
      const uSnap = await getDocs(collection(db, "users"));
      const counts: Record<string, number> = {};
      uSnap.docs.forEach((d) => {
        const u = d.data() as AppUser;
        const ids = Array.isArray(u.cohortIds) ? u.cohortIds : [];
        ids.forEach((cid) => {
          counts[cid] = (counts[cid] ?? 0) + 1;
        });
      });
      setMemberCounts(counts);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load cohorts");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !tag.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const ref = await addDoc(collection(db, "cohorts"), {
        name: name.trim(),
        tag: tag.trim().toLowerCase().replace(/\s+/g, "-"),
        color,
        courseIds: [],
        createdAt: serverTimestamp(),
      });
      await updateDoc(doc(db, "cohorts", ref.id), { id: ref.id });
      setName("");
      setTag("");
      setAdding(false);
      load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to create cohort");
    } finally {
      setSaving(false);
    }
  };

  return (
    <AdminShell>
      {/* Page hero band */}
      <div className="page-hero flex flex-col sm:flex-row sm:items-end gap-4">
        <div className="flex-1">
          <span className="kicker">ADMIN · COHORTS</span>
          <h1 className="font-serif-brand text-2xl sm:text-3xl font-normal text-white leading-tight">
            Cohorts
          </h1>
          <p className="mt-1 text-sm" style={{ color: "#CFE0D5" }}>
            Group learners; assign courses per cohort from the course builder.
          </p>
        </div>
        <button onClick={() => setAdding(!adding)} className="self-start sm:self-auto flex-shrink-0 px-4 py-2 rounded-lg font-semibold text-sm transition-colors" style={{ backgroundColor: "#8FB85C", color: "#13403A" }}>
          + New cohort
        </button>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          {error}
        </div>
      )}

      {adding && (
        <form onSubmit={handleCreate} className="card mb-6 space-y-3">
          <h2 className="font-medium" style={{ color: "#1E302C" }}>New cohort</h2>
          <input
            className="input-field"
            placeholder="Cohort name (e.g. Backend Guild)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
          <input
            className="input-field"
            placeholder="Tag (e.g. q3-2026)"
            value={tag}
            onChange={(e) => setTag(e.target.value)}
            required
          />
          <div className="flex items-center gap-2">
            <span className="text-xs" style={{ color: "#5E6E69" }}>Color:</span>
            {COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                className={`w-6 h-6 rounded-full border-2 ${
                  color === c ? "border-brand-ink" : "border-transparent"
                }`}
                style={{ backgroundColor: c }}
                aria-label={`color ${c}`}
              />
            ))}
          </div>
          <div className="flex gap-2">
            <button type="submit" disabled={saving} className="btn-primary text-xs">
              {saving ? "Creating…" : "Create cohort"}
            </button>
            <button
              type="button"
              onClick={() => setAdding(false)}
              className="btn-secondary text-xs"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <div className="flex justify-center py-20">
          <Spinner />
        </div>
      ) : cohorts.length === 0 ? (
        <div className="text-center py-20" style={{ color: "#5E6E69" }}>
          <div className="mx-auto w-8 h-8 rounded-sm rotate-45 mb-4" style={{ backgroundColor: "#8FB85C" }} />
          <p>No cohorts yet. Create your first one.</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {cohorts.map((c) => (
            <div key={c.id} className="card overflow-hidden !p-0">
              {/* Color left-border chip at top */}
              <div
                className="h-2 w-full rounded-t-xl"
                style={{ backgroundColor: c.color || "#2C7A6B" }}
              />
              <div className="px-4 sm:px-5 py-4">
                <div className="flex items-center gap-2 mb-3">
                  <span
                    className="px-2.5 py-1 rounded-md text-xs font-semibold text-white"
                    style={{ backgroundColor: c.color || "#2C7A6B" }}
                  >
                    {c.name}
                  </span>
                  <span className="text-xs" style={{ color: "#5E6E69" }}>{c.tag}</span>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <div className="flex gap-6 text-sm" style={{ color: "#5E6E69" }}>
                    <span>
                      <b style={{ color: "#1E302C" }}>{memberCounts[c.id] ?? 0}</b> learners
                    </span>
                    <span>
                      <b style={{ color: "#1E302C" }}>{c.courseIds?.length ?? 0}</b> courses
                    </span>
                  </div>
                  <button
                    onClick={() => router.push(`/admin/cohorts/${c.id}`)}
                    className="btn-secondary text-xs px-3 py-1.5 flex-shrink-0"
                  >
                    Manage &rarr;
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </AdminShell>
  );
}
