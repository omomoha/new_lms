/**
 * k6 learner-flow load test — the realistic 5k-learner scenario.
 *
 * Each virtual user behaves like a learner:
 *   1. Signs in (Identity Toolkit REST — same API the web SDK uses)
 *   2. Loads their course doc + enrollment (Firestore REST)
 *   3. Requests a signed video URL (getSignedVideoUrl callable)
 *   4. Writes watch progress every few seconds (Firestore REST PATCH)
 *
 * 5,000 enrolled learners ≈ 250–500 concurrently active (5–10%); the default
 * profile ramps to 300 VUs. Adjust stages to taste.
 *
 * Setup:
 *   - Create a dedicated load-test learner (e.g. loadtest@andela.com) enrolled
 *     in a real course, so auth + rules behave exactly like production.
 *   - NEVER run against production with real-learner credentials.
 *
 * Run:
 *   k6 run loadtest/k6-learner-flow.js \
 *     -e API_KEY=<NEXT_PUBLIC_FIREBASE_API_KEY> \
 *     -e PROJECT_ID=andela-lms-dae5f \
 *     -e TEST_EMAIL=loadtest@andela.com -e TEST_PASSWORD=... \
 *     -e COURSE_ID=<courseId> -e LESSON_ID=<lessonId> \
 *     -e VIDEO_PATH="videos/<courseId>/<moduleId>/<file>.mp4"
 */

import http from "k6/http";
import { check, sleep } from "k6";

const API_KEY = __ENV.API_KEY;
const PROJECT_ID = __ENV.PROJECT_ID || "andela-lms-dae5f";
const EMAIL = __ENV.TEST_EMAIL;
const PASSWORD = __ENV.TEST_PASSWORD;
const COURSE_ID = __ENV.COURSE_ID;
const LESSON_ID = __ENV.LESSON_ID;
const VIDEO_PATH = __ENV.VIDEO_PATH; // optional; skips step 3 when unset

const FIRESTORE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
const FUNCTIONS = `https://us-central1-${PROJECT_ID}.cloudfunctions.net`;

export const options = {
  stages: [
    { duration: "1m", target: 50 },
    { duration: "2m", target: 300 }, // ≈ 5k enrolled, 6% concurrently active
    { duration: "2m", target: 300 },
    { duration: "1m", target: 0 },
  ],
  thresholds: {
    http_req_failed: ["rate<0.02"],
    "http_req_duration{step:signin}": ["p(95)<1500"],
    "http_req_duration{step:read}": ["p(95)<700"],
    "http_req_duration{step:signedUrl}": ["p(95)<2000"],
    "http_req_duration{step:progress}": ["p(95)<800"],
  },
};

function signIn() {
  const res = http.post(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`,
    JSON.stringify({ email: EMAIL, password: PASSWORD, returnSecureToken: true }),
    { headers: { "Content-Type": "application/json" }, tags: { step: "signin" } }
  );
  check(res, { "sign-in 200": (r) => r.status === 200 });
  return res.json("idToken");
}

export default function () {
  if (!API_KEY || !EMAIL || !PASSWORD || !COURSE_ID) {
    throw new Error("API_KEY, TEST_EMAIL, TEST_PASSWORD and COURSE_ID are required");
  }

  const idToken = signIn();
  if (!idToken) { sleep(2); return; }
  const auth = { Authorization: `Bearer ${idToken}` };
  const uid = http
    .post(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${API_KEY}`,
      JSON.stringify({ idToken }),
      { headers: { "Content-Type": "application/json" }, tags: { step: "signin" } }
    )
    .json("users.0.localId");

  // 2. Course doc + enrollment (what the course page reads first)
  const course = http.get(`${FIRESTORE}/courses/${COURSE_ID}`, {
    headers: auth, tags: { step: "read" },
  });
  check(course, { "course read 200": (r) => r.status === 200 });

  const enrollment = http.get(`${FIRESTORE}/enrollments/${uid}_${COURSE_ID}`, {
    headers: auth, tags: { step: "read" },
  });
  check(enrollment, { "enrollment read ok": (r) => r.status === 200 || r.status === 404 });

  // 3. Signed video URL (the new Phase 3 path)
  if (VIDEO_PATH) {
    const signed = http.post(
      `${FUNCTIONS}/getSignedVideoUrl`,
      JSON.stringify({ data: { storagePath: VIDEO_PATH } }),
      { headers: { ...auth, "Content-Type": "application/json" }, tags: { step: "signedUrl" } }
    );
    check(signed, { "signed url 200": (r) => r.status === 200 });
  }

  // 4. Simulate a watch session: 3 progress saves, 5 s apart
  if (LESSON_ID) {
    for (let i = 1; i <= 3; i++) {
      const res = http.request(
        "PATCH",
        `${FIRESTORE}/progress/${uid}_${LESSON_ID}` +
          `?updateMask.fieldPaths=userId&updateMask.fieldPaths=lessonId` +
          `&updateMask.fieldPaths=courseId&updateMask.fieldPaths=watchedPct` +
          `&updateMask.fieldPaths=positionSec&updateMask.fieldPaths=completedAt`,
        JSON.stringify({
          fields: {
            userId: { stringValue: uid },
            lessonId: { stringValue: LESSON_ID },
            courseId: { stringValue: COURSE_ID },
            watchedPct: { integerValue: String(i * 10) },
            positionSec: { integerValue: String(i * 30) },
            completedAt: { nullValue: null },
          },
        }),
        { headers: { ...auth, "Content-Type": "application/json" }, tags: { step: "progress" } }
      );
      check(res, { "progress write 200": (r) => r.status === 200 });
      sleep(5);
    }
  }

  sleep(Math.random() * 3);
}
