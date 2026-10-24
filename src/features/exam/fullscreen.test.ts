import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  detectFullscreenCapability,
  FULLSCREEN_FALLBACK_MESSAGE,
  isFullscreenActive,
  requestExamFullscreen,
} from './fullscreen';

function fakeDoc(options: {
  request?: () => Promise<void> | void;
  enabled?: boolean;
  element?: Element | null;
}): Document {
  const root = {
    requestFullscreen: options.request,
    webkitRequestFullscreen: undefined,
  };
  return {
    documentElement: root,
    fullscreenEnabled: options.enabled,
    webkitFullscreenEnabled: undefined,
    fullscreenElement: options.element ?? null,
    webkitFullscreenElement: null,
  } as unknown as Document;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('fullscreen capability', () => {
  it('treats fullscreenEnabled=false as unsupported', () => {
    const doc = fakeDoc({ request: async () => {}, enabled: false });
    expect(detectFullscreenCapability(doc)).toEqual({ supported: false, reason: 'unsupported' });
  });

  it('allows a request when the enabled flag is absent but the method exists', () => {
    const doc = fakeDoc({ request: async () => {}, enabled: undefined });
    expect(detectFullscreenCapability(doc).supported).toBe(true);
  });

  it('returns unsupported when the request method is missing', () => {
    const doc = fakeDoc({ request: undefined, enabled: true });
    expect(detectFullscreenCapability(doc).supported).toBe(false);
  });

  it('reports a rejected request as a fallback, never an exception', async () => {
    const doc = fakeDoc({ request: async () => Promise.reject(new Error('denied')), enabled: true });
    await expect(requestExamFullscreen(doc)).resolves.toEqual({ ok: false, reason: 'rejected' });
  });

  it('reports a request that never enters fullscreen', async () => {
    const doc = fakeDoc({ request: async () => {}, enabled: true });
    await expect(requestExamFullscreen(doc)).resolves.toEqual({ ok: false, reason: 'not-entered' });
  });

  it('detects an active fullscreen element', () => {
    const element = { nodeName: 'HTML' } as Element;
    expect(isFullscreenActive(fakeDoc({ element }))).toBe(true);
    expect(isFullscreenActive(fakeDoc({ element: null }))).toBe(false);
  });

  it('describes the fallback honestly', () => {
    expect(FULLSCREEN_FALLBACK_MESSAGE).toMatch(/not available/i);
    expect(FULLSCREEN_FALLBACK_MESSAGE).toMatch(/cannot prevent app switching/i);
  });
});
