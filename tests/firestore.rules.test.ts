/**
 * Firestore Security Rules — Unit Tests
 *
 * Uses @firebase/rules-unit-testing against the Firestore emulator.
 * Run via:  npm run test:rules  (inside `firebase emulators:exec`, see CI)
 *
 * Pattern notes:
 * - ALL fixture data is seeded once in beforeAll, inside a single
 *   withSecurityRulesDisabled callback, BEFORE any other Firestore context
 *   is created. Creating the rules-disabled context after other contexts
 *   triggers "Firestore has already been started and its settings can no
 *   longer be changed".
 * - Tests only create authenticated/unauthenticated contexts and assert.
 */

import { describe, it, beforeAll, afterAll } from "vitest";
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
  RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { readFileSync } from "fs";
import { resolve } from "path";
import {
  doc,
  setDoc,
  getDoc,
  getDocs,
  updateDoc,
  deleteDoc,
  collection,
  query,
  where,
} from "firebase/firestore";

let testEnv: RulesTestEnvironment;

const RULES_PATH = resolve(__dirname, "../firestore.rules");

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: "andela-lms-test",
    firestore: {
      rules: readFileSync(RULES_PATH, "utf8"),
      host: "localhost",
      port: 8080,
    },
  });

  // Seed all fixtures FIRST, before any other context initializes Firestore.
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, "users", "learner-uid"), {
      uid: "learner-uid",
      role: "learner",
      cohortIds: ["cohort-mine"],
    });
    await setDoc(doc(db, "courses", "course-mine"), {
      title: "My Course",
      status: "published",
      assignedCohortIds: ["cohort-mine"],
    });
    await setDoc(doc(db, "courses", "course-other"), {
      title: "Other Course",
      status: "published",
      assignedCohortIds: ["cohort-other"],
    });
    await setDoc(doc(db, "courses", "course-open"), {
      title: "Open Course",
      status: "published",
      availability: "all",
      assignedCohortIds: [],
    });
    await setDoc(doc(db, "courses", "course-open-draft"), {
      title: "Open Draft",
      status: "draft",
      availability: "all",
      assignedCohortIds: [],
    });
    // Seeded progress doc (streak list-query test)
    await setDoc(doc(db, "progress", "learner-uid_lessonSeeded"), {
      userId: "learner-uid",
      lessonId: "lessonSeeded",
      courseId: "course-mine",
      completedAt: new Date(),
    });
    // Seeded flashcard (scheduling-field-update tests)
    await setDoc(doc(db, "flashcards", "card1"), {
      userId: "learner-uid",
      courseId: "course-mine",
      moduleId: null,
      front: "What is a closure?",
      back: "A function plus its lexical scope.",
      interval: 0,
      ease: 2.5,
      reps: 0,
      due: new Date(),
    });
    // Seeded lab grade (server-written; learners must not modify)
    await setDoc(doc(db, "labGrades", "learner-uid_lesson1"), {
      userId: "learner-uid",
      courseId: "course-mine",
      lessonId: "lesson1",
      score: 82,
      summary: "Good work",
      strengths: ["clear"],
      improvements: ["tests"],
    });

    // ── Forum fixtures (Phase 4 — Workstream B) ───────────────────────────────
    await setDoc(doc(db, "forumCategories", "cat-all"), {
      name: "General",
      description: "Open to everyone",
      order: 0,
      visibility: "all",
      cohortIds: [],
    });
    await setDoc(doc(db, "forumCategories", "cat-mine"), {
      name: "My Cohort",
      description: "Cohort-scoped",
      order: 1,
      visibility: "cohort",
      cohortIds: ["cohort-mine"],
    });
    await setDoc(doc(db, "forumCategories", "cat-other"), {
      name: "Other Cohort",
      description: "Not mine",
      order: 2,
      visibility: "cohort",
      cohortIds: ["cohort-other"],
    });
    // An open thread by the learner.
    await setDoc(doc(db, "forumThreads", "thread-open"), {
      categoryId: "cat-all",
      authorId: "learner-uid",
      authorName: "Ada",
      title: "Hello",
      body: "First post",
      pinned: false,
      locked: false,
      replyCount: 0,
      createdAt: new Date(),
      lastReplyAt: new Date(),
    });
    // A locked thread by someone else.
    await setDoc(doc(db, "forumThreads", "thread-locked"), {
      categoryId: "cat-all",
      authorId: "other-uid",
      authorName: "Grace",
      title: "Locked topic",
      body: "No replies allowed",
      pinned: false,
      locked: true,
      replyCount: 0,
      createdAt: new Date(),
      lastReplyAt: new Date(),
    });
    // An existing post under the open thread (author = learner).
    await setDoc(doc(db, "forumThreads", "thread-open", "posts", "post-1"), {
      authorId: "learner-uid",
      authorName: "Ada",
      body: "my reply",
      parentId: null,
      createdAt: new Date(),
    });
    // settings/features flag doc (any authed user may read it).
    await setDoc(doc(db, "settings", "features"), {
      communityForum: true,
      tutorEnhancements: false,
      analyticsDashboard: true,
    });
    // analytics/ pre-aggregated docs (admin-read only, server-write only).
    await setDoc(doc(db, "analytics", "overview"), {
      totals: { learners: 3 },
      completion: { completionPct: 42 },
    });
    await setDoc(doc(db, "analytics", "course_course-mine"), {
      title: "My Course",
      completionPct: 50,
    });
  });
});

