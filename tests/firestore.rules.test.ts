/**
 * Firestore Security Rules — Unit Tests
 *
 * Uses @firebase/rules-unit-testing to assert access control.
 *
 * IMPORTANT: These tests require the Firestore emulator to be running.
 *   Run in CI/local with:
 *     firebase emulators:start --only firestore &
 *     npx vitest run tests/firestore.rules.test.ts
 *
 *   The emulator cannot start in the sandbox environment; this file is
 *   authored and verified for correctness but NOT executed here.
 */

import { describe, it, beforeAll, afterAll, expect } from "vitest";
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
  collection,
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
});

afterAll(async () => {
  await testEnv.cleanup();
});

// ── (i) Unauthenticated read denied ─────────────────────────────────────────
describe("unauthenticated access", () => {
  it("denies read to courses collection", async () => {
    const unauthed = testEnv.unauthenticatedContext();
    await assertFails(
      getDoc(doc(unauthed.firestore(), "courses", "course1"))
    );
  });

  it("denies read to users collection", async () => {
    const unauthed = testEnv.unauthenticatedContext();
    await assertFails(
      getDoc(doc(unauthed.firestore(), "users", "uid1"))
    );
  });
});

// ── (ii) Learner cannot write to courses ────────────────────────────────────
describe("learner cannot write courses", () => {
  it("denies learner write to courses", async () => {
    const learner = testEnv.authenticatedContext("learner-uid", {
      role: "learner",
    });
    await assertFails(
      setDoc(doc(learner.firestore(), "courses", "course1"), {
        title: "Hacked Course",
        status: "published",
      })
    );
  });
});

// ── (iii) Learner cannot read another user's progress doc ───────────────────
describe("learner progress isolation", () => {
  it("denies learner reading another user's progress", async () => {
    const learner = testEnv.authenticatedContext("learner-uid", {
      role: "learner",
    });
    // Progress doc owned by a different user
    await assertFails(
      getDoc(doc(learner.firestore(), "progress", "other-uid_lesson1"))
    );
  });

  it("allows learner reading their own progress", async () => {
    const learner = testEnv.authenticatedContext("learner-uid", {
      role: "learner",
    });
    await assertSucceeds(
      getDoc(doc(learner.firestore(), "progress", "learner-uid_lesson1"))
    );
  });
});

// ── (iv) Learner cannot read modules of a course not in their cohort ────────
describe("learner module cohort restriction", () => {
  it("denies learner reading modules of a course not assigned to their cohort", async () => {
    // Seed the course as published but assigned to a DIFFERENT cohort
    await testEnv.withSecurityRulesDisabled(async (ctx: import("@firebase/rules-unit-testing").RulesTestContext) => {
      await setDoc(doc(ctx.firestore(), "courses", "course-other"), {
        title: "Other Course",
        status: "published",
        assignedCohortIds: ["cohort-other"],
      });
      await setDoc(doc(ctx.firestore(), "users", "learner-uid"), {
        uid: "learner-uid",
        role: "learner",
        cohortIds: ["cohort-mine"],
      });
    });

    const learner = testEnv.authenticatedContext("learner-uid", {
      role: "learner",
    });
    await assertFails(
      getDoc(
        doc(learner.firestore(), "courses", "course-other", "modules", "mod1")
      )
    );
  });

  it("allows learner reading modules of a course assigned to their cohort", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx: import("@firebase/rules-unit-testing").RulesTestContext) => {
      await setDoc(doc(ctx.firestore(), "courses", "course-mine"), {
        title: "My Course",
        status: "published",
        assignedCohortIds: ["cohort-mine"],
      });
    });

    const learner = testEnv.authenticatedContext("learner-uid", {
      role: "learner",
    });
    await assertSucceeds(
      getDoc(
        doc(learner.firestore(), "courses", "course-mine", "modules", "mod1")
      )
    );
  });
});

// ── (v) Admin (claim) can write courses ─────────────────────────────────────
describe("admin can write courses", () => {
  it("allows admin to create a course", async () => {
    const admin = testEnv.authenticatedContext("admin-uid", {
      role: "admin",
    });
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
    const admin = testEnv.authenticatedContext("admin-uid", {
      role: "admin",
    });
    await assertSucceeds(
      setDoc(
        doc(admin.firestore(), "courses", "new-course"),
        { status: "published" },
        { merge: true }
      )
    );
  });
});
