export function formatAgentTaskTime(milliseconds: number): string {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) throw new Error("Assistant task time must be non-negative and finite.");
  const totalSeconds = Math.floor(milliseconds / 1_000);
  if (totalSeconds === 0) return "<1s";
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor(totalSeconds % 3_600 / 60);
  const seconds = totalSeconds % 60;
  if (hours) return `${hours}h ${minutes}m ${seconds}s`;
  if (minutes) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}
