import { describe, expect, it } from 'vitest';
import { validateExamDraft } from './validation';
import type { ExamDraftInput, ExamDraftQuestion } from './types';

function question(overrides: Partial<ExamDraftQuestion> = {}): ExamDraftQuestion {
  return {
    prompt: 'What is 2 + 2?',
    points: 1,
    options: ['One', 'Two', 'Three', 'Four'],
    correctIndex: 0,
    explanation: '',
    ...overrides,
  };
}

function exam(overrides: Partial<ExamDraftInput> = {}): ExamDraftInput {
  return {
    course_id: 'course-1',
    title: 'Midterm',
    instructions: '',
    duration_minutes: 60,
    opens_at: '2026-01-01T09:00:00.000Z',
    closes_at: '2026-01-01T10:00:00.000Z',
    question_randomization: false,
    option_randomization: false,
    result_release: 'immediate',
    max_attempts: 1,
    result_policy: 'latest',
    answer_review: 'immediate',
    pass_threshold: null,
    questions: [question()],
    ...overrides,
  };
}

describe('validateExamDraft', () => {
  it('accepts a valid 50-item exam and reports item count and max score', () => {
    const questions = Array.from({ length: 50 }, () => question({ points: 1 }));
    const result = validateExamDraft(exam({ questions }));
    expect(result.ok).toBe(true);
    expect(result.itemCount).toBe(50);
    expect(result.maxScore).toBe(50);
  });

  it('rejects a missing title', () => {
    const result = validateExamDraft(exam({ title: '   ' }));
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => /title/i.test(e))).toBe(true);
  });

  it('rejects a non-positive duration', () => {
    const result = validateExamDraft(exam({ duration_minutes: 0 }));
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => /duration/i.test(e))).toBe(true);
  });

  it('rejects an opening time after the closing time', () => {
    const result = validateExamDraft(
      exam({ opens_at: '2026-01-02T09:00:00.000Z', closes_at: '2026-01-01T09:00:00.000Z' }),
    );
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => /opening time/i.test(e))).toBe(true);
  });

  it('rejects a question with fewer than four choices', () => {
    const result = validateExamDraft(
      exam({ questions: [question({ options: ['only', 'three', 'here'] })] }),
    );
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => /four choices/i.test(e))).toBe(true);
  });

  it('rejects an empty choice', () => {
    const result = validateExamDraft(
      exam({ questions: [question({ options: ['a', ' ', 'c', 'd'] })] }),
    );
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => /empty choice/i.test(e))).toBe(true);
  });

  it('rejects an out-of-range correct option', () => {
    const result = validateExamDraft(exam({ questions: [question({ correctIndex: 4 })] }));
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => /correct option/i.test(e))).toBe(true);
  });

  it('rejects zero questions', () => {
    const result = validateExamDraft(exam({ questions: [] }));
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => /at least one question/i.test(e))).toBe(true);
  });
});
