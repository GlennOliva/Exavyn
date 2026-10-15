import { describe, expect, it } from 'vitest';
import {
  formatDuration,
  percent,
  remainingMs,
  submissionReasonLabel,
} from './format';

describe('remainingMs', () => {
  it('returns the time until the server deadline', () => {
    const deadline = '2026-01-01T10:00:00.000Z';
    const now = new Date('2026-01-01T09:59:00.000Z').getTime();
    expect(remainingMs(deadline, now)).toBe(60_000);
  });

  it('is floored at zero once the deadline has passed', () => {
    const deadline = '2026-01-01T10:00:00.000Z';
    const now = new Date('2026-01-01T10:00:05.000Z').getTime();
    expect(remainingMs(deadline, now)).toBe(0);
  });

  it('returns zero for an invalid deadline', () => {
    expect(remainingMs('not-a-date')).toBe(0);
  });
});

describe('formatDuration', () => {
  it('formats minutes and seconds', () => {
    expect(formatDuration(0)).toBe('00:00');
    expect(formatDuration(61_000)).toBe('01:01');
  });

  it('formats hours when present', () => {
    expect(formatDuration(3_661_000)).toBe('01:01:01');
  });

  it('never renders negative time', () => {
    expect(formatDuration(-5000)).toBe('00:00');
  });
});

describe('percent', () => {
  it('formats a number with a fixed precision', () => {
    expect(percent(83.3333)).toBe('83.3%');
  });

  it('renders an em dash when absent', () => {
    expect(percent(null)).toBe('—');
  });
});

describe('submissionReasonLabel', () => {
  it('maps known reasons to human labels', () => {
    expect(submissionReasonLabel('manual')).toBe('Submitted manually');
    expect(submissionReasonLabel('violation_limit')).toBe(
      'Auto-submitted (violation limit)',
    );
    expect(submissionReasonLabel('time_expired')).toBe(
      'Auto-submitted (time expired)',
    );
  });

  it('falls back for unknown reasons', () => {
    expect(submissionReasonLabel(null)).toBe('—');
  });
});
