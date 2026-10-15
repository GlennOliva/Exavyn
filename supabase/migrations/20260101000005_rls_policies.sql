-- ===========================================================================
-- Anti-Cheating Exam — migration 0005
-- Additional authorization helpers and Row Level Security policies.
-- ===========================================================================

create or replace function app.student_enrolled_any(p_course_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.enrollments e
    where e.course_id = p_course_id
      and e.student_id = auth.uid()
      and e.status in ('pending', 'approved')
  );
$$;

create or replace function app.student_enrolled_approved(p_course_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.enrollments e
    where e.course_id = p_course_id
      and e.student_id = auth.uid()
      and e.status = 'approved'
  );
$$;

create or replace function app.teacher_can_see_student(p_student_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.enrollments e
    join public.courses c on c.id = e.course_id
    where c.owner_id = auth.uid() and e.student_id = p_student_id
  );
$$;

create or replace function app.can_view_attempt(p_attempt_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    app.is_admin()
    or app.owns_attempt(p_attempt_id)
    or app.owns_attempt_course(p_attempt_id);
$$;

-- ---------------------------------------------------------------------------
-- Enable RLS everywhere.
-- ---------------------------------------------------------------------------
alter table public.profiles          enable row level security;
alter table public.user_roles        enable row level security;
alter table public.courses           enable row level security;
alter table public.course_join_codes enable row level security;
alter table public.enrollments       enable row level security;
alter table public.exams             enable row level security;
alter table public.exam_versions     enable row level security;
alter table public.exam_questions    enable row level security;
alter table public.question_options  enable row level security;
alter table public.answer_keys       enable row level security;
alter table public.exam_attempts     enable row level security;
alter table public.attempt_answers   enable row level security;
alter table public.violation_events  enable row level security;
alter table public.attempt_heartbeats enable row level security;
alter table public.audit_logs        enable row level security;

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated
  using (
    id = auth.uid()
    or app.is_admin()
    or app.teacher_can_see_student(id)
  );

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- ---------------------------------------------------------------------------
-- user_roles
-- ---------------------------------------------------------------------------
drop policy if exists user_roles_select on public.user_roles;
create policy user_roles_select on public.user_roles
  for select to authenticated
  using (user_id = auth.uid() or app.is_admin());

-- ---------------------------------------------------------------------------
-- courses
-- ---------------------------------------------------------------------------
drop policy if exists courses_select on public.courses;
create policy courses_select on public.courses
  for select to authenticated
  using (
    owner_id = auth.uid()
    or app.is_admin()
    or app.student_enrolled_any(id)
  );

drop policy if exists courses_update_owner on public.courses;
create policy courses_update_owner on public.courses
  for update to authenticated
  using (owner_id = auth.uid() or app.is_admin())
  with check (owner_id = auth.uid() or app.is_admin());

-- ---------------------------------------------------------------------------
-- course_join_codes (owner/admin only; students never read hashes)
-- ---------------------------------------------------------------------------
drop policy if exists join_codes_select on public.course_join_codes;
create policy join_codes_select on public.course_join_codes
  for select to authenticated
  using (app.owns_course(course_id) or app.is_admin());

-- ---------------------------------------------------------------------------
-- enrollments
-- ---------------------------------------------------------------------------
drop policy if exists enrollments_select on public.enrollments;
create policy enrollments_select on public.enrollments
  for select to authenticated
  using (
    student_id = auth.uid()
    or app.owns_course(course_id)
    or app.is_admin()
  );

-- ---------------------------------------------------------------------------
-- exams
-- ---------------------------------------------------------------------------
drop policy if exists exams_select on public.exams;
create policy exams_select on public.exams
  for select to authenticated
  using (
    owner_id = auth.uid()
    or app.is_admin()
    or (
      state = 'published'
      and archived = false
      and app.student_enrolled_approved(course_id)
    )
  );

-- ---------------------------------------------------------------------------
-- exam_versions
-- ---------------------------------------------------------------------------
drop policy if exists exam_versions_select on public.exam_versions;
create policy exam_versions_select on public.exam_versions
  for select to authenticated
  using (
    exists (
      select 1 from public.exams e
      where e.id = exam_versions.exam_id
        and e.owner_id = auth.uid()
    )
    or app.is_admin()
    or (
      frozen = true
      and exists (
        select 1 from public.exams e
        where e.id = exam_versions.exam_id
          and e.state = 'published'
          and e.archived = false
          and app.student_enrolled_approved(e.course_id)
      )
    )
  );

-- ---------------------------------------------------------------------------
-- exam_questions — students have NO direct access (served via function only)
-- ---------------------------------------------------------------------------
drop policy if exists exam_questions_select on public.exam_questions;
create policy exam_questions_select on public.exam_questions
  for select to authenticated
  using (
    app.is_admin()
    or exists (
      select 1 from public.exams e
      where e.id = exam_questions.exam_id and e.owner_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- question_options — same restriction as questions
-- ---------------------------------------------------------------------------
drop policy if exists question_options_select on public.question_options;
create policy question_options_select on public.question_options
  for select to authenticated
  using (
    app.is_admin()
    or exists (
      select 1
      from public.exam_questions q
      join public.exams e on e.id = q.exam_id
      where q.id = question_options.question_id and e.owner_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- answer_keys — owner/admin only, never students
-- ---------------------------------------------------------------------------
drop policy if exists answer_keys_select on public.answer_keys;
create policy answer_keys_select on public.answer_keys
  for select to authenticated
  using (
    app.is_admin()
    or exists (
      select 1
      from public.exam_questions q
      join public.exams e on e.id = q.exam_id
      where q.id = answer_keys.question_id and e.owner_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- exam_attempts
-- ---------------------------------------------------------------------------
drop policy if exists exam_attempts_select on public.exam_attempts;
create policy exam_attempts_select on public.exam_attempts
  for select to authenticated
  using (student_id = auth.uid() or app.owns_attempt_course(id) or app.is_admin());

-- ---------------------------------------------------------------------------
-- attempt_answers
-- ---------------------------------------------------------------------------
drop policy if exists attempt_answers_select on public.attempt_answers;
create policy attempt_answers_select on public.attempt_answers
  for select to authenticated
  using (app.can_view_attempt(attempt_id));

-- ---------------------------------------------------------------------------
-- violation_events
-- ---------------------------------------------------------------------------
drop policy if exists violation_events_select on public.violation_events;
create policy violation_events_select on public.violation_events
  for select to authenticated
  using (app.can_view_attempt(attempt_id));

-- ---------------------------------------------------------------------------
-- attempt_heartbeats
-- ---------------------------------------------------------------------------
drop policy if exists attempt_heartbeats_select on public.attempt_heartbeats;
create policy attempt_heartbeats_select on public.attempt_heartbeats
  for select to authenticated
  using (app.can_view_attempt(attempt_id));

-- ---------------------------------------------------------------------------
-- audit_logs — admin read-only
-- ---------------------------------------------------------------------------
drop policy if exists audit_logs_select on public.audit_logs;
create policy audit_logs_select on public.audit_logs
  for select to authenticated
  using (app.is_admin());
