import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { examAvailability, isoToLocalInput, localInputToIso } from './datetime';
import { formatDateTimeWithZone } from './format';

describe('examAvailability', () => {
  const opens = '2026-10-14T06:00:00.000Z';
  const closes = '2026-10-14T08:00:00.000Z';

  it('is upcoming before the opening time', () => {
    expect(examAvailability(opens, closes, Date.parse('2026-10-14T05:59:59Z'))).toBe('upcoming');
  });

  it('is open once the window opens', () => {
    expect(examAvailability(opens, closes, Date.parse('2026-10-14T06:00:00.000Z'))).toBe('open');
  });

  it('is closed at and after the closing time', () => {
    expect(examAvailability(opens, closes, Date.parse('2026-10-14T08:00:00.000Z'))).toBe('closed');
    expect(examAvailability(opens, closes, Date.parse('2026-10-15T00:00:00.000Z'))).toBe('closed');
  });
});

describe('instructor datetime conversion (Asia/Manila, UTC+8)', () => {
  beforeEach(() => {
    vi.stubEnv('TZ', 'Asia/Manila');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('converts a local wall-clock input to the correct UTC instant', () => {
    // 2:53 PM in Asia/Manila is 06:53 UTC.
    expect(localInputToIso('2026-10-14T14:53')).toBe('2026-10-14T06:53:00.000Z');
  });

  it('round-trips an instant back to the same local input value', () => {
    expect(isoToLocalInput('2026-10-14T06:53:00.000Z')).toBe('2026-10-14T14:53');
    expect(localInputToIso(isoToLocalInput('2026-10-14T06:53:00.000Z'))).toBe(
      '2026-10-14T06:53:00.000Z',
    );
  });

  it('returns null for empty or invalid input', () => {
    expect(localInputToIso('')).toBeNull();
    expect(localInputToIso('not-a-date')).toBeNull();
  });
});

describe('formatDateTimeWithZone', () => {
  it('renders the instant with an explicit named timezone', () => {
    const text = formatDateTimeWithZone('2026-10-14T06:53:00.000Z', 'Asia/Manila');
    expect(text).toContain('Asia/Manila');
    expect(text).toMatch(/2:53/);
  });

  it('renders an em dash for missing values', () => {
    expect(formatDateTimeWithZone(null, 'Asia/Manila')).toBe('—');
  });
});
