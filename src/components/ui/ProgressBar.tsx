interface ProgressBarProps {
  pct: number; // 0–100
  className?: string;
}

export function ProgressBar({ pct, className = "" }: ProgressBarProps) {
  const clamped = Math.max(0, Math.min(100, pct));
  return (
    <div className={`w-full bg-gray-200 rounded-full h-2 overflow-hidden ${className}`}>
      <div
        className="h-2 rounded-full bg-brand-accent transition-all duration-300"
        style={{ width: `${clamped}%` }}
        role="progressbar"
        aria-valuenow={clamped}
        aria-valuemin={0}
        aria-valuemax={100}
      />
    </div>
  );
}