afterAll(async () => {
  await testEnv.cleanup();
});

// ── (i) Unauthenticated read denied ─────────────────────────────────────────
describe("unauthenticated access", () => {
  it("denies read to courses collection", async () => {
    const unauthed = testEnv.unauthenticatedContext();
    await assertFails(getDoc(doc(unauthed.firestore(), "courses", "course-mine")));
  });

  it("denies read to users collection", async () => {
    const unauthed = testEnv.unauthenticatedContext();
    await assertFails(getDoc(doc(unauthed.firestore(), "users", "learner-uid")));
  });
});

// ── (ii) Learner cannot write to courses ────────────────────────────────────
describe("learner cannot write courses", () => {
  it("denies learner write to courses", async () => {
    const learner = testEnv.authenticatedContext("learner-uid", { role: "learner" });
    await assertFails(
      setDoc(doc(learner.firestore(), "courses", "course-mine"), {
        title: "Hacked Course",
        status: "published",
      })
    );
  });
});

// ── (iii) Learner cannot read another user's progress doc ───────────────────
describe("learner progress isolation", () => {
  it("denies learner reading another user's progress", async () => {
    const learner = testEnv.authenticatedContext("learner-uid", { role: "learner" });
    await assertFails(
      getDoc(doc(learner.firestore(), "progress", "other-uid_lesson1"))
    );
  });

  it("allows learner reading their own progress", async () => {
    const learner = testEnv.authenticatedContext("learner-uid", { role: "learner" });
    await assertSucceeds(
      getDoc(doc(learner.firestore(), "progress", "learner-uid_lesson1"))
    );
  });

  it("allows learner LIST-querying their own progress by userId (streaks)", async () => {
    const learner = testEnv.authenticatedContext("learner-uid", { role: "learner" });
    await assertSucceeds(
      getDocs(
        query(
          collection(learner.firestore(), "progress"),
          where("userId", "==", "learner-uid")
        )
      )
    );
  });

  it("denies learner LIST-querying another user's progress", async () => {
    const learner = testEnv.authenticatedContext("learner-uid", { role: "learner" });
    await assertFails(
      getDocs(
        query(
          collection(learner.firestore(), "progress"),
          where("userId", "==", "other-uid")
        )
      )
    );
  });

  it("denies progress write that forges another userId", async () => {
    const learner = testEnv.authenticatedContext("learner-uid", { role: "learner" });
    await assertFails(
      setDoc(doc(learner.firestore(), "progress", "learner-uid_lesson2"), {
        userId: "other-uid",
        lessonId: "lesson2",
        courseId: "course-mine",
      })
    );
  });
});

