-- ===========================================================================
-- Anti-Cheating Exam — migration 0007
-- Least-privilege grants. RLS filters rows; grants decide which verbs exist.
-- ===========================================================================

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from anon, authenticated;
revoke all on schema app from anon, authenticated, public;
revoke all on all functions in schema app from anon, authenticated, public;

grant usage on schema public to anon, authenticated;

-- RLS policy expressions are evaluated as the querying role, so the helper
-- predicates they call must be executable by `authenticated`. These functions
-- are SECURITY DEFINER and only return booleans; no mutation is exposed.
grant usage on schema app to authenticated;
grant execute on function app.is_admin() to authenticated;
grant execute on function app.has_role(public.app_role) to authenticated;
grant execute on function app.is_active() to authenticated;
grant execute on function app.owns_course(uuid) to authenticated;
grant execute on function app.is_approved_enrolled(uuid) to authenticated;
grant execute on function app.owns_attempt(uuid) to authenticated;
grant execute on function app.owns_attempt_course(uuid) to authenticated;
grant execute on function app.student_enrolled_any(uuid) to authenticated;
grant execute on function app.student_enrolled_approved(uuid) to authenticated;
grant execute on function app.teacher_can_see_student(uuid) to authenticated;
grant execute on function app.can_view_attempt(uuid) to authenticated;

-- Read-only surface for signed-in users (row visibility still governed by RLS).
grant select on public.profiles           to authenticated;
grant select on public.user_roles         to authenticated;
grant select on public.courses            to authenticated;
grant select on public.course_join_codes  to authenticated;
grant select on public.enrollments        to authenticated;
grant select on public.exams              to authenticated;
grant select on public.exam_versions      to authenticated;
grant select on public.exam_questions     to authenticated;
grant select on public.question_options   to authenticated;
grant select on public.answer_keys        to authenticated;
grant select on public.exam_attempts      to authenticated;
grant select on public.attempt_answers    to authenticated;
grant select on public.violation_events   to authenticated;
grant select on public.attempt_heartbeats to authenticated;
grant select on public.audit_logs         to authenticated;

-- Narrow column-level writes. No role may write final score fields, roles,
-- enrollments, attempts, answers, or events directly.
grant update (full_name) on public.profiles to authenticated;
grant update (title, description, section, academic_term, archived)
  on public.courses to authenticated;

grant execute on function public.create_course(text, text, text, text, text) to authenticated;
grant execute on function public.rotate_join_code(uuid) to authenticated;
grant execute on function public.request_enrollment(text) to authenticated;
grant execute on function public.decide_enrollment(uuid, text) to authenticated;
grant execute on function public.save_exam_draft(uuid, jsonb) to authenticated;
grant execute on function public.publish_exam(uuid) to authenticated;
grant execute on function public.archive_exam(uuid) to authenticated;
grant execute on function public.duplicate_exam(uuid) to authenticated;
grant execute on function public.start_attempt(uuid) to authenticated;
grant execute on function public.acquire_attempt_controller(uuid, uuid) to authenticated;
grant execute on function public.get_attempt_payload(uuid) to authenticated;
grant execute on function public.save_answer(uuid, uuid, uuid, bigint, uuid, uuid) to authenticated;
grant execute on function public.record_violation(uuid, uuid, text[], timestamptz, uuid) to authenticated;
grant execute on function public.submit_attempt(uuid, uuid) to authenticated;
grant execute on function public.get_result(uuid) to authenticated;
grant execute on function public.heartbeat(uuid, uuid, bigint) to authenticated;
grant execute on function public.finalize_expired_attempts() to authenticated;
grant execute on function public.admin_set_account_status(uuid, public.account_status) to authenticated;
grant execute on function public.admin_set_role(uuid, public.app_role) to authenticated;
grant execute on function public.admin_dashboard_stats() to authenticated;
