import { describe, expect, it } from 'vitest';
import { classifyScore, countsAsPassed, NEAR_PASSING_BAND } from './score';

describe('classifyScore', () => {
  it('uses the unrounded percentage for the passing boundary', () => {
    expect(classifyScore({ percentage: 80, passThreshold: 80 }).status).toBe('passed');
    expect(classifyScore({ percentage: 79.999, passThreshold: 80 }).status).toBe('near');
  });

  it('maps status to green, yellow, red, and neutral badge tones', () => {
    expect(classifyScore({ percentage: 80, passThreshold: 80 }).tone).toBe('success');
    expect(classifyScore({ percentage: 75, passThreshold: 80 }).tone).toBe('warning');
    expect(classifyScore({ percentage: 69, passThreshold: 80 }).tone).toBe('danger');
    expect(classifyScore({ percentage: 95, passThreshold: null }).tone).toBe('default');
    expect(
      classifyScore({ percentage: 95, passThreshold: 80, released: false }).tone,
    ).toBe('default');
  });

  it('marks the 10-point band below the threshold as near, never passed', () => {
    expect(NEAR_PASSING_BAND).toBe(10);
    expect(classifyScore({ percentage: 70, passThreshold: 80 }).status).toBe('near');
    expect(classifyScore({ percentage: 70, passThreshold: 80 }).label).toBe('Near passing');
    expect(countsAsPassed({ percentage: 70, passThreshold: 80 })).toBe(false);
    expect(classifyScore({ percentage: 69.999, passThreshold: 80 }).status).toBe('failed');
  });

  it('uses raw points instead of the display-rounded percentage', () => {
    expect(
      classifyScore({ percentage: 65, earnedPoints: 64.996, maxPoints: 100, passThreshold: 75 }).status,
    ).toBe('failed');
    expect(
      classifyScore({ percentage: 65, earnedPoints: 65, maxPoints: 100, passThreshold: 75 }).status,
    ).toBe('near');
  });

  it('is neutral when no threshold is configured', () => {
    const result = classifyScore({ percentage: 95, passThreshold: null });
    expect(result.status).toBe('neutral');
    expect(result.tone).toBe('default');
    expect(result.neutralReason).toBe('no-threshold');
    expect(result.label).not.toMatch(/pass/i);
  });

  it('does not leak unreleased or pending scores', () => {
    const unreleased = classifyScore({
      percentage: 95,
      passThreshold: 80,
      released: false,
      state: 'submitted',
    });
    expect(unreleased.status).toBe('neutral');
    expect(unreleased.label).not.toMatch(/pass|fail|near/i);

    const pending = classifyScore({
      percentage: null,
      passThreshold: 80,
      state: 'active',
    });
    expect(pending.status).toBe('neutral');
    expect(pending.label).toBe('Pending');
  });

  it('handles an authoritative zero threshold', () => {
    expect(classifyScore({ percentage: 0, passThreshold: 0 }).status).toBe('passed');
  });
});
