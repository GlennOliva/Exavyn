import { afterEach, describe, expect, it, vi } from 'vitest';

const { resetPasswordForEmail } = vi.hoisted(() => ({
  resetPasswordForEmail: vi.fn(),
}));

vi.mock('../../lib/supabase', () => ({
  supabase: { auth: { resetPasswordForEmail } },
}));

import { sendPasswordReset } from './api';

afterEach(() => {
  vi.unstubAllEnvs();
  resetPasswordForEmail.mockReset();
});

describe('sendPasswordReset', () => {
  it('passes the production recovery destination through redirectTo', async () => {
    window.history.replaceState(null, '', '/forgot-password');
    expect(window.location.origin).toBe('http://localhost:3000');
    vi.stubEnv('VITE_PUBLIC_SITE_URL', 'https://preview.example.test');
    resetPasswordForEmail.mockResolvedValue({ data: {}, error: null });

    await sendPasswordReset('student@example.test');

    expect(resetPasswordForEmail).toHaveBeenCalledWith('student@example.test', {
      redirectTo: 'https://exavyn.vercel.app/update-password',
    });
  });
});
