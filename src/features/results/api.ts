import { supabase } from '../../lib/supabase';
import { toAppError } from '../../lib/errors';
import type {
  ExamAttemptRow,
  ProfileRow,
  ViolationEventRow,
} from '../../lib/database.types';

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
