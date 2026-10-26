import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ReactNode } from 'react';

export type ToastTone = 'success' | 'error' | 'warning' | 'info';

export interface ToastItem {
  id: string;
  message: string;
  tone: ToastTone;
  durationMs?: number;
  dismissible?: boolean;
}

interface ToastContextValue {
  toast: (item: Omit<ToastItem, 'id'>) => string;
  dismiss: (id: string) => void;
  dismissAll: () => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const DEFAULT_DURATION: Record<ToastTone, number> = {
  success: 3000,
  info: 3000,
  warning: 4000,
  error: 6000,
};

function toneIcon(tone: ToastTone) {
  if (tone === 'success') {
    return (
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
        <path d="M20 6L9 17l-5-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (tone === 'error') {
    return (
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
        <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="2" />
        <path d="M15 9l-6 6M9 9l6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
    );
  }
  if (tone === 'warning') {
    return (
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
        <path d="M12 9v4M12 17h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" fill="none" stroke="currentColor" strokeWidth="2" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="M12 16v-4M12 8h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function ToastViewport({ container }: { container: HTMLElement | null }) {
  const { dismiss } = useToasts();
  const [items, setItems] = useState<ToastItem[]>([]);

  useEffect(() => {
    const handler = (event: Event) => {
      const custom = event as CustomEvent<ToastItem & { action?: 'add' | 'dismiss' | 'dismissAll' }>;
      if (custom.detail.action === 'dismiss') {
        setItems((prev) => prev.filter((item) => item.id !== custom.detail.id));
        return;
      }
      if (custom.detail.action === 'dismissAll') {
        setItems([]);
        return;
      }
      setItems((prev) => {
        // avoid duplicates based on message+tone in quick succession
        const exists = prev.some((p) => p.message === custom.detail.message && p.tone === custom.detail.tone);
        if (exists) return prev;
        return [...prev, custom.detail];
      });
    };
    window.addEventListener('exavyn:toast', handler as EventListener);
    return () => window.removeEventListener('exavyn:toast', handler as EventListener);
  }, []);

  const content = (
    <div className="toast-viewport" role="region" aria-label="Notifications" aria-live="polite">
      {items.map((item) => (
        <ToastCard key={item.id} item={item} onDismiss={() => dismiss(item.id)} />
      ))}
    </div>
  );

  if (!container) return content;
  return createPortal(content, container);
}

function ToastCard({ item, onDismiss }: { item: ToastItem; onDismiss: () => void }) {
  const duration = item.durationMs ?? DEFAULT_DURATION[item.tone];
  useEffect(() => {
    const timer = window.setTimeout(onDismiss, duration);
    return () => window.clearTimeout(timer);
  }, [duration, onDismiss]);

  return (
    <div className={`toast toast-${item.tone}`} role={item.tone === 'error' || item.tone === 'warning' ? 'alert' : 'status'} aria-live={item.tone === 'error' ? 'assertive' : 'polite'}>
      <span className="toast-icon" aria-hidden="true">{toneIcon(item.tone)}</span>
      <div className="toast-message">{item.message}</div>
      {(item.dismissible ?? true) ? (
        <button className="toast-close" aria-label="Dismiss notification" onClick={onDismiss}>
          ✕
        </button>
      ) : null}
    </div>
  );
}

export function ToastProvider({ children, container }: { children: ReactNode; container?: HTMLElement | null }) {
  const lastId = useRef(0);
  const toast = useCallback((item: Omit<ToastItem, 'id'>) => {
    const id = `toast-${Date.now()}-${lastId.current++}`;
    const payload = { ...item, id };
    window.dispatchEvent(new CustomEvent('exavyn:toast', { detail: payload }));
    return id;
  }, []);
  const dismiss = useCallback((id: string) => {
    window.dispatchEvent(new CustomEvent('exavyn:toast', { detail: { id, action: 'dismiss' } }));
  }, []);
  const dismissAll = useCallback(() => {
    window.dispatchEvent(new CustomEvent('exavyn:toast', { detail: { action: 'dismissAll' } }));
  }, []);
  const value = useMemo(() => ({ toast, dismiss, dismissAll }), [toast, dismiss, dismissAll]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastViewport container={container ?? null} />
    </ToastContext.Provider>
  );
}

export function useToasts() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToasts must be used within ToastProvider');
  return ctx;
}
