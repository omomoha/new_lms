export function Spinner({ className = "" }: { className?: string }) {
  return (
    <div
      role="status"
      className={`w-6 h-6 border-2 border-brand-accent border-t-transparent rounded-full animate-spin ${className}`}
      aria-label="Loading"
    />
  );
}
