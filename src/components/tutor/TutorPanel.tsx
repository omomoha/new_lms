"use client";

/**
 * TutorPanel — collapsible "Ask the AI tutor" chat panel for the learner UI.
 *
 * Calls the `askTutor` callable with the current course/module/lesson context
 * plus the last 8 conversation turns.
 *
 * RENDERING: assistant turns are rendered from Markdown via a STRICT pipeline —
 * markdownToHtml() escapes everything and emits only an allow-list of structural
 * tags, then DOMPurify sanitizes again before the HTML touches the DOM (see
 * src/lib/tutorMarkdown.ts). Model output therefore can never inject live
 * markup. User turns stay plain text (whitespace-pre-wrap).
 *
 * ENHANCEMENTS (persistence + feedback) are gated behind the `tutorEnhancements`
 * feature flag so a prod deploy of in-progress work stays safe. With the flag
 * OFF the panel behaves exactly as before (markdown rendering aside).
 *
 * Fully keyboard accessible: Enter sends, Shift+Enter adds a newline; the
 * toggle, starter chips, and feedback controls are real buttons.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { httpsCallable } from "firebase/functions";
import functions from "@/lib/firebase/functions";
import getClientAuth from "@/lib/firebase/auth";
import { renderTutorMarkdown } from "@/lib/tutorMarkdown";
import { getFeatureFlag } from "@/lib/featureFlags";
import { submitTutorFeedback, type FeedbackRating } from "@/lib/tutorConversations";

interface TutorPanelProps {
  courseId: string;
  moduleId?: string;
  lessonId?: string;
}

interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

interface AskTutorRequest {
  courseId: string;
  moduleId?: string;
  lessonId?: string;
  question: string;
  history?: ChatTurn[];
  conversationId?: string;
}

interface AskTutorResponse {
  answer: string;
  conversationId: string;
}

const MAX_HISTORY_TURNS = 8;

const STARTER_QUESTIONS = [
  "Summarize the key ideas I should take away from this lesson.",
  "Can you walk me through a practical example?",
  "What should I focus on to pass the assessment?",
];

/** Render an assistant turn as sanitized HTML; falls back to plain text. */
function AssistantMessage({ content }: { content: string }) {
  const [html, setHtml] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void renderTutorMarkdown(content).then((h) => {
      if (alive) setHtml(h);
    });
    return () => {
      alive = false;
    };
  }, [content]);

  if (html === null) {
    // Pre-sanitization: never render raw model output as HTML.
    return <div className="whitespace-pre-wrap">{content}</div>;
  }
  return (
    <div
      className="tutor-markdown space-y-2 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-brand-ink/90 [&_pre]:p-3 [&_pre]:text-xs [&_code]:text-[0.85em] [&_:not(pre)>code]:rounded [&_:not(pre)>code]:bg-black/10 [&_:not(pre)>code]:px-1"
      // Sanitized by markdownToHtml (escape-first) + DOMPurify allow-list.
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

export default function TutorPanel({ courseId, moduleId, lessonId }: TutorPanelProps) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatTurn[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [enhanced, setEnhanced] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  // turnIndex (in `messages`) → submitted rating, to reflect the choice in UI.
  const [feedback, setFeedback] = useState<Record<number, FeedbackRating>>({});
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Resolve the feature flag once.
  useEffect(() => {
    let alive = true;
    void getFeatureFlag("tutorEnhancements").then((on) => {
      if (alive) setEnhanced(on);
    });
    return () => {
      alive = false;
    };
  }, []);

  // Keep the latest message in view.
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, loading]);

  const uid = useMemo(() => {
    try {
      return getClientAuth().currentUser?.uid ?? null;
    } catch {
      return null;
    }
  }, []);

  const send = async (raw?: string) => {
    const question = (raw ?? input).trim();
    if (!question || loading) return;

    setError(null);
    // History as it stood BEFORE this question, truncated client-side.
    const history = messages.slice(-MAX_HISTORY_TURNS);
    setMessages((prev) => [...prev, { role: "user", content: question }]);
    setInput("");
    setLoading(true);

    try {
      const askTutor = httpsCallable<AskTutorRequest, AskTutorResponse>(
        functions,
        "askTutor",
        // Callable client default is 70s — long answers can exceed it
        { timeout: 120000 }
      );
      const res = await askTutor({
        courseId,
        ...(moduleId ? { moduleId } : {}),
        ...(lessonId ? { lessonId } : {}),
        question,
        ...(history.length > 0 ? { history } : {}),
        ...(enhanced && conversationId ? { conversationId } : {}),
      });
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: res.data.answer },
      ]);
      if (enhanced && res.data.conversationId) {
        setConversationId(res.data.conversationId);
      }
    } catch (err: unknown) {
      setError(
        err instanceof Error
          ? err.message
          : "The tutor is unavailable right now. Please try again."
      );
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  };

  const rate = async (turnIndex: number, rating: FeedbackRating) => {
    if (!enhanced || !uid || !conversationId) return;
    setFeedback((prev) => ({ ...prev, [turnIndex]: rating }));
    try {
      await submitTutorFeedback({
        uid,
        conversationId,
        turnIndex,
        courseId,
        rating,
      });
    } catch {
      // Non-fatal: revert the optimistic selection so the learner can retry.
      setFeedback((prev) => {
        const next = { ...prev };
        delete next[turnIndex];
        return next;
      });
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  };

  return (
    <div className="card !p-0 overflow-hidden">
      {/* Toggle header */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="tutor-panel-body"
        className="flex w-full items-center justify-between px-4 py-3 text-left"
      >
        <span className="flex items-center gap-2 text-sm font-semibold text-brand-primary">
          <svg
            viewBox="0 0 24 24"
            className="h-4 w-4 text-brand-accent"
            fill="currentColor"
            aria-hidden="true"
          >
            <path d="M12 2l2.1 5.7L20 10l-5.9 2.3L12 18l-2.1-5.7L4 10l5.9-2.3L12 2z" />
          </svg>
          Ask the AI tutor
        </span>
        <svg
          viewBox="0 0 24 24"
          className={`h-4 w-4 text-brand-muted transition-transform ${open ? "rotate-180" : ""}`}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
        >
          <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div id="tutor-panel-body" className="border-t border-brand-line">
          {/* Conversation */}
          <div
            ref={listRef}
            role="log"
            aria-live="polite"
            aria-label="Tutor conversation"
            className="max-h-80 space-y-3 overflow-y-auto px-4 py-3"
          >
            {messages.length === 0 && !loading && (
              <div className="space-y-2 py-2">
                <p className="text-xs text-brand-muted">
                  Ask anything about this course — the tutor answers from the
                  course material. Try one of these:
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {STARTER_QUESTIONS.map((q) => (
                    <button
                      key={q}
                      type="button"
                      onClick={() => void send(q)}
                      className="rounded-full border border-brand-line bg-brand-mint px-3 py-1.5 text-left text-xs text-brand-ink hover:border-brand-accent"
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((m, i) =>
              m.role === "user" ? (
                <div key={i} className="flex justify-end">
                  <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-brand-primary px-3 py-2 text-sm text-white">
                    {m.content}
                  </div>
                </div>
              ) : (
                <div key={i} className="flex flex-col items-start gap-1">
                  <div className="max-w-[85%] rounded-2xl rounded-bl-sm bg-brand-mint px-3 py-2 text-sm text-brand-ink">
                    <AssistantMessage content={m.content} />
                  </div>
                  {enhanced && conversationId && (
                    <div className="flex items-center gap-1 pl-1" aria-label="Rate this answer">
                      <button
                        type="button"
                        onClick={() => void rate(i, "up")}
                        aria-pressed={feedback[i] === "up"}
                        aria-label="Helpful"
                        title="Helpful"
                        className={`rounded p-1 text-xs hover:bg-brand-mint ${
                          feedback[i] === "up" ? "text-brand-teal" : "text-brand-muted"
                        }`}
                      >
                        👍
                      </button>
                      <button
                        type="button"
                        onClick={() => void rate(i, "down")}
                        aria-pressed={feedback[i] === "down"}
                        aria-label="Not helpful"
                        title="Not helpful"
                        className={`rounded p-1 text-xs hover:bg-brand-mint ${
                          feedback[i] === "down" ? "text-red-600" : "text-brand-muted"
                        }`}
                      >
                        👎
                      </button>
                    </div>
                  )}
                </div>
              )
            )}

            {loading && (
              <div className="flex justify-start" aria-label="The tutor is typing">
                <div className="flex items-center gap-1 rounded-2xl rounded-bl-sm bg-brand-mint px-3 py-2.5">
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-brand-teal" />
                  <span
                    className="h-1.5 w-1.5 animate-bounce rounded-full bg-brand-teal"
                    style={{ animationDelay: "0.15s" }}
                  />
                  <span
                    className="h-1.5 w-1.5 animate-bounce rounded-full bg-brand-teal"
                    style={{ animationDelay: "0.3s" }}
                  />
                </div>
              </div>
            )}

            {error && (
              <p role="alert" className="text-xs text-red-600">
                {error}
              </p>
            )}
          </div>

          {/* Composer */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
            className="flex items-end gap-2 border-t border-brand-line px-4 py-3"
          >
            <textarea
              ref={inputRef}
              rows={2}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask a question about this course… (Enter to send)"
              aria-label="Ask the AI tutor a question"
              className="input-field flex-1 resize-none text-sm"
              maxLength={2000}
            />
            <button
              type="submit"
              disabled={loading || input.trim().length === 0}
              className="btn-primary text-xs disabled:opacity-50"
            >
              {loading ? "Sending…" : "Send"}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
