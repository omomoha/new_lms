"use client";

/**
 * ResumeCard — prominent "Continue learning" CTA shown at the top of the
 * learner dashboard, linking to the most recently touched in-progress course.
 */

import Link from "next/link";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { EntityThumb } from "@/components/ui/Thumb";
import type { ResumeBasis } from "@/lib/resume";

interface ResumeCardProps {
  courseId: string;
  title: string;
  description?: string;
  thumbPath?: string;
  progressPct: number;
  /** "recency" → real last-touched data; "progress" → best-effort fallback. */
  basis: ResumeBasis;
}

export default function ResumeCard({
  courseId,
  title,
  description,
  thumbPath,
  progressPct,
  basis,
}: ResumeCardProps) {
  const label =
    basis === "recency" ? "Continue learning" : "Pick up where you left off";

  return (
    <Link
      href={`/learn/course/${courseId}`}
      aria-label={`${label}: ${title}, ${progressPct}% complete`}
      className="card group mb-6 flex items-stretch gap-0 overflow-hidden !p-0 border-l-4 border-brand-accent hover:shadow-md transition-shadow"
    >
      <div className="hidden sm:block w-36 flex-shrink-0">
        <EntityThumb
          thumbPath={thumbPath}
          seed={courseId}
          title={title}
          className="w-full h-full"
        />
      </div>
      <div className="flex-1 min-w-0 px-4 sm:px-5 py-4">
        <span className="kicker text-xs text-brand-teal">{label.toUpperCase()}</span>
        <h2 className="font-medium mt-0.5 line-clamp-1 text-brand-ink group-hover:text-brand-teal transition-colors">
          {title}
        </h2>
        {description && (
          <p className="text-sm line-clamp-1 mt-0.5 text-brand-muted">{description}</p>
        )}
        <div className="mt-3 max-w-sm">
          <div className="flex justify-between text-xs mb-1 text-brand-muted">
            <span>Progress</span>
            <span className="text-brand-teal font-semibold">{progressPct}%</span>
          </div>
          <ProgressBar pct={progressPct} />
        </div>
      </div>
      <div className="hidden sm:flex items-center pr-5 text-brand-teal" aria-hidden="true">
        <span className="text-xl group-hover:translate-x-0.5 transition-transform">→</span>
      </div>
    </Link>
  );
}
