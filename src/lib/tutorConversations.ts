/**
 * tutorConversations — client helpers for reading the learner's own tutor
 * conversation history and writing answer feedback.
 *
 * Conversations live under users/{uid}/tutorConversations/{id} and are WRITTEN
 * server-side by the askTutor callable (the client only reads them). Feedback is
 * written by the learner into the top-level tutorFeedback collection. Both are
 * gated by firestore.rules (owner-private; admin read).
 */

import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import db from "@/lib/firebase/firestore";

export interface TutorTurn {
  role: "user" | "assistant";
  content: string;
  at?: number;
}

export interface TutorConversation {
  id: string;
  title?: string;
  courseId?: string;
  turns: TutorTurn[];
  updatedAtMillis: number | null;
}

/** Coerce a stored turns array into the strict TutorTurn[] shape. */
function normalizeTurns(raw: unknown): TutorTurn[] {
  if (!Array.isArray(raw)) return [];
  const out: TutorTurn[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const role = (item as { role?: unknown }).role;
    const content = (item as { content?: unknown }).content;
    if ((role === "user" || role === "assistant") && typeof content === "string") {
      out.push({ role, content });
    }
  }
  return out;
}

/** Load a single conversation owned by `uid`. Returns null if missing. */
export async function loadConversation(
  uid: string,
  conversationId: string
): Promise<TutorConversation | null> {
  const snap = await getDoc(doc(db, "users", uid, "tutorConversations", conversationId));
  if (!snap.exists()) return null;
  const d = snap.data();
  return {
    id: snap.id,
    title: typeof d.title === "string" ? d.title : undefined,
    courseId: typeof d.courseId === "string" ? d.courseId : undefined,
    turns: normalizeTurns(d.turns),
    updatedAtMillis:
      d.updatedAt && typeof d.updatedAt.toMillis === "function"
        ? d.updatedAt.toMillis()
        : null,
  };
}

/** List a learner's most recent conversations (id/title/time only). */
export async function listConversations(
  uid: string,
  max = 20
): Promise<Array<Pick<TutorConversation, "id" | "title" | "courseId" | "updatedAtMillis">>> {
  const q = query(
    collection(db, "users", uid, "tutorConversations"),
    orderBy("updatedAt", "desc"),
    limit(max)
  );
  const snap = await getDocs(q);
  return snap.docs.map((s) => {
    const d = s.data();
    return {
      id: s.id,
      title: typeof d.title === "string" ? d.title : undefined,
      courseId: typeof d.courseId === "string" ? d.courseId : undefined,
      updatedAtMillis:
        d.updatedAt && typeof d.updatedAt.toMillis === "function"
          ? d.updatedAt.toMillis()
          : null,
    };
  });
}

export type FeedbackRating = "up" | "down";

/**
 * Write thumbs up/down (+ optional reason) for a tutor answer. Doc ID is
 * `${uid}_${conversationId}_${turnIndex}` so re-rating overwrites rather than
 * duplicating. The reason is capped client-side; rules enforce the bound too.
 */
export async function submitTutorFeedback(params: {
  uid: string;
  conversationId: string;
  turnIndex: number;
  courseId: string;
  rating: FeedbackRating;
  reason?: string;
}): Promise<void> {
  const { uid, conversationId, turnIndex, courseId, rating } = params;
  const reason = (params.reason ?? "").slice(0, 1000);
  const id = `${uid}_${conversationId}_${turnIndex}`;
  await setDoc(doc(db, "tutorFeedback", id), {
    userId: uid,
    conversationId,
    turnIndex,
    courseId,
    rating,
    reason,
    createdAt: serverTimestamp(),
  });
}
