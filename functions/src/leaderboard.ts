/**
 * getCohortLeaderboard — callable returning XP standings for ONE cohort the
 * caller belongs to (admins may view any cohort).
 *
 * Privacy: learners cannot read each other's progress/attempts directly —
 * the aggregation happens here with the admin SDK and only NAME + derived
 * numbers leave the server. Per-user quota prevents hammering.
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { ENFORCE_APPCHECK, requireAuth, consumeQuota } from "./aiCommon";
import { computeXp } from "./gamificationRules";

if (!admin.apps.length) admin.initializeApp();

const db = admin.firestore();

const MAX_MEMBERS = 50;
const ID_RE = /^[A-Za-z0-9_-]+$/;

interface LeaderboardRequest {
  cohortId: string;
}

interface LeaderboardRow {
  name: string;
  xp: number;
  lessonsCompleted: number;
  certificates: number;
  isYou: boolean;
}

interface LeaderboardResponse {
  cohortName: string;
  rows: LeaderboardRow[];
  /** True when the cohort had more members than the aggregation cap */
  truncated: boolean;
}

export const getCohortLeaderboard = onCall<LeaderboardRequest>(
  { region: "us-central1", enforceAppCheck: ENFORCE_APPCHECK },
  async (request): Promise<LeaderboardResponse> => {
    const auth = requireAuth(request.auth);
    const { cohortId } = request.data;
    if (typeof cohortId !== "string" || !ID_RE.test(cohortId)) {
      throw new HttpsError("invalid-argument", "Invalid cohortId.");
    }

    // Caller must be a member (admins may view any cohort)
    if (auth.token.role !== "admin") {
      const me = await db.doc(`users/${auth.uid}`).get();
      const myCohorts: string[] = (me.data()?.cohortIds as string[]) ?? [];
      if (!myCohorts.includes(cohortId)) {
        throw new HttpsError("permission-denied", "You are not in this cohort.");
      }
    }

    await consumeQuota(auth.uid, "leaderboard", 30);

    const cohortSnap = await db.doc(`cohorts/${cohortId}`).get();
    if (!cohortSnap.exists) throw new HttpsError("not-found", "Cohort not found.");
    const cohortName = (cohortSnap.data()?.name as string) ?? "Cohort";

    const membersSnap = await db
      .collection("users")
      .where("cohortIds", "array-contains", cohortId)
      .limit(MAX_MEMBERS + 1)
      .get();
    const truncated = membersSnap.size > MAX_MEMBERS;
    const members = membersSnap.docs.slice(0, MAX_MEMBERS);

    const rows: LeaderboardRow[] = await Promise.all(
      members.map(async (m) => {
        const uid = m.id;
        const [progressSnap, passedAgg, certsAgg] = await Promise.all([
          db.collection("progress").where("userId", "==", uid).get(),
          db
            .collection("attempts")
            .where("userId", "==", uid)
            .where("passed", "==", true)
            .count()
            .get(),
          db.collection("certificates").where("userId", "==", uid).count().get(),
        ]);
        const lessonsCompleted = progressSnap.docs.filter(
          (d) => d.data().completedAt
        ).length;
        const quizzesPassed = passedAgg.data().count;
        const certificates = certsAgg.data().count;
        return {
          name: (m.data().name as string) || "Learner",
          xp: computeXp({ lessonsCompleted, quizzesPassed, certificates }),
          lessonsCompleted,
          certificates,
          isYou: uid === auth.uid,
        };
      })
    );

    rows.sort((a, b) => b.xp - a.xp || a.name.localeCompare(b.name));
    return { cohortName, rows, truncated };
  }
);
