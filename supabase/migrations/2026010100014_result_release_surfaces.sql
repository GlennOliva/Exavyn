-- ===========================================================================
-- EXAVYN VERSION 2 - Migration 0014
-- Result/history surfaces with scheduled-release awareness.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- get_my_results (unpaginated; retained for compatibility)
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
    'released', (st.s->>'released')::boolean,
    'earned_points', case when (st.s->>'released')::boolean then a.earned_points else null end,
    'max_points', case when (st.s->>'released')::boolean then a.max_points else null end,
    'percentage', case when (st.s->>'released')::boolean then a.percentage else null end,
    'pass_threshold', a.pass_threshold,
    'passed', case when (st.s->>'released')::boolean
                    and a.pass_threshold is not null and a.percentage is not null
                   then a.percentage >= a.pass_threshold else null end,
    'review_policy', a.answer_review,
    'review_released', coalesce((app.answer_review_status(a.id, false)->>'released')::boolean, false),
    'review_reason', app.answer_review_status(a.id, false)->>'reason'
  ) order by a.started_at desc), '[]'::jsonb) into v_rows
  from public.exam_attempts a
  join public.exams e on e.id = a.exam_id
  left join public.exam_versions v on v.id = a.exam_version_id
  cross join lateral (select app.result_release_status(a.id) as s) st
  where a.student_id = v_uid and a.state = 'submitted';

  return v_rows;
end;
$$;

grant execute on function public.get_my_results() to authenticated;

-- ---------------------------------------------------------------------------
-- get_my_results_page (paginated history)
-- ---------------------------------------------------------------------------
create or replace function public.get_my_results_page(
  p_search text default '',
  p_page integer default 1,
  p_page_size integer default 10
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := app.require_user();
  v_page integer := greatest(coalesce(p_page, 1), 1);
  v_size integer := least(greatest(coalesce(p_page_size, 10), 1), 50);
  v_offset integer := (v_page - 1) * v_size;
  v_rows jsonb;
  v_total bigint;
  v_search text := btrim(coalesce(p_search, ''));
begin
  with base as (
    select
      a.id,
      a.exam_id,
      v.title as exam_title,
      e.course_id,
      a.attempt_no,
      a.state,
      a.submission_reason,
      a.started_at,
      a.submitted_at,
      a.violation_count,
      a.result_release,
      (st.s->>'released')::boolean as released,
      case when (st.s->>'released')::boolean then a.earned_points else null end as earned_points,
      case when (st.s->>'released')::boolean then a.max_points else null end as max_points,
      case when (st.s->>'released')::boolean then a.percentage else null end as percentage,
      a.pass_threshold,
      case when (st.s->>'released')::boolean
            and a.pass_threshold is not null and a.percentage is not null
           then a.percentage >= a.pass_threshold else null end as passed,
      a.answer_review as review_policy,
      coalesce((app.answer_review_status(a.id, false)->>'released')::boolean, false) as review_released,
      app.answer_review_status(a.id, false)->>'reason' as review_reason
    from public.exam_attempts a
    join public.exams e on e.id = a.exam_id
    left join public.exam_versions v on v.id = a.exam_version_id
    cross join lateral (select app.result_release_status(a.id) as s) st
    where a.student_id = v_uid and a.state = 'submitted'
  ),
  filtered as (
    select * from base
    where v_search = '' or exam_title ilike '%' || v_search || '%'
  ),
  page as (
    select * from filtered
    order by started_at desc, id desc
    limit v_size offset v_offset
  )
  select
    coalesce(jsonb_agg(to_jsonb(page.*)), '[]'::jsonb),
    (select count(*) from filtered)
  into v_rows, v_total
  from page;

  return jsonb_build_object(
    'rows', v_rows,
    'total', v_total,
    'page', v_page,
    'page_size', v_size
  );
end;
$$;

grant execute on function public.get_my_results_page(text, integer, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- get_my_exam_attempts — per-attempt release status for the exam page.
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
    'released', (st.s->>'released')::boolean,
    'earned_points', case when (st.s->>'released')::boolean then a.earned_points else null end,
    'max_points', case when (st.s->>'released')::boolean then a.max_points else null end,
    'percentage', case when (st.s->>'released')::boolean then a.percentage else null end,
    'pass_threshold', a.pass_threshold,
    'passed', case when (st.s->>'released')::boolean
                    and a.pass_threshold is not null and a.percentage is not null
                   then a.percentage >= a.pass_threshold else null end,
    'review_policy', a.answer_review,
    'review_released', coalesce((app.answer_review_status(a.id, false)->>'released')::boolean, false),
    'review_reason', app.answer_review_status(a.id, false)->>'reason'
  ) order by a.attempt_no), '[]'::jsonb) into v_attempts
  from public.exam_attempts a
  cross join lateral (select app.result_release_status(a.id) as s) st
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
    cross join lateral (select app.result_release_status(a.id) as s) st
    where a.exam_id = p_exam_id and a.student_id = v_uid and a.state = 'submitted'
      and (st.s->>'released')::boolean
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

grant execute on function public.get_my_exam_attempts(uuid) to authenticated;
