-- ===========================================================================
-- Exavyn — migration 0010
-- Student results + question-by-question answer review:
--   1. Separate the score-release policy from the correct-answer release
--      policy. A new enum `answer_review_policy` (immediate / after_attempts /
--      after_close / never) governs when a student may see correct answers and
--      per-question outcomes, independently of when the score is released.
--   2. Persist a pass/fail threshold per exam.
--   3. Persist an optional per-question explanation written by the teacher.
--   4. Snapshot answer_review + pass_threshold onto each attempt so a later
--      settings change only affects attempts started afterwards.
--   5. Add public.get_attempt_review() — a server-authorised, release-gated,
--      per-question review served from the immutable version snapshot and the
--      option order the student actually saw.
--
-- Forward-only: migrations 0000-0009 are already applied and are never
-- rewritten. Historical attempts, answers, and finalized results are preserved
-- and are intentionally backed up to the private `never` review policy so that
-- answer keys that were never shown to students stay hidden.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 0. Answer-review release policy enum
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'answer_review_policy') then
    create type public.answer_review_policy as enum (
      'immediate',      -- as soon as the score is released
      'after_attempts', -- once no attempts remain, or the exam closes
      'after_close',    -- once the exam has closed
      'never'           -- answer keys are never shown to students
    );
  end if;
end
$$;

comment on type public.answer_review_policy is
  'When correct answers and per-question outcomes are released to a student. '
  'Never earlier than the score release. Private by default for pre-existing exams.';

-- ---------------------------------------------------------------------------
-- 1. Exam-level settings (live, editable prospectively)
-- ---------------------------------------------------------------------------
alter table public.exams
  add column if not exists answer_review public.answer_review_policy not null default 'immediate',
  add column if not exists pass_threshold numeric(6,2);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'exams_pass_threshold_check') then
    alter table public.exams
      add constraint exams_pass_threshold_check
      check (pass_threshold is null or (pass_threshold >= 0 and pass_threshold <= 100));
  end if;
end
$$;

comment on column public.exams.answer_review is
  'Release policy for correct answers / per-question review (prospective).';
comment on column public.exams.pass_threshold is
  'Optional pass percentage (0-100). Null disables pass/fail reporting.';

-- Preserve the historical guarantee that students never see correct answers:
-- every exam that existed before this migration keeps its answers hidden. New
-- exams keep the column default and therefore default to immediate review.
update public.exams set answer_review = 'never' where answer_review <> 'never';

-- ---------------------------------------------------------------------------
-- 2. Version-level settings snapshot (frozen with the published content)
-- ---------------------------------------------------------------------------
alter table public.exam_versions
  add column if not exists answer_review public.answer_review_policy not null default 'immediate',
  add column if not exists pass_threshold numeric(6,2);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'exam_versions_pass_threshold_check') then
    alter table public.exam_versions
      add constraint exam_versions_pass_threshold_check
      check (pass_threshold is null or (pass_threshold >= 0 and pass_threshold <= 100));
  end if;
end
$$;

-- Backfill pre-existing frozen versions to the private policy. Frozen versions
-- are immutable, so the guard trigger is disabled for this one-time backfill.
alter table public.exam_versions disable trigger trg_version_immutable;
update public.exam_versions
   set answer_review = 'never'
 where answer_review <> 'never';
alter table public.exam_versions enable trigger trg_version_immutable;

-- ---------------------------------------------------------------------------
-- 2b. Per-question explanation (immutable part of the published snapshot).
-- ---------------------------------------------------------------------------
alter table public.exam_questions
  add column if not exists explanation text not null default '';

comment on column public.exam_questions.explanation is
  'Optional teacher-provided rationale shown during answer review.';

-- ---------------------------------------------------------------------------
-- 2. Per-attempt snapshot of the answer-review policy and pass threshold
-- ---------------------------------------------------------------------------
alter table public.exam_attempts
  add column if not exists answer_review public.answer_review_policy not null default 'immediate',
  add column if not exists pass_threshold numeric(6,2);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'exam_attempts_pass_threshold_check') then
    alter table public.exam_attempts
      add constraint exam_attempts_pass_threshold_check
      check (pass_threshold is null or (pass_threshold >= 0 and pass_threshold <= 100));
  end if;
end
$$;

