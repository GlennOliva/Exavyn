-- ===========================================================================
-- EXAVYN VERSION 2 - Migration 0018
-- Restore missing order builders and fix start_attempt to not depend on
-- nonexistent app.build_question_order/build_option_order.
-- Preserves existing attempts; only creates orders for new attempts.
-- ===========================================================================

create or replace function app.build_question_order(p_exam_id uuid, p_version_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_exam public.exams;
  v_order jsonb := '[]'::jsonb;
begin
  select * into v_exam from public.exams where id = p_exam_id;
  if v_exam.question_randomization then
    select coalesce(jsonb_agg(qid), '[]'::jsonb) into v_order
    from (
      select id as qid
      from public.exam_questions
      where version_id = p_version_id
      order by random()
    ) s;
  else
    select coalesce(jsonb_agg(qid order by pos), '[]'::jsonb) into v_order
    from (
      select id as qid, position as pos
      from public.exam_questions
      where version_id = p_version_id
    ) s;
  end if;
  return v_order;
end;
$$;

create or replace function app.build_option_order(p_version_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_exam public.exams;
  v_ver public.exam_versions;
  v_order jsonb := '{}'::jsonb;
  r record;
begin
  select * into v_ver from public.exam_versions where id = p_version_id;
  select * into v_exam from public.exams where id = v_ver.exam_id;
  for r in select id from public.exam_questions where version_id = p_version_id loop
    if v_exam.option_randomization then
      select jsonb_build_object(r.id::text, coalesce(jsonb_agg(oid), '[]'::jsonb)) into v_order
      from (
        select jsonb_build_object(r.id::text, coalesce(jsonb_agg(oid), '[]'::jsonb))
        from (
          select id as oid
          from public.question_options
          where question_id = r.id
          order by random()
        ) o
      ) dummy;
      -- simpler
    end if;
  end loop;
  -- build properly
  v_order := '{}'::jsonb;
  for r in select id from public.exam_questions where version_id = p_version_id loop
    if v_exam.option_randomization then
      v_order := v_order || jsonb_build_object(
        r.id::text,
        coalesce((select jsonb_agg(id) from (select id from public.question_options where question_id = r.id order by random()) x), '[]'::jsonb)
      );
    else
      v_order := v_order || jsonb_build_object(
        r.id::text,
        coalesce((select jsonb_agg(id order by position) from public.question_options where question_id = r.id), '[]'::jsonb)
      );
    end if;
  end loop;
  return v_order;
end;
$$;

revoke all on function app.build_question_order(uuid, uuid) from public, anon, authenticated;
revoke all on function app.build_option_order(uuid) from public, anon, authenticated;
