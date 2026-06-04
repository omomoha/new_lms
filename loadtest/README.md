# Load testing — Andela LMS

Target: comfortable headroom at **5,000 enrolled learners** (≈ 250–500
concurrently active at peak).

Tooling: [k6](https://k6.io) (`brew install k6`).

## Scripts

| Script | What it does | Run first? |
|---|---|---|
| `k6-smoke.js` | Anonymous hosting traffic: `/`, `/auth/login`, `/verify/*`. Ramps to 100 VUs. | yes |
| `k6-learner-flow.js` | Full authenticated learner loop: sign-in → course+enrollment reads → signed video URL → progress writes. Ramps to 300 VUs. | after smoke passes |

## Setup

1. Create a dedicated learner account (e.g. `loadtest@andela.com`), add it to a
   cohort that has a published course assigned.
2. Note the course ID, one lesson ID, and one uploaded video's storage path.
3. **Run against a staging project if possible.** If you must use production,
   run off-peak and delete the load-test user's progress docs afterwards.

## Run

```bash
k6 run loadtest/k6-smoke.js -e BASE_URL=https://andela-lms-dae5f.web.app

k6 run loadtest/k6-learner-flow.js \
  -e API_KEY=$NEXT_PUBLIC_FIREBASE_API_KEY \
  -e PROJECT_ID=andela-lms-dae5f \
  -e TEST_EMAIL=loadtest@andela.com -e TEST_PASSWORD='…' \
  -e COURSE_ID=… -e LESSON_ID=… \
  -e VIDEO_PATH="videos/…/….mp4"
```

## Pass criteria (thresholds are encoded in the scripts)

- Error rate < 1% (smoke) / < 2% (learner flow)
- p95: hosting < 800 ms, Firestore reads < 700 ms, sign-in < 1.5 s,
  signed-URL callable < 2 s, progress writes < 800 ms

## What to watch in Firebase

- **Cloud Functions**: `getSignedVideoUrl` cold-start spikes and instance
  count (set `minInstances: 1` if p95 breaches under sustained load).
- **Firestore**: reads/writes per second in the usage dashboard; watch for
  hot-document contention on popular course docs.
- **Identity Toolkit quota**: sign-in QPS limits — the test signs in once per
  VU iteration, which is far more aggressive than real traffic.
- **Budgets**: a full learner-flow run is ~50k Firestore ops and ~10k function
  invocations — within free-tier territory but set a budget alert anyway.

## Notes

- App Check: if enforcement is ON, REST calls from k6 will be rejected.
  Run load tests before enabling enforcement, or mint debug tokens.
- The learner-flow test reuses ONE account; Firestore rules treat each VU as
  the same uid, which exercises rules + indexes but not per-user fan-out.
  For a closer simulation, bulk-onboard N test users and shard credentials
  via `__VU`.
