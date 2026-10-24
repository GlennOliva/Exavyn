-- ===========================================================================
-- EXAVYN VERSION 2 - Migration 0015
-- update_exam_settings with scheduled release and timezone.
-- ===========================================================================

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
  p_pass_threshold numeric,
  p_result_release_at timestamptz default null,
  p_answer_release_at timestamptz default null,
  p_timezone text default 'UTC'
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
  if p_result_release = 'scheduled' and p_result_release_at is null then
    raise exception 'Result release time is required when scheduled';
  end if;
  if p_answer_review = 'scheduled' and p_answer_release_at is null then
    raise exception 'Answer release time is required when scheduled';
  end if;
  if p_answer_release_at is not null and p_result_release_at is not null
     and p_answer_release_at < p_result_release_at then
    raise exception 'Answer release cannot be before result release';
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
         pass_threshold = p_pass_threshold,
         result_release_at = case when p_result_release = 'scheduled' then p_result_release_at else null end,
         answer_release_at = case when p_answer_review = 'scheduled' then p_answer_release_at else null end,
         timezone = coalesce(nullif(btrim(p_timezone), ''), 'UTC')
   where id = p_exam_id;

  perform app.write_audit(v_uid, 'exam.update_settings', 'exam', p_exam_id::text,
    jsonb_build_object('max_attempts', p_max_attempts, 'result_policy', p_result_policy,
                       'result_release', p_result_release, 'answer_review', p_answer_review,
                       'pass_threshold', p_pass_threshold));
end;
$$;

grant execute on function public.update_exam_settings(
  uuid, text, text, timestamptz, timestamptz, integer,
  public.result_release_policy, integer, public.multi_attempt_policy,
  public.answer_review_policy, numeric, timestamptz, timestamptz, text
) to authenticated;
