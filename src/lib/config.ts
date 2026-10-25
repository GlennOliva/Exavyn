const rawUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const rawKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

const looksLikePlaceholder = (value: string): boolean =>
  value.includes('your-project-ref') || value.includes('your-anon');

export const supabaseUrl =
  rawUrl && !looksLikePlaceholder(rawUrl) ? rawUrl : 'http://localhost:54321';

export const supabaseAnonKey =
  rawKey && !looksLikePlaceholder(rawKey) ? rawKey : 'public-anon-key';

/**
 * True only when real, browser-safe Supabase configuration is present.
 * The app renders a prominent setup notice and disables data access when this
 * is false, instead of silently issuing requests that cannot succeed.
 */
export const isSupabaseConfigured = Boolean(
  rawUrl && rawKey && !looksLikePlaceholder(rawUrl) && !looksLikePlaceholder(rawKey),
);

export const appName = (import.meta.env.VITE_APP_NAME as string | undefined) ?? 'Exavyn';

/** Fixed for this project per the specification. */
export const VIOLATION_THRESHOLD = 2;

/** Focus-loss grace period before a continuous blur is treated as a departure. */
export const FOCUS_LOSS_GRACE_MS = 1000;

/** Coalescing window for grouping overlapping departure signals into one episode. */
export const DEPARTURE_COALESCE_MS = 1200;
