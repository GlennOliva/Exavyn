-- Remove the obsolete overload. The scheduled-release signature keeps defaults
-- for its three new arguments, so existing 11-argument callers remain valid.
drop function if exists public.update_exam_settings(
  uuid, text, text, timestamptz, timestamptz, integer,
  public.result_release_policy, integer, public.multi_attempt_policy,
  public.answer_review_policy, numeric
);
