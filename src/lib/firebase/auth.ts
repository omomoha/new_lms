import { getAuth, type Auth } from "firebase/auth";
import app from "./config";

// Initialize Auth lazily. getAuth() must NOT run during server prerender/build,
// where the public env config can be absent and it would throw
// `auth/invalid-api-key`. This is only invoked on first use in the browser.
let _auth: Auth | undefined;
export default function getClientAuth(): Auth {
  if (!_auth) _auth = getAuth(app);
  return _auth;
}
