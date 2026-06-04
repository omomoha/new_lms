"use client";

/**
 * Cohort Detail — Admin
 *
 * Manage a single cohort:
 *  - Rename (name + tag) and change color.
 *  - Members card: list ALL users with a chip-toggle per user
 *    (arrayUnion / arrayRemove on users/{uid}.cohortIds).
 *  - Courses card: list ALL courses with a toggle per course
 *    (updates courses/{id}.assignedCohortIds AND cohorts/{id}.courseIds
 *    symmetrically, matching the course-builder pattern).
 *  - Delete cohort: confirm prompt, then best-effort cleanup of member user
 *    docs and assigned course docs, then delete the cohort doc.
 */

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  doc,
  getDoc,
  getDocs,
  collection,
  updateDoc,
  deleteDoc,
  arrayUnion,
  arrayRemove,
} from "firebase/firestore";
import db from "@/lib/firebase/firestore";
import type { Cohort, AppUser, Course } from "@/types";
import AdminShell from "@/components/layout/AdminShell";
import { Spinner } from "@/components/ui/Spinner";
import { Badge } from "@/components/ui/Badge";

const COLORS = ["#2C7A6B", "#7FB069", "#13403A", "#C9772F", "#5E6E69"];

export default function CohortDetailPage() {
  const params = useParams();
  const router = useRouter();
  const cohortId = params.cohortId as string;

  const [cohort, setCohort] = useState<Cohort | null>(null);
  const [users, setUsers] = useState<AppUser[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Rename form
  const [editName, setEditName] = useState("");
  const [editTag, setEditTag] = useState("");
  const [editColor, setEditColor] = useState(COLORS[0]);
  const [renaming, setRenaming] = useState(false);

  // Member / course chip busy states
  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  const [busyCourseId, setBusyCourseId] = useState<string | null>(null);

  // Search
  const [userSearch, setUserSearch] = useState("");

  // Delete
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const cohortSnap = await getDoc(doc(db, "cohorts", cohortId));
      if (!cohortSnap.exists()) {
        router.push("/admin/cohorts");
        return;
      }
      const cohortData = { id: cohortSnap.id, ...cohortSnap.data() } as Cohort;
      setCohort(cohortData);
      setEditName(cohortData.name);
      setEditTag(cohortData.tag);
      setEditColor(cohortData.color || COLORS[0]);

      const [uSnap, cSnap] = await Promise.all([
        getDocs(collection(db, "users")),
        getDocs(collection(db, "courses")),
      ]);

      setUsers(
        uSnap.docs.map((d) => {
          const data = d.data() as AppUser;
          return {
            ...data,
            uid: d.id,
            cohortIds: Array.isArray(data.cohortIds) ? data.cohortIds : [],
          };
        })
      );

      setCourses(
        cSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Course))
      );
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load cohort");
    } finally {
      setLoading(false);
    }
  }, [cohortId, router]);

  useEffect(() => {
    load();
  }, [load]);

  // ── Rename ──────────────────────────────────────────────────────────────────
  const handleRename = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editName.trim() || !editTag.trim() || !cohort) return;
    setRenaming(true);
    setError(null);
    try {
      const updated: Partial<Cohort> = {
        name: editName.trim(),
        tag: editTag.trim().toLowerCase().replace(/\s+/g, "-"),
        color: editColor,
      };
      await updateDoc(doc(db, "cohorts", cohortId), updated);
      setCohort((prev) => (prev ? { ...prev, ...updated } : prev));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to rename cohort");
    } finally {
      setRenaming(false);
    }
  };

  // ── Toggle member ───────────────────────────────────────────────────────────
  const toggleMember = async (u: AppUser) => {
    setBusyUserId(u.uid);
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
      setError(err instanceof Error ? err.message : "Failed to update member");
    } finally {
      setBusyUserId(null);
    }
  };

  // ── Toggle course ───────────────────────────────────────────────────────────
  const toggleCourse = async (course: Course) => {
    if (!cohort) return;
    setBusyCourseId(course.id);
    setError(null);
    try {
      const has = (cohort.courseIds ?? []).includes(course.id);
      // Mirror the course builder's toggleCohortAccess:
      // update courses/{id}.assignedCohortIds AND cohorts/{id}.courseIds
      await updateDoc(doc(db, "courses", course.id), {
        assignedCohortIds: has ? arrayRemove(cohortId) : arrayUnion(cohortId),
      });
      await updateDoc(doc(db, "cohorts", cohortId), {
        courseIds: has ? arrayRemove(course.id) : arrayUnion(course.id),
      });
      setCohort((prev) =>
        prev
          ? {
              ...prev,
              courseIds: has
                ? (prev.courseIds ?? []).filter((id) => id !== course.id)
                : [...(prev.courseIds ?? []), course.id],
            }
          : prev
      );
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to update course");
    } finally {
      setBusyCourseId(null);
    }
  };

  // ── Delete ──────────────────────────────────────────────────────────────────
  const handleDelete = async () => {
    if (!cohort) return;
    const confirmed = window.confirm(
      `Delete cohort "${cohort.name}"? This cannot be undone. All member users and assigned courses will have this cohort removed.`
    );
    if (!confirmed) return;
    setDeleting(true);
    setError(null);
    try {
      // Best-effort: remove cohortId from all member users' cohortIds arrays
      const memberUsers = users.filter((u) =>
        (u.cohortIds ?? []).includes(cohortId)
      );
      await Promise.allSettled(
        memberUsers.map((u) =>
          updateDoc(doc(db, "users", u.uid), {
            cohortIds: arrayRemove(cohortId),
          })
        )
      );

      // Best-effort: remove cohortId from assigned courses' assignedCohortIds arrays
      const assignedCourses = courses.filter((c) =>
        (cohort.courseIds ?? []).includes(c.id)
      );
      await Promise.allSettled(
        assignedCourses.map((c) =>
          updateDoc(doc(db, "courses", c.id), {
            assignedCohortIds: arrayRemove(cohortId),
          })
        )
      );

      // Delete the cohort doc itself
      await deleteDoc(doc(db, "cohorts", cohortId));

      router.push("/admin/cohorts");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to delete cohort");
      setDeleting(false);
    }
  };

  // ── Derived ─────────────────────────────────────────────────────────────────
  const memberCount = users.filter((u) =>
    (u.cohortIds ?? []).includes(cohortId)
  ).length;

  const filteredUsers = users.filter(
    (u) =>
      !userSearch ||
      u.name?.toLowerCase().includes(userSearch.toLowerCase()) ||
      u.email?.toLowerCase().includes(userSearch.toLowerCase())
  );

  if (loading) {
    return (
      <AdminShell>
        <div className="flex justify-center py-20">
          <Spinner />
        </div>
      </AdminShell>
    );
  }

  if (!cohort) return null;

  const cohortColor = cohort.color || "#2C7A6B";

  return (
    <AdminShell>
      {/* Page hero band */}
      <div className="page-hero flex flex-col sm:flex-row sm:items-end gap-4 mb-6">
        <div className="flex-1 min-w-0">
          <span className="kicker">ADMIN · COHORTS</span>
          <div className="flex items-center gap-3 mt-0.5">
            <span
              className="inline-block w-3 h-3 rounded-full flex-shrink-0"
              style={{ backgroundColor: cohortColor }}
            />
            <h1 className="font-serif-brand text-2xl sm:text-3xl font-normal text-white leading-tight truncate">
              {cohort.name}
            </h1>
          </div>
          <p className="mt-1 text-sm" style={{ color: "#CFE0D5" }}>
            <span className="font-mono">{cohort.tag}</span>
            {" · "}
            {memberCount} member{memberCount !== 1 ? "s" : ""}
          </p>
        </div>
        <button
          onClick={() => router.push("/admin/cohorts")}
          className="btn-secondary text-xs self-start sm:self-auto flex-shrink-0"
        >
          &larr; All Cohorts
        </button>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          {error}
        </div>
      )}

      {/* ── Rename card ─────────────────────────────────────────────────────── */}
      <form onSubmit={handleRename} className="card mb-4 space-y-3">
        <h2 className="font-medium" style={{ color: "#1E302C" }}>Rename cohort</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <input
            className="input-field"
            placeholder="Cohort name"
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            required
          />
          <input
            className="input-field"
            placeholder="Tag (slug)"
            value={editTag}
            onChange={(e) => setEditTag(e.target.value)}
            required
          />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs" style={{ color: "#5E6E69" }}>Color:</span>
          {COLORS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setEditColor(c)}
              className={`w-6 h-6 rounded-full border-2 ${
                editColor === c ? "border-brand-ink" : "border-transparent"
              }`}
              style={{ backgroundColor: c }}
              aria-label={`color ${c}`}
            />
          ))}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="submit"
            disabled={renaming}
            className="btn-primary text-xs"
          >
            {renaming ? "Saving…" : "Save changes"}
          </button>
          <button
            type="button"
            disabled={deleting}
            onClick={handleDelete}
            className="btn-secondary text-xs !border-red-300 !text-red-600 hover:!bg-red-50"
          >
            {deleting ? "Deleting…" : "Delete cohort"}
          </button>
        </div>
      </form>

      {/* ── Members card ────────────────────────────────────────────────────── */}
      <div className="card mb-4">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-4">
          <div className="flex-1">
            <h2 className="font-medium" style={{ color: "#1E302C" }}>
              Members
              <span
                className="ml-2 px-2 py-0.5 rounded-full text-xs font-semibold"
                style={{ backgroundColor: "#E7F1DE", color: "#13403A" }}
              >
                {memberCount}
              </span>
            </h2>
            <p className="text-xs mt-0.5" style={{ color: "#5E6E69" }}>
              Toggle a user chip to add or remove them from this cohort.
            </p>
          </div>
          <input
            className="input-field sm:max-w-xs text-sm"
            placeholder="Search name or email…"
            value={userSearch}
            onChange={(e) => setUserSearch(e.target.value)}
          />
        </div>

        {filteredUsers.length === 0 ? (
          <p className="text-sm py-4 text-center" style={{ color: "#5E6E69" }}>
            No users found.
          </p>
        ) : (
          <div className="space-y-2">
            {filteredUsers.map((u) => {
              const isMember = (u.cohortIds ?? []).includes(cohortId);
              return (
                <div
                  key={u.uid}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-lg border transition-colors"
                  style={{
                    borderColor: isMember ? cohortColor : "#DDE6DF",
                    backgroundColor: isMember ? "#F5F7F4" : "white",
                  }}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span
                        className="font-medium text-sm truncate"
                        style={{ color: "#1E302C" }}
                      >
                        {u.name || u.email}
                      </span>
                      <Badge
                        label={u.role}
                        variant={u.role === "admin" ? "success" : "default"}
                      />
                    </div>
                    <p className="text-xs truncate" style={{ color: "#5E6E69" }}>
                      {u.email}
                    </p>
                  </div>
                  <button
                    disabled={busyUserId === u.uid}
                    onClick={() => toggleMember(u)}
                    className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors flex-shrink-0 ${
                      isMember ? "text-white" : "bg-white hover:border-brand-teal"
                    }`}
                    style={
                      isMember
                        ? { backgroundColor: cohortColor, borderColor: cohortColor }
                        : { borderColor: "#DDE6DF", color: "#5E6E69" }
                    }
                    title={isMember ? "Remove from cohort" : "Add to cohort"}
                  >
                    {busyUserId === u.uid
                      ? "…"
                      : isMember
                      ? "Member"
                      : "Add"}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Courses card ────────────────────────────────────────────────────── */}
      <div className="card">
        <div className="mb-4">
          <h2 className="font-medium" style={{ color: "#1E302C" }}>
            Courses
            <span
              className="ml-2 px-2 py-0.5 rounded-full text-xs font-semibold"
              style={{ backgroundColor: "#E7F1DE", color: "#13403A" }}
            >
              {(cohort.courseIds ?? []).length}
            </span>
          </h2>
          <p className="text-xs mt-0.5" style={{ color: "#5E6E69" }}>
            Toggle a course to grant or revoke access for this cohort.
            Changes mirror the course builder&apos;s cohort access panel.
          </p>
        </div>

        {courses.length === 0 ? (
          <p className="text-sm py-4 text-center" style={{ color: "#5E6E69" }}>
            No courses found. Create courses first.
          </p>
        ) : (
          <div className="space-y-2">
            {courses.map((course) => {
              const assigned = (cohort.courseIds ?? []).includes(course.id);
              return (
                <div
                  key={course.id}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-lg border transition-colors"
                  style={{
                    borderColor: assigned ? "#8FB85C" : "#DDE6DF",
                    backgroundColor: assigned ? "#F5F7F4" : "white",
                  }}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span
                        className="font-medium text-sm truncate"
                        style={{ color: "#1E302C" }}
                      >
                        {course.title}
                      </span>
                      <Badge
                        label={course.status}
                        variant={
                          course.status === "published"
                            ? "success"
                            : course.status === "archived"
                            ? "default"
                            : "warning"
                        }
                      />
                    </div>
                    {course.description && (
                      <p
                        className="text-xs truncate"
                        style={{ color: "#5E6E69" }}
                      >
                        {course.description}
                      </p>
                    )}
                  </div>
                  <button
                    disabled={busyCourseId === course.id}
                    onClick={() => toggleCourse(course)}
                    className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors flex-shrink-0 ${
                      assigned ? "text-white" : "bg-white hover:border-brand-teal"
                    }`}
                    style={
                      assigned
                        ? { backgroundColor: "#8FB85C", borderColor: "#8FB85C" }
                        : { borderColor: "#DDE6DF", color: "#5E6E69" }
                    }
                    title={assigned ? "Revoke course access" : "Grant course access"}
                  >
                    {busyCourseId === course.id
                      ? "…"
                      : assigned
                      ? "Assigned"
                      : "Assign"}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </AdminShell>
  );
}
