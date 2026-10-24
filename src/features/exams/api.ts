import { supabase } from '../../lib/supabase';
import { toAppError } from '../../lib/errors';
import type { AnswerReviewPolicy, ExamRow, Json } from '../../lib/database.types';
import {
  escapePostgrestSearch,
  pageRange,
  type PageResult,
} from '../../lib/pagination';
import type { ExamDraftInput, ExamDraftQuestion } from './types';

export async function listExamsForCourse(courseId: string): Promise<ExamRow[]> {
  const { data, error } = await supabase
    .from('exams')
    .select('*')
    .eq('course_id', courseId)
    .order('created_at', { ascending: false });
  if (error) throw toAppError(error);
  return data ?? [];
}

export interface LoadedDraft {
  exam: ExamRow;
  questions: ExamDraftQuestion[];
}

interface RawQuestion {
  id: string;
  prompt: string;
  points: number;
  explanation: string | null;
  question_options: { id: string; position: number; label: string }[];
}

export async function loadExamDraft(examId: string): Promise<LoadedDraft> {
  const { data: exam, error: examError } = await supabase
    .from('exams')
    .select('*')
    .eq('id', examId)
    .maybeSingle();
  if (examError) throw toAppError(examError);
  if (!exam) throw toAppError({ code: 'P0002', message: 'Exam not found' });

  const { data: rows, error } = await supabase
    .from('exam_questions')
    .select('id, prompt, points, explanation, question_options(id, position, label)')
    .eq('exam_id', examId)
    .is('version_id', null)
    .order('position');
  if (error) throw toAppError(error);

  const rawQuestions = (rows ?? []) as unknown as RawQuestion[];
  const questionIds = rawQuestions.map((q) => q.id);

  let keyByQuestion = new Map<string, string>();
  if (questionIds.length > 0) {
    const { data: keys, error: keyError } = await supabase
      .from('answer_keys')
      .select('question_id, correct_option_id')
      .in('question_id', questionIds);
    if (keyError) throw toAppError(keyError);
    keyByQuestion = new Map(
      (keys ?? []).map((k) => {
        const row = k as { question_id: string; correct_option_id: string };
        return [row.question_id, row.correct_option_id] as const;
      }),
    );
  }

  const questions: ExamDraftQuestion[] = rawQuestions.map((row) => {
    const options = [...(row.question_options ?? [])].sort((a, b) => a.position - b.position);
    const correctId = keyByQuestion.get(row.id);
    const correctIndex = options.findIndex((o) => o.id === correctId);
    return {
      prompt: row.prompt,
      points: Number(row.points),
      options: options.map((o) => o.label),
      correctIndex: correctIndex >= 0 ? correctIndex : 0,
      explanation: row.explanation ?? '',
    };
  });

  return { exam, questions };
}

/**
 * The server (`app.validate_exam_payload` / `public.save_exam_draft`) expects
 * `questions[].options` as `[{ label }]` objects and `correct_index`. The
 * editor keeps the friendlier `string[]` + `correctIndex` shape, so translate
 * here at the network boundary.
 */
interface ServerExamQuestion {
  prompt: string;
  points: number;
  options: { label: string }[];
  correct_index: number;
  explanation: string;
}

function toServerPayload(payload: ExamDraftInput): Json {
  return {
    course_id: payload.course_id,
    title: payload.title,
    instructions: payload.instructions,
    duration_minutes: payload.duration_minutes,
    opens_at: payload.opens_at,
    closes_at: payload.closes_at,
    question_randomization: payload.question_randomization,
    option_randomization: payload.option_randomization,
    result_release: payload.result_release,
    max_attempts: payload.max_attempts,
    result_policy: payload.result_policy,
    answer_review: payload.answer_review,
    pass_threshold: payload.pass_threshold,
    questions: payload.questions.map(
      (question): ServerExamQuestion => ({
        prompt: question.prompt,
        points: question.points,
        options: question.options.map((label) => ({ label })),
        correct_index: question.correctIndex,
        explanation: question.explanation,
      }),
    ),
  } as unknown as Json;
}

export async function saveExamDraft(
  examId: string | null,
  payload: ExamDraftInput,
): Promise<string> {
  const { data, error } = await supabase.rpc('save_exam_draft', {
    p_exam_id: examId,
    p_payload: toServerPayload(payload),
  });
  if (error) throw toAppError(error);
  return data as string;
}

export async function publishExam(examId: string): Promise<string> {
  const { data, error } = await supabase.rpc('publish_exam', { p_exam_id: examId });
  if (error) throw toAppError(error);
  return data as string;
}

export async function archiveExam(examId: string): Promise<void> {
  const { error } = await supabase.rpc('archive_exam', { p_exam_id: examId });
  if (error) throw toAppError(error);
}

