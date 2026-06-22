/**
 * Unit tests — community-forum pure helpers (src/lib/forum.ts) and the shared
 * threading module (src/lib/threading.ts) that both the forum and per-lesson
 * discussions build on. Mirrors tests/discussions.test.ts for the forum shapes.
 */

import { describe, it, expect } from "vitest";
import {
  buildThreadTree,
  isAuthorOrAdmin,
  type ThreadNode,
} from "../src/lib/threading";
import {
  canViewCategory,
  visibleCategories,
  sortThreads,
  buildPostThreads,
  sortPostsChronological,
  canModerate,
  canAdminister,
  canEdit,
  extractMentions,
  searchThreads,
  EDIT_WINDOW_MS,
  type ForumCategoryDoc,
  type ForumPostDoc,
  type ForumThreadDoc,
} from "../src/lib/forum";

// ── Shared threading (generic) ───────────────────────────────────────────────

function node(over: Partial<ThreadNode> & { id: string }): ThreadNode {
  return { parentId: null, createdAtMillis: 1_000, ...over };
}

describe("buildThreadTree (shared)", () => {
  it("returns empty for empty input", () => {
    expect(buildThreadTree([])).toEqual([]);
  });

  it("sorts top-level newest-first, replies oldest-first, drops orphans", () => {
    const docs = [
      node({ id: "q-old", createdAtMillis: 1_000 }),
      node({ id: "q-new", createdAtMillis: 3_000 }),
      node({ id: "r-late", parentId: "q-new", createdAtMillis: 9_000 }),
      node({ id: "r-early", parentId: "q-new", createdAtMillis: 4_000 }),
      node({ id: "orphan", parentId: "missing", createdAtMillis: 5_000 }),
      node({ id: "nested", parentId: "r-late", createdAtMillis: 6_000 }),
    ];
    const tree = buildThreadTree(docs);
    expect(tree.map((t) => t.post.id)).toEqual(["q-new", "q-old"]);
    expect(tree[0]!.replies.map((r) => r.id)).toEqual(["r-early", "r-late"]);
  });

  it("sorts null timestamps last", () => {
    const docs = [
      node({ id: "pending", createdAtMillis: null }),
      node({ id: "newest", createdAtMillis: 9_000 }),
    ];
    expect(buildThreadTree(docs).map((t) => t.post.id)).toEqual([
      "newest",
      "pending",
    ]);
  });
});

describe("isAuthorOrAdmin", () => {
  it("author can modify own", () => {
    expect(isAuthorOrAdmin({ uid: "u1" }, { authorId: "u1" })).toBe(true);
  });
  it("admin can modify anyone", () => {
    expect(isAuthorOrAdmin({ uid: "x", role: "admin" }, { authorId: "u2" })).toBe(true);
  });
  it("non-author non-admin cannot", () => {
    expect(isAuthorOrAdmin({ uid: "u1" }, { authorId: "u2" })).toBe(false);
  });
  it("empty uid denied even against empty author", () => {
    expect(isAuthorOrAdmin({ uid: "" }, { authorId: "" })).toBe(false);
  });
});

// ── Category visibility ──────────────────────────────────────────────────────

function cat(over: Partial<ForumCategoryDoc> & { id: string }): ForumCategoryDoc {
  return {
    name: "General",
    description: "",
    order: 0,
    visibility: "all",
    ...over,
  };
}

describe("canViewCategory", () => {
  it('admin sees everything including cohort categories', () => {
    expect(
      canViewCategory({ role: "admin" }, { visibility: "cohort", cohortIds: ["c9"] })
    ).toBe(true);
  });
  it('any learner sees "all" categories', () => {
    expect(canViewCategory({ cohortIds: [] }, { visibility: "all" })).toBe(true);
  });
  it("cohort category visible only on cohort intersection", () => {
    expect(
      canViewCategory({ cohortIds: ["c1"] }, { visibility: "cohort", cohortIds: ["c1"] })
    ).toBe(true);
    expect(
      canViewCategory({ cohortIds: ["c2"] }, { visibility: "cohort", cohortIds: ["c1"] })
    ).toBe(false);
  });
  it("cohort category with no cohortIds is hidden from learners", () => {
    expect(
      canViewCategory({ cohortIds: ["c1"] }, { visibility: "cohort" })
    ).toBe(false);
  });
});

describe("visibleCategories", () => {
  it("filters by access and sorts by order then name", () => {
    const cats = [
      cat({ id: "b", name: "Beta", order: 1, visibility: "all" }),
      cat({ id: "a", name: "Alpha", order: 1, visibility: "all" }),
      cat({ id: "secret", name: "Secret", order: 0, visibility: "cohort", cohortIds: ["x"] }),
      cat({ id: "mine", name: "Mine", order: 0, visibility: "cohort", cohortIds: ["c1"] }),
    ];
    const out = visibleCategories({ cohortIds: ["c1"] }, cats);
    expect(out.map((c) => c.id)).toEqual(["mine", "a", "b"]);
  });
});

// ── Thread ordering + search ─────────────────────────────────────────────────

function thread(
  over: Partial<ForumThreadDoc> & { id: string }
): ForumThreadDoc {
  return {
    categoryId: "cat1",
    authorId: "u1",
    authorName: "Ada",
    title: "Title",
    body: "Body",
    pinned: false,
    locked: false,
    replyCount: 0,
    createdAtMillis: 1_000,
    lastReplyAtMillis: 1_000,
    ...over,
  };
}

