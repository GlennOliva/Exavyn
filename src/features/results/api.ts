import { supabase } from '../../lib/supabase';
import { toAppError } from '../../lib/errors';
import type {
  AttemptState,
  ExamAttemptRow,
  ProfileRow,
  ViolationEventRow,
} from '../../lib/database.types';
import {
  pageRange,
  type PageResult,
} from '../../lib/pagination';

export interface AttemptWithStudent extends ExamAttemptRow {
  student: Pick<ProfileRow, 'id' | 'full_name' | 'email'> | null;
}

export type AttemptResultRow = Omit<ExamAttemptRow, 'controller_token'> & {
  student: Pick<ProfileRow, 'id' | 'full_name' | 'email'> | null;
};

type AttemptPageState = 'all' | AttemptState;

interface AttemptPageResult {
  rows?: AttemptResultRow[];
  total?: number;
}

export async function listExamAttempts(examId: string): Promise<AttemptWithStudent[]> {
  const { data, error } = await supabase
    .from('exam_attempts')
    .select('*, student:profiles!exam_attempts_student_id_fkey(id, full_name, email)')
    .eq('exam_id', examId)
    .order('started_at', { ascending: false });
  if (error) throw toAppError(error);
  return (data ?? []) as unknown as AttemptWithStudent[];
}

export async function listCourseAttempts(courseId: string): Promise<AttemptWithStudent[]> {
  const { data: exams, error: examError } = await supabase
    .from('exams')
    .select('id')
    .eq('course_id', courseId);
  if (examError) throw toAppError(examError);
  const examIds = (exams ?? []).map((e) => e.id);
  if (examIds.length === 0) return [];

  const { data, error } = await supabase
    .from('exam_attempts')
    .select('*, student:profiles!exam_attempts_student_id_fkey(id, full_name, email)')
    .in('exam_id', examIds)
    .order('started_at', { ascending: false });
  if (error) throw toAppError(error);
  return (data ?? []) as unknown as AttemptWithStudent[];
}

export async function listAttemptViolations(
  attemptId: string,
): Promise<ViolationEventRow[]> {
  const { data, error } = await supabase
    .from('violation_events')
    .select('*')
    .eq('attempt_id', attemptId)
    .order('received_at', { ascending: true });
  if (error) throw toAppError(error);
  return data ?? [];
}

export async function listFlaggedAttempts(): Promise<AttemptWithStudent[]> {
  const { data, error } = await supabase
    .from('exam_attempts')
    .select('*, student:profiles!exam_attempts_student_id_fkey(id, full_name, email)')
    .gt('violation_count', 0)
    .order('started_at', { ascending: false });
  if (error) throw toAppError(error);
  return (data ?? []) as unknown as AttemptWithStudent[];
}


function normalizeAttemptPage(data: unknown, fallback: PageResult<AttemptResultRow>) {
  const page = (data ?? {}) as AttemptPageResult;
  return {
    rows: page.rows ?? fallback.rows,
    total: typeof page.total === 'number' ? page.total : fallback.total,
  };
}

function pageState(state: AttemptPageState | undefined): AttemptState | null {
  return state && state !== 'all' ? state : null;
}

export async function listExamAttemptsPage(
  examId: string,
  params: { page: number; pageSize: number; q: string; state?: AttemptPageState },
): Promise<PageResult<AttemptResultRow>> {
  const { data, error } = await supabase.rpc('get_exam_attempts_page', {
    p_exam_id: examId,
    p_search: params.q,
    p_state: pageState(params.state),
    p_page: params.page,
    p_page_size: params.pageSize,
  });
  if (error) throw toAppError(error);
  const empty = { rows: [], total: 0 };
  return normalizeAttemptPage(data, empty);
}

export async function listCourseAttemptsPage(
  courseId: string,
  params: { page: number; pageSize: number; q: string; state?: AttemptPageState },
): Promise<PageResult<AttemptResultRow>> {
  const { data, error } = await supabase.rpc('get_course_attempts_page', {
    p_course_id: courseId,
    p_search: params.q,
    p_state: pageState(params.state),
    p_page: params.page,
    p_page_size: params.pageSize,
  });
  if (error) throw toAppError(error);
  const empty = { rows: [], total: 0 };
  return normalizeAttemptPage(data, empty);
}

export async function listAttemptViolationsPage(
  attemptId: string,
  params: { page: number; pageSize: number },
): Promise<PageResult<ViolationEventRow>> {
  const { from, to } = pageRange(params.page, params.pageSize);
  const { data, count, error } = await supabase
    .from('violation_events')
    .select('*', { count: 'exact' })
    .eq('attempt_id', attemptId)
    .order('received_at', { ascending: true })
    .order('id', { ascending: true })
    .range(from, to);
  if (error) throw toAppError(error);
  return { rows: data ?? [], total: count ?? 0 };
}
