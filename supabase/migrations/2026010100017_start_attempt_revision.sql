-- ===========================================================================
-- EXAVYN VERSION 2 - Migration 0017
-- start_attempt snapshots scheduled release + get_attempt_payload returns saved_revision
-- ===========================================================================

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
    raise exception 'No attempts remaining' using errcode = 'P0001';
  end if;

  v_attempt_no := v_completed + 1;
  v_deadline := now() + (v_version.duration_minutes || ' minutes')::interval;
  v_token := gen_random_uuid();

  select app.build_question_order(v_exam.id, v_version.id) into v_qorder;
  select app.build_option_order(v_version.id) into v_oorder;

  insert into public.exam_attempts (
    exam_id, exam_version_id, student_id, attempt_no, result_release,
    answer_review, pass_threshold, result_release_at, answer_release_at,
    deadline_at, question_order, option_order, controller_token, controller_lease_expires_at,
    max_points
  ) values (
    p_exam_id, v_version.id, v_uid, v_attempt_no, v_exam.result_release,
    v_exam.answer_review, v_exam.pass_threshold,
    case when v_exam.result_release = 'scheduled' then v_exam.result_release_at else null end,
    case when v_exam.answer_review = 'scheduled' then v_exam.answer_release_at else null end,
    v_deadline, v_qorder, v_oorder, v_token, now() + interval '30 seconds',
    v_version.max_score
  ) returning id into v_attempt_id;

  perform app.write_audit(v_uid, 'attempt.start', 'attempt', v_attempt_id::text,
    jsonb_build_object('exam_id', p_exam_id, 'attempt_no', v_attempt_no));
  perform app.finalize_if_expired(v_attempt_id);

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

create or replace function public.get_attempt_payload(p_attempt_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := app.require_user();
  v_attempt public.exam_attempts;
  v_version public.exam_versions;
  v_questions jsonb;
  v_saved_rev bigint;
begin
  select * into v_attempt from public.exam_attempts
  where id = p_attempt_id and student_id = v_uid;
  if not found then raise exception 'Attempt not found' using errcode = 'P0002'; end if;

  select * into v_version from public.exam_versions where id = v_attempt.exam_version_id;

  select max(revision) into v_saved_rev
  from public.attempt_answers
  where attempt_id = p_attempt_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', q.id,
    'prompt', q.prompt,
    'points', q.points,
    'options', (
      select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'label', o.label) order by oo.ord), '[]'::jsonb)
      from jsonb_array_elements_text(v_attempt.option_order -> q.id::text)
           with ordinality as oo(oid, ord)
      join public.question_options o on o.id = oo.oid::uuid
    ),
    'saved_option_id', aa.selected_option_id,
    'revision', aa.revision
  ) order by qord.ord), '[]'::jsonb) into v_questions
  from jsonb_array_elements_text(v_attempt.question_order) with ordinality as qord(qid, ord)
  join public.exam_questions q on q.id = qord.qid::uuid
  left join public.attempt_answers aa
    on aa.attempt_id = p_attempt_id and aa.question_id = q.id;

  return jsonb_build_object(
    'attempt', jsonb_build_object(
      'id', v_attempt.id,
      'state', v_attempt.state,
      'started_at', v_attempt.started_at,
      'deadline_at', v_attempt.deadline_at,
      'violation_count', v_attempt.violation_count,
      'violation_threshold', v_version.violation_threshold,
      'submission_reason', v_attempt.submission_reason
    ),
    'exam', jsonb_build_object(
      'title', v_version.title,
      'instructions', v_version.instructions,
      'duration_minutes', v_version.duration_minutes,
      'item_count', v_version.item_count,
      'result_release', v_version.result_release,
      'closes_at', v_version.closes_at
    ),
    'questions', v_questions,
    'saved_revision', coalesce(v_saved_rev, 0)
  );
end;
$$;

grant execute on function public.start_attempt(uuid, uuid) to authenticated;
grant execute on function public.get_attempt_payload(uuid) to authenticated;
