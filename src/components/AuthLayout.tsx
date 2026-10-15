import type { ReactNode } from 'react';
import { Brand } from './Brand';
import { ThemeToggle } from './ThemeToggle';

/**
 * Shared wrapper for the public authentication pages: Exavyn branding plus an
 * in-page theme control so public visitors can pick a theme before signing in.
 */
export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="auth-wrap">
      <div className="auth-top">
        <Brand variant="auth" />
        <ThemeToggle />
      </div>
      {children}
    </div>
  );
}
