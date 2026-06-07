// Shared, deterministic helpers for time/night handling.
// A night shift runs ~23:00–07:00, so a single shift spans two calendar dates.
// We key everything off the *morning* the shift ends on.

/**
 * Map an event timestamp to the morning date its shift ends on.
 * Rule: evening events (local hour >= 18) belong to the *next* day's morning;
 * everything else (the 00:00–17:59 part of the calendar day) stays on that day.
 * e.g. 2026-05-25T23:14+08 -> "2026-05-26"; 2026-05-26T03:10+08 -> "2026-05-26".
 *
 * We read the wall-clock fields directly off the ISO string so the result does
 * not depend on the server's timezone. Inputs carry an explicit offset (+08:00).
 */
export function nightOf(timestamp: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):/.exec(timestamp);
  if (!m) throw new Error(`Unparseable timestamp: ${timestamp}`);
  const [, y, mo, d, h] = m;
  const date = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)));
  if (Number(h) >= 18) date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

/** Compare two ISO dates as strings (YYYY-MM-DD sorts lexicographically). */
export function dateLte(a: string, b: string): boolean {
  return a <= b;
}

/** Whole-day distance between two ISO dates (b - a), e.g. daysBetween("2026-05-28","2026-05-30") === 2. */
export function daysBetween(a: string, b: string): number {
  const da = Date.parse(`${a}T00:00:00Z`);
  const db = Date.parse(`${b}T00:00:00Z`);
  return Math.round((db - da) / 86_400_000);
}
