-- ===========================================================================
-- Anti-Cheating Exam — migration 0008
-- Hardening:
--   1. start_attempt is now controller-gated so a resume can never hand the
--      live controller token to a second session (single-controller rule).
--   2. Suspended accounts are blocked at the RLS layer for reads and writes,
--      not only inside RPCs.
--   3. A scheduled server job finalizes expired attempts even when no browser
--      is open (pg_cron when available; otherwise an external scheduler can
--      call public.finalize_expired_attempts directly).
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Controller-gated start_attempt
--    The previous uuid-only signature leaked the stored controller token to any
--    caller on resume. The new signature takes the caller's current token and
--    only returns it when the caller already holds the controller (or when the
--    previous lease has lapsed and control is rotated to the new session).
-- ---------------------------------------------------------------------------
drop function if exists public.start_attempt(uuid);

create or replace function public.start_attempt(
  p_exam_id uuid,
  p_current_token uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := app.require_user();
  v_exam public.exams;
  v_version public.exam_versions;
  v_existing public.exam_attempts;
  v_attempt_id uuid;
  v_deadline timestamptz;
  v_qorder jsonb;
  v_oorder jsonb;
  v_token uuid;
begin
  if not app.has_role('student') then
    raise exception 'Only students may start attempts' using errcode = '42501';
  end if;

  select * into v_exam from public.exams where id = p_exam_id for update;
  if not found then raise exception 'Exam not found' using errcode = 'P0002'; end if;
  if v_exam.state <> 'published' or v_exam.archived then
    raise exception 'Exam is not available' using errcode = 'P0002';
  end if;
  if v_exam.current_version_id is null then
    raise exception 'Exam has no published version';
  end if;

  -- Availability is checked atomically against server time.
  if now() < v_exam.opens_at then
    raise exception 'Exam has not opened yet' using errcode = 'P0002';
  end if;
  if now() >= v_exam.closes_at then
    raise exception 'Exam has closed' using errcode = 'P0002';
  end if;

  if not app.student_enrolled_approved(v_exam.course_id) then
    raise exception 'You are not enrolled in this course' using errcode = '42501';
  end if;

  select * into v_version from public.exam_versions where id = v_exam.current_version_id;

  select * into v_existing from public.exam_attempts
  where exam_id = p_exam_id and student_id = v_uid for update;

  if found then
    if v_existing.state = 'in_progress' then
      -- Single-controller enforcement. A session may only resume the attempt
      -- when it already holds the controller token, or when the previous
      -- holder's lease has lapsed (crash / closed browser) and control rotates.
      if p_current_token is not null and p_current_token = v_existing.controller_token then
        update public.exam_attempts
          set controller_lease_expires_at = now() + interval '30 seconds'
          where id = v_existing.id
          returning * into v_existing;
      elsif v_existing.controller_lease_expires_at is not null
            and v_existing.controller_lease_expires_at > now() then
        raise exception 'This attempt is active in another session'
          using errcode = '55006';
      else
        update public.exam_attempts
          set controller_token = gen_random_uuid(),
              controller_lease_expires_at = now() + interval '30 seconds'
          where id = v_existing.id
          returning * into v_existing;
      end if;

      return jsonb_build_object(
        'attempt_id', v_existing.id,
        'resumed', true,
        'controller_token', v_existing.controller_token,
        'deadline_at', v_existing.deadline_at,
        'started_at', v_existing.started_at,
        'violation_count', v_existing.violation_count,
        'violation_threshold', v_version.violation_threshold
      );
    end if;
    raise exception 'You have already completed this exam' using errcode = 'P0002';
  end if;

  v_deadline := least(now() + make_interval(mins => v_version.duration_minutes), v_version.closes_at);
  v_token := gen_random_uuid();

  if v_version.question_randomization then
    select coalesce(jsonb_agg(qid), '[]'::jsonb) into v_qorder
    from (
      select id as qid from public.exam_questions
      where version_id = v_version.id order by random()
    ) s;
  else
    select coalesce(jsonb_agg(qid), '[]'::jsonb) into v_qorder
    from (
      select id as qid from public.exam_questions
      where version_id = v_version.id order by position
    ) s;
  end if;

  if v_version.option_randomization then
    select coalesce(jsonb_object_agg(q.id::text, (
      select coalesce(jsonb_agg(oid), '[]'::jsonb)
      from (select id as oid from public.question_options where question_id = q.id order by random()) o
    )), '{}'::jsonb) into v_oorder
    from public.exam_questions q where q.version_id = v_version.id;
  else
    select coalesce(jsonb_object_agg(q.id::text, (
      select coalesce(jsonb_agg(oid), '[]'::jsonb)
      from (select id as oid from public.question_options where question_id = q.id order by position) o
    )), '{}'::jsonb) into v_oorder
    from public.exam_questions q where q.version_id = v_version.id;
  end if;

  insert into public.exam_attempts (
    exam_id, exam_version_id, student_id, deadline_at, question_order, option_order,
    controller_token, controller_lease_expires_at
  ) values (
    p_exam_id, v_version.id, v_uid, v_deadline, v_qorder, v_oorder,
    v_token, now() + interval '30 seconds'
  ) returning id into v_attempt_id;

  return jsonb_build_object(
    'attempt_id', v_attempt_id,
    'resumed', false,
    'controller_token', v_token,
    'deadline_at', v_deadline,
    'started_at', now(),
    'violation_count', 0,
    'violation_threshold', v_version.violation_threshold
  );
end;
$$;

grant execute on function public.start_attempt(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Suspension enforcement at the RLS layer.
--    require_user() already gates every RPC, but suspended accounts still had
--    read access to their rows and (for teachers) course rows via PostgREST.
--    Recreate the policies so a suspended account sees only its own profile
--    and role (enough to render an explanatory message) and nothing else.
-- ---------------------------------------------------------------------------

-- profiles: self always readable; other visibility requires an active account.
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated
  using (
    id = auth.uid()
    or (app.is_active() and (app.is_admin() or app.teacher_can_see_student(id)))
  );

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = auth.uid() and app.is_active())
  with check (id = auth.uid() and app.is_active());

drop policy if exists user_roles_select on public.user_roles;
create policy user_roles_select on public.user_roles
  for select to authenticated
  using (user_id = auth.uid() or (app.is_active() and app.is_admin()));

drop policy if exists courses_select on public.courses;
create policy courses_select on public.courses
  for select to authenticated
  using (
    app.is_active()
    and (owner_id = auth.uid() or app.is_admin() or app.student_enrolled_any(id))
  );

drop policy if exists courses_update_owner on public.courses;
create policy courses_update_owner on public.courses
  for update to authenticated
  using (app.is_active() and (owner_id = auth.uid() or app.is_admin()))
  with check (app.is_active() and (owner_id = auth.uid() or app.is_admin()));

drop policy if exists join_codes_select on public.course_join_codes;
create policy join_codes_select on public.course_join_codes
  for select to authenticated
  using (app.is_active() and (app.owns_course(course_id) or app.is_admin()));

drop policy if exists enrollments_select on public.enrollments;
create policy enrollments_select on public.enrollments
  for select to authenticated
  using (
    app.is_active()
    and (student_id = auth.uid() or app.owns_course(course_id) or app.is_admin())
  );

drop policy if exists exams_select on public.exams;
create policy exams_select on public.exams
  for select to authenticated
  using (
    app.is_active()
    and (
      owner_id = auth.uid()
      or app.is_admin()
      or (
        state = 'published'
        and archived = false
        and app.student_enrolled_approved(course_id)
      )
    )
  );

drop policy if exists exam_versions_select on public.exam_versions;
create policy exam_versions_select on public.exam_versions
  for select to authenticated
  using (
    app.is_active()
    and (
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
    )
  );

drop policy if exists exam_questions_select on public.exam_questions;
create policy exam_questions_select on public.exam_questions
  for select to authenticated
  using (
    app.is_active()
    and (
      app.is_admin()
      or exists (
        select 1 from public.exams e
        where e.id = exam_questions.exam_id and e.owner_id = auth.uid()
      )
    )
  );

drop policy if exists question_options_select on public.question_options;
create policy question_options_select on public.question_options
  for select to authenticated
  using (
    app.is_active()
    and (
      app.is_admin()
      or exists (
        select 1
        from public.exam_questions q
        join public.exams e on e.id = q.exam_id
        where q.id = question_options.question_id and e.owner_id = auth.uid()
      )
    )
  );

drop policy if exists answer_keys_select on public.answer_keys;
create policy answer_keys_select on public.answer_keys
  for select to authenticated
  using (
    app.is_active()
    and (
      app.is_admin()
      or exists (
        select 1
        from public.exam_questions q
        join public.exams e on e.id = q.exam_id
        where q.id = answer_keys.question_id and e.owner_id = auth.uid()
      )
    )
  );

drop policy if exists exam_attempts_select on public.exam_attempts;
create policy exam_attempts_select on public.exam_attempts
  for select to authenticated
  using (
    app.is_active()
    and (student_id = auth.uid() or app.owns_attempt_course(id) or app.is_admin())
  );

drop policy if exists attempt_answers_select on public.attempt_answers;
create policy attempt_answers_select on public.attempt_answers
  for select to authenticated
  using (app.is_active() and app.can_view_attempt(attempt_id));

drop policy if exists violation_events_select on public.violation_events;
create policy violation_events_select on public.violation_events
  for select to authenticated
  using (app.is_active() and app.can_view_attempt(attempt_id));

drop policy if exists attempt_heartbeats_select on public.attempt_heartbeats;
create policy attempt_heartbeats_select on public.attempt_heartbeats
  for select to authenticated
  using (app.is_active() and app.can_view_attempt(attempt_id));

drop policy if exists audit_logs_select on public.audit_logs;
create policy audit_logs_select on public.audit_logs
  for select to authenticated
  using (app.is_active() and app.is_admin());

-- ---------------------------------------------------------------------------
-- 3. Scheduled finalization of expired attempts.
--    pg_cron is available on Supabase and is enabled best-effort here so no
--    browser (or admin click) is required to close an attempt at its deadline.
--    When the extension is unavailable the guard is a no-op and an external
--    scheduler can call public.finalize_expired_attempts() on a timer.
-- ---------------------------------------------------------------------------
do $$
begin
  execute 'create extension if not exists pg_cron';
exception
  when others then
    -- Best-effort: pg_cron may be unavailable (not installed, insufficient
    -- privilege, or not supported by the platform). Never fail the migration
    -- over scheduling; an external scheduler can call the function instead.
    raise notice 'pg_cron not available (%); skipping scheduled finalization', sqlerrm;
end;
$$;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'finalize-expired-attempts') then
      perform cron.unschedule('finalize-expired-attempts');
    end if;
    perform cron.schedule(
      'finalize-expired-attempts',
      '* * * * *',
      'select public.finalize_expired_attempts();'
    );
  end if;
exception
  when others then
    raise notice 'pg_cron scheduling skipped: %', sqlerrm;
end;
$$;
