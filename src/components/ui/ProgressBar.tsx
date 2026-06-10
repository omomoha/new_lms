interface ProgressBarProps {
  pct: number; // 0–100
  className?: string;
}

export function ProgressBar({ pct, className = "" }: ProgressBarProps) {
  const clamped = Math.max(0, Math.min(100, pct));
  return (
    <div className={`w-full rounded-full h-2 overflow-hidden ${className} bg-brand-mint`}>
      <div
        className="h-2 rounded-full transition-all duration-300"
        style={{ width: `${clamped}%`, backgroundColor: "#2C7A6B" }}
        role="progressbar"
        aria-valuenow={clamped}
        aria-valuemin={0}
        aria-valuemax={100}
      />
    </div>
  );
}
