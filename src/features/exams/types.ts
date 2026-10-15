import type {
  AnswerReviewPolicy,
  ExamState,
  MultiAttemptPolicy,
  ResultReleasePolicy,
} from '../../lib/database.types';

export interface ExamDraftQuestion {
  prompt: string;
  points: number;
  options: string[];
  correctIndex: number;
  explanation: string;
}

export interface ExamDraftInput {
  course_id: string;
  title: string;
  instructions: string;
  duration_minutes: number;
  opens_at: string;
  closes_at: string;
  question_randomization: boolean;
  option_randomization: boolean;
  result_release: ResultReleasePolicy;
  max_attempts: number;
  result_policy: MultiAttemptPolicy;
  answer_review: AnswerReviewPolicy;
  pass_threshold: number | null;
  questions: ExamDraftQuestion[];
}

export interface ExamSummary {
  id: string;
  course_id: string;
  title: string;
  state: ExamState;
  duration_minutes: number;
  opens_at: string;
  closes_at: string;
  item_count: number;
  max_score: number;
  result_release: ResultReleasePolicy;
  answer_review: AnswerReviewPolicy;
  pass_threshold: number | null;
  archived: boolean;
  created_at: string;
}

export function emptyQuestion(): ExamDraftQuestion {
  return { prompt: '', points: 1, options: ['', '', '', ''], correctIndex: 0, explanation: '' };
}
