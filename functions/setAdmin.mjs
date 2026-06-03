// One-time admin bootstrap.
// Run from the functions/ directory (where firebase-admin is installed):
//   cd functions
//   node setAdmin.mjs you@example.com /absolute/path/to/serviceAccount.json
//
// The email must already exist as a Firebase Auth user (create it in the
// console, or self-register through the app first). This grants the admin
// custom claim and writes/merges the users/{uid} profile doc with role=admin.
import admin from "firebase-admin";
import { readFileSync } from "node:fs";

const [, , email, keyPath] = process.argv;
if (!email || !keyPath) {
  console.error("Usage: node setAdmin.mjs <email> <path-to-serviceAccount.json>");
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.cert(JSON.parse(readFileSync(keyPath, "utf8"))),
});

const auth = admin.auth();
const db = admin.firestore();

const user = await auth.getUserByEmail(email);
await auth.setCustomUserClaims(user.uid, { role: "admin" });
await db.collection("users").doc(user.uid).set(
  {
    uid: user.uid,
    email,
    name: user.displayName || email.split("@")[0],
    role: "admin",
    cohortIds: [],
    status: "active",
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  },
  { merge: true }
);

console.log(`✅ ${email} is now an admin (uid ${user.uid}).`);
console.log("Sign out and back in (or hard-refresh) so the new token loads.");
process.exit(0);
