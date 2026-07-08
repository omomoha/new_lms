import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from "firebase/firestore";
import app from "./config";

// experimentalAutoDetectLongPolling lets the SDK fall back to a transport
// that survives more restrictive environments (corporate proxies, and some
// ad-blocker configurations that interfere with the WebChannel endpoint).
// Note: a blocker that outright blocks firestore.googleapis.com (e.g. strict
// Brave Shields / uBlock lists) can still break realtime reads — users must
// allow the site in that case.
//
// Phase 6 (offline parity with the mobile app): persistentLocalCache caches
// reads in IndexedDB so the app survives reloads / flaky networks and cuts
// repeat reads; persistentMultipleTabManager keeps multiple tabs in sync.
// This module is only imported client-side, so IndexedDB is available.
const db = initializeFirestore(app, {
  experimentalAutoDetectLongPolling: true,
  localCache: persistentLocalCache({
    tabManager: persistentMultipleTabManager(),
  }),
});
export default db;