// ── (vi) lessonFeedback validation ──────────────────────────────────────────
describe("lessonFeedback rules", () => {
  it("allows owner writing valid feedback", async () => {
    const learner = testEnv.authenticatedContext("learner-uid", { role: "learner" });
    await assertSucceeds(
      setDoc(doc(learner.firestore(), "lessonFeedback", "learner-uid_lesson1"), {
        userId: "learner-uid",
        lessonId: "lesson1",
        courseId: "course-mine",
        rating: 4,
        comment: "Great lesson",
      })
    );
  });

  it("denies out-of-range rating", async () => {
    const learner = testEnv.authenticatedContext("learner-uid", { role: "learner" });
    await assertFails(
      setDoc(doc(learner.firestore(), "lessonFeedback", "learner-uid_lesson1"), {
        userId: "learner-uid",
        lessonId: "lesson1",
        courseId: "course-mine",
        rating: 7,
        comment: "",
      })
    );
  });

  it("denies writing feedback under another user's doc id", async () => {
    const learner = testEnv.authenticatedContext("learner-uid", { role: "learner" });
    await assertFails(
      setDoc(doc(learner.firestore(), "lessonFeedback", "other-uid_lesson1"), {
        userId: "other-uid",
        lessonId: "lesson1",
        courseId: "course-mine",
        rating: 1,
        comment: "",
      })
    );
  });

  it("allows owner get of their not-yet-written feedback doc", async () => {
    const learner = testEnv.authenticatedContext("learner-uid", { role: "learner" });
    await assertSucceeds(
      getDoc(doc(learner.firestore(), "lessonFeedback", "learner-uid_lessonNew"))
    );
  });
});

// ── (vii) labGrades: server-written only ────────────────────────────────────
describe("labGrades rules", () => {
  it("allows learner reading their own grade", async () => {
    const learner = testEnv.authenticatedContext("learner-uid", { role: "learner" });
    await assertSucceeds(
      getDoc(doc(learner.firestore(), "labGrades", "learner-uid_lesson1"))
    );
  });

  it("allows owner get of a not-yet-graded submission doc", async () => {
    const learner = testEnv.authenticatedContext("learner-uid", { role: "learner" });
    await assertSucceeds(
      getDoc(doc(learner.firestore(), "labGrades", "learner-uid_lessonNew"))
    );
  });

  it("denies learner forging/overwriting a grade", async () => {
    const learner = testEnv.authenticatedContext("learner-uid", { role: "learner" });
    await assertFails(
      setDoc(doc(learner.firestore(), "labGrades", "learner-uid_lesson1"), {
        userId: "learner-uid",
        score: 100,
      })
    );
  });

  it("denies learner reading another user's grade", async () => {
    const learner = testEnv.authenticatedContext("learner-uid", { role: "learner" });
    await assertFails(
      getDoc(doc(learner.firestore(), "labGrades", "other-uid_lesson1"))
    );
  });
});

// ── (viii) flashcards: scheduling-only client updates ───────────────────────
describe("flashcards rules", () => {
  it("allows owner updating ONLY scheduling fields", async () => {
    const learner = testEnv.authenticatedContext("learner-uid", { role: "learner" });
    await assertSucceeds(
      updateDoc(doc(learner.firestore(), "flashcards", "card1"), {
        interval: 1,
        ease: 2.35,
        reps: 1,
        due: new Date(),
      })
    );
  });

  it("denies owner editing card content", async () => {
    const learner = testEnv.authenticatedContext("learner-uid", { role: "learner" });
    await assertFails(
      updateDoc(doc(learner.firestore(), "flashcards", "card1"), {
        front: "Tampered",
      })
    );
  });

  it("denies client creating flashcards", async () => {
    const learner = testEnv.authenticatedContext("learner-uid", { role: "learner" });
    await assertFails(
      setDoc(doc(learner.firestore(), "flashcards", "card-forged"), {
        userId: "learner-uid",
        front: "x",
        back: "y",
        interval: 0,
        ease: 2.5,
        reps: 0,
        due: new Date(),
      })
    );
  });

  it("allows owner list-querying their own cards", async () => {
    const learner = testEnv.authenticatedContext("learner-uid", { role: "learner" });
    await assertSucceeds(
      getDocs(
        query(
          collection(learner.firestore(), "flashcards"),
          where("userId", "==", "learner-uid")
        )
      )
    );
  });
});

