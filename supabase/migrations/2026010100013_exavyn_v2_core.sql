-- ===========================================================================
-- EXAVYN VERSION 2 - Migration 0013
-- Answer integrity, bookmarks, scheduled release, feedback, controller lease.
-- Forward-only. Does not reset or regrade existing data.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Scheduled release values
-- ---------------------------------------------------------------------------
alter type public.answer_review_policy add value if not exists 'scheduled';
alter type public.result_release_policy add value if not exists 'scheduled';

-- Exam-level scheduling. `timezone` is informational (IANA name); all stored
-- timestamps remain UTC timestamptz.
alter table public.exams
  add column if not exists result_release_at timestamptz,
  add column if not exists answer_release_at timestamptz,
  add column if not exists timezone text not null default 'UTC';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'exams_release_schedule_check'
  ) then
    alter table public.exams
      add constraint exams_release_schedule_check
      check (
        answer_release_at is null
        or result_release_at is null
        or answer_release_at >= result_release_at
      );
  end if;
end
$$;

-- Per-attempt snapshot so a later settings change only affects future attempts.
alter table public.exam_attempts
  add column if not exists result_release_at timestamptz,
  add column if not exists answer_release_at timestamptz;

-- ---------------------------------------------------------------------------
-- 2. Answer integrity: clearing an answer is represented by a null selection.
-- ---------------------------------------------------------------------------
alter table public.attempt_answers
  alter column selected_option_id drop not null;

comment on column public.attempt_answers.selected_option_id is
  'Null means the student explicitly cleared/deselected their answer.';

