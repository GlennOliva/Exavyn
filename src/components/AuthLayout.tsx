import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Brand } from './Brand';
import { CyberArtwork } from './CyberArtwork';

/**
 * Shared public account shell. These screens always render the dark
 * Cyber-Tribal surface; appearance controls are only available after sign-in.
 */
export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="auth-page">
      <div className="auth-art" aria-hidden="true">
        <CyberArtwork />
      </div>
      <div className="auth-shell">
        <header className="auth-header">
          <Link className="auth-brand" to="/login" aria-label="Exavyn account access">
            <Brand variant="auth" />
          </Link>
          <span className="auth-header-label">Secure account access</span>
        </header>

        <div className="auth-grid">
          <aside className="auth-story">
            <p className="auth-kicker">Assessment integrity</p>
            <h2>Built into every session.</h2>
            <p className="auth-lede">
              Exavyn keeps exam access role-scoped, answers server-verified, and results under
              instructor control.
            </p>
            <ul className="auth-facts">
              <li>Monitored exam sessions</li>
              <li>Server-verified responses</li>
              <li>Results released when ready</li>
            </ul>
          </aside>

          <main className="auth-form">{children}</main>
        </div>

        <footer className="auth-footer">
          <span>Role-scoped access</span>
          <span aria-hidden="true">/</span>
          <span>Server-verified results</span>
        </footer>
      </div>
    </div>
  );
}