// ── (ix) aiUsage: fully server-side ─────────────────────────────────────────
describe("aiUsage rules", () => {
  it("denies a user reading even their own usage doc", async () => {
    const learner = testEnv.authenticatedContext("learner-uid", { role: "learner" });
    await assertFails(
      getDoc(doc(learner.firestore(), "aiUsage", "learner-uid"))
    );
  });
});

// ── (iv) Learner module reads gated by cohort assignment ────────────────────
describe("learner module cohort restriction", () => {
  it("denies learner reading modules of a course not assigned to their cohort", async () => {
    const learner = testEnv.authenticatedContext("learner-uid", { role: "learner" });
    await assertFails(
      getDoc(doc(learner.firestore(), "courses", "course-other", "modules", "mod1"))
    );
  });

  it("allows learner reading modules of a course assigned to their cohort", async () => {
    const learner = testEnv.authenticatedContext("learner-uid", { role: "learner" });
    await assertSucceeds(
      getDoc(doc(learner.firestore(), "courses", "course-mine", "modules", "mod1"))
    );
  });
});

// ── (iv-b) availability: "all" opens published courses to any learner ───────
describe("course availability: all users", () => {
  it("allows an UNASSIGNED learner to read modules of an open course", async () => {
    const learner = testEnv.authenticatedContext("learner-uid", { role: "learner" });
    await assertSucceeds(
      getDoc(doc(learner.firestore(), "courses", "course-open", "modules", "mod1"))
    );
  });

  it("allows an unassigned learner to read lessons of an open course", async () => {
    const learner = testEnv.authenticatedContext("learner-uid", { role: "learner" });
    await assertSucceeds(
      getDoc(
        doc(learner.firestore(), "courses", "course-open", "modules", "mod1", "lessons", "l1")
      )
    );
  });

  it("allows an unassigned learner to write their enrollment on an open course", async () => {
    const learner = testEnv.authenticatedContext("learner-uid", { role: "learner" });
    await assertSucceeds(
      setDoc(doc(learner.firestore(), "enrollments", "learner-uid_course-open"), {
        userId: "learner-uid",
        courseId: "course-open",
        cohortId: "",
        progressPct: 10,
        lastLessonId: null,
        updatedAt: new Date(),
      })
    );
  });

  it("still denies a DRAFT open course", async () => {
    const learner = testEnv.authenticatedContext("learner-uid", { role: "learner" });
    await assertFails(
      getDoc(doc(learner.firestore(), "courses", "course-open-draft", "modules", "mod1"))
    );
  });

  it("still denies cohort-restricted courses to outsiders", async () => {
    const learner = testEnv.authenticatedContext("learner-uid", { role: "learner" });
    await assertFails(
      getDoc(doc(learner.firestore(), "courses", "course-other", "modules", "mod1"))
    );
  });
});

// ── (v) Admin (claim) can write courses ─────────────────────────────────────
describe("admin can write courses", () => {
  it("allows admin to create a course", async () => {
    const admin = testEnv.authenticatedContext("admin-uid", { role: "admin" });
    await assertSucceeds(
      setDoc(doc(admin.firestore(), "courses", "new-course"), {
        title: "New Course",
        status: "draft",
        assignedCohortIds: [],
        moduleOrder: [],
        createdAt: new Date(),
      })
    );
  });

  it("allows admin to update a course", async () => {
    const admin = testEnv.authenticatedContext("admin-uid", { role: "admin" });
    await assertSucceeds(
      setDoc(
        doc(admin.firestore(), "courses", "new-course"),
        { status: "published" },
        { merge: true }
      )
    );
  });
});

