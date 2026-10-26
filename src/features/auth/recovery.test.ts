import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearRecoveryLocation,
  normalizePublicSiteUrl,
  parseRecoveryLinkFailure,
  passwordResetRedirectUrl,
} from './recovery';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('recovery redirects', () => {
  it('uses the stable configured production origin', () => {
    vi.stubEnv('VITE_PUBLIC_SITE_URL', 'https://exavyn.vercel.app');
    expect(passwordResetRedirectUrl('https://preview.example.test')).toBe(
      'https://exavyn.vercel.app/update-password',
    );
  });

  it('uses the current local origin when no production origin is configured', () => {
    vi.stubEnv('VITE_PUBLIC_SITE_URL', '');
    expect(passwordResetRedirectUrl('http://localhost:5173')).toBe(
      'http://localhost:5173/update-password',
    );
  });

  it('falls back to the current origin rather than localhost for invalid config', () => {
    vi.stubEnv('VITE_PUBLIC_SITE_URL', 'http://evil.example.test');
    expect(passwordResetRedirectUrl('https://exavyn.vercel.app')).toBe(
      'https://exavyn.vercel.app/update-password',
    );
  });

  it('normalizes valid origins and rejects unsafe protocols', () => {
    expect(normalizePublicSiteUrl(' https://exavyn.vercel.app/path ')).toBe(
      'https://exavyn.vercel.app',
    );
    expect(normalizePublicSiteUrl('http://localhost:3000')).toBe('http://localhost:3000');
    expect(normalizePublicSiteUrl('javascript:alert(1)')).toBeNull();
    expect(normalizePublicSiteUrl('http://production.example.test')).toBeNull();
    expect(normalizePublicSiteUrl('')).toBeNull();
  });
});

describe('recovery link failures', () => {
  it('recognizes an expired one-time token', () => {
    const failure = parseRecoveryLinkFailure(
      '#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid',
    );
    expect(failure?.code).toBe('otp_expired');
    expect(failure?.message).toMatch(/expired or has already been used/i);
    expect(failure?.message).not.toContain('Email link');
  });

  it('recognizes query-string errors', () => {
    expect(parseRecoveryLinkFailure('', '?error=access_denied')?.code).toBe(
      'access_denied',
    );
  });

  it('does not treat a valid recovery hash as an error', () => {
    expect(
      parseRecoveryLinkFailure(
        '#access_token=opaque&refresh_token=opaque&expires_in=3600&type=recovery',
        '',
      ),
    ).toBeNull();
  });

  it('returns a safe generic message for unknown errors', () => {
    const failure = parseRecoveryLinkFailure('#error=server_error');
    expect(failure?.code).toBe('server_error');
    expect(failure?.message).toBe(
      'This password reset link is invalid. Request a new reset email to continue.',
    );
  });
});

describe('recovery location cleanup', () => {
  it('removes a consumed recovery fragment with no token parameters left', () => {
    window.history.replaceState(null, '', '/update-password#');
    clearRecoveryLocation();
    expect(window.location.hash).toBe('');
    expect(window.location.href).not.toContain('#');
  });

  it('removes token and error fragments', () => {
    window.history.replaceState(
      null,
      '',
      '/update-password#access_token=opaque&refresh_token=opaque',
    );
    clearRecoveryLocation();
    expect(window.location.href).not.toContain('access_token');
    expect(window.location.href).not.toContain('refresh_token');
  });
});
