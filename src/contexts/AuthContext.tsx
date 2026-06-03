"use client";

/**
 * AuthContext — provides Firebase Auth user + Firestore role to the entire app.
 *
 * Role resolution order (Fix #7):
 *   1. JWT custom claim `role` (set by Cloud Function via setCustomUserClaims)
 *   2. Firestore `users/{uid}` doc `role` field as fallback
 * Profile fields (name, cohortIds) always come from the Firestore doc.
 *
 * Usage:
 *   const { user, appUser, loading } = useAuth();
 *   user      → Firebase User | null
 *   appUser   → AppUser (merged from JWT claim + Firestore doc) | null
 *   loading   → true while auth state is resolving
 */

import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  ReactNode,
} from "react";
import {
  onAuthStateChanged,
  User,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
} from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import auth from "@/lib/firebase/auth";
import db from "@/lib/firebase/firestore";
import type { AppUser } from "@/types";

interface AuthContextValue {
  user: User | null;
  appUser: AppUser | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [appUser, setAppUser] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser: User | null) => {
      setUser(firebaseUser);

      if (firebaseUser) {
        // Fix #8: wrap Firestore read in try/catch with finally to guarantee
        // setLoading(false) even on network error — prevents infinite spinner.
        try {
          // Fix #7: JWT custom claim is the authoritative role source.
          // Force=false uses the cached token (avoid unnecessary network round-trip).
          const tokenResult = await firebaseUser.getIdTokenResult();
          const claimRole = tokenResult.claims["role"] as AppUser["role"] | undefined;

          const snap = await getDoc(doc(db, "users", firebaseUser.uid));
          if (snap.exists()) {
            const docData = snap.data() as AppUser;
            setAppUser({
              ...docData,
              // Claim role wins; fall back to Firestore doc role if claim absent
              role: claimRole ?? docData.role,
            });
          } else {
            // Doc doesn't exist yet (e.g. race condition during onboard).
            // Surface the JWT claim role so UI can redirect correctly.
            // status/createdAt are unknown — use safe sentinel values.
            setAppUser(
              claimRole
                ? ({
                    uid: firebaseUser.uid,
                    email: firebaseUser.email ?? "",
                    role: claimRole,
                    name: firebaseUser.displayName ?? "",
                    cohortIds: [],
                    status: "pending",
                    createdAt: null,
                  } as unknown as AppUser)
                : null
            );
          }
        } catch (err) {
          console.error("AuthContext: failed to load user profile:", err);
          setAppUser(null);
        } finally {
          // Fix #8: always clear the loading spinner, even on error
          setLoading(false);
        }
      } else {
        setAppUser(null);
        setLoading(false);
      }
    });

    return unsubscribe;
  }, []);

  const signIn = async (email: string, password: string) => {
    await signInWithEmailAndPassword(auth, email, password);
    // onAuthStateChanged above will update state automatically
  };

  const signOut = async () => {
    await firebaseSignOut(auth);
  };

  return (
    <AuthContext.Provider value={{ user, appUser, loading, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used inside <AuthProvider>");
  }
  return ctx;
}
