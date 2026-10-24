import { supabase } from '../../lib/supabase';
import { AppError, toAppError } from '../../lib/errors';
import type {
  AcquireControllerResult,
  AttemptPayload,
  AttemptReview,
  MyExamAttempts,
  MyResultRow,
  MyResultsPage,
  ResultData,
  SaveAnswerResult,
  StartAttemptResult,
  ViolationResult,
} from './types';
import type { ViolationSignal } from '../monitoring/types';

export async function startAttempt(
  examId: string,
  currentToken: string | null = null,
): Promise<StartAttemptResult> {
  const { data, error } = await supabase.rpc('start_attempt', {
    p_exam_id: examId,
    p_current_token: currentToken,
  });
  if (error) throw toAppError(error);
  return data as unknown as StartAttemptResult;
}

export async function getAttemptReview(attemptId: string): Promise<AttemptReview> {
  const [{ data, error }, release] = await Promise.all([
    supabase.rpc('get_attempt_review', { p_attempt_id: attemptId }),
    supabase.rpc('get_attempt_release_status', { p_attempt_id: attemptId }),
  ]);
  if (error) throw toAppError(error);
  if (release.error) throw toAppError(release.error);
  const review = data as unknown as AttemptReview;
  const status = release.data as unknown as { review?: { at?: string | null } };
  return { ...review, review_release_at: status.review?.at ?? null };
}

export async function acquireAttemptController(
  attemptId: string,
  currentToken: string | null,
): Promise<AcquireControllerResult> {
  const { data, error } = await supabase.rpc('acquire_attempt_controller', {
    p_attempt_id: attemptId,
    p_current_token: currentToken,
  });
  if (error) throw toAppError(error);
  return data as unknown as AcquireControllerResult;
}

export async function getAttemptPayload(attemptId: string): Promise<AttemptPayload> {
  const { data, error } = await supabase.rpc('get_attempt_payload', {
    p_attempt_id: attemptId,
  });
  if (error) throw toAppError(error);
  return data as unknown as AttemptPayload;
}

export async function saveAnswer(params: {
  attemptId: string;
  questionId: string;
  optionId: string | null;
  revision: number;
  requestId: string;
  controllerToken: string;
}): Promise<SaveAnswerResult> {
  const { data, error } = await supabase.rpc('save_answer', {
    p_attempt_id: params.attemptId,
    p_question_id: params.questionId,
    p_option_id: params.optionId,
    p_revision: params.revision,
    p_request_id: params.requestId,
    p_controller_token: params.controllerToken,
  });
  if (error) throw toAppError(error);
  return data as unknown as SaveAnswerResult;
}

export async function recordViolation(params: {
  attemptId: string;
  episodeId: string;
  signals: ViolationSignal[];
  observedAt: string;
  controllerToken: string;
}): Promise<ViolationResult> {
  const { data, error } = await supabase.rpc('record_violation', {
    p_attempt_id: params.attemptId,
    p_episode_id: params.episodeId,
    p_signals: params.signals,
    p_observed_at: params.observedAt,
    p_controller_token: params.controllerToken,
  });
  if (error) throw toAppError(error);
  return data as unknown as ViolationResult;
}

export async function submitAttempt(
  attemptId: string,
  controllerToken: string,
): Promise<ResultData> {
  const { data, error } = await supabase.rpc('submit_attempt', {
    p_attempt_id: attemptId,
    p_controller_token: controllerToken,
  });
  if (error) throw toAppError(error);
  const payload = data as unknown as ResultData & { error?: string };
  // A controller mismatch returns HTTP 200 with an error body rather than
  // raising, so translate it into a real error the UI can surface.
  if (payload.error === 'controller') {
    throw new AppError('This attempt is active in another session.', '55006');
  }
  return payload;
}

export async function getResult(attemptId: string): Promise<ResultData> {
  const [{ data, error }, release] = await Promise.all([
    supabase.rpc('get_result', { p_attempt_id: attemptId }),
    supabase.rpc('get_attempt_release_status', { p_attempt_id: attemptId }),
  ]);
  if (error) throw toAppError(error);
  if (release.error) throw toAppError(release.error);
  const result = data as unknown as ResultData;
  const status = release.data as unknown as { review?: { at?: string | null } };
  return { ...result, review_release_at: status.review?.at ?? null };
}

export async function sendHeartbeat(
  attemptId: string,
  controllerToken: string,
  seq: number,
): Promise<void> {
  const { error } = await supabase.rpc('heartbeat', {
    p_attempt_id: attemptId,
    p_controller_token: controllerToken,
    p_seq: seq,
  });
  if (error) throw toAppError(error);
}

export async function finalizeExpiredAttempts(): Promise<number> {
  const { data, error } = await supabase.rpc('finalize_expired_attempts');
  if (error) throw toAppError(error);
  return (data as number) ?? 0;
}

export async function getMyExamAttempts(examId: string): Promise<MyExamAttempts> {
  const { data, error } = await supabase.rpc('get_my_exam_attempts', {
    p_exam_id: examId,
  });
  if (error) throw toAppError(error);
  return data as unknown as MyExamAttempts;
}

export async function getMyResults(): Promise<MyResultRow[]> {
  const { data, error } = await supabase.rpc('get_my_results');
  if (error) throw toAppError(error);
  return (data as unknown as MyResultRow[]) ?? [];
}

export async function getMyResultsPage(params: {
  page: number;
  pageSize: number;
  q: string;
}): Promise<MyResultsPage> {
  const { data, error } = await supabase.rpc('get_my_results_page', {
    p_search: params.q,
    p_page: params.page,
    p_page_size: params.pageSize,
  });
  if (error) throw toAppError(error);
  return data as unknown as MyResultsPage;
}
