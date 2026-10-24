/** Local persistence for recovery across reloads. Authoritative state always
 * lives on the server; this only helps the client resume the correct attempt,
 * reuse the same controller token, and retry unsent episode reports. */

const PREFIX = 'ace';

function safeGetLocal(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSetLocal(key: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    /* storage may be unavailable (private mode); recovery degrades gracefully */
  }
}

function safeGetSession(key: string): string | null {
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSetSession(key: string, value: string | null): void {
  try {
    if (value === null) window.sessionStorage.removeItem(key);
    else window.sessionStorage.setItem(key, value);
  } catch {
    /* storage may be unavailable (private mode); recovery degrades gracefully */
  }
}

export type AttemptMonitoringMode = 'fullscreen' | 'fallback';

const key = {
  attemptForExam: (examId: string) => `${PREFIX}.attempt.${examId}`,
  controller: (attemptId: string) => `${PREFIX}.controller.${attemptId}`,
  monitoringMode: (attemptId: string) => `${PREFIX}.mode.${attemptId}`,
};

export function getAttemptIdForExam(examId: string): string | null {
  return safeGetLocal(key.attemptForExam(examId));
}

export function setAttemptIdForExam(examId: string, attemptId: string): void {
  safeSetLocal(key.attemptForExam(examId), attemptId);
}

export function clearAttemptIdForExam(examId: string): void {
  safeSetLocal(key.attemptForExam(examId), null);
}

export function getControllerToken(attemptId: string): string | null {
  // Prefer sessionStorage for same-tab isolation; fall back to localStorage for migration
  const session = safeGetSession(key.controller(attemptId));
  if (session) return session;
  return safeGetLocal(key.controller(attemptId));
}

export function setControllerToken(attemptId: string, token: string): void {
  // Move to sessionStorage; clear localStorage copy
  safeSetSession(key.controller(attemptId), token);
  safeSetLocal(key.controller(attemptId), null);
}

export function getAttemptMonitoringMode(attemptId: string): AttemptMonitoringMode | null {
  const value = safeGetLocal(key.monitoringMode(attemptId));
  return value === 'fullscreen' || value === 'fallback' ? value : null;
}

export function setAttemptMonitoringMode(
  attemptId: string,
  mode: AttemptMonitoringMode,
): void {
  safeSetLocal(key.monitoringMode(attemptId), mode);
}

/**
 * Remove every attempt-related key from storage. Called on sign-out and
 * when the authenticated account changes.
 */
export function clearAttemptStorage(): void {
  try {
    const keys: string[] = [];
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const keyName = window.localStorage.key(i);
      if (keyName && keyName.startsWith(PREFIX)) keys.push(keyName);
    }
    for (const k of keys) window.localStorage.removeItem(k);
    const sKeys: string[] = [];
    for (let i = 0; i < window.sessionStorage.length; i += 1) {
      const keyName = window.sessionStorage.key(i);
      if (keyName && keyName.startsWith(PREFIX)) sKeys.push(keyName);
    }
    for (const k of sKeys) window.sessionStorage.removeItem(k);
  } catch {
    /* storage may be unavailable (private mode); nothing to clear */
  }
}

/** Convenience alias kept explicit for readers at call sites. */
export const ATTEMPT_STORAGE_PREFIX = PREFIX;
