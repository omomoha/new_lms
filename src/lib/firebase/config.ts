/**
 * Firebase app initialization — singleton pattern.
 * All NEXT_PUBLIC_FIREBASE_* vars are set in .env.local (see .env.example).
 */

import { initializeApp, getApps, getApp, FirebaseApp } from "firebase/app";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY!,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN!,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID!,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET!,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID!,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID!,
};

// Avoid re-initializing during hot-module reloads in dev
const app: FirebaseApp =
  getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();

export default app;
