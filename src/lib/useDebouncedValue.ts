import { useEffect, useState } from 'react';

/**
 * Delay propagating a rapidly changing value (for example a search box) until
 * the user pauses. The returned value only updates after `delay` ms; a newer
 * value cancels the pending update.
 */
export function useDebouncedValue<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), Math.max(0, delay));
    return () => window.clearTimeout(timer);
  }, [value, delay]);

  return debounced;
}
