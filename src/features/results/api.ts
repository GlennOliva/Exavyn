import { supabase } from '../../lib/supabase';
import { toAppError } from '../../lib/errors';
import type {
  ExamAttemptRow,
  ProfileRow,
  ViolationEventRow,
} from '../../lib/database.types';
import {
  escapePostgrestSearch,
  pageRange,
  type PageResult,
} from '../../lib/pagination';

export interface AttemptWithStudent extends ExamAttemptRow {
  student: Pick<ProfileRow, 'id' | 'full_name' | 'email'> | null;
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


export async function listExamAttemptsPage(
  examId: string,
  params: { page: number; pageSize: number; q: string; state?: 'all' | 'in_progress' | 'submitted' },
): Promise<PageResult<AttemptWithStudent>> {
  const { from, to } = pageRange(params.page, params.pageSize);
  const needle = escapePostgrestSearch(params.q);
  let query = supabase
    .from('exam_attempts')
    .select('*, student:profiles!exam_attempts_student_id_fkey(id, full_name, email)', {
      count: 'exact',
    })
    .eq('exam_id', examId);
  if (params.state && params.state !== 'all') query = query.eq('state', params.state);
  if (needle) {
    query = query.or(
      `student.full_name.ilike.%${needle}%,student.email.ilike.%${needle}%`,
    );
  }
  const { data, count, error } = await query
    .order('started_at', { ascending: false })
    .order('id', { ascending: false })
    .range(from, to);
  if (error) throw toAppError(error);
  return { rows: (data ?? []) as unknown as AttemptWithStudent[], total: count ?? 0 };
}

export async function listCourseAttemptsPage(
  courseId: string,
  params: { page: number; pageSize: number; q: string },
): Promise<PageResult<AttemptWithStudent>> {
  const { data: exams, error: examError } = await supabase
    .from('exams')
    .select('id')
    .eq('course_id', courseId);
  if (examError) throw toAppError(examError);
  const examIds = (exams ?? []).map((e) => e.id);
  if (examIds.length === 0) return { rows: [], total: 0 };

  const { from, to } = pageRange(params.page, params.pageSize);
  const needle = escapePostgrestSearch(params.q);
  let query = supabase
    .from('exam_attempts')
    .select('*, student:profiles!exam_attempts_student_id_fkey(id, full_name, email)', {
      count: 'exact',
    })
    .in('exam_id', examIds);
  if (needle) {
    query = query.or(
      `student.full_name.ilike.%${needle}%,student.email.ilike.%${needle}%`,
    );
  }
  const { data, count, error } = await query
    .order('started_at', { ascending: false })
    .order('id', { ascending: false })
    .range(from, to);
  if (error) throw toAppError(error);
  return { rows: (data ?? []) as unknown as AttemptWithStudent[], total: count ?? 0 };
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
