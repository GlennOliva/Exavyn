-- ===========================================================================
-- Anti-Cheating Exam — migration 0001
-- Core identity, role, course, enrollment and audit tables.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text,
  full_name   text not null default '',
  status      public.account_status not null default 'active',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.profiles is
  'Application identity record, one row per auth user. Roles are NOT stored here.';

-- ---------------------------------------------------------------------------
-- user_roles — trusted role assignments
-- ---------------------------------------------------------------------------
create table if not exists public.user_roles (
  user_id    uuid primary key references public.profiles (id) on delete cascade,
  role       public.app_role not null,
  granted_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.user_roles is
  'Trusted role assignment. Only roles in this table authorize privileged actions.';

-- ---------------------------------------------------------------------------
-- courses
-- ---------------------------------------------------------------------------
create table if not exists public.courses (
  id             uuid primary key default gen_random_uuid(),
  owner_id       uuid not null references public.profiles (id),
  title          text not null check (length(btrim(title)) > 0),
  description    text not null default '',
  section        text not null default '',
  academic_term  text not null default '',
  course_code    text not null,
  archived       boolean not null default false,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint courses_course_code_unique unique (course_code),
  constraint courses_course_code_format check (course_code ~ '^[A-Z0-9][A-Z0-9-]{1,15}$')
);

comment on column public.courses.course_code is
  'Human-facing course identifier (e.g. IT101). It NEVER grants enrollment.';

-- ---------------------------------------------------------------------------
-- course_join_codes — hashed enrollment codes
-- ---------------------------------------------------------------------------
create table if not exists public.course_join_codes (
  id          uuid primary key default gen_random_uuid(),
  course_id   uuid not null references public.courses (id) on delete cascade,
  code_hash   text not null,
  code_hint   text not null default '',
  active      boolean not null default true,
  expires_at  timestamptz,
  created_by  uuid not null references public.profiles (id),
  created_at  timestamptz not null default now(),
  rotated_at  timestamptz,
  constraint course_join_codes_active_unique unique (course_id, active, code_hash)
);

comment on table public.course_join_codes is
  'Only the salted hash of an enrollment join code is stored. Plaintext is shown once.';

-- ---------------------------------------------------------------------------
-- enrollments
-- ---------------------------------------------------------------------------
create table if not exists public.enrollments (
  id            uuid primary key default gen_random_uuid(),
  course_id     uuid not null references public.courses (id) on delete cascade,
  student_id    uuid not null references public.profiles (id) on delete cascade,
  status        public.enrollment_status not null default 'pending',
  requested_at  timestamptz not null default now(),
  decided_at    timestamptz,
  decided_by    uuid references public.profiles (id),
  constraint enrollments_unique_pair unique (course_id, student_id)
);

create index if not exists enrollments_student_idx on public.enrollments (student_id, status);
create index if not exists enrollments_course_idx on public.enrollments (course_id, status);

-- ---------------------------------------------------------------------------
-- audit_logs — append-only
-- ---------------------------------------------------------------------------
create table if not exists public.audit_logs (
  id           bigint generated always as identity primary key,
  actor_id     uuid references public.profiles (id),
  action       text not null,
  entity_type  text not null,
  entity_id    text,
  details      jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now()
);

comment on table public.audit_logs is
  'Append-only administrative and publication audit trail. Updates and deletes are denied.';

create index if not exists audit_logs_created_idx on public.audit_logs (created_at desc);
create index if not exists audit_logs_actor_idx on public.audit_logs (actor_id);
