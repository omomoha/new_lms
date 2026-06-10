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
