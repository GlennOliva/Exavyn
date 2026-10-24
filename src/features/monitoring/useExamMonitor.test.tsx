import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const recordViolation = vi.fn();

vi.mock('../attempts/api', () => ({
  recordViolation: (...args: unknown[]) => recordViolation(...args),
  sendHeartbeat: () => Promise.resolve(),
}));

import { useExamMonitor } from './useExamMonitor';

let visibility: 'visible' | 'hidden' = 'visible';
let focused = true;
let fullscreenEl: Element | null = null;

function renderMonitor(attemptId: string, fullscreenRequired = true) {
  return renderHook(() =>
    useExamMonitor({
      attemptId,
      controllerToken: `token-${attemptId}`,
      initialViolationCount: 0,
      enabled: true,
      fullscreenRequired,
    }),
  );
}

beforeEach(() => {
  visibility = 'visible';
  focused = true;
  fullscreenEl = null;
  localStorage.clear();
  recordViolation.mockReset();
  recordViolation.mockImplementation(() =>
    Promise.resolve({
      violation_count: 1,
      attempt_state: 'active',
      finalized: false,
      duplicate: false,
    }),
  );
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => visibility,
  });
  Object.defineProperty(document, 'hasFocus', { configurable: true, value: () => focused });
  Object.defineProperty(document, 'fullscreenElement', {
    configurable: true,
    get: () => fullscreenEl,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

const signals = () => recordViolation.mock.calls[0]?.[0]?.signals as string[];

describe('useExamMonitor departure wiring', () => {
  it('reports a real tab/app switch (visibility hidden) as one violation', async () => {
    const { unmount } = renderMonitor('a1');

    await act(async () => {
      visibility = 'hidden';
      document.dispatchEvent(new Event('visibilitychange'));
    });

    await waitFor(() => expect(recordViolation).toHaveBeenCalledTimes(1));
    expect(signals()).toContain('visibility_hidden');

    // Switching away again without recovering stays in the same episode: no
    // double count, matching the server-side (attempt_id, episode_id) dedupe.
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(recordViolation).toHaveBeenCalledTimes(1);
    unmount();
  });

  it('reports a sustained window blur (Command+Tab / Alt+Tab) as focus_lost after the grace window', async () => {
    renderMonitor('a2');

    await act(async () => {
      focused = false;
      window.dispatchEvent(new Event('blur'));
    });

    await waitFor(() => expect(recordViolation).toHaveBeenCalledTimes(1), { timeout: 2500 });
    expect(signals()).toContain('focus_lost');
  });

  it('ignores a blur shorter than the grace window (quick peek back)', async () => {
    renderMonitor('a3');

    await act(async () => {
      focused = false;
      window.dispatchEvent(new Event('blur'));
      focused = true;
      window.dispatchEvent(new Event('focus'));
    });

    await new Promise((resolve) => setTimeout(resolve, 1300));
    expect(recordViolation).not.toHaveBeenCalled();
  });

  it('reports a real fullscreen exit', async () => {
    renderMonitor('a4');

    await act(async () => {
      document.dispatchEvent(new Event('fullscreenchange'));
    });

    await waitFor(() => expect(recordViolation).toHaveBeenCalledTimes(1));
    expect(signals()).toContain('fullscreen_exit');
  });
});


describe('useExamMonitor accessible fallback', () => {
  it('does not report fullscreen exit when fullscreen is not required', async () => {
    const { unmount } = renderMonitor('fallback-1', false);

    await act(async () => {
      document.dispatchEvent(new Event('fullscreenchange'));
    });

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(recordViolation).not.toHaveBeenCalled();
    unmount();
  });

  it('still reports a real tab/app switch in fallback mode', async () => {
    const { unmount } = renderMonitor('fallback-2', false);

    await act(async () => {
      visibility = 'hidden';
      document.dispatchEvent(new Event('visibilitychange'));
    });

    await waitFor(() => expect(recordViolation).toHaveBeenCalledTimes(1));
    expect(signals()).toContain('visibility_hidden');
    unmount();
  });

  it('does not require fullscreen to recover in fallback mode', async () => {
    const { unmount } = renderMonitor('fallback-3', false);

    await act(async () => {
      visibility = 'hidden';
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await waitFor(() => expect(recordViolation).toHaveBeenCalledTimes(1));

    await act(async () => {
      visibility = 'visible';
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(recordViolation).toHaveBeenCalledTimes(1);
    unmount();
  });
});
