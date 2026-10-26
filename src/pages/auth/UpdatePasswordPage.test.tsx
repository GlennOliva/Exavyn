import type { ReactNode } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UpdatePasswordPage } from './UpdatePasswordPage';
import { useAuth } from '../../features/auth/AuthContext';

vi.mock('../../features/auth/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('../../components/AuthLayout', () => ({
  AuthLayout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/update-password']}>
      <UpdatePasswordPage />
    </MemoryRouter>,
  );
}

describe('UpdatePasswordPage', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/update-password');
    vi.clearAllMocks();
  });

  it('shows a safe expired-link message for an otp_expired redirect', () => {
    window.history.replaceState(
      null,
      '',
      '/update-password#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired',
    );
    vi.mocked(useAuth).mockReturnValue({
      changePassword: vi.fn(),
      session: null,
      loading: false,
    } as never);

    renderPage();

    expect(screen.getByRole('heading', { name: /reset link unavailable/i })).toBeVisible();
    expect(screen.getByRole('alert')).toHaveTextContent(/expired or has already been used/i);
    expect(screen.getByRole('link', { name: /request a new reset email/i })).toHaveAttribute(
      'href',
      '/forgot-password',
    );
    expect(window.location.hash).toBe('');
    expect(window.location.href).not.toContain('access_denied');
  });

  it('removes a consumed recovery fragment once the session is established', async () => {
    window.history.replaceState(
      null,
      '',
      '/update-password#access_token=opaque&refresh_token=opaque&type=recovery',
    );
    vi.mocked(useAuth).mockReturnValue({
      changePassword: vi.fn(),
      session: { access_token: 'opaque' },
      loading: false,
    } as never);

    renderPage();

    await waitFor(() => expect(window.location.hash).toBe(''));
    expect(window.location.href).not.toContain('access_token');
    expect(window.location.href).not.toContain('refresh_token');
  });

  it('does not offer the form without a recovery session', () => {
    vi.mocked(useAuth).mockReturnValue({
      changePassword: vi.fn(),
      session: null,
      loading: false,
    } as never);

    renderPage();

    expect(screen.queryByLabelText('New password')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /request a new reset email/i })).toBeVisible();
  });

  it('updates a password only after the client confirms success', async () => {
    const changePassword = vi.fn().mockResolvedValue(undefined);
    vi.mocked(useAuth).mockReturnValue({
      changePassword,
      session: { access_token: 'opaque' },
      loading: false,
    } as never);

    renderPage();
    await userEvent.type(screen.getByLabelText('New password'), 'NewPassw0rd!');
    await userEvent.type(screen.getByLabelText('Confirm new password'), 'NewPassw0rd!');
    await userEvent.click(screen.getByRole('button', { name: /update password/i }));

    expect(changePassword).toHaveBeenCalledWith('NewPassw0rd!');
    expect(await screen.findByText(/your password was changed/i)).toBeVisible();
  });

  it('does not claim success when the update fails', async () => {
    const changePassword = vi.fn().mockRejectedValue(new Error('Auth session missing!'));
    vi.mocked(useAuth).mockReturnValue({
      changePassword,
      session: { access_token: 'opaque' },
      loading: false,
    } as never);

    renderPage();
    await userEvent.type(screen.getByLabelText('New password'), 'NewPassw0rd!');
    await userEvent.type(screen.getByLabelText('Confirm new password'), 'NewPassw0rd!');
    await userEvent.click(screen.getByRole('button', { name: /update password/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /expired or is no longer valid/i,
    );
    expect(screen.queryByText(/your password was changed/i)).not.toBeInTheDocument();
  });
});
