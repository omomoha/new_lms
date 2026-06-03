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
import { doc, setDoc, getDoc } from "firebase/firestore";

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
