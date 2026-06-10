"use client";

/**
 * /admin/copilot — "Ask your data" admin analytics copilot.
 *
 * Chat-style page over the adminCopilot Cloud Function: the server gathers
 * grounded platform stats and Claude answers ONLY from them. Answers are
 * rendered as plain text (whitespace-pre-wrap) — never as HTML.
 */

import { useCallback, useRef, useState } from "react";
import { httpsCallable } from "firebase/functions";
import functions from "@/lib/firebase/functions";
import AdminShell from "@/components/layout/AdminShell";

interface AdminCopilotRequest {
  question: string;
}

interface AdminCopilotResponse {
  answer: string;
}

interface Exchange {
  question: string;
  answer: string | null; // null while loading
  error?: string;
}

const SUGGESTED_QUESTIONS = [
  "Which cohort is falling behind?",
  "How is completion trending?",
  "Where do learners drop off?",
];

const MAX_QUESTION_CHARS = 1000;

function friendlyError(err: unknown): string {
  const code = (err as { code?: string } | null)?.code ?? "";
  if (code.includes("resource-exhausted")) {
    return "You've hit the hourly copilot limit — try again in a bit.";
  }
  if (code.includes("failed-precondition")) {
    return "The AI copilot isn't configured on this deployment yet (missing API key).";
  }
  if (code.includes("permission-denied")) {
    return "Copilot is available to admins only.";
  }
  if (code.includes("invalid-argument") && err instanceof Error && err.message) {
    return err.message;
  }
  return "The copilot couldn't answer right now. Please try again.";
}

export default function AdminCopilotPage() {
  const [exchanges, setExchanges] = useState<Exchange[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const ask = useCallback(
    async (raw: string) => {
      const question = raw.trim().slice(0, MAX_QUESTION_CHARS);
      if (!question || loading) return;

      setInput("");
      setLoading(true);
      setExchanges((prev) => [...prev, { question, answer: null }]);
      // Let the pending bubble render, then scroll to it
      requestAnimationFrame(() =>
        bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" })
      );

      try {
        const fn = httpsCallable<AdminCopilotRequest, AdminCopilotResponse>(
          functions,
          "adminCopilot"
        , {
        // Firebase callable clients default to 70s — AI/conversion calls need longer
        timeout: 120000,
      });
        const res = await fn({ question });
        setExchanges((prev) =>
          prev.map((ex, i) =>
            i === prev.length - 1 ? { ...ex, answer: res.data.answer } : ex
          )
        );
      } catch (err: unknown) {
        const message = friendlyError(err);
        setExchanges((prev) =>
          prev.map((ex, i) =>
            i === prev.length - 1 ? { ...ex, answer: null, error: message } : ex
          )
        );
      } finally {
        setLoading(false);
        requestAnimationFrame(() =>
          bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" })
        );
      }
    },
    [loading]
  );

  return (
    <AdminShell>
      {/* Hero */}
      <div className="page-hero">
        <span className="kicker">ADMIN · COPILOT</span>
        <h1 className="font-serif-brand text-2xl sm:text-3xl font-normal text-white leading-tight">
          Ask your data
        </h1>
        <p className="mt-1 text-sm text-brand-mist">
          Plain-language questions, answered from live platform stats — cohorts,
          courses, enrollments, and assessments.
        </p>
      </div>

      <div className="max-w-3xl">
        {/* Suggested questions */}
        <div className="flex flex-wrap gap-2 mb-5">
          {SUGGESTED_QUESTIONS.map((q) => (
            <button
              key={q}
              type="button"
              onClick={() => void ask(q)}
              disabled={loading}
              className="px-3 py-1.5 rounded-full text-xs font-medium border border-brand-line bg-white text-brand-teal hover:bg-brand-mint transition-colors disabled:opacity-50"
            >
              {q}
            </button>
          ))}
        </div>

        {/* Conversation */}
        {exchanges.length === 0 ? (
          <div className="card text-center py-12 mb-5">
            <div className="mx-auto w-8 h-8 rounded-sm rotate-45 mb-4 bg-brand-accent" />
            <p className="font-semibold text-brand-primary mb-1">
              What would you like to know?
            </p>
            <p className="text-sm text-brand-muted">
              Try one of the suggestions above, or ask anything about users,
              cohorts, courses, or completion.
            </p>
          </div>
        ) : (
          <div className="space-y-4 mb-5">
            {exchanges.map((ex, i) => (
              <div key={i} className="space-y-2">
                {/* Question bubble */}
                <div className="flex justify-end">
                  <div className="max-w-[85%] rounded-2xl rounded-br-sm px-4 py-2.5 bg-brand-primary text-white text-sm whitespace-pre-wrap">
                    {ex.question}
                  </div>
                </div>
                {/* Answer bubble */}
                <div className="flex justify-start">
                  {ex.answer === null && !ex.error ? (
                    <div className="max-w-[85%] rounded-2xl rounded-bl-sm px-4 py-2.5 bg-brand-mint text-sm text-brand-muted">
                      Analyzing your data…
                    </div>
                  ) : ex.error ? (
                    <div className="max-w-[85%] rounded-2xl rounded-bl-sm px-4 py-2.5 bg-red-50 border border-red-200 text-sm text-red-700">
                      {ex.error}
                    </div>
                  ) : (
                    <div className="max-w-[85%] rounded-2xl rounded-bl-sm px-4 py-2.5 bg-white border border-brand-line text-sm text-brand-ink whitespace-pre-wrap">
                      {ex.answer}
                    </div>
                  )}
                </div>
              </div>
            ))}
            <div ref={bottomRef} />
          </div>
        )}

        {/* Input */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void ask(input);
          }}
          className="card !p-3 flex items-center gap-2"
        >
          <input
            type="text"
            className="input-field !border-0 !ring-0 flex-1"
            placeholder="e.g. Which course has the lowest completion rate?"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            maxLength={MAX_QUESTION_CHARS}
            disabled={loading}
            aria-label="Ask the copilot a question"
          />
          <button
            type="submit"
            className="btn-primary flex-shrink-0"
            disabled={loading || input.trim().length === 0}
          >
            {loading ? "Thinking…" : "Send"}
          </button>
        </form>
        <p className="mt-2 text-xs text-brand-muted">
          Answers are generated from aggregated platform data only — no
          individual learner records are shared with the model.
        </p>
      </div>
    </AdminShell>
  );
}
