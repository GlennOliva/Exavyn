import logoUrl from '../assets/logo_exavyn.png';
import { appName, appTagline } from '../lib/config';

/**
 * The Exavyn wordmark. The supplied PNG has navy lettering, so a light backing
 * is applied in dark mode (see `.brand-logo` in `index.css`) to keep it legible.
 * Proportions are preserved via `width`/`height` attributes plus a CSS height.
 */
export function Brand({
  variant = 'header',
  showTagline = true,
}: {
  variant?: 'header' | 'auth';
  showTagline?: boolean;
}) {
  return (
    <span className={`brand brand-${variant}`}>
      <img className="brand-logo" src={logoUrl} alt={appName} width={2172} height={724} />
      {showTagline ? <span className="brand-tagline">{appTagline}</span> : null}
    </span>
  );
}