-- Count only questions that currently have a non-null selection. This keeps
-- answered_count honest after clear/deselect and after answer changes.
create or replace function public.recompute_answered_count(p_attempt_id uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer;
begin
  select count(*) into v_count
  from public.attempt_answers
  where attempt_id = p_attempt_id and selected_option_id is not null;
  update public.exam_attempts set answered_count = v_count where id = p_attempt_id;
  return v_count;
end;
$$;

revoke all on function public.recompute_answered_count(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. save_answer
--    - each logical save has a fresh request_id; retries reuse it
--    - duplicate detection is scoped to (attempt, question, request_id)
--    - p_option_id may be null (clear)
--    - returns the server's current revision so the client can resync
-- ---------------------------------------------------------------------------
create or replace function public.save_answer(
  p_attempt_id uuid,
  p_question_id uuid,
  p_option_id uuid,
  p_revision bigint,
  p_request_id uuid,
  p_controller_token uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := app.require_user();
  v_attempt public.exam_attempts;
  v_valid integer;
  v_existing public.attempt_answers;
  v_accepted boolean := false;
  v_current_revision bigint := coalesce(p_revision, 1);
begin
  select * into v_attempt from public.exam_attempts
  where id = p_attempt_id and student_id = v_uid for update;
  if not found then raise exception 'Attempt not found' using errcode = 'P0002'; end if;

  if v_attempt.state = 'submitted' then
    return jsonb_build_object('accepted', false, 'reason', 'finalized',
      'attempt_state', 'submitted', 'violation_count', v_attempt.violation_count,
      'deadline_at', v_attempt.deadline_at);
  end if;

  if now() >= v_attempt.deadline_at then
    perform app.finalize_attempt(p_attempt_id, 'time_expired');
    return jsonb_build_object('accepted', false, 'reason', 'time_expired',
      'attempt_state', 'submitted');
  end if;

  if p_controller_token <> v_attempt.controller_token then
    return jsonb_build_object('accepted', false, 'reason', 'controller');
  end if;

  -- Idempotent retry: same request for the same question. Return the current
  -- stored revision rather than the client's stale revision.
  select * into v_existing from public.attempt_answers
  where attempt_id = p_attempt_id
    and question_id = p_question_id
    and request_id = p_request_id;
  if found then
    update public.exam_attempts
       set controller_lease_expires_at = now() + interval '30 seconds'
     where id = p_attempt_id;
    return jsonb_build_object(
      'accepted', true,
      'reason', 'duplicate',
      'revision', v_existing.revision,
      'selected_option_id', v_existing.selected_option_id
    );
  end if;

  -- A non-null option must belong to this question in the frozen version.
  if p_option_id is not null then
    select 1 into v_valid
    from public.question_options o
    join public.exam_questions q on q.id = o.question_id
    where o.id = p_option_id and q.id = p_question_id
      and q.version_id = v_attempt.exam_version_id;
    if v_valid is null then
      return jsonb_build_object('accepted', false, 'reason', 'invalid_option');
    end if;
  end if;

  insert into public.attempt_answers (
    attempt_id, question_id, selected_option_id, revision, request_id, answered_at
  ) values (
    p_attempt_id, p_question_id, p_option_id,
    greatest(coalesce(p_revision, 1), 1), p_request_id, now()
  )
  on conflict (attempt_id, question_id) do update
    set selected_option_id = excluded.selected_option_id,
        revision = excluded.revision,
        request_id = excluded.request_id,
        answered_at = now()
    where public.attempt_answers.revision < excluded.revision;

  get diagnostics v_valid = row_count;
  v_accepted := v_valid > 0;

  select revision into v_current_revision
  from public.attempt_answers
  where attempt_id = p_attempt_id and question_id = p_question_id;
  if v_current_revision is null then
    v_current_revision := coalesce(p_revision, 1);
  end if;

  if v_accepted then
    update public.exam_attempts
       set controller_lease_expires_at = now() + interval '30 seconds'
     where id = p_attempt_id;
    perform public.recompute_answered_count(p_attempt_id);
  end if;

  return jsonb_build_object(
    'accepted', v_accepted,
    'reason', case when v_accepted then 'saved' else 'stale' end,
    'revision', v_current_revision
  );
end;
$$;

grant execute on function public.save_answer(uuid, uuid, uuid, bigint, uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. heartbeat — keep the existing void signature, extend the lease.
-- ---------------------------------------------------------------------------
create or replace function public.heartbeat(
  p_attempt_id uuid,
  p_controller_token uuid,
  p_seq bigint
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := app.require_user();
  v_attempt public.exam_attempts;
begin
  select * into v_attempt from public.exam_attempts
  where id = p_attempt_id and student_id = v_uid for update;
  if not found then raise exception 'Attempt not found' using errcode = 'P0002'; end if;
  if v_attempt.controller_token <> p_controller_token then
    raise exception 'Not the active controller' using errcode = '55006';
  end if;
  if v_attempt.state <> 'submitted' then
    update public.exam_attempts
       set controller_lease_expires_at = now() + interval '30 seconds'
     where id = p_attempt_id;
  end if;
  insert into public.attempt_heartbeats (attempt_id, last_seen_at, client_seq)
  values (p_attempt_id, now(), coalesce(p_seq, 0))
  on conflict (attempt_id) do update
    set last_seen_at = now(),
        client_seq = greatest(public.attempt_heartbeats.client_seq, excluded.client_seq);
end;
$$;

grant execute on function public.heartbeat(uuid, uuid, bigint) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Bookmarks
-- ---------------------------------------------------------------------------
create table if not exists public.attempt_bookmarks (
  id          uuid primary key default gen_random_uuid(),
  attempt_id  uuid not null references public.exam_attempts (id) on delete cascade,
  question_id uuid not null references public.exam_questions (id),
  created_at  timestamptz not null default now(),
  constraint attempt_bookmarks_unique unique (attempt_id, question_id)
);

create index if not exists attempt_bookmarks_attempt_idx
  on public.attempt_bookmarks (attempt_id);

alter table public.attempt_bookmarks enable row level security;

drop policy if exists attempt_bookmarks_select on public.attempt_bookmarks;
create policy attempt_bookmarks_select on public.attempt_bookmarks
  for select to authenticated
  using (app.can_view_attempt(attempt_id));

revoke all on public.attempt_bookmarks from anon, authenticated;
grant select on public.attempt_bookmarks to authenticated;

create or replace function public.toggle_bookmark(
  p_attempt_id uuid,
  p_question_id uuid,
  p_controller_token uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := app.require_user();
  v_attempt public.exam_attempts;
  v_question_version uuid;
  v_exists boolean;
begin
  select * into v_attempt from public.exam_attempts
  where id = p_attempt_id and student_id = v_uid for update;
  if not found then raise exception 'Attempt not found' using errcode = 'P0002'; end if;
  if v_attempt.state = 'submitted' then
    return jsonb_build_object('error', 'finalized');
  end if;
  if p_controller_token <> v_attempt.controller_token then
    return jsonb_build_object('error', 'controller');
  end if;

  select version_id into v_question_version
  from public.exam_questions where id = p_question_id;
  if v_question_version is distinct from v_attempt.exam_version_id then
    return jsonb_build_object('error', 'invalid_question');
  end if;

  select exists(
    select 1 from public.attempt_bookmarks
    where attempt_id = p_attempt_id and question_id = p_question_id
  ) into v_exists;

  if v_exists then
    delete from public.attempt_bookmarks
    where attempt_id = p_attempt_id and question_id = p_question_id;
    return jsonb_build_object('bookmarked', false);
  end if;

  insert into public.attempt_bookmarks (attempt_id, question_id)
  values (p_attempt_id, p_question_id)
  on conflict (attempt_id, question_id) do nothing;
  return jsonb_build_object('bookmarked', true);
end;
$$;

create or replace function public.get_bookmarks(
  p_attempt_id uuid,
  p_controller_token uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := app.require_user();
  v_attempt public.exam_attempts;
begin
  select * into v_attempt from public.exam_attempts
  where id = p_attempt_id and student_id = v_uid;
  if not found then raise exception 'Attempt not found' using errcode = 'P0002'; end if;
  if p_controller_token <> v_attempt.controller_token then
    return jsonb_build_object('error', 'controller');
  end if;
  return jsonb_build_object(
    'bookmarks',
    coalesce(
      (select jsonb_agg(question_id order by created_at)
       from public.attempt_bookmarks where attempt_id = p_attempt_id),
      '[]'::jsonb
    )
  );
end;
$$;

grant execute on function public.toggle_bookmark(uuid, uuid, uuid) to authenticated;
grant execute on function public.get_bookmarks(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Feedback
-- ---------------------------------------------------------------------------
create table if not exists public.exam_feedback (
  id         uuid primary key default gen_random_uuid(),
  exam_id    uuid not null references public.exams (id) on delete cascade,
  student_id uuid not null references public.profiles (id) on delete cascade,
  rating     integer check (rating is null or (rating >= 1 and rating <= 5)),
  comment    text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint exam_feedback_unique_student_exam unique (exam_id, student_id)
);

alter table public.exam_feedback enable row level security;

drop policy if exists exam_feedback_select on public.exam_feedback;
create policy exam_feedback_select on public.exam_feedback
  for select to authenticated
  using (student_id = auth.uid() or app.is_admin());

revoke all on public.exam_feedback from anon, authenticated;
grant select on public.exam_feedback to authenticated;

drop trigger if exists trg_exam_feedback_updated on public.exam_feedback;
create trigger trg_exam_feedback_updated before update on public.exam_feedback
  for each row execute function app.set_updated_at();

create or replace function public.submit_feedback(
  p_exam_id uuid,
  p_rating integer,
  p_comment text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := app.require_user();
  v_exam public.exams;
begin
  if not app.has_role('student') then
    raise exception 'Only students can submit feedback' using errcode = '42501';
  end if;
  select * into v_exam from public.exams where id = p_exam_id;
  if not found then raise exception 'Exam not found' using errcode = 'P0002'; end if;
  if not app.student_enrolled_approved(v_exam.course_id) then
    raise exception 'Not enrolled in this course' using errcode = '42501';
  end if;
  if p_rating is not null and (p_rating < 1 or p_rating > 5) then
    raise exception 'Rating must be between 1 and 5';
  end if;

  insert into public.exam_feedback (exam_id, student_id, rating, comment)
  values (p_exam_id, v_uid, p_rating, nullif(btrim(coalesce(p_comment, '')), ''))
  on conflict (exam_id, student_id) do update
    set rating = excluded.rating,
        comment = excluded.comment,
        updated_at = now();

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.get_feedback_summary(p_exam_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_exam public.exams;
begin
  select * into v_exam from public.exams where id = p_exam_id;
  if not found then raise exception 'Exam not found' using errcode = 'P0002'; end if;
  if not (app.owns_course(v_exam.course_id) or app.is_admin()) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'average', (select round(avg(rating)::numeric, 2) from public.exam_feedback where exam_id = p_exam_id and rating is not null),
    'count', (select count(*) from public.exam_feedback where exam_id = p_exam_id),
    'rating_count', (select count(*) from public.exam_feedback where exam_id = p_exam_id and rating is not null),
    'recent', coalesce((
      select jsonb_agg(jsonb_build_object(
        'rating', rating, 'comment', comment,
        'created_at', created_at, 'student_id', student_id
      ) order by created_at desc)
      from (
        select * from public.exam_feedback
        where exam_id = p_exam_id
        order by created_at desc
        limit 50
      ) f
    ), '[]'::jsonb)
  );
end;
$$;

grant execute on function public.submit_feedback(uuid, integer, text) to authenticated;
grant execute on function public.get_feedback_summary(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Release evaluation helpers (shared by every result surface).
-- ---------------------------------------------------------------------------
create or replace function app.result_release_status(p_attempt_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_attempt public.exam_attempts;
  v_exam public.exams;
  v_at timestamptz;
  v_released boolean := false;
  v_reason text;
begin
  select * into v_attempt from public.exam_attempts where id = p_attempt_id;
  if not found then
    return jsonb_build_object('released', false, 'reason', 'not_found');
  end if;
  if v_attempt.state <> 'submitted' then
    return jsonb_build_object('released', false, 'reason', 'in_progress');
  end if;

  select * into v_exam from public.exams where id = v_attempt.exam_id;

  if v_attempt.result_release = 'immediate' then
    v_released := true;
    v_reason := 'immediate';
  elsif v_attempt.result_release = 'after_close' then
    v_released := v_exam.state = 'archived'
      or v_exam.archived
      or (v_exam.closes_at is not null and now() >= v_exam.closes_at);
    v_reason := case when v_released then 'after_close' else 'awaiting_close' end;
  elsif v_attempt.result_release = 'scheduled' then
    v_at := coalesce(v_attempt.result_release_at, v_exam.result_release_at);
    v_released := v_at is not null and now() >= v_at;
    v_reason := case when v_released then 'scheduled' else 'awaiting_scheduled' end;
  else
    v_released := true;
    v_reason := 'immediate';
  end if;

  return jsonb_build_object(
    'released', v_released,
    'reason', v_reason,
    'at', v_at,
    'policy', v_attempt.result_release
  );
end;
$$;

revoke all on function app.result_release_status(uuid) from public, anon, authenticated;

create or replace function app.answer_review_status(
  p_attempt_id uuid,
  p_privileged boolean default false
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_attempt public.exam_attempts;
  v_exam public.exams;
  v_release jsonb;
  v_used integer;
  v_at timestamptz;
begin
  select * into v_attempt from public.exam_attempts where id = p_attempt_id;
  if not found then
    return jsonb_build_object('released', false, 'reason', 'not_found');
  end if;
  if v_attempt.state <> 'submitted' then
    return jsonb_build_object('released', false, 'reason', 'in_progress');
  end if;
  if p_privileged then
    return jsonb_build_object('released', true, 'reason', 'privileged');
  end if;
  if v_attempt.answer_review = 'never' then
    return jsonb_build_object('released', false, 'reason', 'never');
  end if;

  select * into v_exam from public.exams where id = v_attempt.exam_id;

  v_release := app.result_release_status(p_attempt_id);
  if not coalesce((v_release->>'released')::boolean, false) then
    return jsonb_build_object('released', false, 'reason', 'score_pending');
  end if;

  if v_attempt.answer_review = 'immediate' then
    return jsonb_build_object('released', true, 'reason', 'immediate');
  end if;

  if v_attempt.answer_review = 'scheduled' then
    v_at := coalesce(v_attempt.answer_release_at, v_exam.answer_release_at);
    -- Never before the score. The exam constraint enforces this for new
    -- schedules; this also protects edited/legacy data.
    if v_at is not null and now() >= v_at then
      return jsonb_build_object('released', true, 'reason', 'scheduled', 'at', v_at);
    end if;
    return jsonb_build_object('released', false, 'reason', 'awaiting_scheduled', 'at', v_at);
  end if;

  if v_exam.closes_at is not null and now() >= v_exam.closes_at then
    return jsonb_build_object('released', true, 'reason', 'after_close');
  end if;

  if v_attempt.answer_review = 'after_close' then
    return jsonb_build_object('released', false, 'reason', 'awaiting_close');
  end if;

  select count(*) into v_used
  from public.exam_attempts
  where exam_id = v_exam.id
    and student_id = v_attempt.student_id
    and state = 'submitted';
  if v_used >= greatest(coalesce(v_exam.max_attempts, 1), 1) then
    return jsonb_build_object('released', true, 'reason', 'after_attempts');
  end if;

  return jsonb_build_object('released', false, 'reason', 'awaiting_attempts');
end;
$$;

revoke all on function app.answer_review_status(uuid, boolean) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 8. get_result — release-gated score + review availability.
-- ---------------------------------------------------------------------------
create or replace function public.get_result(p_attempt_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := app.require_user();
  v_attempt public.exam_attempts;
  v_exam public.exams;
  v_version public.exam_versions;
  v_is_privileged boolean;
  v_release jsonb;
  v_released boolean;
  v_used integer;
  v_review jsonb;
begin
  select * into v_attempt from public.exam_attempts where id = p_attempt_id;
  if not found then raise exception 'Attempt not found' using errcode = 'P0002'; end if;

  v_is_privileged := app.is_admin()
    or app.owns_attempt_course(p_attempt_id)
    or v_attempt.student_id = v_uid;
  if not v_is_privileged then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  if v_attempt.state <> 'submitted' then
    return jsonb_build_object('attempt_state', 'in_progress',
      'exam_id', v_attempt.exam_id,
      'deadline_at', v_attempt.deadline_at,
      'violation_count', v_attempt.violation_count);
  end if;

  select * into v_exam from public.exams where id = v_attempt.exam_id;
  select * into v_version from public.exam_versions where id = v_attempt.exam_version_id;

  v_release := app.result_release_status(p_attempt_id);
  v_released := coalesce((v_release->>'released')::boolean, false)
    or app.is_admin()
    or app.owns_attempt_course(p_attempt_id);

  select count(*) into v_used from public.exam_attempts
  where exam_id = v_attempt.exam_id
    and student_id = v_attempt.student_id
    and state = 'submitted';

  v_review := app.answer_review_status(
    p_attempt_id,
    app.is_admin() or app.owns_attempt_course(p_attempt_id)
  );

  return jsonb_build_object(
    'attempt_id', v_attempt.id,
    'exam_id', v_attempt.exam_id,
    'attempt_state', 'submitted',
    'attempt_no', v_attempt.attempt_no,
    'max_attempts', coalesce(v_exam.max_attempts, 1),
    'used_attempts', v_used,
    'remaining_attempts', greatest(coalesce(v_exam.max_attempts, 1) - v_used, 0),
    'submission_reason', v_attempt.submission_reason,
    'submitted_at', v_attempt.submitted_at,
    'time_spent_seconds', case when v_attempt.submitted_at is not null
      then extract(epoch from (v_attempt.submitted_at - v_attempt.started_at))::int end,
    'violation_count', v_attempt.violation_count,
    'max_points', v_version.max_score,
    'result_release', v_attempt.result_release,
    'result_release_at', coalesce(v_attempt.result_release_at, v_exam.result_release_at),
    'released', v_released,
    'earned_points', case when v_released then v_attempt.earned_points else null end,
    'percentage', case when v_released then v_attempt.percentage else null end,
    'correct_count', case when v_released then v_attempt.correct_count else null end,
    'answered_count', v_attempt.answered_count,
    'item_count', v_version.item_count,
    'pass_threshold', v_attempt.pass_threshold,
    'passed', case when v_released and v_attempt.pass_threshold is not null
                        and v_attempt.percentage is not null
                   then v_attempt.percentage >= v_attempt.pass_threshold else null end,
    'review_policy', v_attempt.answer_review,
    'review_released', coalesce((v_review->>'released')::boolean, false),
    'review_reason', v_review->>'reason'
  );
end;
$$;

grant execute on function public.get_result(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 9. get_attempt_review — unchanged shape; scheduled-aware release.
-- ---------------------------------------------------------------------------
create or replace function public.get_attempt_review(p_attempt_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := app.require_user();
  v_attempt public.exam_attempts;
  v_exam public.exams;
  v_version public.exam_versions;
  v_privileged boolean;
  v_is_student_owner boolean;
  v_status jsonb;
  v_score_released boolean;
  v_review_released boolean;
  v_questions jsonb := '[]'::jsonb;
begin
  select * into v_attempt from public.exam_attempts where id = p_attempt_id;
  if not found then raise exception 'Attempt not found' using errcode = 'P0002'; end if;

  select * into v_exam from public.exams where id = v_attempt.exam_id;

  v_privileged := app.is_admin() or app.owns_attempt_course(p_attempt_id);
  v_is_student_owner := v_attempt.student_id = v_uid;

  if not (v_is_student_owner or v_privileged) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if v_is_student_owner and not v_privileged
     and not app.student_enrolled_approved(v_exam.course_id) then
    raise exception 'You are not enrolled in this course' using errcode = '42501';
  end if;

  select * into v_version from public.exam_versions where id = v_attempt.exam_version_id;

  v_status := app.answer_review_status(p_attempt_id, v_privileged);
  v_review_released := coalesce((v_status->>'released')::boolean, false);
  v_score_released := v_privileged
    or coalesce((app.result_release_status(p_attempt_id)->>'released')::boolean, false);

  if v_review_released then
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', q.id,
      'position', q.position,
      'prompt', q.prompt,
      'points', q.points,
      'explanation', q.explanation,
      'selected_option_id', aa.selected_option_id,
      'correct_option_id', ak.correct_option_id,
      'is_correct', (aa.selected_option_id is not null and aa.selected_option_id = ak.correct_option_id),
      'options', (
        select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'label', o.label) order by oo.ord), '[]'::jsonb)
        from jsonb_array_elements_text(v_attempt.option_order -> q.id::text)
             with ordinality as oo(oid, ord)
        join public.question_options o on o.id = oo.oid::uuid
      )
    ) order by qord.ord), '[]'::jsonb) into v_questions
    from jsonb_array_elements_text(v_attempt.question_order) with ordinality as qord(qid, ord)
    join public.exam_questions q on q.id = qord.qid::uuid
    left join public.answer_keys ak on ak.question_id = q.id
    left join public.attempt_answers aa
      on aa.attempt_id = p_attempt_id and aa.question_id = q.id;
  end if;

  return jsonb_build_object(
    'attempt_state', v_attempt.state,
    'attempt_no', v_attempt.attempt_no,
    'exam_id', v_attempt.exam_id,
    'exam_title', coalesce(v_version.title, v_exam.title),
    'submission_reason', v_attempt.submission_reason,
    'submitted_at', v_attempt.submitted_at,
    'violation_count', v_attempt.violation_count,
    'item_count', v_version.item_count,
    'max_points', v_version.max_score,
    'earned_points', case when v_score_released then v_attempt.earned_points else null end,
    'percentage', case when v_score_released then v_attempt.percentage else null end,
    'correct_count', case when v_score_released then v_attempt.correct_count else null end,
    'answered_count', v_attempt.answered_count,
    'pass_threshold', case when v_score_released then v_attempt.pass_threshold else null end,
    'passed', case when v_score_released and v_attempt.pass_threshold is not null
                        and v_attempt.percentage is not null
                   then v_attempt.percentage >= v_attempt.pass_threshold else null end,
    'review_policy', v_attempt.answer_review,
    'review_released', v_review_released,
    'review_reason', v_status->>'reason',
    'questions', v_questions
  );
end;
$$;

grant execute on function public.get_attempt_review(uuid) to authenticated;
