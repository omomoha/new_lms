"use client";

/**
 * Cohorts — Admin
 * Create cohorts and see member counts. Courses are granted to cohorts from
 * the course builder; learners are added to cohorts from the Users page.
 */

import { useEffect, useState, useCallback } from "react";
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
        (u.cohortIds ?? []).forEach((cid) => {
          counts[cid] = (counts[cid] ?? 0) + 1;
        });
      });
      setMemberCounts(counts);
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
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Cohorts</h1>
          <p className="text-sm text-gray-500">
            Group learners; assign courses per cohort from the course builder.
          </p>
        </div>
        <button onClick={() => setAdding(!adding)} className="btn-primary text-sm">
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
          <h2 className="font-medium text-gray-900">New cohort</h2>
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
            <span className="text-xs text-gray-500">Color:</span>
            {COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                className={`w-6 h-6 rounded-full border-2 ${
                  color === c ? "border-gray-900" : "border-transparent"
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
        <div className="text-center py-20 text-gray-400">
          <p className="text-4xl mb-2">⬡</p>
          <p>No cohorts yet. Create your first one.</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {cohorts.map((c) => (
            <div key={c.id} className="card">
              <div className="flex items-center gap-2 mb-3">
                <span
                  className="px-2.5 py-1 rounded-md text-xs font-semibold text-white"
                  style={{ backgroundColor: c.color || "#2C7A6B" }}
                >
                  {c.name}
                </span>
                <span className="text-xs text-gray-400">{c.tag}</span>
              </div>
              <div className="flex gap-6 text-sm text-gray-600">
                <span>
                  <b className="text-gray-900">{memberCounts[c.id] ?? 0}</b> learners
                </span>
                <span>
                  <b className="text-gray-900">{c.courseIds?.length ?? 0}</b> courses
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </AdminShell>
  );
}