// ── (x) settings/features readable by any authed user ───────────────────────
describe("settings/features flag", () => {
  it("allows a learner to read the feature-flag doc", async () => {
    const learner = testEnv.authenticatedContext("learner-uid", { role: "learner" });
    await assertSucceeds(
      getDoc(doc(learner.firestore(), "settings", "features"))
    );
  });

  it("denies a learner reading any other settings doc", async () => {
    const learner = testEnv.authenticatedContext("learner-uid", { role: "learner" });
    await assertFails(
      getDoc(doc(learner.firestore(), "settings", "certificate"))
    );
  });

  it("denies a learner writing the feature-flag doc", async () => {
    const learner = testEnv.authenticatedContext("learner-uid", { role: "learner" });
    await assertFails(
      setDoc(doc(learner.firestore(), "settings", "features"), { communityForum: false })
    );
  });
});

// ── (xi) Forum category visibility ──────────────────────────────────────────
describe("forum category visibility", () => {
  it('allows any learner to read an "all" category', async () => {
    const learner = testEnv.authenticatedContext("learner-uid", { role: "learner" });
    await assertSucceeds(
      getDoc(doc(learner.firestore(), "forumCategories", "cat-all"))
    );
  });

  it("allows a learner to read a cohort category they belong to", async () => {
    const learner = testEnv.authenticatedContext("learner-uid", { role: "learner" });
    await assertSucceeds(
      getDoc(doc(learner.firestore(), "forumCategories", "cat-mine"))
    );
  });

  it("denies a learner reading a cohort category they do NOT belong to", async () => {
    const learner = testEnv.authenticatedContext("learner-uid", { role: "learner" });
    await assertFails(
      getDoc(doc(learner.firestore(), "forumCategories", "cat-other"))
    );
  });

  it("denies a learner creating/managing categories", async () => {
    const learner = testEnv.authenticatedContext("learner-uid", { role: "learner" });
    await assertFails(
      setDoc(doc(learner.firestore(), "forumCategories", "cat-forged"), {
        name: "Hax",
        visibility: "all",
        order: 0,
      })
    );
  });

  it("allows an admin to manage categories", async () => {
    const admin = testEnv.authenticatedContext("admin-uid", { role: "admin" });
    await assertSucceeds(
      setDoc(doc(admin.firestore(), "forumCategories", "cat-new"), {
        name: "Announcements",
        description: "",
        order: 9,
        visibility: "all",
        cohortIds: [],
      })
    );
  });
});

