-- ===========================================================================
-- EXAVYN VERSION 2 - Migration 0019
-- Restore app.finalize_if_expired and ensure helpers exist.
-- Uses authoritative app.finalize_attempt; atomic and idempotent.
-- ===========================================================================

create or replace function app.finalize_if_expired(p_attempt_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_attempt public.exam_attempts;
  v_res jsonb;
begin
  select * into v_attempt from public.exam_attempts where id = p_attempt_id for update;
  if not found then
    return jsonb_build_object('finalized', false, 'reason', 'not_found');
  end if;
  if v_attempt.state = 'submitted' then
    return jsonb_build_object('finalized', false, 'reason', 'already_submitted');
  end if;
  if now() >= v_attempt.deadline_at then
    v_res := app.finalize_attempt(p_attempt_id, 'time_expired');
    return jsonb_build_object('finalized', true, 'reason', 'time_expired', 'result', v_res);
  end if;
  return jsonb_build_object('finalized', false, 'reason', 'not_expired');
end;
$$;

revoke all on function app.finalize_if_expired(uuid) from public, anon, authenticated;

-- Ensure other helpers exist if missing (defensive)
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
    from (select id as qid from public.exam_questions where version_id = p_version_id order by random()) s;
  else
    select coalesce(jsonb_agg(qid order by pos), '[]'::jsonb) into v_order
    from (select id as qid, position as pos from public.exam_questions where version_id = p_version_id) s;
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