describe("sortThreads", () => {
  it("pinned first, then by last activity newest-first", () => {
    const out = sortThreads([
      thread({ id: "a", lastReplyAtMillis: 5_000 }),
      thread({ id: "pinned-old", pinned: true, lastReplyAtMillis: 1_000 }),
      thread({ id: "b", lastReplyAtMillis: 8_000 }),
    ]);
    expect(out.map((t) => t.id)).toEqual(["pinned-old", "b", "a"]);
  });

  it("falls back to createdAt when lastReplyAt is null", () => {
    const out = sortThreads([
      thread({ id: "x", lastReplyAtMillis: null, createdAtMillis: 2_000 }),
      thread({ id: "y", lastReplyAtMillis: null, createdAtMillis: 5_000 }),
    ]);
    expect(out.map((t) => t.id)).toEqual(["y", "x"]);
  });
});

describe("searchThreads", () => {
  const threads = [
    thread({ id: "1", title: "Async/await in JS", body: "promises" }),
    thread({ id: "2", title: "CSS grid", body: "layout", tags: ["frontend"] }),
    thread({ id: "3", title: "Café tips", body: "résumé writing" }),
  ];
  it("empty query returns all", () => {
    expect(searchThreads(threads, "  ").map((t) => t.id)).toEqual(["1", "2", "3"]);
  });
  it("matches title, body, and tags case/diacritic-insensitively", () => {
    expect(searchThreads(threads, "PROMISES").map((t) => t.id)).toEqual(["1"]);
    expect(searchThreads(threads, "frontend").map((t) => t.id)).toEqual(["2"]);
    expect(searchThreads(threads, "cafe").map((t) => t.id)).toEqual(["3"]);
    expect(searchThreads(threads, "resume").map((t) => t.id)).toEqual(["3"]);
  });
});

// ── Posts ────────────────────────────────────────────────────────────────────

function post(over: Partial<ForumPostDoc> & { id: string }): ForumPostDoc {
  return {
    authorId: "u1",
    authorName: "Ada",
    body: "hi",
    parentId: null,
    createdAtMillis: 1_000,
    ...over,
  };
}

describe("forum posts", () => {
  it("sortPostsChronological is oldest-first with null last", () => {
    const out = sortPostsChronological([
      post({ id: "c", createdAtMillis: 3_000 }),
      post({ id: "pending", createdAtMillis: null }),
      post({ id: "a", createdAtMillis: 1_000 }),
    ]);
    expect(out.map((p) => p.id)).toEqual(["a", "c", "pending"]);
  });

  it("buildPostThreads groups single-level replies", () => {
    const tree = buildPostThreads([
      post({ id: "p1", createdAtMillis: 2_000 }),
      post({ id: "r1", parentId: "p1", createdAtMillis: 3_000 }),
      post({ id: "p0", createdAtMillis: 1_000 }),
    ]);
    expect(tree.map((t) => t.post.id)).toEqual(["p1", "p0"]);
    expect(tree[0]!.replies.map((r) => r.id)).toEqual(["r1"]);
  });
});

// ── Permissions ──────────────────────────────────────────────────────────────

describe("canModerate / canAdminister", () => {
  it("author or admin may moderate", () => {
    expect(canModerate({ uid: "u1" }, { authorId: "u1" })).toBe(true);
    expect(canModerate({ uid: "x", role: "admin" }, { authorId: "u1" })).toBe(true);
    expect(canModerate({ uid: "u2" }, { authorId: "u1" })).toBe(false);
  });
  it("only admins may administer", () => {
    expect(canAdminister({ role: "admin" })).toBe(true);
    expect(canAdminister({ role: "learner" })).toBe(false);
    expect(canAdminister({})).toBe(false);
  });
});

describe("canEdit (time-boxed)", () => {
  const now = 1_000_000;
  it("admin can always edit", () => {
    expect(
      canEdit({ uid: "x", role: "admin" }, { authorId: "u1", createdAtMillis: 0 }, now)
    ).toBe(true);
  });
  it("author can edit within the window", () => {
    expect(
      canEdit({ uid: "u1" }, { authorId: "u1", createdAtMillis: now - 1_000 }, now)
    ).toBe(true);
  });
  it("author cannot edit after the window", () => {
    expect(
      canEdit(
        { uid: "u1" },
        { authorId: "u1", createdAtMillis: now - EDIT_WINDOW_MS - 1 },
        now
      )
    ).toBe(false);
  });
  it("pending write (null createdAt) is editable by the author", () => {
    expect(
      canEdit({ uid: "u1" }, { authorId: "u1", createdAtMillis: null }, now)
    ).toBe(true);
  });
  it("non-author cannot edit", () => {
    expect(
      canEdit({ uid: "u2" }, { authorId: "u1", createdAtMillis: now }, now)
    ).toBe(false);
  });
});

// ── @mentions ────────────────────────────────────────────────────────────────

describe("extractMentions", () => {
  it("extracts handles after @, lowercased and de-duped", () => {
    expect(extractMentions("hey @Ada and @ada, also @bob.smith")).toEqual([
      "ada",
      "bob.smith",
    ]);
  });
  it("ignores @ mid-word (emails) and trims trailing punctuation", () => {
    expect(extractMentions("mail me at foo@bar.com")).toEqual([]);
    expect(extractMentions("thanks @grace!")).toEqual(["grace"]);
  });
  it("returns [] when there are no mentions", () => {
    expect(extractMentions("no mentions here")).toEqual([]);
  });
});
