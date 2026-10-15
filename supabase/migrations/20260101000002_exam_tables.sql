-- ===========================================================================
-- Anti-Cheating Exam — migration 0002
-- Exam authoring, immutable published versions, and private answer keys.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- exams — authoring metadata / mutable working container
-- ---------------------------------------------------------------------------
create table if not exists public.exams (
  id                     uuid primary key default gen_random_uuid(),
  course_id              uuid not null references public.courses (id) on delete cascade,
  owner_id               uuid not null references public.profiles (id),
  title                  text not null check (length(btrim(title)) > 0),
  instructions           text not null default '',
  duration_minutes       integer not null default 60 check (duration_minutes > 0),
  opens_at               timestamptz not null default now(),
  closes_at              timestamptz not null,
  question_randomization boolean not null default false,
  option_randomization   boolean not null default false,
  result_release         public.result_release_policy not null default 'immediate',
  violation_threshold    integer not null default 2 check (violation_threshold = 2),
  state                  public.exam_state not null default 'draft',
  current_version_id     uuid,
  archived               boolean not null default false,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint exams_schedule_check check (closes_at > opens_at)
);

create index if not exists exams_course_idx on public.exams (course_id, state);
create index if not exists exams_owner_idx on public.exams (owner_id);

-- ---------------------------------------------------------------------------
-- exam_versions — immutable published snapshots
-- ---------------------------------------------------------------------------
create table if not exists public.exam_versions (
  id                     uuid primary key default gen_random_uuid(),
  exam_id                uuid not null references public.exams (id) on delete cascade,
  version_no             integer not null check (version_no > 0),
  title                  text not null,
  instructions           text not null default '',
  duration_minutes       integer not null check (duration_minutes > 0),
  opens_at               timestamptz not null,
  closes_at              timestamptz not null,
  question_randomization boolean not null default false,
  option_randomization   boolean not null default false,
  result_release         public.result_release_policy not null,
  violation_threshold    integer not null default 2,
  item_count             integer not null default 0 check (item_count >= 0),
  max_score              numeric(10,2) not null default 0 check (max_score >= 0),
  frozen                 boolean not null default true,
  published_at           timestamptz not null default now(),
  published_by           uuid not null references public.profiles (id),
  created_at             timestamptz not null default now(),
  constraint exam_versions_unique_no unique (exam_id, version_no),
  constraint exam_versions_schedule_check check (closes_at > opens_at)
);

-- ---------------------------------------------------------------------------
-- exam_questions — draft (version_id null) or published (version_id set)
-- ---------------------------------------------------------------------------
create table if not exists public.exam_questions (
  id          uuid primary key default gen_random_uuid(),
  exam_id     uuid not null references public.exams (id) on delete cascade,
  version_id  uuid references public.exam_versions (id) on delete cascade,
  position    integer not null check (position > 0),
  prompt      text not null check (length(btrim(prompt)) > 0),
  points      numeric(6,2) not null default 1 check (points > 0),
  created_at  timestamptz not null default now()
);

create index if not exists exam_questions_exam_idx on public.exam_questions (exam_id);
create index if not exists exam_questions_version_idx on public.exam_questions (version_id, position);

-- ---------------------------------------------------------------------------
-- question_options — NO correctness column (correctness lives in answer_keys)
-- ---------------------------------------------------------------------------
create table if not exists public.question_options (
  id          uuid primary key default gen_random_uuid(),
  question_id uuid not null references public.exam_questions (id) on delete cascade,
  position    integer not null check (position between 1 and 4),
  label       text not null check (length(btrim(label)) > 0),
  created_at  timestamptz not null default now(),
  constraint question_options_unique_position unique (question_id, position)
);

-- ---------------------------------------------------------------------------
-- answer_keys — private. Students never receive these rows.
-- ---------------------------------------------------------------------------
create table if not exists public.answer_keys (
  question_id       uuid primary key references public.exam_questions (id) on delete cascade,
  correct_option_id uuid not null references public.question_options (id) on delete cascade,
  points            numeric(6,2) not null default 1 check (points > 0),
  created_at        timestamptz not null default now()
);

comment on table public.answer_keys is
  'Authoritative correct option + points per question. Never readable by students.';

-- Deferred FK added after both tables exist.
alter table public.exams
  drop constraint if exists exams_current_version_fk;
alter table public.exams
  add constraint exams_current_version_fk
  foreign key (current_version_id) references public.exam_versions (id) on delete set null;
