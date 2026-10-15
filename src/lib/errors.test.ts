import { describe, expect, it } from 'vitest';
import { AppError, errorMessage, toAppError } from './errors';

describe('toAppError / errorMessage', () => {
  it('maps a PostgREST error code to a safe message', () => {
    const err = { code: '42501', message: 'permission denied for table exams' };
    expect(errorMessage(err)).toBe('You do not have permission to perform this action.');
  });

  it('maps the Supabase email send rate limit to a student-friendly message', () => {
    const err = {
      code: 'over_email_send_rate_limit',
      status: 429,
      message: 'email rate limit exceeded',
    };
    const message = errorMessage(err);
    expect(message).toMatch(/too many emails/i);
    expect(message).not.toMatch(/email rate limit exceeded/i);
  });

  it('recognizes the snake_case error_code field', () => {
    const err = { error_code: 'over_email_send_rate_limit', message: 'raw' };
    expect(errorMessage(err)).toMatch(/too many emails/i);
  });

  it('maps a bare HTTP 429 to a generic rate-limit message', () => {
    expect(errorMessage({ status: 429, message: 'raw 429' })).toMatch(/too many requests/i);
  });

  it('maps duplicate-email signup to a sign-in hint', () => {
    expect(errorMessage({ code: 'user_already_exists', message: 'x' })).toMatch(/already exists/i);
  });

  it('passes through unknown messages unchanged', () => {
    expect(errorMessage(new Error('boom'))).toBe('boom');
  });

  it('preserves authored P0002 availability distinctions instead of "not found"', () => {
    expect(errorMessage({ code: 'P0002', message: 'Exam has not opened yet' })).toBe(
      'This exam has not opened yet.',
    );
    expect(errorMessage({ code: 'P0002', message: 'Exam has closed' })).toBe(
      'This exam has closed.',
    );
    expect(errorMessage({ code: 'P0002', message: 'Exam not found' })).toBe(
      'This exam could not be found.',
    );
    expect(errorMessage({ code: 'P0002', message: 'Exam has not opened yet' })).not.toMatch(
      /record could not be found/i,
    );
  });

  it('falls back to the authored P0002 message for an unmapped condition', () => {
    expect(errorMessage({ code: 'P0002', message: 'A new authored condition' })).toBe(
      'A new authored condition',
    );
  });

  it('preserves an AppError identity', () => {
    const original = new AppError('custom', 'X');
    expect(toAppError(original)).toBe(original);
  });
});
