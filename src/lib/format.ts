export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
  });
}

/** Remaining milliseconds, floored at zero. Uses server-supplied deadlines. */
export function remainingMs(deadlineIso: string, now: number = Date.now()): number {
  const deadline = new Date(deadlineIso).getTime();
  if (Number.isNaN(deadline)) return 0;
  return Math.max(0, deadline - now);
}

/** Format a duration in milliseconds as `HH:MM:SS` or `MM:SS`. */
export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return hours > 0 ? `${pad(hours)}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
}

export function percent(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined) return '—';
  return `${value.toFixed(digits)}%`;
}

/** The IANA name of the browser's timezone, with a safe fallback. */
export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'local time';
  } catch {
    return 'local time';
  }
}

/**
 * Format an instant with an explicit timezone label so students and teachers
 * never have to guess which zone a deadline is expressed in. Defaults to the
 * viewer's own zone (named), e.g. `Oct 14, 2026, 2:53 PM GMT+8 (Asia/Manila)`.
 */
export function formatDateTimeWithZone(
  value: string | null | undefined,
  timeZone: string = browserTimeZone(),
): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  try {
    const formatted = date.toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      timeZone,
      timeZoneName: 'short',
    });
    return `${formatted} (${timeZone})`;
  } catch {
    return formatDateTime(value);
  }
}

export function answerReviewPolicyLabel(policy: string | null | undefined): string {
  switch (policy) {
    case 'immediate':
      return 'Immediately after the score is released';
    case 'after_attempts':
      return 'After all attempts are used (or the exam closes)';
    case 'after_close':
      return 'After the exam closes';
    case 'never':
      return 'Correct answers are not released';
    default:
      return '—';
  }
}

export function reviewUnavailableReasonText(reason: string | null | undefined): string {
  switch (reason) {
    case 'never':
      return 'Your instructor has chosen not to release correct answers for this exam.';
    case 'in_progress':
      return 'Finish the attempt to see your answers.';
    case 'score_pending':
      return 'Correct answers become visible once your score is released.';
    case 'awaiting_close':
      return 'Correct answers will be visible after the exam closes.';
    case 'awaiting_attempts':
      return 'Correct answers become visible once you have used all of your attempts for this exam.';
    default:
      return 'Correct answers are not available yet.';
  }
}

export function submissionReasonLabel(reason: string | null): string {
  switch (reason) {
    case 'manual':
      return 'Submitted manually';
    case 'violation_limit':
      return 'Auto-submitted (violation limit)';
    case 'time_expired':
      return 'Auto-submitted (time expired)';
    default:
      return '—';
  }
}
