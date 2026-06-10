import { initializeFirestore } from "firebase/firestore";
import app from "./config";

// experimentalAutoDetectLongPolling lets the SDK fall back to a transport
// that survives more restrictive environments (corporate proxies, and some
// ad-blocker configurations that interfere with the WebChannel endpoint).
// Note: a blocker that outright blocks firestore.googleapis.com (e.g. strict
// Brave Shields / uBlock lists) can still break realtime reads — users must
// allow the site in that case.
const db = initializeFirestore(app, {
  experimentalAutoDetectLongPolling: true,
});
export default db;
