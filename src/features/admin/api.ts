import { supabase } from '../../lib/supabase';
import { toAppError } from '../../lib/errors';
import type {
  AccountStatus,
  AppRole,
  AuditLogRow,
  CourseRow,
  ExamRow,
  ProfileRow,
  UserRoleRow,
} from '../../lib/database.types';
import {
  escapePostgrestSearch,
  pageRange,
  type PageResult,
} from '../../lib/pagination';

export interface AdminStats {
  users: number;
  teachers: number;
  students: number;
  courses: number;
  exams: number;
  published_exams: number;
  attempts: number;
  submitted_attempts: number;
  flagged_attempts: number;
}

export async function getAdminStats(): Promise<AdminStats> {
  const { data, error } = await supabase.rpc('admin_dashboard_stats');
  if (error) throw toAppError(error);
  return data as unknown as AdminStats;
}

export interface AdminUser extends ProfileRow {
  role: AppRole | null;
}

export async function listUsers(): Promise<AdminUser[]> {
  const { data: profiles, error } = await supabase
    .from('profiles')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw toAppError(error);

  const { data: roles, error: roleError } = await supabase
    .from('user_roles')
    .select('*');
  if (roleError) throw toAppError(roleError);

  const roleMap = new Map((roles ?? []).map((r: UserRoleRow) => [r.user_id, r.role]));
  return (profiles ?? []).map((profile) => ({
    ...profile,
    role: roleMap.get(profile.id) ?? null,
  }));
}

export async function setAccountStatus(
  userId: string,
  status: AccountStatus,
): Promise<void> {
  const { error } = await supabase.rpc('admin_set_account_status', {
    p_user_id: userId,
    p_status: status,
  });
  if (error) throw toAppError(error);
}

export async function setRole(userId: string, role: AppRole): Promise<void> {
  const { error } = await supabase.rpc('admin_set_role', {
    p_user_id: userId,
    p_role: role,
  });
  if (error) throw toAppError(error);
}