// ── (xii) Forum threads ─────────────────────────────────────────────────────
describe("forum threads", () => {
  it("allows any authed user to read a thread", async () => {
    const learner = testEnv.authenticatedContext("learner-uid", { role: "learner" });
    await assertSucceeds(
      getDoc(doc(learner.firestore(), "forumThreads", "thread-open"))
    );
  });

  it("allows a learner to create a thread authored as themselves", async () => {
    const learner = testEnv.authenticatedContext("learner-uid", { role: "learner" });
    await assertSucceeds(
      setDoc(doc(learner.firestore(), "forumThreads", "thread-new"), {
        categoryId: "cat-all",
        authorId: "learner-uid",
        authorName: "Ada",
        title: "New topic",
        body: "Body text",
        pinned: false,
        locked: false,
        replyCount: 0,
        createdAt: new Date(),
        lastReplyAt: new Date(),
      })
    );
  });

  it("denies creating a thread that forges a pinned flag", async () => {
    const learner = testEnv.authenticatedContext("learner-uid", { role: "learner" });
    await assertFails(
      setDoc(doc(learner.firestore(), "forumThreads", "thread-forge"), {
        categoryId: "cat-all",
        authorId: "learner-uid",
        authorName: "Ada",
        title: "x",
        body: "y",
        pinned: true,
        locked: false,
        replyCount: 0,
        createdAt: new Date(),
        lastReplyAt: new Date(),
      })
    );
  });

  it("denies creating a thread authored as someone else", async () => {
    const learner = testEnv.authenticatedContext("learner-uid", { role: "learner" });
    await assertFails(
      setDoc(doc(learner.firestore(), "forumThreads", "thread-spoof"), {
        categoryId: "cat-all",
        authorId: "other-uid",
        authorName: "Grace",
        title: "x",
        body: "y",
        pinned: false,
        locked: false,
        replyCount: 0,
        createdAt: new Date(),
        lastReplyAt: new Date(),
      })
    );
  });

  it("allows the author to edit their own thread title/body", async () => {
    const learner = testEnv.authenticatedContext("learner-uid", { role: "learner" });
    await assertSucceeds(
      updateDoc(doc(learner.firestore(), "forumThreads", "thread-open"), {
        title: "Hello (edited)",
        body: "First post, revised",
        editedAt: new Date(),
      })
    );
  });

  it("denies a non-author learner editing a thread", async () => {
    const learner = testEnv.authenticatedContext("learner-uid", { role: "learner" });
    await assertFails(
      updateDoc(doc(learner.firestore(), "forumThreads", "thread-locked"), {
        title: "tamper",
        body: "tamper",
        editedAt: new Date(),
      })
    );
  });

  it("denies a learner pinning/locking (admin-only fields)", async () => {
    const learner = testEnv.authenticatedContext("learner-uid", { role: "learner" });
    await assertFails(
      updateDoc(doc(learner.firestore(), "forumThreads", "thread-open"), {
        pinned: true,
      })
    );
  });

  it("allows an admin to pin/lock a thread", async () => {
    const admin = testEnv.authenticatedContext("admin-uid", { role: "admin" });
    await assertSucceeds(
      updateDoc(doc(admin.firestore(), "forumThreads", "thread-open"), {
        pinned: true,
        locked: true,
      })
    );
    // restore for other tests (so the lock test below still sees it unlocked)
    await updateDoc(doc(admin.firestore(), "forumThreads", "thread-open"), {
      pinned: false,
      locked: false,
    });
  });
});

// ── (xiii) Forum posts + lock enforcement at the rules layer ────────────────
describe("forum posts", () => {
  it("allows a learner to reply to an UNlocked thread", async () => {
    const learner = testEnv.authenticatedContext("learner-uid", { role: "learner" });
    await assertSucceeds(
      setDoc(
        doc(learner.firestore(), "forumThreads", "thread-open", "posts", "post-new"),
        {
          authorId: "learner-uid",
          authorName: "Ada",
          body: "another reply",
          parentId: null,
          createdAt: new Date(),
        }
      )
    );
  });

  it("DENIES replying to a LOCKED thread (rules-layer lock enforcement)", async () => {
    const learner = testEnv.authenticatedContext("learner-uid", { role: "learner" });
    await assertFails(
      setDoc(
        doc(learner.firestore(), "forumThreads", "thread-locked", "posts", "p-x"),
        {
          authorId: "learner-uid",
          authorName: "Ada",
          body: "sneaky",
          parentId: null,
          createdAt: new Date(),
        }
      )
    );
  });

  it("allows the author to edit their own post body", async () => {
    const learner = testEnv.authenticatedContext("learner-uid", { role: "learner" });
    await assertSucceeds(
      updateDoc(
        doc(learner.firestore(), "forumThreads", "thread-open", "posts", "post-1"),
        { body: "my reply (edited)", editedAt: new Date() }
      )
    );
  });

  it("allows any authed user to toggle a reaction (reactions-only diff)", async () => {
    const other = testEnv.authenticatedContext("admin-uid", { role: "admin" });
    await assertSucceeds(
      updateDoc(
        doc(other.firestore(), "forumThreads", "thread-open", "posts", "post-1"),
        { reactions: { "👍": ["admin-uid"] } }
      )
    );
  });

  it("denies a non-author editing someone else's post body", async () => {
    const other = testEnv.authenticatedContext("other-uid", { role: "learner" });
    await assertFails(
      updateDoc(
        doc(other.firestore(), "forumThreads", "thread-open", "posts", "post-1"),
        { body: "hijacked", editedAt: new Date() }
      )
    );
  });

  it("allows the author to delete their own post", async () => {
    const learner = testEnv.authenticatedContext("learner-uid", { role: "learner" });
    await assertSucceeds(
      deleteDoc(
        doc(learner.firestore(), "forumThreads", "thread-open", "posts", "post-new")
      )
    );
  });
});

