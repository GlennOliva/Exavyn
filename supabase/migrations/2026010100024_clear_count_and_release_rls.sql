-- Count only non-null selections when finalizing. This affects future
-- finalizations only; historical finalized results remain immutable.
create or replace function app.finalize_attempt(
  p_attempt_id uuid,
  p_reason public.submission_reason
)
returns public.exam_attempts
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_attempt public.exam_attempts;
  v_max numeric(10,2);
  v_earned numeric(10,2);
  v_correct integer;
  v_answered integer;
  v_pct numeric(6,2);
  v_reason public.submission_reason;
  v_released timestamptz;
begin
  select * into v_attempt from public.exam_attempts where id = p_attempt_id for update;
  if not found then raise exception 'Attempt not found' using errcode = 'P0002'; end if;
  if v_attempt.state = 'submitted' then return v_attempt; end if;

  v_reason := case when now() >= v_attempt.deadline_at then 'time_expired' else p_reason end;

  select coalesce(sum(ak.points), 0) into v_max
  from public.exam_questions q
  join public.answer_keys ak on ak.question_id = q.id
  where q.version_id = v_attempt.exam_version_id;

  select coalesce(sum(ak.points), 0), count(*)
  into v_earned, v_correct
  from public.attempt_answers aa
  join public.answer_keys ak on ak.question_id = aa.question_id
  where aa.attempt_id = p_attempt_id
    and aa.selected_option_id = ak.correct_option_id;

  select count(*) into v_answered
  from public.attempt_answers
  where attempt_id = p_attempt_id and selected_option_id is not null;

  v_pct := case when v_max > 0 then round(v_earned / v_max * 100, 2) else 0 end;
  v_released := case when v_attempt.result_release = 'immediate' then now() else null end;

  update public.exam_attempts set
    state = 'submitted', submitted_at = now(), submission_reason = v_reason,
    earned_points = v_earned, max_points = v_max, percentage = v_pct,
    answered_count = v_answered, correct_count = v_correct,
    result_released_at = v_released
  where id = p_attempt_id
  returning * into v_attempt;

  return v_attempt;
end;
$$;

-- Keep app.result_release_status private. The direct-table RLS gate evaluates
-- the same release conditions without requiring users to execute the helper.
drop policy if exists exam_attempts_select on public.exam_attempts;
create policy exam_attempts_select on public.exam_attempts
  for select to authenticated
  using (
    app.is_active()
    and (
      app.is_admin()
      or app.owns_attempt_course(id)
      or (
        student_id = auth.uid()
        and state = 'submitted'
        and (
          result_release = 'immediate'
          or (result_release = 'scheduled' and result_release_at is not null and now() >= result_release_at)
          or (
            result_release = 'after_close'
            and exists (
              select 1 from public.exams e
              where e.id = exam_attempts.exam_id
                and (e.archived or e.state = 'archived' or now() >= e.closes_at)
            )
          )
        )
      )
    )
  );

revoke all on function app.finalize_attempt(uuid, public.submission_reason) from public, anon, authenticated;
