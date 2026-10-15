-- ===========================================================================
-- Anti-Cheating Exam — migration 0000
-- Extensions, private schema, and domain types.
-- ===========================================================================

create extension if not exists pgcrypto with schema extensions;
create extension if not exists "uuid-ossp" with schema extensions;

-- Private helper schema. Nothing in `app` is exposed through the API directly;
-- only explicitly granted functions are reachable.
create schema if not exists app;

comment on schema app is
  'Private helper schema for the Anti-Cheating Exam application.';

-- ---------------------------------------------------------------------------
-- Domain enums
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'app_role') then
    create type public.app_role as enum ('admin', 'teacher', 'student');
  end if;
  if not exists (select 1 from pg_type where typname = 'account_status') then
    create type public.account_status as enum ('active', 'suspended');
  end if;
  if not exists (select 1 from pg_type where typname = 'enrollment_status') then
    create type public.enrollment_status as enum ('pending', 'approved', 'rejected', 'withdrawn');
  end if;
  if not exists (select 1 from pg_type where typname = 'exam_state') then
    create type public.exam_state as enum ('draft', 'published', 'archived');
  end if;
  if not exists (select 1 from pg_type where typname = 'attempt_state') then
    create type public.attempt_state as enum ('in_progress', 'submitted');
  end if;
  if not exists (select 1 from pg_type where typname = 'submission_reason') then
    create type public.submission_reason as enum ('manual', 'violation_limit', 'time_expired');
  end if;
  if not exists (select 1 from pg_type where typname = 'result_release_policy') then
    create type public.result_release_policy as enum ('immediate', 'after_close');
  end if;
end
$$;
