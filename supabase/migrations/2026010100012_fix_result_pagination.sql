-- ===========================================================================
-- Exavyn — migration 0012
-- Fixes get_my_results_page(): the first release of the function referenced a
-- CTE from a separate SQL statement, where it is out of scope. This version
-- computes the page rows and total in one statement. Behaviour is unchanged.
-- ===========================================================================

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
      (a.result_release = 'immediate' or now() >= e.closes_at) as released,
      case when a.result_release = 'immediate' or now() >= e.closes_at
           then a.earned_points else null end as earned_points,
      case when a.result_release = 'immediate' or now() >= e.closes_at
           then a.max_points else null end as max_points,
      case when a.result_release = 'immediate' or now() >= e.closes_at
           then a.percentage else null end as percentage,
      a.pass_threshold,
      case when (a.result_release = 'immediate' or now() >= e.closes_at)
            and a.pass_threshold is not null and a.percentage is not null
           then a.percentage >= a.pass_threshold else null end as passed,
      a.answer_review as review_policy,
      coalesce((app.answer_review_status(a.id, false)->>'released')::boolean, false) as review_released,
      app.answer_review_status(a.id, false)->>'reason' as review_reason
    from public.exam_attempts a
    join public.exams e on e.id = a.exam_id
    left join public.exam_versions v on v.id = a.exam_version_id
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
    (select coalesce(jsonb_agg(to_jsonb(page)), '[]'::jsonb) from page),
    (select count(*) from filtered)
  into v_rows, v_total;

  return jsonb_build_object(
    'rows', v_rows,
    'total', v_total,
    'page', v_page,
    'page_size', v_size
  );
end;
$$;

comment on function public.get_my_results_page(text, integer, integer) is
  'Release-guarded student result history with server-side search + pagination.';

grant execute on function public.get_my_results_page(text, integer, integer) to authenticated;
