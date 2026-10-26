import { supabase } from '../../lib/supabase';
import { toAppError } from '../../lib/errors';
import type {
  CourseRow,
  EnrollmentRow,
  ProfileRow,
} from '../../lib/database.types';
import {
  escapePostgrestSearch,
  pageRange,
  type PageResult,
} from '../../lib/pagination';

export async function listTeacherCourses(): Promise<CourseRow[]> {
  const { data, error } = await supabase
    .from('courses')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw toAppError(error);
  return data ?? [];
}

export async function getCourse(courseId: string): Promise<CourseRow | null> {
  const { data, error } = await supabase
    .from('courses')
    .select('*')
    .eq('id', courseId)
    .maybeSingle();
  if (error) throw toAppError(error);
  return data;
}

export async function updateCourse(
  courseId: string,
  patch: {
    title: string;
    description?: string | null;
    section?: string | null;
    academic_term?: string | null;
  },
): Promise<void> {
  const { error } = await supabase.rpc('update_course', {
    p_course_id: courseId,
    p_title: patch.title,
    p_description: patch.description ?? '',
    p_section: patch.section ?? '',
    p_academic_term: patch.academic_term ?? '',
  });
  if (error) throw toAppError(error);
}

export interface CreateCourseResult {
  course_id: string;
  join_code: string;
}

export async function createCourse(input: {
  title: string;
  description: string;
  section: string;
  academicTerm: string;
  courseCode: string;
}): Promise<CreateCourseResult> {
  const { data, error } = await supabase.rpc('create_course', {
    p_title: input.title,
    p_description: input.description,
    p_section: input.section,
    p_academic_term: input.academicTerm,
    p_course_code: input.courseCode,
  });
  if (error) throw toAppError(error);
  return data as unknown as CreateCourseResult;
}

export async function rotateJoinCode(courseId: string): Promise<string> {
  const { data, error } = await supabase.rpc('rotate_join_code', {
    p_course_id: courseId,
  });
  if (error) throw new Error(error.message);
  return data;
}

export async function setCourseArchived(courseId: string, archived: boolean): Promise<void> {
  const { error } = await supabase.rpc('set_course_archived', {
    p_course_id: courseId,
    p_archived: archived,
  });
  if (error) throw toAppError(error);
}

export async function deleteCourse(courseId: string): Promise<void> {
  const { error } = await supabase.rpc('delete_course', { p_course_id: courseId });
  if (error) throw toAppError(error);
}

export interface JoinCodeInfo {
  present: boolean;
  legacy: boolean;
  code: string | null;
  code_hint?: string | null;
  created_at?: string | null;
  rotated_at?: string | null;
}

export async function getJoinCode(courseId: string): Promise<JoinCodeInfo> {
  const { data, error } = await supabase.rpc('get_join_code', { p_course_id: courseId });
  if (error) throw toAppError(error);
  return data as unknown as JoinCodeInfo;
}

export interface EnrollmentWithStudent extends EnrollmentRow {
  student: Pick<ProfileRow, 'id' | 'full_name' | 'email'> | null;
}

export async function listCourseEnrollments(
  courseId: string,
): Promise<EnrollmentWithStudent[]> {
  const { data, error } = await supabase
    .from('enrollments')
    .select('*, student:profiles!enrollments_student_id_fkey(id, full_name, email)')
    .eq('course_id', courseId)
    .order('requested_at', { ascending: false });
  if (error) throw toAppError(error);
  return (data ?? []) as unknown as EnrollmentWithStudent[];
}

export async function decideEnrollment(
  enrollmentId: string,
  decision: 'approved' | 'rejected' | 'withdrawn',
): Promise<void> {
  const { error } = await supabase.rpc('decide_enrollment', {
    p_enrollment_id: enrollmentId,
    p_decision: decision,
  });
  if (error) throw toAppError(error);
}

export interface StudentEnrollment extends EnrollmentRow {
  course: CourseRow | null;
}

