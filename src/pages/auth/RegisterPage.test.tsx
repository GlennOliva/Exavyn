import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RegisterPage } from './RegisterPage';
import { useAuth } from '../../features/auth/AuthContext';

vi.mock('../../features/auth/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('../../components/AuthLayout', () => ({
  AuthLayout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

const assign = vi.fn();

function renderPage() {
  return render(
    <MemoryRouter>
      <RegisterPage />
    </MemoryRouter>,
  );
}

async function fillAndSubmit() {
  await userEvent.type(screen.getByLabelText('Full name'), 'New Student');
  await userEvent.type(screen.getByLabelText('Email'), 'new@exam.test');
  await userEvent.type(screen.getByLabelText('Password', { exact: true }), 'Passw0rd!123');
  await userEvent.type(screen.getByLabelText('Confirm password'), 'Passw0rd!123');
  await userEvent.click(screen.getByRole('button', { name: /create student account/i }));
}

describe('RegisterPage', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'location', { configurable: true, value: { assign } });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('redirects to the student dashboard when signup returns a session', async () => {
    vi.mocked(useAuth).mockReturnValue({
      signUp: vi.fn().mockResolvedValue({ session: { access_token: 'token' } }),
    } as never);

    renderPage();
    await fillAndSubmit();

    expect(assign).toHaveBeenCalledWith('/student');
  });

  it('shows a sign-in hint and does not redirect when no session is returned', async () => {
    vi.mocked(useAuth).mockReturnValue({
      signUp: vi.fn().mockResolvedValue({ session: null }),
    } as never);

    renderPage();
    await fillAndSubmit();

    expect(await screen.findByRole('alert')).toHaveTextContent(/already exists/i);
    expect(assign).not.toHaveBeenCalled();
  });

  it('rejects mismatched passwords without calling signup', async () => {
    const signUp = vi.fn();
    vi.mocked(useAuth).mockReturnValue({ signUp } as never);

    renderPage();
    await userEvent.type(screen.getByLabelText('Full name'), 'New Student');
    await userEvent.type(screen.getByLabelText('Email'), 'new@exam.test');
    await userEvent.type(screen.getByLabelText('Password', { exact: true }), 'Passw0rd!123');
    await userEvent.type(screen.getByLabelText('Confirm password'), 'Different!123');
    await userEvent.click(screen.getByRole('button', { name: /create student account/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/do not match/i);
    expect(signUp).not.toHaveBeenCalled();
    expect(assign).not.toHaveBeenCalled();
  });
});
