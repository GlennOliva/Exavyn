-- ===========================================================================
-- EXAVYN VERSION 2 - Migration 0016
-- save_exam_draft with scheduled release and timezone.
-- ===========================================================================

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
  v_result_release public.result_release_policy :=
    coalesce((p_payload->>'result_release'), 'immediate')::public.result_release_policy;
  v_pass_threshold numeric(6,2) := (p_payload->>'pass_threshold')::numeric;
  v_result_release_at timestamptz := nullif(p_payload->>'result_release_at','')::timestamptz;
  v_answer_release_at timestamptz := nullif(p_payload->>'answer_release_at','')::timestamptz;
  v_timezone text := coalesce(nullif(btrim(p_payload->>'timezone'), ''), 'UTC');
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
  if v_result_release = 'scheduled' and v_result_release_at is null then
    raise exception 'Result release time is required when scheduled';
  end if;
  if v_answer_review = 'scheduled' and v_answer_release_at is null then
    raise exception 'Answer release time is required when scheduled';
  end if;
  if v_answer_release_at is not null and v_result_release_at is not null
     and v_answer_release_at < v_result_release_at then
    raise exception 'Answer release cannot be before result release';
  end if;

  perform app.validate_exam_payload(p_payload);

  if v_exam_id is null then
    insert into public.exams (
      course_id, owner_id, title, instructions, duration_minutes, opens_at, closes_at,
      question_randomization, option_randomization, result_release, max_attempts,
      result_policy, answer_review, pass_threshold, state,
      result_release_at, answer_release_at, timezone
    ) values (
      v_course_id, v_uid, btrim(p_payload->>'title'), coalesce(p_payload->>'instructions',''),
      (p_payload->>'duration_minutes')::int,
      (p_payload->>'opens_at')::timestamptz,
      (p_payload->>'closes_at')::timestamptz,
      coalesce((p_payload->>'question_randomization')::boolean, false),
      coalesce((p_payload->>'option_randomization')::boolean, false),
      v_result_release,
      v_max_attempts, v_result_policy, v_answer_review, v_pass_threshold, 'draft',
      case when v_result_release = 'scheduled' then v_result_release_at else null end,
      case when v_answer_review = 'scheduled' then v_answer_release_at else null end,
      v_timezone
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
      result_release = v_result_release,
      max_attempts = v_max_attempts,
      result_policy = v_result_policy,
      answer_review = v_answer_review,
      pass_threshold = v_pass_threshold,
      result_release_at = case when v_result_release = 'scheduled' then v_result_release_at else null end,
      answer_release_at = case when v_answer_review = 'scheduled' then v_answer_release_at else null end,
      timezone = v_timezone
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

grant execute on function public.save_exam_draft(uuid, jsonb) to authenticated;
