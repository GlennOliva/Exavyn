const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * Validate a browser-safe site URL. Only http(s) origins are accepted, and
 * plain HTTP is limited to local development so a production build cannot be
 * redirected to an insecure remote origin by configuration.
 */
export function normalizePublicSiteUrl(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    if (url.protocol === 'http:' && !LOCAL_HOSTS.has(url.hostname)) return null;
    return url.origin;
  } catch {
    return null;
  }
}

/**
 * The canonical password-recovery destination. Recovery links must always
 * return to the production app, regardless of the browser origin, local
 * development, or a missing/invalid VITE_PUBLIC_SITE_URL value.
 */
const PASSWORD_RESET_REDIRECT_URL = 'https://exavyn.vercel.app/update-password';

export function passwordResetRedirectUrl(): string {
  return PASSWORD_RESET_REDIRECT_URL;
}

export interface RecoveryLinkFailure {
  code: string;
  message: string;
}

const EXPIRED_MESSAGE =
  'This password reset link has expired or has already been used. Request a new reset email to continue.';
const INVALID_MESSAGE =
  'This password reset link is invalid. Request a new reset email to continue.';

/**
 * Read only the non-secret error fields Supabase appends to recovery redirects.
 * Never return or log the full hash: a valid recovery hash contains tokens.
 */
export function parseRecoveryLinkFailure(
  hash: string,
  search = '',
): RecoveryLinkFailure | null {
  const hashParams = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash);
  const queryParams = new URLSearchParams(search);
  const error = hashParams.get('error') ?? queryParams.get('error') ?? '';
  const errorCode = hashParams.get('error_code') ?? queryParams.get('error_code') ?? '';
  const code = errorCode || error;

  if (!error && !errorCode) return null;
  if (
    code === 'otp_expired' ||
    code === 'access_denied' ||
    code === 'session_not_found' ||
    code === 'refresh_token_not_found'
  ) {
    return { code, message: EXPIRED_MESSAGE };
  }
  return { code: code || 'invalid_link', message: INVALID_MESSAGE };
}

/** Remove recovery parameters, including a consumed empty fragment, from history. */
export function clearRecoveryLocation(): void {
  if (typeof window === 'undefined') return;
  const hasFragment = window.location.hash || window.location.href.includes('#');
  if (hasFragment || window.location.search) {
    window.history.replaceState(null, '', window.location.pathname);
  }
}
