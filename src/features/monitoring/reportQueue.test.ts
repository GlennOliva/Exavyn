import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearPending,
  enqueuePending,
  loadPending,
  persistPending,
  removePending,
} from './reportQueue';
import type { ViolationSignal } from './types';

const report = (episodeId: string) => ({
  episodeId,
  signals: ['visibility_hidden'] as ViolationSignal[],
  observedAt: '2026-01-01T00:00:00.000Z',
});

describe('reportQueue', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('returns an empty queue when nothing is stored', () => {
    expect(loadPending('attempt-1')).toEqual([]);
  });

  it('enqueues a report with an attempts counter of zero', () => {
    const queue = enqueuePending('attempt-1', report('ep-1'));
    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({ episodeId: 'ep-1', attempts: 0 });
    expect(loadPending('attempt-1')).toHaveLength(1);
  });

  it('does not duplicate a report with the same episode id', () => {
    enqueuePending('attempt-1', report('ep-1'));
    const queue = enqueuePending('attempt-1', report('ep-1'));
    expect(queue).toHaveLength(1);
  });

  it('removes exactly one episode and clears the key when empty', () => {
    enqueuePending('attempt-1', report('ep-1'));
    enqueuePending('attempt-1', report('ep-2'));
    const afterRemove = removePending('attempt-1', 'ep-1');
    expect(afterRemove.map((r) => r.episodeId)).toEqual(['ep-2']);

    clearPending('attempt-1');
    expect(loadPending('attempt-1')).toEqual([]);
    expect(window.localStorage.getItem('ace.pendingViolations.attempt-1')).toBeNull();
  });

  it('recovers gracefully from malformed stored data', () => {
    window.localStorage.setItem('ace.pendingViolations.attempt-1', '{not json');
    expect(loadPending('attempt-1')).toEqual([]);
  });

  it('keeps queues isolated per attempt', () => {
    enqueuePending('attempt-1', report('ep-1'));
    enqueuePending('attempt-2', report('ep-2'));
    expect(loadPending('attempt-1').map((r) => r.episodeId)).toEqual(['ep-1']);
    expect(loadPending('attempt-2').map((r) => r.episodeId)).toEqual(['ep-2']);
    persistPending('attempt-1', []);
    expect(loadPending('attempt-1')).toEqual([]);
    expect(loadPending('attempt-2')).toHaveLength(1);
  });
});
