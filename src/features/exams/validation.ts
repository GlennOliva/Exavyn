import type { ExamDraftInput } from './types';

export interface ExamValidationResult {
  ok: boolean;
  errors: string[];
  itemCount: number;
  maxScore: number;
}

/**
 * Mirrors the server-side validation in `app.validate_exam_payload` so authors
 * get immediate feedback. The database remains the authority.
 */
export function validateExamDraft(input: Partial<ExamDraftInput>): ExamValidationResult {
  const errors: string[] = [];
  const questions = input.questions ?? [];

  if (!input.title || input.title.trim().length === 0) {
    errors.push('An exam title is required.');
  }
  if (!input.duration_minutes || input.duration_minutes <= 0) {
    errors.push('Duration must be positive.');
  }
  if (
    input.pass_threshold !== null &&
    input.pass_threshold !== undefined &&
    (input.pass_threshold < 0 || input.pass_threshold > 100)
  ) {
    errors.push('Pass threshold must be between 0 and 100.');
  }
  if (input.max_attempts !== undefined) {
    if (
      !Number.isInteger(input.max_attempts) ||
      input.max_attempts < 1 ||
      input.max_attempts > 20
    ) {
      errors.push('Maximum attempts must be a whole number between 1 and 20.');
    }
  }
  if (input.opens_at && input.closes_at) {
    if (new Date(input.opens_at).getTime() >= new Date(input.closes_at).getTime()) {
      errors.push('The opening time must be before the closing time.');
    }
  } else {
    errors.push('Both an opening and a closing time are required.');
  }

  if (questions.length < 1) {
    errors.push('At least one question is required.');
  }

  questions.forEach((question, index) => {
    const label = `Question ${index + 1}`;
    if (!question.prompt || question.prompt.trim().length === 0) {
      errors.push(`${label} needs a prompt.`);
    }
    if (!Number.isFinite(question.points) || question.points <= 0) {
      errors.push(`${label} needs a positive point value.`);
    }
    const options = question.options ?? [];
    if (options.length !== 4) {
      errors.push(`${label} must have exactly four choices.`);
    }
    if (options.some((option) => !option || option.trim().length === 0)) {
      errors.push(`${label} has an empty choice.`);
    }
    if (
      !Number.isInteger(question.correctIndex) ||
      question.correctIndex < 0 ||
      question.correctIndex > 3
    ) {
      errors.push(`${label} needs exactly one correct option.`);
    }
  });

  const maxScore = questions.reduce(
    (total, question) => total + (Number(question.points) || 0),
    0,
  );

  return {
    ok: errors.length === 0,
    errors,
    itemCount: questions.length,
    maxScore: Math.round(maxScore * 100) / 100,
  };
}