// ── (xiv) Forum reports ─────────────────────────────────────────────────────
describe("forum reports", () => {
  it("allows a learner to file a report attributed to themselves", async () => {
    const learner = testEnv.authenticatedContext("learner-uid", { role: "learner" });
    await assertSucceeds(
      setDoc(doc(learner.firestore(), "forumReports", "report-1"), {
        reporterId: "learner-uid",
        reporterName: "Ada",
        threadId: "thread-open",
        postId: null,
        reason: "spam",
        resolved: false,
        createdAt: new Date(),
      })
    );
  });

  it("denies filing a report attributed to another user", async () => {
    const learner = testEnv.authenticatedContext("learner-uid", { role: "learner" });
    await assertFails(
      setDoc(doc(learner.firestore(), "forumReports", "report-spoof"), {
        reporterId: "other-uid",
        reporterName: "Grace",
        threadId: "thread-open",
        reason: "x",
        resolved: false,
        createdAt: new Date(),
      })
    );
  });

  it("denies a learner reading the moderation queue", async () => {
    const learner = testEnv.authenticatedContext("learner-uid", { role: "learner" });
    await assertFails(
      getDocs(
        query(
          collection(learner.firestore(), "forumReports"),
          where("resolved", "==", false)
        )
      )
    );
  });

  it("allows an admin to read and resolve a report", async () => {
    const admin = testEnv.authenticatedContext("admin-uid", { role: "admin" });
    await assertSucceeds(
      getDoc(doc(admin.firestore(), "forumReports", "report-1"))
    );
    await assertSucceeds(
      updateDoc(doc(admin.firestore(), "forumReports", "report-1"), {
        resolved: true,
      })
    );
  });
});

// ── analytics/ (Phase 4 — Workstream D) ─────────────────────────────────────
// Pre-aggregated leadership metrics: admin-read only, server-write only.
describe("analytics aggregates", () => {
  it("allows an admin to read the overview doc", async () => {
    const admin = testEnv.authenticatedContext("admin-uid", { role: "admin" });
    await assertSucceeds(getDoc(doc(admin.firestore(), "analytics", "overview")));
  });

  it("allows an admin to read a per-course aggregate", async () => {
    const admin = testEnv.authenticatedContext("admin-uid", { role: "admin" });
    await assertSucceeds(
      getDoc(doc(admin.firestore(), "analytics", "course_course-mine"))
    );
  });

  it("denies a learner reading analytics docs", async () => {
    const learner = testEnv.authenticatedContext("learner-uid", { role: "learner" });
    await assertFails(getDoc(doc(learner.firestore(), "analytics", "overview")));
  });

  it("denies an unauthenticated user reading analytics docs", async () => {
    const unauthed = testEnv.unauthenticatedContext();
    await assertFails(getDoc(doc(unauthed.firestore(), "analytics", "overview")));
  });

  it("denies an admin writing analytics docs (server-side only)", async () => {
    const admin = testEnv.authenticatedContext("admin-uid", { role: "admin" });
    await assertFails(
      setDoc(doc(admin.firestore(), "analytics", "overview"), { totals: { learners: 9 } })
    );
  });

  it("denies a learner writing analytics docs", async () => {
    const learner = testEnv.authenticatedContext("learner-uid", { role: "learner" });
    await assertFails(
      setDoc(doc(learner.firestore(), "analytics", "course_course-mine"), { completionPct: 1 })
    );
  });
});
