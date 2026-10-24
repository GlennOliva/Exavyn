/**
 * Authoritative score classification used by every authorized result view.
 *
 * The teacher-configured passing threshold is the only authority. The yellow
 * band is exactly 10 percentage points wide and remains BELOW passing. The
 * comparison uses the unrounded stored percentage; rounding is display-only.
 * Missing thresholds and unreleased/pending results stay neutral so hidden
 * scores cannot leak through badge colour or wording.
 */

export type ScoreStatus = 'passed' | 'near' | 'failed' | 'neutral';
export type NeutralScoreReason = 'unreleased' | 'pending' | 'unavailable' | 'no-threshold';

export interface ScoreClassification {
  status: ScoreStatus;
  label: string;
  icon: string;
  tone: 'success' | 'warning' | 'danger' | 'default';
  neutralReason?: NeutralScoreReason;
}

export const NEAR_PASSING_BAND = 10;

export interface ClassifyScoreInput {
  percentage: number | null | undefined;
  passThreshold: number | null | undefined;
  /** Raw awarded points, when available. Preferred for the boundary check. */
  earnedPoints?: number | null;
  /** Raw available points, when available. Preferred for the boundary check. */
  maxPoints?: number | null;
  released?: boolean;
  state?: string | null;
}

export function classifyScore(input: ClassifyScoreInput): ScoreClassification {
  const { percentage, passThreshold, released, state } = input;

  if (state && state !== 'submitted') {
    return { status: 'neutral', label: 'Pending', icon: '…', tone: 'default', neutralReason: 'pending' };
  }
  if (released === false || percentage === null || percentage === undefined) {
    return {
      status: 'neutral',
      label: 'Pending release',
      icon: '…',
      tone: 'default',
      neutralReason: 'unreleased',
    };
  }
  if (passThreshold === null || passThreshold === undefined) {
    return {
      status: 'neutral',
      label: 'Not configured',
      icon: '—',
      tone: 'default',
      neutralReason: 'no-threshold',
    };
  }

  // Compare the authoritative unrounded score. The database stores percentage
  // at two decimals, so when raw points are available we recompute the exact
  // ratio instead of trusting the display-rounded percentage.
  const threshold = Number(passThreshold);
  const earned = Number(input.earnedPoints);
  const max = Number(input.maxPoints);
  const hasRawPoints =
    input.earnedPoints !== null &&
    input.earnedPoints !== undefined &&
    input.maxPoints !== null &&
    input.maxPoints !== undefined;
  const score =
    hasRawPoints && Number.isFinite(earned) && Number.isFinite(max) && max > 0
      ? (earned / max) * 100
      : Number(percentage);
  if (!Number.isFinite(threshold) || !Number.isFinite(score)) {
    return {
      status: 'neutral',
      label: 'Unavailable',
      icon: '—',
      tone: 'default',
      neutralReason: 'unavailable',
    };
  }

  if (score >= threshold) {
    return { status: 'passed', label: 'Passed', icon: '✓', tone: 'success' };
  }
  if (score >= threshold - NEAR_PASSING_BAND) {
    return { status: 'near', label: 'Near passing', icon: '!', tone: 'warning' };
  }
  return { status: 'failed', label: 'Failed', icon: '✕', tone: 'danger' };
}

/** True only when the authoritative score is at/above the configured pass mark. */
export function countsAsPassed(input: ClassifyScoreInput): boolean {
  return classifyScore(input).status === 'passed';
}
