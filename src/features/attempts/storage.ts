/** Local persistence for recovery across reloads. Authoritative state always
 * lives on the server; this only helps the client resume the correct attempt,
 * reuse the same controller token, and retry unsent episode reports. */

const PREFIX = 'ace';

function safeGet(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    /* storage may be unavailable (private mode); recovery degrades gracefully */
  }
}

const key = {
  attemptForExam: (examId: string) => `${PREFIX}.attempt.${examId}`,
  controller: (attemptId: string) => `${PREFIX}.controller.${attemptId}`,
};

export function getAttemptIdForExam(examId: string): string | null {
  return safeGet(key.attemptForExam(examId));
}

export function setAttemptIdForExam(examId: string, attemptId: string): void {
  safeSet(key.attemptForExam(examId), attemptId);
}

export function clearAttemptIdForExam(examId: string): void {
  safeSet(key.attemptForExam(examId), null);
}

export function getControllerToken(attemptId: string): string | null {
  return safeGet(key.controller(attemptId));
}

export function setControllerToken(attemptId: string, token: string): void {
  safeSet(key.controller(attemptId), token);
}

/**
 * Remove every attempt-related key from local storage. Called on sign-out and
 * when the authenticated account changes so that cached attempt identifiers,
 * controller tokens, or recovered attempts never leak across accounts.
 */
export function clearAttemptStorage(): void {
  try {
    const keys: string[] = [];
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const keyName = window.localStorage.key(i);
      if (keyName && keyName.startsWith(PREFIX)) keys.push(keyName);
    }
    for (const k of keys) window.localStorage.removeItem(k);
  } catch {
    /* storage may be unavailable (private mode); nothing to clear */
  }
}

/** Convenience alias kept explicit for readers at call sites. */
export const ATTEMPT_STORAGE_PREFIX = PREFIX;
