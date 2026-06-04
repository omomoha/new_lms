/**
 * k6 smoke test — anonymous traffic against Firebase Hosting.
 *
 * Verifies the public surface (landing, login, verify page) stays fast under
 * moderate concurrency. Run before the learner-flow test.
 *
 *   k6 run loadtest/k6-smoke.js -e BASE_URL=https://andela-lms-dae5f.web.app
 */

import http from "k6/http";
import { check, sleep } from "k6";

const BASE_URL = __ENV.BASE_URL || "https://andela-lms-dae5f.web.app";

export const options = {
  stages: [
    { duration: "30s", target: 25 },
    { duration: "1m", target: 100 },
    { duration: "30s", target: 0 },
  ],
  thresholds: {
    http_req_failed: ["rate<0.01"],   // <1% errors
    http_req_duration: ["p(95)<800"], // 95% under 800 ms
  },
};

export default function () {
  const pages = ["/", "/auth/login", "/verify/AND-TEST-0000"];
  for (const p of pages) {
    const res = http.get(`${BASE_URL}${p}`);
    check(res, { [`${p} is 200`]: (r) => r.status === 200 });
  }
  sleep(1);
}
