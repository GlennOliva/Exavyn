import type {
  AnswerReviewPolicy,
  AttemptState,
  MultiAttemptPolicy,
  ResultReleasePolicy,
  SubmissionReason,
} from '../../lib/database.types';

/** Server-provided explanation of when (or whether) answer review is available. */
export type ReviewReason =
  | 'not_found'
  | 'in_progress'
  | 'never'
  | 'score_pending'
  | 'awaiting_close'
  | 'awaiting_attempts'
  | 'immediate'
  | 'after_close'
  | 'after_attempts'
  | 'privileged';

export interface AttemptOption {
  id: string;
  label: string;
}

export interface AttemptQuestion {
  id: string;
  prompt: string;
  points: number;
  options: AttemptOption[];
  saved_option_id: string | null;
}

export interface AttemptPayload {
  attempt: {
    id: string;
    state: AttemptState;
    started_at: string;
    deadline_at: string;
    violation_count: number;
    violation_threshold: number;
    submission_reason: SubmissionReason | null;
  };
  exam: {
    title: string;
    instructions: string;
    duration_minutes: number;
    item_count: number;
    result_release: 'immediate' | 'after_close';
    closes_at: string;
  };
  questions: AttemptQuestion[];
}

export interface StartAttemptResult {
  attempt_id: string;
  resumed: boolean;
  attempt_no?: number;
  max_attempts?: number;
  controller_token: string;
  deadline_at: string;
  started_at: string;
  violation_count: number;
  violation_threshold: number;
}

export interface AcquireControllerResult {
  controller_token: string;
  lease_expires_at?: string;
  rotated?: boolean;
  state?: AttemptState;
}

export interface SaveAnswerResult {
  accepted: boolean;
  reason: string;
  revision?: number;
  attempt_state?: AttemptState;
  deadline_at?: string;
}

export interface ViolationResult {
  violation_count: number;
  attempt_state: AttemptState;
  submission_reason?: SubmissionReason | null;
  violation_threshold?: number;
  finalized: boolean;
  duplicate: boolean;
  error?: string;
}

export interface ResultData {
  attempt_state: AttemptState;
  attempt_no?: number;
  max_attempts?: number;
  used_attempts?: number;
  remaining_attempts?: number;
  submission_reason?: SubmissionReason;
  submitted_at?: string;
  time_spent_seconds?: number | null;
  violation_count: number;
  max_points?: number;
  result_release?: ResultReleasePolicy;
  released?: boolean;
  earned_points?: number | null;
  percentage?: number | null;
  correct_count?: number | null;
  answered_count?: number | null;
  item_count?: number;
  pass_threshold?: number | null;
  passed?: boolean | null;
  review_policy?: AnswerReviewPolicy;
  review_released?: boolean;
  review_reason?: ReviewReason;
  deadline_at?: string;
}

export interface ExamAttemptSummary {
  id: string;
  attempt_no: number;
  state: AttemptState;
  started_at: string;
  deadline_at: string;
  submitted_at: string | null;
  submission_reason: SubmissionReason | null;
  violation_count: number;
  released: boolean;
  earned_points: number | null;
  max_points: number | null;
  percentage: number | null;
  pass_threshold: number | null;
  passed: boolean | null;
  review_policy: AnswerReviewPolicy;
  review_released: boolean;
  review_reason: ReviewReason;
}

export interface MyExamAttempts {
  max_attempts: number;
  used: number;
  remaining: number;
  result_policy: MultiAttemptPolicy;
  answer_review: AnswerReviewPolicy;
  pass_threshold: number | null;
  active_attempt_id: string | null;
  attempts: ExamAttemptSummary[];
  summary: {
    attempt_no: number;
    percentage: number | null;
    earned_points: number | null;
    max_points: number | null;
    pass_threshold: number | null;
    passed: boolean | null;
  } | null;
}

export interface MyResultRow {
  id: string;
  exam_id: string;
  exam_title: string | null;
  course_id: string;
  attempt_no: number;
  state: AttemptState;
  submission_reason: SubmissionReason | null;
  started_at: string;
  submitted_at: string | null;
  violation_count: number;
  result_release: ResultReleasePolicy;
  released: boolean;
  earned_points: number | null;
  max_points: number | null;
  percentage: number | null;
  pass_threshold: number | null;
  passed: boolean | null;
  review_policy: AnswerReviewPolicy;
  review_released: boolean;
  review_reason: ReviewReason;
}

export interface AttemptReviewOption {
  id: string;
  label: string;
}

export interface AttemptReviewQuestion {
  id: string;
  position: number;
  prompt: string;
  points: number;
  explanation: string;
  selected_option_id: string | null;
  correct_option_id: string | null;
  is_correct: boolean;
  options: AttemptReviewOption[];
}

export interface AttemptReview {
  attempt_state: AttemptState;
  attempt_no: number;
  exam_id: string;
  exam_title: string | null;
  submission_reason: SubmissionReason | null;
  submitted_at: string | null;
  violation_count: number;
  item_count: number;
  max_points: number;
  earned_points: number | null;
  percentage: number | null;
  correct_count: number | null;
  answered_count: number | null;
  pass_threshold: number | null;
  passed: boolean | null;
  review_policy: AnswerReviewPolicy;
  review_released: boolean;
  review_reason: ReviewReason;
  questions: AttemptReviewQuestion[];
}
