-- ===========================================================================
-- Anti-Cheating Exam — migration 0003
-- Attempts, answers, violation events, heartbeats.
-- ===========================================================================

create table if not exists public.exam_attempts (
  id                        uuid primary key default gen_random_uuid(),
  exam_id                   uuid not null references public.exams (id),
  exam_version_id           uuid not null references public.exam_versions (id),
  student_id                uuid not null references public.profiles (id),
  state                     public.attempt_state not null default 'in_progress',
  started_at                timestamptz not null default now(),
  deadline_at               timestamptz not null,
  violation_count           integer not null default 0 check (violation_count >= 0 and violation_count <= 2),
  question_order            jsonb not null default '[]'::jsonb,
  option_order              jsonb not null default '{}'::jsonb,
  controller_token          uuid not null default gen_random_uuid(),
  controller_lease_expires_at timestamptz not null default (now() + interval '30 seconds'),
  submitted_at              timestamptz,
  submission_reason         public.submission_reason,
  earned_points             numeric(10,2),
  max_points                numeric(10,2),
  percentage                numeric(6,2),
  answered_count            integer,
  correct_count             integer,
  result_released_at        timestamptz,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  constraint exam_attempts_one_per_student unique (exam_id, student_id),
  constraint exam_attempts_final_consistency check (
    (state = 'in_progress' and submitted_at is null)
    or
    (state = 'submitted' and submitted_at is not null and submission_reason is not null
      and earned_points is not null and max_points is not null and percentage is not null
      and answered_count is not null and correct_count is not null)
  )
);

create index if not exists exam_attempts_student_idx on public.exam_attempts (student_id);
create index if not exists exam_attempts_exam_idx on public.exam_attempts (exam_id);
create index if not exists exam_attempts_active_deadline_idx
  on public.exam_attempts (deadline_at) where state = 'in_progress';

-- ---------------------------------------------------------------------------
-- attempt_answers
-- ---------------------------------------------------------------------------
create table if not exists public.attempt_answers (
  id                 uuid primary key default gen_random_uuid(),
  attempt_id         uuid not null references public.exam_attempts (id) on delete cascade,
  question_id        uuid not null references public.exam_questions (id),
  selected_option_id uuid not null references public.question_options (id),
  revision           bigint not null default 1,
  request_id         uuid not null default gen_random_uuid(),
  answered_at        timestamptz not null default now(),
  constraint attempt_answers_unique_question unique (attempt_id, question_id)
);

create index if not exists attempt_answers_attempt_idx on public.attempt_answers (attempt_id);

-- ---------------------------------------------------------------------------
-- violation_events — append only, one row per episode
-- ---------------------------------------------------------------------------
create table if not exists public.violation_events (
  id             bigint generated always as identity primary key,
  attempt_id     uuid not null references public.exam_attempts (id) on delete cascade,
  episode_id     uuid not null,
  signals        text[] not null default '{}',
  observed_at    timestamptz,
  received_at    timestamptz not null default now(),
  details        jsonb not null default '{}'::jsonb,
  constraint violation_events_unique_episode unique (attempt_id, episode_id)
);

create index if not exists violation_events_attempt_idx on public.violation_events (attempt_id);

-- ---------------------------------------------------------------------------
-- attempt_heartbeats — minimal session health diagnostics
-- ---------------------------------------------------------------------------
create table if not exists public.attempt_heartbeats (
  attempt_id   uuid primary key references public.exam_attempts (id) on delete cascade,
  last_seen_at timestamptz not null default now(),
  client_seq   bigint not null default 0
);
