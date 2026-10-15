import { describe, expect, it } from 'vitest';
import { parseTxtQuestionnaire } from './txtImport';

const SAMPLE = [
  '1. Which of the following is a prime number?',
  'a) 4',
  '*b) 5',
  'c) 6',
  'd) 8',
].join('\n');

describe('parseTxtQuestionnaire', () => {
  it('parses the documented sample and strips the answer asterisk', () => {
    const result = parseTxtQuestionnaire(SAMPLE);
    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.questions).toHaveLength(1);
    const question = result.questions[0];
    expect(question.prompt).toBe('Which of the following is a prime number?');
    expect(question.options).toEqual(['4', '5', '6', '8']);
    expect(question.correctIndex).toBe(1);
    expect(question.options.some((option) => option.includes('*'))).toBe(false);
  });

  it('parses multiple questions with blank lines, indentation, and CRLF endings', () => {
    const text = [
      '1. First question?',
      '   a) one',
      '   *b) two',
      '   c) three',
      '   d) four',
      '',
      '2. Second question?',
      '\ta) alpha',
      '\tb) bravo',
      '\tc) charlie',
      '\t*d) delta',
      '',
    ].join('\r\n');

    const result = parseTxtQuestionnaire(text);
    expect(result.ok).toBe(true);
    expect(result.questions).toHaveLength(2);
    expect(result.questions[0].correctIndex).toBe(1);
    expect(result.questions[1].correctIndex).toBe(3);
    expect(result.questions[1].options).toEqual(['alpha', 'bravo', 'charlie', 'delta']);
  });

  it('supports multi-line question prompts', () => {
    const text = [
      '1. Read the passage below and choose the best answer.',
      'The quick brown fox jumps over the lazy dog.',
      'a) a',
      '*b) b',
      'c) c',
      'd) d',
    ].join('\n');
    const result = parseTxtQuestionnaire(text);
    expect(result.ok).toBe(true);
    expect(result.questions[0].prompt).toBe(
      'Read the passage below and choose the best answer. The quick brown fox jumps over the lazy dog.',
    );
  });

  it('rejects a question with fewer than four choices and names the line', () => {
    const text = ['1. Too few?', 'a) 1', '*b) 2', 'c) 3'].join('\n');
    const result = parseTxtQuestionnaire(text);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => /expected exactly 4 choices, found 3/i.test(i.message))).toBe(
      true,
    );
    expect(result.issues[0].line).toBe(1);
  });

  it('rejects a question with more than four choices', () => {
    const text = ['1. Too many?', 'a) 1', '*b) 2', 'c) 3', 'd) 4', 'e) 5'].join('\n');
    const result = parseTxtQuestionnaire(text);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => /found 5/i.test(i.message))).toBe(true);
  });

  it('rejects a question with no marked answer', () => {
    const text = ['1. Unmarked?', 'a) 1', 'b) 2', 'c) 3', 'd) 4'].join('\n');
    const result = parseTxtQuestionnaire(text);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => /no choice is marked correct/i.test(i.message))).toBe(true);
  });

  it('rejects a question with more than one marked answer', () => {
    const text = ['1. Double?', '*a) 1', '*b) 2', 'c) 3', 'd) 4'].join('\n');
    const result = parseTxtQuestionnaire(text);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => /2 choices are marked correct/i.test(i.message))).toBe(true);
  });

  it('rejects a choice that appears before any question, with its line number', () => {
    const text = ['a) stray', '1. Real?', '*a) 1', 'b) 2', 'c) 3', 'd) 4'].join('\n');
    const result = parseTxtQuestionnaire(text);
    expect(result.ok).toBe(false);
    const issue = result.issues.find((i) => /before any question/i.test(i.message));
    expect(issue?.line).toBe(1);
  });

  it('rejects a question with no text', () => {
    const text = ['1.', 'a) 1', '*b) 2', 'c) 3', 'd) 4'].join('\n');
    const result = parseTxtQuestionnaire(text);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => /missing question text/i.test(i.message))).toBe(true);
  });

  it('rejects an empty choice and reports the choice line', () => {
    const text = ['1. Empty option?', 'a) 1', '*b) 2', 'c)', 'd) 4'].join('\n');
    const result = parseTxtQuestionnaire(text);
    expect(result.ok).toBe(false);
    const issue = result.issues.find((i) => /choice "c" has no text/i.test(i.message));
    expect(issue).toBeDefined();
    expect(issue!.line).toBe(4);
  });

  it('reports a numbered question before any question text and empty input', () => {
    expect(parseTxtQuestionnaire('').ok).toBe(false);
    expect(parseTxtQuestionnaire('\n\n').ok).toBe(false);
    expect(
      parseTxtQuestionnaire('').issues.some((i) => /no questions found/i.test(i.message)),
    ).toBe(true);
  });

  it('reports the true source line for an indented question', () => {
    const text = ['', '', '  1. Indented?', '  a) 1', '  *b) 2', '  c) 3', '  d) 4'].join('\n');
    const result = parseTxtQuestionnaire(text);
    expect(result.ok).toBe(true);
    expect(result.questions).toHaveLength(1);
  });

  it('does not partially import: one bad question rejects the whole file', () => {
    const text = [
      '1. Good question?',
      'a) 1',
      '*b) 2',
      'c) 3',
      'd) 4',
      '',
      '2. Bad question?',
      'a) only one',
    ].join('\n');
    const result = parseTxtQuestionnaire(text);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => /Question 2/.test(i.message))).toBe(true);
  });
});
