-- Prevent students from bypassing release RPCs by selecting score columns from
-- exam_attempts directly. Teachers who own the course and admins retain their
-- authorized reporting access. Active/unreleased student access uses RPCs.
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
        and coalesce((app.result_release_status(id)->>'released')::boolean, false)
      )
    )
  );
