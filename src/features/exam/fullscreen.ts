/**
 * Runtime fullscreen capability detection and a best-effort request helper.
 *
 * The app never decides based on a device or browser name. It asks the
 * document what it can actually do, attempts fullscreen from a user gesture,
 * and falls back to a focused viewport layout when the request is unavailable
 * or rejected. The fallback is deliberately not described as native
 * fullscreen or device lockdown.
 */

export type FullscreenUnavailableReason = 'unsupported' | 'rejected' | 'not-entered';

export interface FullscreenCapability {
  supported: boolean;
  reason: 'supported' | 'unsupported';
}

export interface FullscreenRequestResult {
  ok: boolean;
  reason?: FullscreenUnavailableReason;
}

type FullscreenCapableElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
  webkitRequestFullScreen?: () => Promise<void> | void;
};

type FullscreenCapableDocument = Document & {
  webkitFullscreenEnabled?: boolean;
  webkitFullscreenElement?: Element | null;
};

function fullscreenElement(doc: Document): Element | null {
  const d = doc as FullscreenCapableDocument;
  return d.fullscreenElement ?? d.webkitFullscreenElement ?? null;
}

/**
 * Detect whether the current document appears able to request element
 * fullscreen. `fullscreenEnabled === false` is authoritative. When the flag is
 * absent (some WebKit builds), a callable request method is treated as
 * requestable so the real request can decide; a rejected request is handled
 * as an unsupported fallback, never as a violation.
 */
export function detectFullscreenCapability(doc: Document = document): FullscreenCapability {
  const d = doc as FullscreenCapableDocument;
  const root = d.documentElement as FullscreenCapableElement | null;
  if (!root) return { supported: false, reason: 'unsupported' };

  const request =
    typeof root.requestFullscreen === 'function' ||
    typeof root.webkitRequestFullscreen === 'function' ||
    typeof root.webkitRequestFullScreen === 'function';
  const enabled = d.fullscreenEnabled ?? d.webkitFullscreenEnabled;

  if (!request || enabled === false) {
    return { supported: false, reason: 'unsupported' };
  }
  return { supported: true, reason: 'supported' };
}

/**
 * Request fullscreen. Must be called synchronously from a user interaction
 * (click/tap) so the browser can honour the gesture. Never throws: callers use
 * the returned result to decide whether to continue in the fallback layout.
 */
export async function requestExamFullscreen(
  doc: Document = document,
): Promise<FullscreenRequestResult> {
  const capability = detectFullscreenCapability(doc);
  if (!capability.supported) return { ok: false, reason: 'unsupported' };

  const root = doc.documentElement as FullscreenCapableElement;
  const request =
    root.requestFullscreen?.bind(root) ??
    root.webkitRequestFullscreen?.bind(root) ??
    root.webkitRequestFullScreen?.bind(root);

  if (!request) return { ok: false, reason: 'unsupported' };

  try {
    await request();
  } catch {
    return { ok: false, reason: 'rejected' };
  }

  if (!fullscreenElement(doc)) {
    return { ok: false, reason: 'not-entered' };
  }
  return { ok: true };
}

export function isFullscreenActive(doc: Document = document): boolean {
  return Boolean(fullscreenElement(doc));
}

export const FULLSCREEN_FALLBACK_MESSAGE =
  'Fullscreen is not available in this browser. The exam continues in a focused layout ' +
  'that fills the available screen. Tab and window monitoring is still active where the ' +
  'browser reports it, but it is limited and cannot prevent app switching.';
