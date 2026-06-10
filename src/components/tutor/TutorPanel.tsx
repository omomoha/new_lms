"use client";

/**
 * TutorPanel — collapsible "Ask the AI tutor" chat panel for the learner UI.
 *
 * Calls the `askTutor` callable with the current course/module/lesson context
 * plus the last 8 conversation turns. Tutor answers are rendered as PLAIN
 * TEXT (whitespace-pre-wrap) — never as HTML — so model output can't inject
 * markup. Errors from the callable (quota, not-configured, …) are shown
 * inline. Fully keyboard accessible: Enter sends, Shift+Enter adds a newline,
 * the toggle and starter chips are real buttons.
 */

import { useEffect, useRef, useState } from "react";
import { httpsCallable } from "firebase/functions";
import functions from "@/lib/firebase/functions";

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
}

interface AskTutorResponse {
  answer: string;
}

const MAX_HISTORY_TURNS = 8;

const STARTER_QUESTIONS = [
  "Summarize the key ideas I should take away from this lesson.",
  "Can you walk me through a practical example?",
  "What should I focus on to pass the assessment?",
];

export default function TutorPanel({ courseId, moduleId, lessonId }: TutorPanelProps) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatTurn[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Keep the latest message in view.
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, loading]);

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
        "askTutor"
      );
      const res = await askTutor({
        courseId,
        ...(moduleId ? { moduleId } : {}),
        ...(lessonId ? { lessonId } : {}),
        question,
        ...(history.length > 0 ? { history } : {}),
      });
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: res.data.answer },
      ]);
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
                <div key={i} className="flex justify-start">
                  {/* Plain text on purpose — never render model markdown as HTML */}
                  <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-bl-sm bg-brand-mint px-3 py-2 text-sm text-brand-ink">
                    {m.content}
                  </div>
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
