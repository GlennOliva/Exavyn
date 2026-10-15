/** Signals that can indicate a departure from the exam environment. */
export type ViolationSignal =
  | 'visibility_hidden'
  | 'focus_lost'
  | 'fullscreen_exit'
  | 'navigation_attempt';

export interface DepartureEpisode {
  episodeId: string;
  signals: ViolationSignal[];
  firstSignalAt: number;
  lastSignalAt: number;
  reported: boolean;
}

export interface RecoverySnapshot {
  visible: boolean;
  focused: boolean;
  fullscreen: boolean;
}

export type MonitorPhase = 'armed' | 'active';

export interface MonitorSignalResult {
  episode: DepartureEpisode;
  isNewEpisode: boolean;
}
