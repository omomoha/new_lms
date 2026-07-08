/** "just now" / "5m ago" / "3h ago" / "2d ago" / locale date for older posts. */
export function formatRelativeTime(
  millis: number | null,
  nowMillis: number
): string {
  if (millis === null) return "just now";
  const diff = nowMillis - millis;
  if (diff < 60_000) return "just now";
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(millis).toLocaleDateString();
}