export async function listStudentEnrollments(): Promise<StudentEnrollment[]> {
  const { data, error } = await supabase
    .from('enrollments')
    .select('*, course:courses!enrollments_course_id_fkey(*)')
    .order('requested_at', { ascending: false });
  if (error) throw toAppError(error);
  return (data ?? []) as unknown as StudentEnrollment[];
}

export async function requestEnrollment(joinCode: string): Promise<{
  enrollment_id: string;
  course_id: string;
  status: string;
  already?: boolean;
}> {
  const { data, error } = await supabase.rpc('request_enrollment', {
    p_join_code: joinCode,
  });
  if (error) throw toAppError(error);
  return data as unknown as { enrollment_id: string; course_id: string; status: string };
}


export async function listTeacherCoursesPage(params: {
  page: number;
  pageSize: number;
  q: string;
  archived?: 'all' | 'active' | 'archived';
}): Promise<PageResult<CourseRow>> {
  const { from, to } = pageRange(params.page, params.pageSize);
  const needle = escapePostgrestSearch(params.q);
  let query = supabase.from('courses').select('*', { count: 'exact' });
  if (params.archived === 'active') query = query.eq('archived', false);
  if (params.archived === 'archived') query = query.eq('archived', true);
  if (needle) {
    query = query.or(
      `course_code.ilike.%${needle}%,title.ilike.%${needle}%,section.ilike.%${needle}%,academic_term.ilike.%${needle}%`,
    );
  }
  const { data, count, error } = await query
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .range(from, to);
  if (error) throw toAppError(error);
  return { rows: data ?? [], total: count ?? 0 };
}

interface EnrollmentSearchRow {
  id: string;
  course_id: string;
  student_id: string;
  status: EnrollmentRow['status'];
  requested_at: string;
  decided_at: string | null;
  decided_by: string | null;
  student_full_name: string;
  student_email: string | null;
  total?: number;
}

/**
 * Server-side enrollment search. PostgREST cannot express an `or` across an
 * embedded relationship alias (`student.full_name...`), so the search, status
 * filter, ordering, pagination, and exact count all run in one parameterized
 * RPC over the teacher's authorized course.
 */
export async function listCourseEnrollmentsPage(
  courseId: string,
  params: {
    page: number;
    pageSize: number;
    q: string;
    status?: 'all' | EnrollmentRow['status'];
  },
): Promise<PageResult<EnrollmentWithStudent>> {
  const { data, error } = await supabase.rpc('get_course_enrollments_page', {
    p_course_id: courseId,
    p_search: params.q,
    p_status: params.status && params.status !== 'all' ? params.status : null,
    p_page: params.page,
    p_page_size: params.pageSize,
  });
  if (error) throw toAppError(error);

  const payload = data as unknown as {
    rows?: EnrollmentSearchRow[];
    total?: number;
  } | null;
  const rows = (payload?.rows ?? []).map((row) => ({
    id: row.id,
    course_id: row.course_id,
    student_id: row.student_id,
    status: row.status,
    requested_at: row.requested_at,
    decided_at: row.decided_at,
    decided_by: row.decided_by,
    student: {
      id: row.student_id,
      full_name: row.student_full_name,
      email: row.student_email,
    },
  }));

  return { rows, total: Number(payload?.total ?? 0) };
}

export async function listStudentEnrollmentsPage(params: {
  page: number;
  pageSize: number;
  q: string;
}): Promise<PageResult<StudentEnrollment>> {
  const { from, to } = pageRange(params.page, params.pageSize);
  const needle = escapePostgrestSearch(params.q);
  let query = supabase
    .from('enrollments')
    .select('*, course:courses!enrollments_course_id_fkey(*)', { count: 'exact' });
  if (needle) {
    query = query.or(
      `course.title.ilike.%${needle}%,course.course_code.ilike.%${needle}%`,
    );
  }
  const { data, count, error } = await query
    .order('requested_at', { ascending: false })
    .order('id', { ascending: false })
    .range(from, to);
  if (error) throw toAppError(error);
  return { rows: (data ?? []) as unknown as StudentEnrollment[], total: count ?? 0 };
}
