-- Authorized release metadata without score or answer-key material.
create or replace function public.get_attempt_release_status(p_attempt_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := app.require_user();
  v_attempt public.exam_attempts;
  v_privileged boolean;
begin
  select * into v_attempt from public.exam_attempts where id = p_attempt_id;
  if not found then raise exception 'Attempt not found' using errcode = 'P0002'; end if;
  v_privileged := app.is_admin() or app.owns_attempt_course(p_attempt_id);
  if not (v_attempt.student_id = v_uid or v_privileged) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'result', app.result_release_status(p_attempt_id),
    'review', app.answer_review_status(p_attempt_id, v_privileged)
  );
end;
$$;

grant execute on function public.get_attempt_release_status(uuid) to authenticated;
