-- ===========================================================================
-- Anti-Cheating Exam — migration 0004
-- Helper functions, identity bootstrap, and immutability triggers.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Authorization helpers (SECURITY DEFINER; table owners bypass RLS, so these
-- do not recurse into the policies that call them).
-- ---------------------------------------------------------------------------
create or replace function app.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.user_roles ur
    where ur.user_id = auth.uid() and ur.role = 'admin'
  );
$$;

create or replace function app.has_role(p_role public.app_role)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.user_roles ur
    where ur.user_id = auth.uid() and ur.role = p_role
  );
$$;

create or replace function app.is_active()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.status = 'active'
  );
$$;

create or replace function app.owns_course(p_course_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.courses c
    where c.id = p_course_id and c.owner_id = auth.uid()
  );
$$;

create or replace function app.is_approved_enrolled(p_course_id uuid)
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

-- Attempt belongs to the calling student.
create or replace function app.owns_attempt(p_attempt_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.exam_attempts a
    where a.id = p_attempt_id and a.student_id = auth.uid()
  );
$$;

-- Teacher owns the course behind an attempt.
create or replace function app.owns_attempt_course(p_attempt_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.exam_attempts a
    join public.exams e on e.id = a.exam_id
    join public.courses c on c.id = e.course_id
    where a.id = p_attempt_id and c.owner_id = auth.uid()
  );
$$;

-- ---------------------------------------------------------------------------
-- Generic updated_at trigger
-- ---------------------------------------------------------------------------
create or replace function app.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_profiles_updated on public.profiles;
create trigger trg_profiles_updated before update on public.profiles
  for each row execute function app.set_updated_at();

drop trigger if exists trg_user_roles_updated on public.user_roles;
create trigger trg_user_roles_updated before update on public.user_roles
  for each row execute function app.set_updated_at();

drop trigger if exists trg_courses_updated on public.courses;
create trigger trg_courses_updated before update on public.courses
  for each row execute function app.set_updated_at();

drop trigger if exists trg_exams_updated on public.exams;
create trigger trg_exams_updated before update on public.exams
  for each row execute function app.set_updated_at();

drop trigger if exists trg_exam_attempts_updated on public.exam_attempts;
create trigger trg_exam_attempts_updated before update on public.exam_attempts
  for each row execute function app.set_updated_at();

-- ---------------------------------------------------------------------------
-- Identity bootstrap: create a profile + default student role on signup.
-- ---------------------------------------------------------------------------
create or replace function app.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', '')
  )
  on conflict (id) do nothing;

  -- Public signup always yields a student role. Never trust metadata for role.
  insert into public.user_roles (user_id, role)
  values (new.id, 'student')
  on conflict (user_id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function app.handle_new_user();

-- ---------------------------------------------------------------------------
-- Immutability: finalized attempts are never mutated.
-- ---------------------------------------------------------------------------
create or replace function app.guard_attempt_immutable()
returns trigger
language plpgsql
as $$
begin
  if old.state = 'submitted' then
    raise exception 'Attempt % is finalized and cannot be modified', old.id
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_attempts_immutable on public.exam_attempts;
create trigger trg_attempts_immutable before update on public.exam_attempts
  for each row execute function app.guard_attempt_immutable();

-- Answers cannot be written once the parent attempt is finalized.
create or replace function app.guard_answer_after_finalize()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_state public.attempt_state;
  v_attempt uuid;
begin
  v_attempt := coalesce(new.attempt_id, old.attempt_id);
  select state into v_state from public.exam_attempts where id = v_attempt;
  if v_state = 'submitted' then
    raise exception 'Attempt % is finalized; answers are locked', v_attempt
      using errcode = 'check_violation';
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_answers_guard on public.attempt_answers;
create trigger trg_answers_guard before insert or update or delete on public.attempt_answers
  for each row execute function app.guard_answer_after_finalize();

-- Published exam versions are immutable.
create or replace function app.guard_version_immutable()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' and old.frozen then
    raise exception 'Published exam version % is immutable', old.id
      using errcode = 'check_violation';
  end if;
  if tg_op = 'DELETE' and old.frozen then
    raise exception 'Published exam version % cannot be deleted', old.id
      using errcode = 'check_violation';
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_version_immutable on public.exam_versions;
create trigger trg_version_immutable before update or delete on public.exam_versions
  for each row execute function app.guard_version_immutable();

-- Published question content is immutable.
create or replace function app.guard_published_question()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' and old.version_id is not null then
    raise exception 'Published question % is immutable', old.id using errcode = 'check_violation';
  end if;
  if tg_op = 'DELETE' and old.version_id is not null then
    raise exception 'Published question % cannot be deleted', old.id using errcode = 'check_violation';
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_published_question on public.exam_questions;
create trigger trg_published_question before update or delete on public.exam_questions
  for each row execute function app.guard_published_question();

-- Answer keys may not change once an attempt exists on their version.
create or replace function app.guard_answer_key_final()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_version uuid;
begin
  select q.version_id into v_version
  from public.exam_questions q
  where q.id = coalesce(new.question_id, old.question_id);

  if v_version is not null and exists (
    select 1 from public.exam_attempts a where a.exam_version_id = v_version
  ) then
    raise exception 'Answer key is frozen because an attempt exists'
      using errcode = 'check_violation';
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_answer_key_final on public.answer_keys;
create trigger trg_answer_key_final before update or delete on public.answer_keys
  for each row execute function app.guard_answer_key_final();

-- Violation events are append-only.
create or replace function app.guard_violation_append_only()
returns trigger
language plpgsql
as $$
begin
  raise exception 'violation_events is append-only' using errcode = 'check_violation';
end;
$$;

drop trigger if exists trg_violation_append_only on public.violation_events;
create trigger trg_violation_append_only before update or delete on public.violation_events
  for each row execute function app.guard_violation_append_only();
