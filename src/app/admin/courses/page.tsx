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
import type { Course } from "@/types";
import AdminShell from "@/components/layout/AdminShell";
import { Spinner } from "@/components/ui/Spinner";
import { Badge } from "@/components/ui/Badge";

const STATUS_VARIANT: Record<string, "default" | "success" | "warning" | "error"> = {
  draft: "warning",
  published: "success",
  archived: "default",
};

export default function AdminCoursesPage() {
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
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold text-gray-900">Courses</h1>
        <button className="btn-primary" onClick={() => setShowForm((v) => !v)}>
          {showForm ? "Cancel" : "+ New Course"}
        </button>
      </div>

      {/* Create form */}
      {showForm && (
        <div className="card mb-6">
          <h2 className="text-base font-medium mb-4">Create Course</h2>
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
        <div className="text-center py-20 text-gray-400">
          <p className="text-4xl mb-2">📚</p>
          <p>No courses yet. Create your first one.</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {courses.map((c) => (
            <Link
              key={c.id}
              href={`/admin/courses/${c.id}`}
              className="card hover:shadow-md transition-shadow flex flex-col gap-2 group"
            >
              <div className="flex items-start justify-between">
                <h3 className="font-medium text-gray-900 group-hover:text-brand-primary line-clamp-2">
                  {c.title}
                </h3>
                <Badge label={c.status} variant={STATUS_VARIANT[c.status]} />
              </div>
              {c.description && (
                <p className="text-sm text-gray-500 line-clamp-2">{c.description}</p>
              )}
              <p className="text-xs text-gray-400 mt-auto">
                {c.moduleOrder?.length ?? 0} modules
              </p>
            </Link>
          ))}
        </div>
      )}
    </AdminShell>
  );
}
