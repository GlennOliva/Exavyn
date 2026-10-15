import type { PostgrestError } from '@supabase/supabase-js';

/**
 * Turn a PostgREST/Postgres error into a safe, student-friendly message.
 * Raw database errors and detail text are never surfaced to end users; the
 * original is preserved on the thrown object for local diagnostics.
 */
export class AppError extends Error {
  readonly code?: string;
  readonly cause?: unknown;

  constructor(message: string, code?: string, cause?: unknown) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.cause = cause;
  }
}

const EMAIL_SEND_RATE_LIMIT_MESSAGE =
  'We have sent too many emails for this project recently. ' +
  'Please wait a few minutes, then try again. If this keeps happening, ask ' +
  'your administrator to configure a custom email (SMTP) sender.';

const REQUEST_RATE_LIMIT_MESSAGE = 'Too many requests. Please wait a moment and try again.';

/**
 * Authored messages raised by our own PL/pgSQL RPCs. `P0002` (no_data_found)
 * is reused deliberately by the schema for many distinct conditions, so a
 * blanket code-level mapping would wrongly collapse "Exam has not opened yet"
 * into "record not found". Matching the authored text keeps those distinctions
 * intact while never leaking raw database diagnostics.
 */
const AUTHORED_MESSAGES: Record<string, string> = {
  'Exam not found': 'This exam could not be found.',
  'Exam is not available': 'This exam is not available to start.',
  'Exam has no published version': 'This exam is not available to start.',
  'Exam has not opened yet': 'This exam has not opened yet.',
  'Exam has closed': 'This exam has closed.',
  'You have already completed this exam': 'You have already completed this exam.',
  'You are not enrolled in this course': 'You are not enrolled in this course.',
};

const SAFE_MESSAGES: Record<string, string> = {
  '28000': 'Authentication required.',
  '42501': 'You do not have permission to perform this action.',
  '53400': 'Too many attempts. Please wait a moment and try again.',
  '55006': 'This attempt is active in another session.',
  // Supabase Auth errors (AuthApiError.code / error_code).
  over_email_send_rate_limit: EMAIL_SEND_RATE_LIMIT_MESSAGE,
  over_request_rate_limit: REQUEST_RATE_LIMIT_MESSAGE,
  email_exists: 'An account with this email already exists. Try signing in instead.',
  user_already_exists: 'An account with this email already exists. Try signing in instead.',
  email_address_invalid: 'That email address does not look valid.',
  email_address_not_authorized: 'That email address is not allowed to register.',
  signup_disabled: 'New sign-ups are currently disabled. Please contact your administrator.',
  weak_password: 'Please choose a stronger password (at least 8 characters).',
};

export function toAppError(error: unknown): AppError {
  if (error instanceof AppError) return error;

  const err = error as Partial<PostgrestError> & {
    message?: string;
    code?: string;
    status?: number;
    error_code?: string;
  };
  if (err && typeof err === 'object' && (err.message || err.code || err.error_code)) {
    const code = err.code ?? err.error_code ?? undefined;
    const rawMessage = typeof err.message === 'string' ? err.message.trim() : '';
    const friendly =
      AUTHORED_MESSAGES[rawMessage] ??
      (code === 'P0002' ? rawMessage || undefined : undefined) ??
      (code ? SAFE_MESSAGES[code] : undefined) ??
      (err.status === 429 ? REQUEST_RATE_LIMIT_MESSAGE : undefined) ??
      err.message;
    return new AppError(friendly ?? 'Something went wrong.', code, error);
  }

  if (error instanceof Error) return new AppError(error.message, undefined, error);
  return new AppError('Something went wrong.', undefined, error);
}

export function errorMessage(error: unknown): string {
  return toAppError(error).message;
}
