import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ImportTxtDialog } from './ImportTxtDialog';

const VALID = [
  '1. Which of the following is a prime number?',
  'a) 4',
  '*b) 5',
  'c) 6',
  'd) 8',
].join('\n');

const MALFORMED = ['1. Too few?', 'a) 1', '*b) 2', 'c) 3'].join('\n');

function paste(text: string) {
  const area = screen.getByLabelText(/or paste the questionnaire/i);
  fireEvent.change(area, { target: { value: text } });
  return area;
}

describe('ImportTxtDialog', () => {
  it('previews a valid import and confirms the parsed questions', async () => {
    const onConfirm = vi.fn();
    render(<ImportTxtDialog onCancel={vi.fn()} onConfirm={onConfirm} />);

    paste(VALID);

    expect(screen.getByText('Which of the following is a prime number?')).toBeInTheDocument();
    expect(screen.getByText('marked answer')).toBeInTheDocument();
    // The asterisk must never appear in the displayed option text (only in the
    // static format example above the preview).
    expect(screen.queryByText('*b) 5')).not.toBeInTheDocument();

    const confirm = screen.getByRole('button', { name: /import 1 question/i });
    expect(confirm).toBeEnabled();
    await userEvent.click(confirm);

    expect(onConfirm).toHaveBeenCalledTimes(1);
    const questions = onConfirm.mock.calls[0][0];
    expect(questions).toHaveLength(1);
    expect(questions[0].options).toEqual(['4', '5', '6', '8']);
    expect(questions[0].correctIndex).toBe(1);
  });

  it('shows actionable errors and blocks the import for malformed input', async () => {
    const onConfirm = vi.fn();
    render(<ImportTxtDialog onCancel={vi.fn()} onConfirm={onConfirm} />);

    paste(MALFORMED);

    expect(screen.getByRole('alert')).toHaveTextContent(/expected exactly 4 choices, found 3/i);
    const confirm = screen.getByRole('button', { name: /import/i });
    expect(confirm).toBeDisabled();
    await userEvent.click(confirm);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('calls onCancel when cancelled', async () => {
    const onCancel = vi.fn();
    render(<ImportTxtDialog onCancel={onCancel} onConfirm={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: /^cancel$/i }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
