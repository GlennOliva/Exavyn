import type { ViolationSignal } from './types';

/** A departure episode awaiting confirmation by the server. The episode UUID is
 * generated once and reused for every retry, so duplicate deliveries can never
 * double count on the backend. */
export interface PendingViolationReport {
  episodeId: string;
  signals: ViolationSignal[];
  observedAt: string;
  attempts: number;
}

const key = (attemptId: string) => `ace.pendingViolations.${attemptId}`;

export function loadPending(attemptId: string): PendingViolationReport[] {
  try {
    const raw = window.localStorage.getItem(key(attemptId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as PendingViolationReport[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function persistPending(
  attemptId: string,
  reports: PendingViolationReport[],
): void {
  try {
    if (reports.length === 0) window.localStorage.removeItem(key(attemptId));
    else window.localStorage.setItem(key(attemptId), JSON.stringify(reports));
  } catch {
    /* ignore storage failures */
  }
}

export function enqueuePending(
  attemptId: string,
  report: Omit<PendingViolationReport, 'attempts'>,
): PendingViolationReport[] {
  const current = loadPending(attemptId);
  if (current.some((r) => r.episodeId === report.episodeId)) return current;
  const next = [...current, { ...report, attempts: 0 }];
  persistPending(attemptId, next);
  return next;
}

export function removePending(
  attemptId: string,
  episodeId: string,
): PendingViolationReport[] {
  const next = loadPending(attemptId).filter((r) => r.episodeId !== episodeId);
  persistPending(attemptId, next);
  return next;
}

export function clearPending(attemptId: string): void {
  persistPending(attemptId, []);
}
