import { describe, expect, it } from 'vitest';
import { DepartureTracker } from './dedupe';

function makeTracker(coalesceMs = 1200) {
  let seq = 0;
  return new DepartureTracker({
    now: () => 0,
    newId: () => `episode-${++seq}`,
    coalesceMs,
  });
}

describe('DepartureTracker', () => {
  it('groups blur + hidden + fullscreen-exit from one departure into one episode', () => {
    const tracker = makeTracker();
    const first = tracker.onDepartureSignal('focus_lost', 1000);
    const second = tracker.onDepartureSignal('visibility_hidden', 1050);
    const third = tracker.onDepartureSignal('fullscreen_exit', 1100);

    expect(first.isNewEpisode).toBe(true);
    expect(second.isNewEpisode).toBe(false);
    expect(third.isNewEpisode).toBe(false);
    expect(first.episode.episodeId).toBe(third.episode.episodeId);
    expect(third.episode.signals).toEqual([
      'focus_lost',
      'visibility_hidden',
      'fullscreen_exit',
    ]);
  });

  it('treats a prolonged absence as a single episode', () => {
    const tracker = makeTracker();
    const first = tracker.onDepartureSignal('visibility_hidden', 1000);
    const later = tracker.onDepartureSignal('focus_lost', 60_000);
    expect(first.isNewEpisode).toBe(true);
    expect(later.isNewEpisode).toBe(false);
    expect(later.episode.episodeId).toBe(first.episode.episodeId);
  });

  it('does not rearm until visible, focused, and fullscreen are all restored', () => {
    const tracker = makeTracker();
    tracker.onDepartureSignal('visibility_hidden', 1000);

    expect(
      tracker.observeRecovery({ visible: false, focused: true, fullscreen: true }, 1100).rearmed,
    ).toBe(false);
    expect(
      tracker.observeRecovery({ visible: true, focused: false, fullscreen: true }, 1200).rearmed,
    ).toBe(false);
    expect(
      tracker.observeRecovery({ visible: true, focused: true, fullscreen: false }, 1300).rearmed,
    ).toBe(false);
    expect(tracker.currentPhase).toBe('active');
    expect(
      tracker.observeRecovery({ visible: true, focused: true, fullscreen: true }, 1400).rearmed,
    ).toBe(true);
    expect(tracker.currentPhase).toBe('armed');
  });

  it('counts a second distinct departure after recovery as a new episode', () => {
    const tracker = makeTracker();
    const first = tracker.onDepartureSignal('visibility_hidden', 1000);
    tracker.observeRecovery({ visible: true, focused: true, fullscreen: true }, 1500);

    // Outside the coalescing window: genuinely new departure.
    const second = tracker.onDepartureSignal('focus_lost', 1500 + 2000);
    expect(second.isNewEpisode).toBe(true);
    expect(second.episode.episodeId).not.toBe(first.episode.episodeId);
  });

  it('absorbs a tail signal that arrives just after recovery (no double count)', () => {
    const tracker = makeTracker(1200);
    const first = tracker.onDepartureSignal('focus_lost', 1000);
    tracker.observeRecovery({ visible: true, focused: true, fullscreen: true }, 1500);

    // Within the coalescing window: treated as the same physical departure.
    const tail = tracker.onDepartureSignal('fullscreen_exit', 1500 + 300);
    expect(tail.isNewEpisode).toBe(false);
    expect(tail.episode.episodeId).toBe(first.episode.episodeId);
  });

  it('deduplicates a navigation attempt against an overlapping departure signal', () => {
    const tracker = makeTracker();
    const departure = tracker.onDepartureSignal('visibility_hidden', 1000);
    const nav = tracker.onDepartureSignal('navigation_attempt', 1080);
    expect(departure.isNewEpisode).toBe(true);
    expect(nav.isNewEpisode).toBe(false);
    expect(nav.episode.episodeId).toBe(departure.episode.episodeId);
    expect(nav.episode.signals).toContain('navigation_attempt');
  });

  it('marks an episode as reported without changing its id (retry-safe)', () => {
    const tracker = makeTracker();
    const episode = tracker.onDepartureSignal('visibility_hidden', 1000);
    tracker.markReported(episode.episode.episodeId);
    expect(tracker.activeEpisode?.reported).toBe(true);
    expect(tracker.activeEpisode?.episodeId).toBe(episode.episode.episodeId);
  });
});
