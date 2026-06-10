/**
 * Unit tests — discussion threading + delete-permission utilities
 */

import { describe, it, expect } from "vitest";
import { buildThreads, canDelete, type DiscussionDoc } from "../src/lib/discussions";

/** Build a DiscussionDoc with sensible defaults; override what the test cares about. */
function makeDoc(
  overrides: Partial<DiscussionDoc> & { id: string }
): DiscussionDoc {
  return {
    courseId: "c1",
    lessonId: "l1",
    userId: "u1",
    userName: "Ada",
    body: "Hello",
    parentId: null,
    createdAtMillis: 1_000,
    ...overrides,
  };
}

describe("buildThreads", () => {
  it("returns an empty array for empty input", () => {
    expect(buildThreads([])).toEqual([]);
  });

  it("sorts top-level posts newest-first", () => {
    const docs = [
      makeDoc({ id: "old", createdAtMillis: 1_000 }),
      makeDoc({ id: "new", createdAtMillis: 3_000 }),
      makeDoc({ id: "mid", createdAtMillis: 2_000 }),
    ];
    const threads = buildThreads(docs);
    expect(threads.map((t) => t.post.id)).toEqual(["new", "mid", "old"]);
  });

  it("sorts replies oldest-first under their parent", () => {
    const docs = [
      makeDoc({ id: "q1", createdAtMillis: 1_000 }),
      makeDoc({ id: "r-late", parentId: "q1", createdAtMillis: 5_000 }),
      makeDoc({ id: "r-early", parentId: "q1", createdAtMillis: 2_000 }),
      makeDoc({ id: "r-mid", parentId: "q1", createdAtMillis: 3_000 }),
    ];
    const threads = buildThreads(docs);
    expect(threads).toHaveLength(1);
    expect(threads[0]!.replies.map((r) => r.id)).toEqual([
      "r-early",
      "r-mid",
      "r-late",
    ]);
  });

  it("attaches replies to the correct parent across multiple threads", () => {
    const docs = [
      makeDoc({ id: "q1", createdAtMillis: 1_000 }),
      makeDoc({ id: "q2", createdAtMillis: 2_000 }),
      makeDoc({ id: "r1", parentId: "q1", createdAtMillis: 3_000 }),
      makeDoc({ id: "r2", parentId: "q2", createdAtMillis: 4_000 }),
    ];
    const threads = buildThreads(docs);
    expect(threads.map((t) => t.post.id)).toEqual(["q2", "q1"]);
    expect(threads[0]!.replies.map((r) => r.id)).toEqual(["r2"]);
    expect(threads[1]!.replies.map((r) => r.id)).toEqual(["r1"]);
  });

  it("drops replies whose parent is missing from the input", () => {
    const docs = [
      makeDoc({ id: "q1", createdAtMillis: 1_000 }),
      makeDoc({ id: "orphan", parentId: "deleted-question", createdAtMillis: 2_000 }),
    ];
    const threads = buildThreads(docs);
    expect(threads).toHaveLength(1);
    expect(threads[0]!.replies).toEqual([]);
  });

  it("drops replies that point at another reply (no nesting)", () => {
    const docs = [
      makeDoc({ id: "q1", createdAtMillis: 1_000 }),
      makeDoc({ id: "r1", parentId: "q1", createdAtMillis: 2_000 }),
      makeDoc({ id: "nested", parentId: "r1", createdAtMillis: 3_000 }),
    ];
    const threads = buildThreads(docs);
    expect(threads).toHaveLength(1);
    expect(threads[0]!.replies.map((r) => r.id)).toEqual(["r1"]);
  });

  it("sorts threads with null createdAtMillis last (pending server timestamp)", () => {
    const docs = [
      makeDoc({ id: "pending", createdAtMillis: null }),
      makeDoc({ id: "newest", createdAtMillis: 9_000 }),
      makeDoc({ id: "oldest", createdAtMillis: 1_000 }),
    ];
    const threads = buildThreads(docs);
    expect(threads.map((t) => t.post.id)).toEqual(["newest", "oldest", "pending"]);
  });

  it("sorts replies with null createdAtMillis last (they are the newest)", () => {
    const docs = [
      makeDoc({ id: "q1", createdAtMillis: 1_000 }),
      makeDoc({ id: "r-pending", parentId: "q1", createdAtMillis: null }),
      makeDoc({ id: "r-old", parentId: "q1", createdAtMillis: 2_000 }),
    ];
    const threads = buildThreads(docs);
    expect(threads[0]!.replies.map((r) => r.id)).toEqual(["r-old", "r-pending"]);
  });

  it("orders deterministically (by id) when timestamps tie", () => {
    const docs = [
      makeDoc({ id: "b", createdAtMillis: 1_000 }),
      makeDoc({ id: "a", createdAtMillis: 1_000 }),
    ];
    const threads = buildThreads(docs);
    expect(threads.map((t) => t.post.id)).toEqual(["a", "b"]);
  });
});

describe("canDelete", () => {
  it("allows the author to delete their own post", () => {
    expect(canDelete({ uid: "u1", role: "learner" }, { userId: "u1" })).toBe(true);
  });

  it("denies a learner deleting someone else's post", () => {
    expect(canDelete({ uid: "u1", role: "learner" }, { userId: "u2" })).toBe(false);
  });

  it("allows an admin to delete anyone's post", () => {
    expect(canDelete({ uid: "admin-1", role: "admin" }, { userId: "u2" })).toBe(true);
  });

  it("allows deletion of own post even with no role set", () => {
    expect(canDelete({ uid: "u1" }, { userId: "u1" })).toBe(true);
  });

  it("denies when viewer uid is empty even if post userId is empty", () => {
    expect(canDelete({ uid: "" }, { userId: "" })).toBe(false);
  });
});
