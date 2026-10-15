import type {
  DepartureEpisode,
  MonitorPhase,
  MonitorSignalResult,
  RecoverySnapshot,
  ViolationSignal,
} from './types';
import { DEPARTURE_COALESCE_MS } from '../../lib/config';

export interface DepartureTrackerOptions {
  now?: () => number;
  newId?: () => string;
  coalesceMs?: number;
}

const defaultId = (): string => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `ep-${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

/**
 * Groups overlapping browser signals (blur + visibilitychange +
 * fullscreenchange emitted by a single physical departure) into ONE episode
 * with a stable UUID so the backend increments the violation count once.
 *
 * The machine only returns to `armed` once the document is visible, the window
 * is focused, and required fullscreen is restored. Signals that arrive as the
 * tail of a just-recovered episode (within the short coalescing window) are
 * merged into that episode rather than opening a new one.
 */
export class DepartureTracker {
  private phase: MonitorPhase = 'armed';
  private episode: DepartureEpisode | null = null;
  private closedAt = Number.NEGATIVE_INFINITY;
  private readonly now: () => number;
  private readonly newId: () => string;
  private readonly coalesceMs: number;

  constructor(options: DepartureTrackerOptions = {}) {
    this.now = options.now ?? (() => Date.now());
    this.newId = options.newId ?? defaultId;
    this.coalesceMs = options.coalesceMs ?? DEPARTURE_COALESCE_MS;
  }

  get currentPhase(): MonitorPhase {
    return this.phase;
  }

  get activeEpisode(): DepartureEpisode | null {
    return this.episode;
  }

  get lastClosedAt(): number {
    return this.closedAt;
  }

  /**
   * Register a departure signal. Returns the episode it belongs to and whether
   * it opened a new episode (the only case that should count once).
   */
  onDepartureSignal(
    signal: ViolationSignal,
    at: number = this.now(),
  ): MonitorSignalResult {
    if (this.phase === 'active' && this.episode) {
      this.merge(this.episode, signal, at);
      return { episode: this.episode, isNewEpisode: false };
    }

    // Armed. Absorb tail signals that belong to a just-closed episode.
    if (this.episode && at - this.closedAt < this.coalesceMs) {
      this.merge(this.episode, signal, at);
      return { episode: this.episode, isNewEpisode: false };
    }

    const episode: DepartureEpisode = {
      episodeId: this.newId(),
      signals: [signal],
      firstSignalAt: at,
      lastSignalAt: at,
      reported: false,
    };
    this.episode = episode;
    this.phase = 'active';
    return { episode, isNewEpisode: true };
  }

  /**
   * Observe the recovery conditions after a departure. Rearms the machine only
   * when the student has fully returned to the monitored environment.
   */
  observeRecovery(
    snapshot: RecoverySnapshot,
    at: number = this.now(),
  ): { rearmed: boolean } {
    if (
      this.phase === 'active' &&
      snapshot.visible &&
      snapshot.focused &&
      snapshot.fullscreen
    ) {
      this.phase = 'armed';
      this.closedAt = at;
      return { rearmed: true };
    }
    return { rearmed: false };
  }

  markReported(episodeId: string): void {
    if (this.episode && this.episode.episodeId === episodeId) {
      this.episode.reported = true;
    }
  }

  reset(): void {
    this.phase = 'armed';
    this.episode = null;
    this.closedAt = Number.NEGATIVE_INFINITY;
  }

  private merge(
    episode: DepartureEpisode,
    signal: ViolationSignal,
    at: number,
  ): void {
    if (!episode.signals.includes(signal)) {
      episode.signals.push(signal);
    }
    episode.lastSignalAt = at;
  }
}

/**
 * Groups a burst of signal occurrences that arrive in the same tick/frame into
 * a single dispatch, used by the React hook to feed the tracker.
 */
export function dedupeSignals(signals: ViolationSignal[]): ViolationSignal[] {
  return Array.from(new Set(signals));
}