export async function restoreExam(examId: string): Promise<void> {
  const { error } = await supabase.rpc('restore_exam', { p_exam_id: examId });
  if (error) throw toAppError(error);
}

export async function deleteExam(examId: string): Promise<void> {
  const { error } = await supabase.rpc('delete_exam', { p_exam_id: examId });
  if (error) throw toAppError(error);
}

export async function updateExamSettings(
  examId: string,
  patch: {
    title: string;
    instructions?: string | null;
    opens_at: string;
    closes_at: string;
    duration_minutes: number;
    result_release: 'immediate' | 'after_close' | 'scheduled';
    result_release_at?: string | null;
    answer_release_at?: string | null;
    timezone?: string | null;
    max_attempts: number;
    result_policy: 'latest' | 'highest';
    answer_review: AnswerReviewPolicy;
    pass_threshold: number | null;
  },
): Promise<void> {
  const { error } = await supabase.rpc('update_exam_settings', {
    p_exam_id: examId,
    p_title: patch.title,
    p_instructions: patch.instructions ?? '',
    p_opens_at: patch.opens_at,
    p_closes_at: patch.closes_at,
    p_duration_minutes: patch.duration_minutes,
    p_result_release: patch.result_release,
    p_max_attempts: patch.max_attempts,
    p_result_policy: patch.result_policy,
    p_answer_review: patch.answer_review,
    p_pass_threshold: patch.pass_threshold,
    p_result_release_at: patch.result_release_at ?? null,
    p_answer_release_at: patch.answer_release_at ?? null,
    p_timezone: patch.timezone ?? 'UTC',
  });
  if (error) throw toAppError(error);
}

export async function duplicateExam(examId: string): Promise<string> {
  const { data, error } = await supabase.rpc('duplicate_exam', { p_exam_id: examId });
  if (error) throw toAppError(error);
  return data as string;
}

export interface StudentExam extends ExamRow {
  course_title?: string;
  course_code?: string;
}

export async function listStudentExams(): Promise<StudentExam[]> {
  const { data, error } = await supabase
    .from('exams')
    .select('*, course:courses!exams_course_id_fkey(title, course_code)')
    .eq('state', 'published')
    .eq('archived', false)
    .order('closes_at', { ascending: true });
  if (error) throw toAppError(error);
  return (data ?? []) as unknown as StudentExam[];
}

export async function getStudentExam(examId: string): Promise<StudentExam | null> {
  const { data, error } = await supabase
    .from('exams')
    .select('*, course:courses!exams_course_id_fkey(title, course_code)')
    .eq('id', examId)
    .maybeSingle();
  if (error) throw toAppError(error);
  return data as unknown as StudentExam | null;
}

export async function getExamVersion(versionId: string) {
  const { data, error } = await supabase
    .from('exam_versions')
    .select('id, item_count, max_score, duration_minutes, violation_threshold, result_release, closes_at')
    .eq('id', versionId)
    .maybeSingle();
  if (error) throw toAppError(error);
  return data;
}


export async function listExamsForCoursePage(
  courseId: string,
  params: { page: number; pageSize: number; q: string; state?: 'all' | ExamRow['state'] },
): Promise<PageResult<ExamRow>> {
  const { from, to } = pageRange(params.page, params.pageSize);
  const needle = escapePostgrestSearch(params.q);
  let query = supabase
    .from('exams')
    .select('*', { count: 'exact' })
    .eq('course_id', courseId);
  if (params.state && params.state !== 'all') query = query.eq('state', params.state);
  if (needle) query = query.ilike('title', `%${needle}%`);
  const { data, count, error } = await query
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .range(from, to);
  if (error) throw toAppError(error);
  return { rows: data ?? [], total: count ?? 0 };
}

export async function listStudentExamsPage(params: {
  page: number;
  pageSize: number;
  q: string;
  courseId?: string;
}): Promise<PageResult<StudentExam>> {
  const { from, to } = pageRange(params.page, params.pageSize);
  const needle = escapePostgrestSearch(params.q);
  let query = supabase
    .from('exams')
    .select('*, course:courses!exams_course_id_fkey(title, course_code)', {
      count: 'exact',
    })
    .eq('state', 'published')
    .eq('archived', false);
  if (params.courseId) query = query.eq('course_id', params.courseId);
  if (needle) {
    query = query.or(
      `title.ilike.%${needle}%,course.title.ilike.%${needle}%,course.course_code.ilike.%${needle}%`,
    );
  }
  const { data, count, error } = await query
    .order('closes_at', { ascending: true })
    .order('id', { ascending: true })
    .range(from, to);
  if (error) throw toAppError(error);
  return { rows: (data ?? []) as unknown as StudentExam[], total: count ?? 0 };
}
