"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  collection,
  getDocs,
  addDoc,
  updateDoc,
  doc,
  serverTimestamp,
  query,
  orderBy,
} from "firebase/firestore";
import db from "@/lib/firebase/firestore";
import { logAdminAction } from "@/lib/audit";
import { useAuth } from "@/contexts/AuthContext";
import type { Course } from "@/types";
import AdminShell from "@/components/layout/AdminShell";
import { Spinner } from "@/components/ui/Spinner";
import { Badge } from "@/components/ui/Badge";
import { EntityThumb } from "@/components/ui/Thumb";

const STATUS_VARIANT: Record<string, "default" | "success" | "warning" | "error"> = {
  draft: "warning",
  published: "success",
  archived: "default",
};

export default function AdminCoursesPage() {
  const { user } = useAuth();
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);

  const fetchCourses = async () => {
    setLoading(true);
    try {
      const q = query(collection(db, "courses"), orderBy("createdAt", "desc"));
      const snap = await getDocs(q);
      setCourses(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Course)));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchCourses(); }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const ref = await addDoc(collection(db, "courses"), {
        title: title.trim(),
        description: description.trim(),
        status: "draft",
        moduleOrder: [],
        assignedCohortIds: [],
        createdAt: serverTimestamp(),
      });
      // Update with generated id
      await updateDoc(doc(db, "courses", ref.id), { id: ref.id });
      // Best-effort audit trail — never blocks or fails the UI
      if (user) {
        void logAdminAction(
          { uid: user.uid, email: user.email },
          {
            action: "course.create",
            targetType: "course",
            targetId: ref.id,
            details: `Created course "${title.trim()}" (draft)`,
          }
        );
      }
      setTitle(""); setDescription(""); setShowForm(false);
      fetchCourses();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to create course");
    } finally {
      setCreating(false);
    }
  };

  return (
    <AdminShell>
      {/* Page hero band */}
      <div className="page-hero flex flex-col sm:flex-row sm:items-end gap-4">
        <div className="flex-1">
          <span className="kicker">ADMIN · COURSES</span>
          <h1 className="font-serif-brand text-2xl sm:text-3xl font-normal text-white leading-tight">
            Course Library
          </h1>
          <p className="mt-1 text-sm text-brand-mist">
            Build and publish courses, manage modules and lessons.
          </p>
        </div>
        <div className="flex gap-2 self-start sm:self-auto flex-shrink-0">
          <Link
            href="/admin/courses/builder"
            className="px-4 py-2 rounded-lg font-semibold text-sm transition-colors border border-brand-accent text-brand-mint hover:bg-brand-accent hover:text-brand-primary"
          >
            ✨ Generate with AI
          </Link>
          <button
            className="px-4 py-2 rounded-lg font-semibold text-sm transition-colors bg-brand-accent text-brand-primary"
            onClick={() => setShowForm((v) => !v)}
          >
            {showForm ? "Cancel" : "+ New Course"}
          </button>
        </div>
      </div>

      {/* Create form */}
      {showForm && (
        <div className="card mb-6">
          <h2 className="text-base font-medium mb-4 text-brand-ink">Create Course</h2>
          {error && <p className="text-sm text-red-600 mb-3">{error}</p>}
          <form onSubmit={handleCreate} className="space-y-3">
            <input
              className="input-field"
              placeholder="Course title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
            />
            <textarea
              className="input-field resize-none"
              rows={3}
              placeholder="Description (optional)"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
            <button type="submit" disabled={creating} className="btn-primary">
              {creating ? "Creating…" : "Create Course"}
            </button>
          </form>
        </div>
      )}

      {/* Course list */}
      {loading ? (
        <div className="flex justify-center py-20"><Spinner /></div>
      ) : courses.length === 0 ? (
        <div className="text-center py-20 text-brand-muted">
          <div className="mx-auto w-8 h-8 rounded-sm rotate-45 mb-4 bg-brand-accent" />
          <p>No courses yet. Create your first one.</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {courses.map((c) => (
            <Link
              key={c.id}
              href={`/admin/courses/${c.id}`}
              className="card hover:shadow-md transition-shadow flex flex-col gap-2 group overflow-hidden !p-0"
            >
              {/* Course thumbnail header strip */}
              <div className="h-20 w-full rounded-t-xl overflow-hidden">
                <EntityThumb
                  thumbPath={c.thumbPath}
                  seed={c.id}
                  title={c.title}
                  className="w-full h-full"
                />
              </div>
              <div className="px-4 sm:px-5 pb-4 sm:pb-5 pt-3 flex flex-col gap-2 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-medium line-clamp-2 group-hover:text-brand-teal transition-colors text-brand-ink">
                    {c.title}
                  </h3>
                  <Badge label={c.status} variant={STATUS_VARIANT[c.status]} />
                </div>
                {c.description && (
                  <p className="text-sm line-clamp-2 text-brand-muted">{c.description}</p>
                )}
                <p className="text-xs mt-auto text-brand-muted">
                  {c.moduleOrder?.length ?? 0} modules
                </p>
              </div>
            </Link>
          ))}
        </div>
      )}
    </AdminShell>
  );
}