export async function listAuditLogs(limit = 200): Promise<AuditLogRow[]> {
  const { data, error } = await supabase
    .from('audit_logs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw toAppError(error);
  return data ?? [];
}

export async function listAllCourses() {
  const { data, error } = await supabase
    .from('courses')
    .select('*, owner:profiles!courses_owner_id_fkey(full_name, email)')
    .order('created_at', { ascending: false });
  if (error) throw toAppError(error);
  return data ?? [];
}

export interface AdminAttemptRow {
  id: string;
  exam_id: string;
  student_id: string;
  state: string;
  violation_count: number;
  submission_reason: string | null;
  earned_points: number | null;
  max_points: number | null;
  percentage: number | null;
  pass_threshold: number | null;
  started_at: string;
  submitted_at: string | null;
  student: { full_name: string; email: string | null } | null;
}

export async function listAllAttempts(): Promise<AdminAttemptRow[]> {
  const { data, error } = await supabase
    .from('exam_attempts')
    .select(
      'id, exam_id, student_id, state, violation_count, submission_reason, earned_points, max_points, percentage, pass_threshold, started_at, submitted_at, student:profiles!exam_attempts_student_id_fkey(full_name, email)',
    )
    .order('started_at', { ascending: false });
  if (error) throw toAppError(error);
  return (data ?? []) as unknown as AdminAttemptRow[];
}

export async function listAllExams(): Promise<ExamRow[]> {
  const { data, error } = await supabase
    .from('exams')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw toAppError(error);
  return data ?? [];
}

export async function provisionTeacher(input: {
  email: string;
  password: string;
  fullName: string;
}): Promise<void> {
  const { data: session } = await supabase.auth.getSession();
  const token = session.session?.access_token;
  if (!token) throw toAppError({ code: '28000', message: 'Authentication required.' });

  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/provision-teacher`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      apikey: import.meta.env.VITE_SUPABASE_ANON_KEY as string,
    },
    body: JSON.stringify({
      email: input.email,
      password: input.password,
      full_name: input.fullName,
    }),
  });
  const payload = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) {
    throw toAppError({ message: payload.error ?? 'Could not provision teacher.' });
  }
}


export interface AdminCoursePageRow extends CourseRow {
  owner: { full_name: string; email: string | null } | null;
}

function roleFromEmbedded(row: Record<string, unknown>): AppRole | null {
  const roles = row.user_roles as { role?: AppRole }[] | { role?: AppRole } | null | undefined;
  if (Array.isArray(roles)) return roles[0]?.role ?? null;
  return roles?.role ?? null;
}

/** Server-side paginated user directory (search/filter/count run in Postgres). */
export async function listUsersPage(params: {
  page: number;
  pageSize: number;
  q: string;
  role: 'all' | AppRole;
}): Promise<PageResult<AdminUser>> {
  const { from, to } = pageRange(params.page, params.pageSize);
  const needle = escapePostgrestSearch(params.q);
  let query = supabase
    .from('profiles')
    // `user_roles` has two foreign keys to `profiles` (user_id and granted_by),
    // so the embed must name the relationship explicitly or PostgREST rejects
    // it as ambiguous (PGRST201). Every account gets a role from the signup
    // trigger, so an inner embed is safe and lets Postgres filter by role
    // before pagination.
    .select('*, user_roles!user_roles_user_id_fkey!inner(role)', { count: 'exact' });

  if (params.role !== 'all') query = query.eq('user_roles.role', params.role);
  if (needle) query = query.or(`full_name.ilike.%${needle}%,email.ilike.%${needle}%`);

  const { data, count, error } = await query
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .range(from, to);
  if (error) throw toAppError(error);

  return {
    rows: (data ?? []).map((row) => {
      const record = row as unknown as Record<string, unknown> & ProfileRow;
      return { ...record, role: roleFromEmbedded(record) };
    }),
    total: count ?? 0,
  };
}

export async function listAllCoursesPage(params: {
  page: number;
  pageSize: number;
  q: string;
  archived?: 'all' | 'active' | 'archived';
}): Promise<PageResult<AdminCoursePageRow>> {
  const { from, to } = pageRange(params.page, params.pageSize);
  const needle = escapePostgrestSearch(params.q);
  let query = supabase
    .from('courses')
    .select('*, owner:profiles!courses_owner_id_fkey(full_name, email)', { count: 'exact' });

  if (params.archived === 'active') query = query.eq('archived', false);
  if (params.archived === 'archived') query = query.eq('archived', true);
  if (needle) {
    query = query.or(
      `course_code.ilike.%${needle}%,title.ilike.%${needle}%,section.ilike.%${needle}%,owner.full_name.ilike.%${needle}%`,
    );
  }

  const { data, count, error } = await query
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .range(from, to);
  if (error) throw toAppError(error);
  return { rows: (data ?? []) as unknown as AdminCoursePageRow[], total: count ?? 0 };
}

export async function listAllExamsPage(params: {
  page: number;
  pageSize: number;
  q: string;
  state?: 'all' | ExamRow['state'];
}): Promise<PageResult<ExamRow>> {
  const { from, to } = pageRange(params.page, params.pageSize);
  const needle = escapePostgrestSearch(params.q);
  let query = supabase.from('exams').select('*', { count: 'exact' });
  if (params.state && params.state !== 'all') query = query.eq('state', params.state);
  if (needle) query = query.or(`title.ilike.%${needle}%,state.ilike.%${needle}%`);
  const { data, count, error } = await query
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .range(from, to);
  if (error) throw toAppError(error);
  return { rows: data ?? [], total: count ?? 0 };
}

export async function listAllAttemptsPage(params: {
  page: number;
  pageSize: number;
  q: string;
  onlyFlagged: boolean;
}): Promise<PageResult<AdminAttemptRow>> {
  const { from, to } = pageRange(params.page, params.pageSize);
  const needle = escapePostgrestSearch(params.q);
  let query = supabase
    .from('exam_attempts')
    .select(
      'id, exam_id, student_id, state, violation_count, submission_reason, earned_points, max_points, percentage, pass_threshold, started_at, submitted_at, student:profiles!exam_attempts_student_id_fkey(full_name, email)',
      { count: 'exact' },
    );
  if (params.onlyFlagged) query = query.gt('violation_count', 0);
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
  return { rows: (data ?? []) as unknown as AdminAttemptRow[], total: count ?? 0 };
}

export async function listAuditLogsPage(params: {
  page: number;
  pageSize: number;
  q: string;
}): Promise<PageResult<AuditLogRow>> {
  const { from, to } = pageRange(params.page, params.pageSize);
  const needle = escapePostgrestSearch(params.q);
  let query = supabase.from('audit_logs').select('*', { count: 'exact' });
  if (needle) query = query.or(`action.ilike.%${needle}%,entity_type.ilike.%${needle}%`);
  const { data, count, error } = await query
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .range(from, to);
  if (error) throw toAppError(error);
  return { rows: data ?? [], total: count ?? 0 };
}
