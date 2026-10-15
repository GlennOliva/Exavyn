/**
 * Date/time helpers shared by the exam builder and the student instructions
 * page. All conversions go through the browser's local timezone: a teacher
 * entering a wall-clock time in the `datetime-local` input has it stored as the
 * equivalent UTC instant, and students see that instant rendered back in their
 * own (explicitly labelled) zone.
 */

/** Convert an ISO instant into a `datetime-local` input value (browser-local). */
export function isoToLocalInput(value: string | null | undefined): string {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return '';
  const offset = date.getTimezoneOffset();
  const local = new Date(date.getTime() - offset * 60 * 1000);
  return local.toISOString().slice(0, 16);
}

/**
 * Interpret a `datetime-local` value as wall-clock time in the browser's zone
 * and return an ISO instant (UTC). Returns `null` for empty/invalid input.
 */
export function localInputToIso(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

export type ExamAvailability = 'upcoming' | 'open' | 'closed';

/**
 * Classify an exam window relative to `now`. This mirrors the server-side
 * check in `start_attempt`; the UI uses it to explain why a start is blocked,
 * while the database remains the authority.
 */
export function examAvailability(
  opensAt: string,
  closesAt: string,
  now: number = Date.now(),
): ExamAvailability {
  const opens = new Date(opensAt).getTime();
  const closes = new Date(closesAt).getTime();
  if (Number.isFinite(opens) && now < opens) return 'upcoming';
  if (Number.isFinite(closes) && now >= closes) return 'closed';
  return 'open';
}
