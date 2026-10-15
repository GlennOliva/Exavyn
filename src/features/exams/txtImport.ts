import type { ExamDraftQuestion } from './types';

/**
 * Parser for plain-text questionnaires in this format:
 *
 *   1. Which of the following is a prime number?
 *   a) 4
 *   *b) 5
 *   c) 6
 *   d) 8
 *
 * An asterisk immediately before a choice letter marks the correct answer. The
 * asterisk is stripped from the stored/displayed option text and the answer is
 * kept only as `correctIndex`, so no correctness material ever reaches a
 * student through the option labels.
 *
 * The parser never rewrites question or option content (only surrounding
 * indentation is trimmed). Every problem is reported with the question number
 * and 1-based source line so a teacher can fix the file precisely. A non-empty
 * `issues` list means the whole import is rejected — callers must not import a
 * partial result.
 */

export interface TxtImportIssue {
  /** 1-based line number in the source text. */
  line: number;
  /** Actionable, teacher-facing description. */
  message: string;
}

export interface TxtImportResult {
  questions: ExamDraftQuestion[];
  issues: TxtImportIssue[];
  ok: boolean;
}

const QUESTION_RE = /^(\d+)[.)]\s*(.*)$/;
const OPTION_RE = /^(\*)?\s*([a-hA-H])[.)]\s*(.*)$/;

const MAX_SNIPPET = 60;

function snippet(value: string): string {
  const trimmed = value.trim();
  return trimmed.length > MAX_SNIPPET ? `${trimmed.slice(0, MAX_SNIPPET)}…` : trimmed;
}

interface DraftOption {
  letter: string;
  text: string;
  marked: boolean;
  line: number;
}

interface DraftQuestion {
  number: string;
  startLine: number;
  promptParts: string[];
  options: DraftOption[];
}

export function parseTxtQuestionnaire(input: string): TxtImportResult {
  const issues: TxtImportIssue[] = [];
  const questions: ExamDraftQuestion[] = [];
  const lines = input.replace(/\r\n?/g, '\n').split('\n');
  let current: DraftQuestion | null = null;

  const flush = () => {
    if (!current) return;
    const draft = current;
    current = null;

    const prompt = draft.promptParts.join(' ').trim();
    const markedCount = draft.options.filter((option) => option.marked).length;
    const where = `Question ${draft.number} (line ${draft.startLine})`;

    if (prompt.length === 0) {
      issues.push({ line: draft.startLine, message: `${where}: missing question text.` });
    }
    if (draft.options.length !== 4) {
      issues.push({
        line: draft.startLine,
        message: `${where}: expected exactly 4 choices, found ${draft.options.length}.`,
      });
    }
    if (markedCount === 0) {
      issues.push({
        line: draft.startLine,
        message: `${where}: no choice is marked correct. Put an asterisk before the correct choice, e.g. "*b) ...".`,
      });
    } else if (markedCount > 1) {
      issues.push({
        line: draft.startLine,
        message: `${where}: ${markedCount} choices are marked correct; mark exactly one.`,
      });
    }
    for (const option of draft.options) {
      if (option.text.trim().length === 0) {
        issues.push({
          line: option.line,
          message: `Question ${draft.number} (line ${option.line}): choice "${option.letter}" has no text.`,
        });
      }
    }

    const correctIndex = draft.options.findIndex((option) => option.marked);
    questions.push({
      prompt,
      points: 1,
      options: draft.options.map((option) => option.text.trim()),
      correctIndex: correctIndex >= 0 ? correctIndex : 0,
      explanation: '',
    });
  };

  lines.forEach((raw, index) => {
    const line = index + 1;
    const trimmed = raw.trim();
    if (trimmed.length === 0) return;

    const questionMatch = QUESTION_RE.exec(trimmed);
    if (questionMatch) {
      flush();
      current = {
        number: questionMatch[1],
        startLine: line,
        promptParts: questionMatch[2].trim() ? [questionMatch[2].trim()] : [],
        options: [],
      };
      return;
    }

    const optionMatch = OPTION_RE.exec(trimmed);
    if (optionMatch) {
      if (!current) {
        issues.push({
          line,
          message: `Line ${line}: choice "${optionMatch[2]}" appears before any question. Start a question first, e.g. "1. ...".`,
        });
        return;
      }
      current.options.push({
        letter: optionMatch[2],
        text: optionMatch[3],
        marked: Boolean(optionMatch[1]),
        line,
      });
      return;
    }

    // Anything else is either a wrapped prompt line (before the choices) or a
    // mistake we must report rather than silently ignore.
    if (current && current.options.length === 0) {
      current.promptParts.push(trimmed);
    } else if (current) {
      issues.push({
        line,
        message: `Question ${current.number} (line ${line}): expected a choice like "a) ..." but found "${snippet(trimmed)}".`,
      });
    } else {
      issues.push({
        line,
        message: `Line ${line}: expected a numbered question like "1. ..." but found "${snippet(trimmed)}".`,
      });
    }
  });
  flush();

  if (questions.length === 0) {
    issues.push({
      line: 1,
      message: 'No questions found. Start each question with a number, e.g. "1. ...".',
    });
  }

  return { questions, issues, ok: issues.length === 0 && questions.length > 0 };
}
