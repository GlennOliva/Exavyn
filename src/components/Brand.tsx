import logoUrl from '../assets/logo_exavyn.png';
import { appName } from '../lib/config';

/**
 * The Exavyn wordmark. The supplied PNG has navy lettering, so a light backing
 * is applied on dark surfaces (see `.brand-logo` in `index.css`) to keep it
 * legible. Proportions are preserved via `width`/`height` attributes plus a CSS
 * height. The product slogan is intentionally not rendered beside the logo.
 */
export function Brand({ variant = 'header' }: { variant?: 'header' | 'auth' }) {
  return (
    <span className={`brand brand-${variant}`}>
      <img className="brand-logo" src={logoUrl} alt={appName} width={2172} height={724} />
    </span>
  );
}