-- Agent: the immutability trigger forbids UPDATEs on finalized attempts, so it
-- is disabled for this one-time, privacy-preserving backfill only.
alter table public.exam_attempts disable trigger trg_attempts_immutable;
update public.exam_attempts
   set answer_review = 'never'
 where answer_review is distinct from 'never';
alter table public.exam_attempts enable trigger trg_attempts_immutable;

-- ---------------------------------------------------------------------------
-- 3. Release evaluation helper
--    Shared by get_result() and get_attempt_review() so both surfaces agree on
--    exactly when review content may be returned. Answer review is never
--    earlier than score release.
-- ---------------------------------------------------------------------------
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
  v_score_released boolean;
  v_used integer;
begin
  select * into v_attempt from public.exam_attempts where id = p_attempt_id;
  if not found then
    return jsonb_build_object('released', false, 'reason', 'not_found');
  end if;

  if v_attempt.state <> 'submitted' then
    return jsonb_build_object('released', false, 'reason', 'in_progress');
  end if;

  -- Teachers/admins may always see the review (they already hold the keys).
  if p_privileged then
    return jsonb_build_object('released', true, 'reason', 'privileged');
  end if;

  if v_attempt.answer_review = 'never' then
    return jsonb_build_object('released', false, 'reason', 'never');
  end if;

  select * into v_exam from public.exams where id = v_attempt.exam_id;

  v_score_released := v_attempt.result_release = 'immediate'
    or (v_exam.closes_at is not null and now() >= v_exam.closes_at);
  if not v_score_released then
    return jsonb_build_object('released', false, 'reason', 'score_pending');
  end if;

  if v_attempt.answer_review = 'immediate' then
    return jsonb_build_object('released', true, 'reason', 'immediate');
  end if;

  if v_exam.closes_at is not null and now() >= v_exam.closes_at then
    return jsonb_build_object('released', true, 'reason', 'after_close');
  end if;

  if v_attempt.answer_review = 'after_close' then
    return jsonb_build_object('released', false, 'reason', 'awaiting_close');
  end if;

  -- after_attempts: released once the student can no longer retake.
  select count(*) into v_used
  from public.exam_attempts
  where exam_id = v_exam.id and student_id = v_attempt.student_id and state = 'submitted';
  if v_used >= greatest(coalesce(v_exam.max_attempts, 1), 1) then
    return jsonb_build_object('released', true, 'reason', 'after_attempts');
  end if;

  return jsonb_build_object('released', false, 'reason', 'awaiting_attempts');
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. save_exam_draft — persist answer_review / pass_threshold / explanation.
-- ---------------------------------------------------------------------------
create or replace function public.save_exam_draft(
  p_exam_id uuid,
  p_payload jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := app.require_user();
  v_exam_id uuid := p_exam_id;
  v_course_id uuid := (p_payload->>'course_id')::uuid;
  v_state public.exam_state;
  v_q jsonb;
  v_opt jsonb;
  v_qid uuid;
  v_pos integer;
  v_opos integer;
  v_correct_option uuid;
  v_opts jsonb;
  v_correct_idx integer;
  v_max_attempts integer := coalesce((p_payload->>'max_attempts')::int, 1);
  v_result_policy public.multi_attempt_policy :=
    coalesce((p_payload->>'result_policy'), 'latest')::public.multi_attempt_policy;
  v_answer_review public.answer_review_policy :=
    coalesce((p_payload->>'answer_review'), 'immediate')::public.answer_review_policy;
  v_pass_threshold numeric(6,2) := (p_payload->>'pass_threshold')::numeric;
begin
  if not (app.has_role('teacher') or app.is_admin()) then
    raise exception 'Only teachers may author exams' using errcode = '42501';
  end if;
  if not (app.owns_course(v_course_id) or app.is_admin()) then
    raise exception 'Not your course' using errcode = '42501';
  end if;
  if v_max_attempts < 1 or v_max_attempts > 20 then
    raise exception 'Maximum attempts must be between 1 and 20';
  end if;
  if v_pass_threshold is not null and (v_pass_threshold < 0 or v_pass_threshold > 100) then
    raise exception 'Pass threshold must be between 0 and 100';
  end if;

  perform app.validate_exam_payload(p_payload);

  if v_exam_id is null then
    insert into public.exams (
      course_id, owner_id, title, instructions, duration_minutes, opens_at, closes_at,
      question_randomization, option_randomization, result_release, max_attempts,
      result_policy, answer_review, pass_threshold, state
    ) values (
      v_course_id, v_uid, btrim(p_payload->>'title'), coalesce(p_payload->>'instructions',''),
      (p_payload->>'duration_minutes')::int,
      (p_payload->>'opens_at')::timestamptz,
      (p_payload->>'closes_at')::timestamptz,
      coalesce((p_payload->>'question_randomization')::boolean, false),
      coalesce((p_payload->>'option_randomization')::boolean, false),
      coalesce((p_payload->>'result_release'), 'immediate')::public.result_release_policy,
      v_max_attempts, v_result_policy, v_answer_review, v_pass_threshold, 'draft'
    ) returning id into v_exam_id;
  else
    select state into v_state from public.exams where id = v_exam_id for update;
    if not found then raise exception 'Exam not found' using errcode = 'P0002'; end if;
    if not (app.owns_course((select course_id from public.exams where id = v_exam_id)) or app.is_admin()) then
      raise exception 'Not your exam' using errcode = '42501';
    end if;
    if v_state <> 'draft' then
      raise exception 'Published exams are immutable; duplicate it instead or edit its settings';
    end if;

    update public.exams set
      course_id = v_course_id,
      title = btrim(p_payload->>'title'),
      instructions = coalesce(p_payload->>'instructions',''),
      duration_minutes = (p_payload->>'duration_minutes')::int,
      opens_at = (p_payload->>'opens_at')::timestamptz,
      closes_at = (p_payload->>'closes_at')::timestamptz,
      question_randomization = coalesce((p_payload->>'question_randomization')::boolean, false),
      option_randomization = coalesce((p_payload->>'option_randomization')::boolean, false),
      result_release = coalesce((p_payload->>'result_release'),'immediate')::public.result_release_policy,
      max_attempts = v_max_attempts,
      result_policy = v_result_policy,
      answer_review = v_answer_review,
      pass_threshold = v_pass_threshold
    where id = v_exam_id;

    delete from public.exam_questions where exam_id = v_exam_id and version_id is null;
  end if;

  v_pos := 0;
  for v_q in select * from jsonb_array_elements(p_payload->'questions')
  loop
    v_pos := v_pos + 1;
    insert into public.exam_questions (exam_id, version_id, position, prompt, points, explanation)
    values (v_exam_id, null, v_pos, btrim(v_q->>'prompt'),
            coalesce((v_q->>'points')::numeric, 1), coalesce(v_q->>'explanation', ''))
    returning id into v_qid;

    v_correct_idx := (v_q->>'correct_index')::int;
    v_opts := v_q->'options';
    v_opos := 0;
    v_correct_option := null;
    for v_opt in select * from jsonb_array_elements(v_opts)
    loop
      v_opos := v_opos + 1;
      insert into public.question_options (question_id, position, label)
      values (v_qid, v_opos, btrim(v_opt->>'label'));

      if v_opos - 1 = v_correct_idx then
        select id into v_correct_option
        from public.question_options
        where question_id = v_qid and position = v_opos;
      end if;
    end loop;

    insert into public.answer_keys (question_id, correct_option_id, points)
    values (v_qid, v_correct_option, coalesce((v_q->>'points')::numeric, 1));
  end loop;

  perform app.write_audit(v_uid, 'exam.save_draft', 'exam', v_exam_id::text, '{}'::jsonb);
  return v_exam_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. publish_exam — freeze answer_review / pass_threshold / explanation into
--    the published version.
-- ---------------------------------------------------------------------------
create or replace function public.publish_exam(p_exam_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := app.require_user();
  v_exam public.exams;
  v_version_id uuid;
  v_version_no integer;
  v_item_count integer;
  v_max numeric(10,2);
begin
  select * into v_exam from public.exams where id = p_exam_id for update;
  if not found then raise exception 'Exam not found' using errcode = 'P0002'; end if;
  if not (app.owns_course(v_exam.course_id) or app.is_admin()) then
    raise exception 'Not your exam' using errcode = '42501';
  end if;
  if v_exam.archived then raise exception 'Archived exams cannot be published'; end if;

  select count(*), coalesce(sum(points),0) into v_item_count, v_max
  from public.exam_questions where exam_id = p_exam_id and version_id is null;

  if v_item_count < 1 then
    raise exception 'Cannot publish an exam without questions';
  end if;
  if exists (
    select 1
    from public.exam_questions q
    left join public.answer_keys ak on ak.question_id = q.id
    where q.exam_id = p_exam_id and q.version_id is null and ak.question_id is null
  ) then
    raise exception 'Cannot publish: a question is missing its answer key';
  end if;

  select coalesce(max(version_no), 0) + 1 into v_version_no
  from public.exam_versions where exam_id = p_exam_id;

  insert into public.exam_versions (
    exam_id, version_no, title, instructions, duration_minutes, opens_at, closes_at,
    question_randomization, option_randomization, result_release, violation_threshold,
    max_attempts, result_policy, answer_review, pass_threshold,
    item_count, max_score, frozen, published_by
  ) values (
    p_exam_id, v_version_no, v_exam.title, v_exam.instructions, v_exam.duration_minutes,
    v_exam.opens_at, v_exam.closes_at, v_exam.question_randomization,
    v_exam.option_randomization, v_exam.result_release, v_exam.violation_threshold,
    v_exam.max_attempts, v_exam.result_policy, v_exam.answer_review, v_exam.pass_threshold,
    v_item_count, v_max, true, v_uid
  ) returning id into v_version_id;

  declare
    v_q jsonb;
    v_qid uuid;
    v_o record;
    v_o_new_id uuid;
    v_correct_pos integer;
    v_correct_new_id uuid;
  begin
    for v_q in
      select jsonb_build_object(
        'id', q.id, 'position', q.position, 'prompt', q.prompt,
        'points', q.points, 'explanation', q.explanation
      ) from public.exam_questions q
      where q.exam_id = p_exam_id and q.version_id is null order by q.position
    loop
      insert into public.exam_questions (
        exam_id, version_id, position, prompt, points, explanation
      ) values (
        p_exam_id, v_version_id, (v_q->>'position')::int, v_q->>'prompt',
        (v_q->>'points')::numeric, coalesce(v_q->>'explanation', '')
      ) returning id into v_qid;

      select po.position into v_correct_pos
      from public.answer_keys ak
      join public.question_options po on po.id = ak.correct_option_id
      where ak.question_id = (v_q->>'id')::uuid;

      v_correct_new_id := null;
      for v_o in
        select * from public.question_options
        where question_id = (v_q->>'id')::uuid order by position
      loop
        insert into public.question_options (question_id, position, label)
        values (v_qid, v_o.position, v_o.label)
        returning id into v_o_new_id;

        if v_o.position = v_correct_pos then
          v_correct_new_id := v_o_new_id;
        end if;
      end loop;

      if v_correct_new_id is null then
        raise exception 'Draft question % has no resolvable correct option', (v_q->>'id')::uuid;
      end if;

      insert into public.answer_keys (question_id, correct_option_id, points)
      values (v_qid, v_correct_new_id, (v_q->>'points')::numeric);
    end loop;
  end;

  update public.exams
     set state = 'published', current_version_id = v_version_id
   where id = p_exam_id;

  perform app.write_audit(v_uid, 'exam.publish', 'exam', p_exam_id::text,
    jsonb_build_object('version_id', v_version_id, 'version_no', v_version_no,
                       'item_count', v_item_count, 'max_score', v_max,
                       'max_attempts', v_exam.max_attempts,
                       'result_policy', v_exam.result_policy,
                       'answer_review', v_exam.answer_review));

  return v_version_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. duplicate_exam — carry answer_review / pass_threshold / explanation.
-- ---------------------------------------------------------------------------
create or replace function public.duplicate_exam(p_exam_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := app.require_user();
  v_src public.exams;
  v_new_id uuid;
  v_payload jsonb;
begin
  select * into v_src from public.exams where id = p_exam_id;
  if not found then raise exception 'Exam not found' using errcode = 'P0002'; end if;
  if not (app.owns_course(v_src.course_id) or app.is_admin()) then
    raise exception 'Not your exam' using errcode = '42501';
  end if;

  declare
    v_source_version uuid := v_src.current_version_id;
    v_questions jsonb;
  begin
    select coalesce(jsonb_agg(jsonb_build_object(
      'prompt', q.prompt,
      'points', q.points,
      'explanation', q.explanation,
      'correct_index', (
        select po.position - 1
        from public.answer_keys ak
        join public.question_options po on po.id = ak.correct_option_id
        where ak.question_id = q.id
      ),
      'options', (
        select jsonb_agg(jsonb_build_object('label', o.label) order by o.position)
        from public.question_options o where o.question_id = q.id
      )
    ) order by q.position), '[]'::jsonb) into v_questions
    from public.exam_questions q
    where q.exam_id = v_src.id
      and (
        (v_source_version is not null and q.version_id = v_source_version)
        or (v_source_version is null and q.version_id is null)
      );

    if jsonb_array_length(v_questions) = 0 then
      select coalesce(jsonb_agg(jsonb_build_object(
        'prompt', q.prompt,
        'points', q.points,
        'explanation', q.explanation,
        'correct_index', (
          select po.position - 1
          from public.answer_keys ak
          join public.question_options po on po.id = ak.correct_option_id
          where ak.question_id = q.id
        ),
        'options', (
          select jsonb_agg(jsonb_build_object('label', o.label) order by o.position)
          from public.question_options o where o.question_id = q.id
        )
      ) order by q.position), '[]'::jsonb) into v_questions
      from public.exam_questions q
      where q.exam_id = v_src.id and q.version_id is null;
    end if;

    v_payload := jsonb_build_object(
      'course_id', v_src.course_id,
      'title', v_src.title || ' (copy)',
      'instructions', v_src.instructions,
      'duration_minutes', v_src.duration_minutes,
      'opens_at', v_src.opens_at,
      'closes_at', v_src.closes_at,
      'question_randomization', v_src.question_randomization,
      'option_randomization', v_src.option_randomization,
      'result_release', v_src.result_release,
      'max_attempts', v_src.max_attempts,
      'result_policy', v_src.result_policy,
      'answer_review', v_src.answer_review,
      'pass_threshold', v_src.pass_threshold,
      'questions', v_questions
    );
  end;

  v_new_id := public.save_exam_draft(null, v_payload);
  perform app.write_audit(v_uid, 'exam.duplicate', 'exam', v_new_id::text,
    jsonb_build_object('source_exam_id', p_exam_id));
  return v_new_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. update_exam_settings — now also edits answer_review / pass_threshold.
--    The signature changes, so the previous overload is dropped first.
-- ---------------------------------------------------------------------------
drop function if exists public.update_exam_settings(
  uuid, text, text, timestamptz, timestamptz, integer,
  public.result_release_policy, integer, public.multi_attempt_policy);

create or replace function public.update_exam_settings(
  p_exam_id uuid,
  p_title text,
  p_instructions text,
  p_opens_at timestamptz,
  p_closes_at timestamptz,
  p_duration_minutes integer,
  p_result_release public.result_release_policy,
  p_max_attempts integer,
  p_result_policy public.multi_attempt_policy,
  p_answer_review public.answer_review_policy,
  p_pass_threshold numeric
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := app.require_user();
  v_exam public.exams;
begin
  select * into v_exam from public.exams where id = p_exam_id for update;
  if not found then raise exception 'Exam not found' using errcode = 'P0002'; end if;
  if not (app.owns_course(v_exam.course_id) or app.is_admin()) then
    raise exception 'Not your exam' using errcode = '42501';
  end if;
  if v_exam.state = 'archived' then
    raise exception 'Restore the exam before editing its settings' using errcode = 'P0002';
  end if;
  if coalesce(length(btrim(p_title)), 0) = 0 then
    raise exception 'Exam title is required';
  end if;
  if p_duration_minutes <= 0 then
    raise exception 'Duration must be positive';
  end if;
  if p_opens_at >= p_closes_at then
    raise exception 'Opening time must be before closing time';
  end if;
  if p_max_attempts < 1 or p_max_attempts > 20 then
    raise exception 'Maximum attempts must be between 1 and 20';
  end if;
  if p_pass_threshold is not null and (p_pass_threshold < 0 or p_pass_threshold > 100) then
    raise exception 'Pass threshold must be between 0 and 100';
  end if;

  update public.exams
     set title = btrim(p_title),
         instructions = coalesce(p_instructions, ''),
         opens_at = p_opens_at,
         closes_at = p_closes_at,
         duration_minutes = p_duration_minutes,
         result_release = p_result_release,
         max_attempts = p_max_attempts,
         result_policy = p_result_policy,
         answer_review = p_answer_review,
         pass_threshold = p_pass_threshold
   where id = p_exam_id;

  perform app.write_audit(v_uid, 'exam.update_settings', 'exam', p_exam_id::text,
    jsonb_build_object('max_attempts', p_max_attempts, 'result_policy', p_result_policy,
                       'result_release', p_result_release, 'answer_review', p_answer_review,
                       'pass_threshold', p_pass_threshold));
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. start_attempt — snapshot answer_review / pass_threshold onto the attempt.
-- ---------------------------------------------------------------------------
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
  v_completed integer;
  v_attempt_id uuid;
  v_attempt_no integer;
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

  if exists (select 1 from public.courses c where c.id = v_exam.course_id and c.archived) then
    raise exception 'This course is archived; new attempts are not allowed' using errcode = 'P0002';
  end if;

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
  if not found then raise exception 'Exam version not found' using errcode = 'P0002'; end if;

  -- Resume the single active attempt (if any). Resuming never consumes an attempt.
  select * into v_existing from public.exam_attempts
  where exam_id = p_exam_id and student_id = v_uid and state = 'in_progress'
  for update;

  if found then
    if p_current_token is not null and p_current_token = v_existing.controller_token then
      update public.exam_attempts
        set controller_lease_expires_at = now() + interval '30 seconds'
        where id = v_existing.id
        returning * into v_existing;
    elsif v_existing.controller_lease_expires_at is not null
          and v_existing.controller_lease_expires_at > now() then
      raise exception 'This attempt is active in another session' using errcode = '55006';
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
      'attempt_no', v_existing.attempt_no,
      'max_attempts', v_exam.max_attempts,
      'controller_token', v_existing.controller_token,
      'deadline_at', v_existing.deadline_at,
      'started_at', v_existing.started_at,
      'violation_count', v_existing.violation_count,
      'violation_threshold', v_version.violation_threshold
    );
  end if;

  select count(*) into v_completed from public.exam_attempts
  where exam_id = p_exam_id and student_id = v_uid and state = 'submitted';

  if v_completed >= v_exam.max_attempts then
    raise exception 'You have used all % attempts for this exam', v_exam.max_attempts
      using errcode = 'P0002';
  end if;

  v_attempt_no := v_completed + 1;

  v_deadline := least(now() + make_interval(mins => v_exam.duration_minutes), v_exam.closes_at);

  if v_version.question_randomization then
    select coalesce(jsonb_agg(q.id order by random()), '[]'::jsonb) into v_qorder
    from public.exam_questions q where q.version_id = v_version.id;
  else
    select coalesce(jsonb_agg(q.id order by q.position), '[]'::jsonb) into v_qorder
    from public.exam_questions q where q.version_id = v_version.id;
  end if;

  if v_version.option_randomization then
    select coalesce(jsonb_object_agg(sub.qid, sub.oids), '{}'::jsonb) into v_oorder
    from (
      select q.id::text as qid,
             (select coalesce(jsonb_agg(o.id order by random()), '[]'::jsonb)
                from public.question_options o where o.question_id = q.id) as oids
      from public.exam_questions q where q.version_id = v_version.id
    ) sub;
  else
    select coalesce(jsonb_object_agg(sub.qid, sub.oids), '{}'::jsonb) into v_oorder
    from (
      select q.id::text as qid,
             (select coalesce(jsonb_agg(o.id order by o.position), '[]'::jsonb)
                from public.question_options o where o.question_id = q.id) as oids
      from public.exam_questions q where q.version_id = v_version.id
    ) sub;
  end if;

  insert into public.exam_attempts (
    exam_id, exam_version_id, student_id, attempt_no, result_release,
    answer_review, pass_threshold,
    deadline_at, question_order, option_order, controller_token, controller_lease_expires_at
  ) values (
    p_exam_id, v_version.id, v_uid, v_attempt_no, v_exam.result_release,
    v_exam.answer_review, v_exam.pass_threshold,
    v_deadline, v_qorder, v_oorder, gen_random_uuid(), now() + interval '30 seconds'
  ) returning id, controller_token into v_attempt_id, v_token;

  return jsonb_build_object(
    'attempt_id', v_attempt_id,
    'resumed', false,
    'attempt_no', v_attempt_no,
    'max_attempts', v_exam.max_attempts,
    'controller_token', v_token,
    'deadline_at', v_deadline,
    'started_at', now(),
    'violation_count', 0,
    'violation_threshold', v_version.violation_threshold
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. get_result — add attempt/remaining counts, pass threshold, review state.
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
  v_version public.exam_versions;
  v_exam public.exams;
  v_is_privileged boolean;
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
      'deadline_at', v_attempt.deadline_at,
      'violation_count', v_attempt.violation_count);
  end if;

  select * into v_version from public.exam_versions where id = v_attempt.exam_version_id;
  select * into v_exam from public.exams where id = v_attempt.exam_id;

  v_released := v_attempt.result_release = 'immediate'
    or (v_exam.closes_at is not null and now() >= v_exam.closes_at)
    or app.is_admin()
    or app.owns_attempt_course(p_attempt_id);

  select count(*) into v_used from public.exam_attempts
  where exam_id = v_attempt.exam_id and student_id = v_attempt.student_id and state = 'submitted';

  v_review := app.answer_review_status(
    p_attempt_id,
    app.is_admin() or app.owns_attempt_course(p_attempt_id)
  );

  return jsonb_build_object(
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

-- ---------------------------------------------------------------------------
-- 9. get_attempt_review — server-authorised per-question review.
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

  -- A student must still be approved-enrolled to read their own review.
  if v_is_student_owner and not v_privileged
     and not app.student_enrolled_approved(v_exam.course_id) then
    raise exception 'You are not enrolled in this course' using errcode = '42501';
  end if;

  select * into v_version from public.exam_versions where id = v_attempt.exam_version_id;

  v_status := app.answer_review_status(p_attempt_id, v_privileged);
  v_review_released := coalesce((v_status->>'released')::boolean, false);

  v_score_released := v_privileged
    or v_attempt.result_release = 'immediate'
    or (v_exam.closes_at is not null and now() >= v_exam.closes_at);

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

-- ---------------------------------------------------------------------------
-- 10. get_my_results — surface review availability for history/dashboard links.
-- ---------------------------------------------------------------------------
create or replace function public.get_my_results()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := app.require_user();
  v_rows jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', a.id,
    'exam_id', a.exam_id,
    'exam_title', v.title,
    'course_id', e.course_id,
    'attempt_no', a.attempt_no,
    'state', a.state,
    'submission_reason', a.submission_reason,
    'started_at', a.started_at,
    'submitted_at', a.submitted_at,
    'violation_count', a.violation_count,
    'result_release', a.result_release,
    'released', (a.result_release = 'immediate' or now() >= e.closes_at),
    'earned_points', case when a.result_release = 'immediate' or now() >= e.closes_at
                          then a.earned_points else null end,
    'max_points', case when a.result_release = 'immediate' or now() >= e.closes_at
                       then a.max_points else null end,
    'percentage', case when a.result_release = 'immediate' or now() >= e.closes_at
                       then a.percentage else null end,
    'pass_threshold', a.pass_threshold,
    'passed', case when (a.result_release = 'immediate' or now() >= e.closes_at)
                    and a.pass_threshold is not null and a.percentage is not null
                   then a.percentage >= a.pass_threshold else null end,
    'review_policy', a.answer_review,
    'review_released', coalesce((app.answer_review_status(a.id, false)->>'released')::boolean, false),
    'review_reason', app.answer_review_status(a.id, false)->>'reason'
  ) order by a.started_at desc), '[]'::jsonb) into v_rows
  from public.exam_attempts a
  join public.exams e on e.id = a.exam_id
  left join public.exam_versions v on v.id = a.exam_version_id
  where a.student_id = v_uid and a.state = 'submitted';

  return v_rows;
end;
$$;

-- ---------------------------------------------------------------------------
-- 11. get_my_exam_attempts — include per-attempt review availability.
-- ---------------------------------------------------------------------------
create or replace function public.get_my_exam_attempts(p_exam_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := app.require_user();
  v_exam public.exams;
  v_used integer;
  v_remaining integer;
  v_attempts jsonb;
  v_active uuid;
  v_best jsonb;
begin
  select * into v_exam from public.exams where id = p_exam_id;
  if not found then raise exception 'Exam not found' using errcode = 'P0002'; end if;

  if not (v_exam.state = 'published' and v_exam.archived = false) then
    raise exception 'Exam is not available' using errcode = 'P0002';
  end if;
  if not app.student_enrolled_approved(v_exam.course_id) then
    raise exception 'You are not enrolled in this course' using errcode = '42501';
  end if;

  select count(*) into v_used from public.exam_attempts
  where exam_id = p_exam_id and student_id = v_uid and state = 'submitted';
  v_remaining := greatest(v_exam.max_attempts - v_used, 0);

  select id into v_active from public.exam_attempts
  where exam_id = p_exam_id and student_id = v_uid and state = 'in_progress'
  limit 1;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', a.id,
    'attempt_no', a.attempt_no,
    'state', a.state,
    'started_at', a.started_at,
    'deadline_at', a.deadline_at,
    'submitted_at', a.submitted_at,
    'submission_reason', a.submission_reason,
    'violation_count', a.violation_count,
    'released', (a.result_release = 'immediate' or now() >= v_exam.closes_at),
    'earned_points', case when a.result_release = 'immediate' or now() >= v_exam.closes_at
                          then a.earned_points else null end,
    'max_points', case when a.result_release = 'immediate' or now() >= v_exam.closes_at
                       then a.max_points else null end,
    'percentage', case when a.result_release = 'immediate' or now() >= v_exam.closes_at
                       then a.percentage else null end,
    'pass_threshold', a.pass_threshold,
    'passed', case when (a.result_release = 'immediate' or now() >= v_exam.closes_at)
                    and a.pass_threshold is not null and a.percentage is not null
                   then a.percentage >= a.pass_threshold else null end,
    'review_policy', a.answer_review,
    'review_released', coalesce((app.answer_review_status(a.id, false)->>'released')::boolean, false),
    'review_reason', app.answer_review_status(a.id, false)->>'reason'
  ) order by a.attempt_no), '[]'::jsonb) into v_attempts
  from public.exam_attempts a
  where a.exam_id = p_exam_id and a.student_id = v_uid;

  select jsonb_build_object(
    'attempt_no', x.attempt_no,
    'percentage', x.percentage,
    'earned_points', x.earned_points,
    'max_points', x.max_points,
    'pass_threshold', x.pass_threshold,
    'passed', case when x.pass_threshold is not null and x.percentage is not null
                   then x.percentage >= x.pass_threshold else null end
  ) into v_best
  from (
    select a.attempt_no, a.percentage, a.earned_points, a.max_points, a.pass_threshold
    from public.exam_attempts a
    where a.exam_id = p_exam_id and a.student_id = v_uid and a.state = 'submitted'
      and (a.result_release = 'immediate' or now() >= v_exam.closes_at)
    order by
      case when v_exam.result_policy = 'highest' then a.percentage end desc nulls last,
      a.attempt_no desc
    limit 1
  ) x;

  return jsonb_build_object(
    'max_attempts', v_exam.max_attempts,
    'used', v_used,
    'remaining', v_remaining,
    'result_policy', v_exam.result_policy,
    'answer_review', v_exam.answer_review,
    'pass_threshold', v_exam.pass_threshold,
    'active_attempt_id', v_active,
    'attempts', v_attempts,
    'summary', v_best
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 12. Grants
-- ---------------------------------------------------------------------------
grant execute on function public.get_attempt_review(uuid) to authenticated;
grant execute on function public.update_exam_settings(
  uuid, text, text, timestamptz, timestamptz, integer,
  public.result_release_policy, integer, public.multi_attempt_policy,
  public.answer_review_policy, numeric) to authenticated;
grant execute on function public.get_result(uuid) to authenticated;
grant execute on function public.get_my_results() to authenticated;
grant execute on function public.get_my_exam_attempts(uuid) to authenticated;
grant execute on function public.start_attempt(uuid, uuid) to authenticated;
grant execute on function public.save_exam_draft(uuid, jsonb) to authenticated;
grant execute on function public.publish_exam(uuid) to authenticated;
grant execute on function public.duplicate_exam(uuid) to authenticated;
