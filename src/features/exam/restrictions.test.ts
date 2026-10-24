import { describe, expect, it } from 'vitest';
import { isBlockedExamShortcut, isEditableExamTarget } from './restrictions';

describe('exam interaction restrictions', () => {
  it('blocks page copy/cut shortcuts without disabling navigation keys', () => {
    expect(isBlockedExamShortcut(new KeyboardEvent('keydown', { key: 'c', ctrlKey: true }))).toBe(true);
    expect(isBlockedExamShortcut(new KeyboardEvent('keydown', { key: 'x', metaKey: true }))).toBe(true);
    expect(isBlockedExamShortcut(new KeyboardEvent('keydown', { key: 'Tab' }))).toBe(false);
    expect(isBlockedExamShortcut(new KeyboardEvent('keydown', { key: 'ArrowRight' }))).toBe(false);
  });

  it('does not block editing or paste in text fields', () => {
    const input = document.createElement('input');
    const copy = new KeyboardEvent('keydown', { key: 'c', ctrlKey: true });
    Object.defineProperty(copy, 'target', { value: input });
    expect(isEditableExamTarget(input)).toBe(true);
    expect(isBlockedExamShortcut(copy)).toBe(false);
    expect(isBlockedExamShortcut(new KeyboardEvent('keydown', { key: 'v', ctrlKey: true }))).toBe(false);
  });
});
