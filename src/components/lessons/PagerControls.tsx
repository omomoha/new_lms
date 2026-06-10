"use client";

/**
 * PagerControls — shared Prev / "Page x of y" / Next bar used by the PDF and
 * DOCX paged viewers. Keyboard-accessible; page-jump via a number input.
 */

import { useState, useEffect } from "react";
import { clampPage } from "@/lib/paginate";

interface PagerControlsProps {
  page: number; // 1-based
  total: number;
  onPageChange: (page: number) => void;
}

export default function PagerControls({ page, total, onPageChange }: PagerControlsProps) {
  const [jump, setJump] = useState(String(page));

  useEffect(() => setJump(String(page)), [page]);

  const go = (p: number) => onPageChange(clampPage(p, total));

  return (
    <nav
      aria-label="Document pages"
      className="flex items-center justify-center gap-3 py-3"
    >
      <button
        type="button"
        onClick={() => go(page - 1)}
        disabled={page <= 1}
        className="btn-secondary text-xs px-4 py-2 disabled:opacity-40 disabled:cursor-not-allowed"
        aria-label="Previous page"
      >
        ← Previous
      </button>

      <span className="text-xs text-brand-muted flex items-center gap-1.5">
        Page
        <input
          type="number"
          min={1}
          max={total}
          value={jump}
          onChange={(e) => setJump(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") go(parseInt(jump, 10) || page);
          }}
          onBlur={() => go(parseInt(jump, 10) || page)}
          className="w-14 text-center input-field !py-1 !px-1 text-xs"
          aria-label={`Page number, 1 to ${total}`}
        />
        of {total}
      </span>

      <button
        type="button"
        onClick={() => go(page + 1)}
        disabled={page >= total}
        className="btn-primary text-xs px-4 py-2 disabled:opacity-40 disabled:cursor-not-allowed"
        aria-label="Next page"
      >
        Next →
      </button>
    </nav>
  );
}
