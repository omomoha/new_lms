"use client";

/**
 * CourseSearch — debounced search input with a clear button for the learner
 * dashboard course grid. Pure UI: the actual filtering lives in
 * src/lib/search.ts so it stays unit-testable.
 */

import { useEffect, useRef, useState } from "react";

interface CourseSearchProps {
  /** Called with the (debounced) query text. */
  onQueryChange: (query: string) => void;
  debounceMs?: number;
}

export default function CourseSearch({
  onQueryChange,
  debounceMs = 250,
}: CourseSearchProps) {
  const [value, setValue] = useState("");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clear any pending debounce timer on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const handleChange = (next: string) => {
    setValue(next);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => onQueryChange(next), debounceMs);
  };

  const handleClear = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setValue("");
    onQueryChange("");
  };

  return (
    <div className="relative mb-4" role="search">
      <label htmlFor="course-search" className="sr-only">
        Search courses
      </label>
      <input
        id="course-search"
        type="search"
        inputMode="search"
        autoComplete="off"
        placeholder="Search courses…"
        value={value}
        onChange={(e) => handleChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape" && value) {
            e.preventDefault();
            handleClear();
          }
        }}
        className="input-field w-full !pr-10"
      />
      {value && (
        <button
          type="button"
          onClick={handleClear}
          aria-label="Clear search"
          className="absolute right-2 top-1/2 -translate-y-1/2 w-6 h-6 flex items-center justify-center rounded-full text-brand-muted hover:text-brand-ink hover:bg-brand-mint transition-colors"
        >
          <span aria-hidden="true">✕</span>
        </button>
      )}
    </div>
  );
}
