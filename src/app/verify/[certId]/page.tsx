"use client";

/**
 * Public certificate verification page — /verify/[certId]
 *
 * Anyone (no sign-in required) can confirm a certificate is genuine.
 * Reads certificates/{certId} directly; Firestore rules allow public
 * single-document GETs on this collection (list queries stay restricted).
 */

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { doc, getDoc } from "firebase/firestore";
import db from "@/lib/firebase/firestore";
import type { Certificate } from "@/types";

type VerifyState = "loading" | "valid" | "not-found" | "error";

export default function VerifyCertificatePage() {
  const params = useParams();
  const certId = (params.certId as string)?.toUpperCase();

  const [state, setState] = useState<VerifyState>("loading");
  const [cert, setCert] = useState<Certificate | null>(null);

  useEffect(() => {
    if (!certId) return;
    let cancelled = false;
    (async () => {
      try {
        const snap = await getDoc(doc(db, "certificates", certId));
        if (cancelled) return;
        if (snap.exists()) {
          setCert(snap.data() as Certificate);
          setState("valid");
        } else {
          setState("not-found");
        }
      } catch (err) {
        console.error("Certificate verification failed:", err);
        if (!cancelled) setState("error");
      }
    })();
    return () => { cancelled = true; };
  }, [certId]);

  const issuedDate = cert?.issuedAt?.toDate?.()
    ? cert.issuedAt.toDate().toLocaleDateString("en-GB", {
        day: "numeric", month: "long", year: "numeric",
      })
    : null;

  return (
    <main
      className="min-h-screen flex items-center justify-center px-4 py-12 bg-brand-primary"
    >
      <div className="w-full max-w-lg">
        <div className="text-center mb-6">
          <span
            className="inline-block w-3 h-3 rotate-45 mb-3 bg-brand-accent"
            aria-hidden="true"
          />
          <h1 className="font-serif-brand text-2xl text-white">
            Andela Learn — Certificate Verification
          </h1>
        </div>

        <div className="bg-white rounded-2xl shadow-xl p-8">
          {state === "loading" && (
            <p className="text-center text-sm text-brand-muted" role="status">
              Checking certificate…
            </p>
          )}

          {state === "valid" && cert && (
            <div className="text-center space-y-4">
              <div
                className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-semibold bg-brand-mint text-brand-primary"
              >
                <span aria-hidden="true">✓</span> Valid certificate
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide mb-1 text-brand-muted">
                  Awarded to
                </p>
                <p className="font-serif-brand text-2xl text-brand-primary">
                  {cert.learnerName}
                </p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide mb-1 text-brand-muted">
                  For completing
                </p>
                <p className="text-lg font-medium text-brand-ink">
                  {cert.courseTitle}
                </p>
              </div>
              <div className="pt-2 text-sm text-brand-muted">
                {issuedDate && <p>Issued {issuedDate}</p>}
                <p className="mt-1">
                  Certificate ID: <span className="font-mono font-semibold">{cert.certId}</span>
                </p>
              </div>
            </div>
          )}

          {state === "not-found" && (
            <div className="text-center space-y-3">
              <div
                className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-semibold bg-red-100 text-red-800"
              >
                ✕ No certificate found
              </div>
              <p className="text-sm text-brand-muted">
                No certificate with ID <span className="font-mono">{certId}</span> exists.
                Check the ID and try again.
              </p>
            </div>
          )}

          {state === "error" && (
            <p className="text-center text-sm text-red-800">
              Could not check the certificate right now. Please try again shortly.
            </p>
          )}
        </div>

        <p className="text-center mt-6 text-xs" style={{ color: "#9EB3AD" }}>
          <Link href="/" className="underline hover:text-white">
            andela-lms — Andela Learn
          </Link>
        </p>
      </div>
    </main>
  );
}
