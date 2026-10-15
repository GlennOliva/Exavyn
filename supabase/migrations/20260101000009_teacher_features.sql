-- ===========================================================================
-- Exavyn — migration 0009
-- Teacher-side features:
--   1. Configurable maximum attempts per student per exam (numbered, independent
--      attempts) replacing the hard-coded single-attempt rule.
--   2. Multi-attempt result policy (latest completed / highest score) computed
--      separately from immutable per-attempt results.
--   3. Reversibly-stored, retrievable current course join codes (encrypted),
--      plus authorized retrieval and legacy hash-only regeneration.
--   4. Course edit / archive / restore / guarded hard-delete.
--   5. Exam settings edit (prospective) / restore / guarded hard-delete.
--
-- Forward-only: migrations 0000-0008 are already applied and are never rewritten.
-- Historical attempts, answers, and finalized results are preserved.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 0. Multi-attempt result policy enum
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'multi_attempt_policy') then
    create type public.multi_attempt_policy as enum ('latest', 'highest');
  end if;
end
$$;

comment on type public.multi_attempt_policy is
  'Aggregate policy for multiple attempts: latest completed attempt, or highest score.';

-- ---------------------------------------------------------------------------
-- 1. Exam-level settings (live, editable prospectively)
--    Bounds: 1..20 attempts. The upper bound is documented in README/SOP.
-- ---------------------------------------------------------------------------
alter table public.exams
  add column if not exists max_attempts integer not null default 1,
  add column if not exists result_policy public.multi_attempt_policy not null default 'latest';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'exams_max_attempts_check') then
    alter table public.exams
      add constraint exams_max_attempts_check check (max_attempts between 1 and 20);
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 2. Version-level settings snapshot (frozen with the published content)
-- ---------------------------------------------------------------------------
alter table public.exam_versions
  add column if not exists max_attempts integer not null default 1,
  add column if not exists result_policy public.multi_attempt_policy not null default 'latest';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'exam_versions_max_attempts_check') then
    alter table public.exam_versions
      add constraint exam_versions_max_attempts_check check (max_attempts between 1 and 20);
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 3. Attempt numbering + per-attempt result-release snapshot
--    result_release is snapshotted onto the attempt so that a later settings
--    change applies prospectively and never alters an attempt already started.
-- ---------------------------------------------------------------------------
alter table public.exam_attempts
  add column if not exists attempt_no integer not null default 1,
  add column if not exists result_release public.result_release_policy not null default 'immediate';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'exam_attempts_attempt_no_check') then
    alter table public.exam_attempts
      add constraint exam_attempts_attempt_no_check check (attempt_no >= 1);
  end if;
end
$$;

-- Backfill the result-release snapshot from the frozen version. The immutability
-- trigger forbids UPDATEs on finalized attempts, so it is disabled for this
-- one-time data migration only.
alter table public.exam_attempts disable trigger trg_attempts_immutable;
update public.exam_attempts a
   set result_release = v.result_release
  from public.exam_versions v
 where v.id = a.exam_version_id
   and a.result_release is distinct from v.result_release;
alter table public.exam_attempts enable trigger trg_attempts_immutable;

-- Replace the single-attempt unique constraint with a numbered-attempt key plus
-- a partial unique index that guarantees at most one active attempt per student.
alter table public.exam_attempts drop constraint if exists exam_attempts_one_per_student;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'exam_attempts_unique_attempt') then
    alter table public.exam_attempts
      add constraint exam_attempts_unique_attempt unique (exam_id, student_id, attempt_no);
  end if;
end
$$;

create unique index if not exists exam_attempts_one_active_idx
  on public.exam_attempts (exam_id, student_id) where state = 'in_progress';

-- ---------------------------------------------------------------------------
-- 4. Secure, retrievable join codes
--    The plaintext is stored encrypted with a key that lives only inside the
--    private `app` schema (never in source control, never API-exposed). The
--    salted hash is retained for join validation. Courses created before this
--    migration have no cipher and must be regenerated once (see get_join_code).
-- ---------------------------------------------------------------------------
create table if not exists app.secrets (
  name       text primary key,
  value      text not null,
  created_at timestamptz not null default now()
);

revoke all on app.secrets from public, anon, authenticated;

insert into app.secrets (name, value)
select 'join_code_key', encode(extensions.gen_random_bytes(32), 'hex')
where not exists (select 1 from app.secrets where name = 'join_code_key');

create or replace function app.join_code_key()
returns text
language sql
stable
security definer
set search_path = app, pg_temp
as $$
  select value from app.secrets where name = 'join_code_key';
$$;

create or replace function app.encrypt_join_code(p_code text)
returns text
language sql
stable
security definer
set search_path = extensions, app, pg_temp
as $$
  select encode(pgp_sym_encrypt(upper(btrim(p_code)), app.join_code_key()), 'base64');
$$;

create or replace function app.decrypt_join_code(p_cipher text)
returns text
language sql
stable
security definer
set search_path = extensions, app, pg_temp
as $$
  select pgp_sym_decrypt(decode(p_cipher, 'base64'), app.join_code_key());
$$;

alter table public.course_join_codes add column if not exists code_cipher text;

comment on column public.course_join_codes.code_cipher is
  'Encrypted plaintext of the active join code, retrievable only via public.get_join_code().';

-- Never expose the hash or the cipher through the API. Only non-secret columns
-- remain selectable (row visibility still governed by RLS).
revoke select on public.course_join_codes from authenticated;
grant select (id, course_id, code_hint, active, expires_at, created_by, created_at, rotated_at)
  on public.course_join_codes to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Re-create create_course / rotate_join_code so new codes are retrievable.
-- ---------------------------------------------------------------------------
create or replace function public.create_course(
  p_title text,
  p_description text,
  p_section text,
  p_academic_term text,
  p_course_code text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := app.require_user();
  v_course_id uuid;
  v_code text;
  v_code_upper text := upper(btrim(p_course_code));
begin
  if not (app.has_role('teacher') or app.is_admin()) then
    raise exception 'Only teachers may create courses' using errcode = '42501';
  end if;

  if v_code_upper !~ '^[A-Z0-9][A-Z0-9-]{1,15}$' then
    raise exception 'Course code must be 2-16 chars: letters, digits, hyphen';
  end if;

  insert into public.courses (owner_id, title, description, section, academic_term, course_code)
  values (v_uid, btrim(p_title), coalesce(p_description,''), coalesce(p_section,''),
          coalesce(p_academic_term,''), v_code_upper)
  returning id into v_course_id;

  v_code := app.generate_join_code();
  insert into public.course_join_codes (course_id, code_hash, code_hint, code_cipher, created_by)
  values (v_course_id, app.hash_join_code(v_code), left(v_code, 2) || '****',
          app.encrypt_join_code(v_code), v_uid);

  perform app.write_audit(v_uid, 'course.create', 'course', v_course_id::text,
    jsonb_build_object('course_code', v_code_upper));

  return jsonb_build_object('course_id', v_course_id, 'join_code', v_code);
end;
$$;

create or replace function public.rotate_join_code(p_course_id uuid)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := app.require_user();
  v_code text;
begin
  if not (app.owns_course(p_course_id) or app.is_admin()) then
    raise exception 'Not your course' using errcode = '42501';
  end if;

  update public.course_join_codes
     set active = false, rotated_at = now()
   where course_id = p_course_id and active = true;

  v_code := app.generate_join_code();
  insert into public.course_join_codes (course_id, code_hash, code_hint, code_cipher, created_by)
  values (p_course_id, app.hash_join_code(v_code), left(v_code, 2) || '****',
          app.encrypt_join_code(v_code), v_uid);

  perform app.write_audit(v_uid, 'join_code.rotate', 'course', p_course_id::text, '{}'::jsonb);
  return v_code;
end;
$$;

-- Authorized retrieval of the current join code (owner or admin only).
create or replace function public.get_join_code(p_course_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := app.require_user();
  v_row public.course_join_codes;
begin
  if not (app.owns_course(p_course_id) or app.is_admin()) then
    raise exception 'Not your course' using errcode = '42501';
  end if;

  select * into v_row
  from public.course_join_codes
  where course_id = p_course_id and active = true
  order by created_at desc
  limit 1;

  if not found then
    return jsonb_build_object('present', false, 'code', null, 'legacy', false);
  end if;

  if v_row.code_cipher is null then
    -- Legacy hash-only code: the original plaintext cannot be recovered.
    return jsonb_build_object(
      'present', true, 'legacy', true, 'code', null,
      'code_hint', v_row.code_hint, 'created_at', v_row.created_at,
      'rotated_at', v_row.rotated_at
    );
  end if;

  return jsonb_build_object(
    'present', true, 'legacy', false,
    'code', app.decrypt_join_code(v_row.code_cipher),
    'code_hint', v_row.code_hint, 'created_at', v_row.created_at,
    'rotated_at', v_row.rotated_at
  );
end;
$$;

grant execute on function public.get_join_code(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Course edit / archive / restore / guarded delete
-- ---------------------------------------------------------------------------
create or replace function public.update_course(
  p_course_id uuid,
  p_title text,
  p_description text,
  p_section text,
  p_academic_term text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := app.require_user();
begin
  if not (app.owns_course(p_course_id) or app.is_admin()) then
    raise exception 'Not your course' using errcode = '42501';
  end if;
  if coalesce(length(btrim(p_title)), 0) = 0 then
    raise exception 'Course title is required';
  end if;

  update public.courses
     set title = btrim(p_title),
         description = coalesce(p_description, ''),
         section = coalesce(p_section, ''),
         academic_term = coalesce(p_academic_term, '')
   where id = p_course_id;

  perform app.write_audit(v_uid, 'course.update', 'course', p_course_id::text, '{}'::jsonb);
end;
$$;

create or replace function public.set_course_archived(p_course_id uuid, p_archived boolean)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := app.require_user();
begin
  if not (app.owns_course(p_course_id) or app.is_admin()) then
    raise exception 'Not your course' using errcode = '42501';
  end if;

  update public.courses set archived = p_archived where id = p_course_id;

  perform app.write_audit(v_uid,
    case when p_archived then 'course.archive' else 'course.restore' end,
    'course', p_course_id::text, '{}'::jsonb);
end;
$$;

create or replace function public.delete_course(p_course_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := app.require_user();
  v_enrollments integer;
  v_exams integer;
begin
  if not (app.owns_course(p_course_id) or app.is_admin()) then
    raise exception 'Not your course' using errcode = '42501';
  end if;

  select count(*) into v_enrollments from public.enrollments where course_id = p_course_id;
  select count(*) into v_exams from public.exams where course_id = p_course_id;

  if v_enrollments > 0 or v_exams > 0 then
    raise exception 'Course has % enrollment(s) and % exam(s); archive it instead',
      v_enrollments, v_exams using errcode = '23503';
  end if;

  delete from public.courses where id = p_course_id;
  perform app.write_audit(v_uid, 'course.delete', 'course', p_course_id::text, '{}'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Extend authoring functions with the new settings.
-- ---------------------------------------------------------------------------
create or replace function public.save_exam_draft(
  p_exam_id uuid,
  p_payload jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := app.require_user();
  v_exam_id uuid := p_exam_id;
  v_course_id uuid := (p_payload->>'course_id')::uuid;
  v_state public.exam_state;
  v_q jsonb;
  v_opt jsonb;
  v_qid uuid;
  v_pos integer;
  v_opos integer;
  v_correct_option uuid;
  v_opts jsonb;
  v_correct_idx integer;
  v_max_attempts integer := coalesce((p_payload->>'max_attempts')::int, 1);
  v_result_policy public.multi_attempt_policy :=
    coalesce((p_payload->>'result_policy'), 'latest')::public.multi_attempt_policy;
begin
  if not (app.has_role('teacher') or app.is_admin()) then
    raise exception 'Only teachers may author exams' using errcode = '42501';
  end if;
  if not (app.owns_course(v_course_id) or app.is_admin()) then
    raise exception 'Not your course' using errcode = '42501';
  end if;
  if v_max_attempts < 1 or v_max_attempts > 20 then
    raise exception 'Maximum attempts must be between 1 and 20';
  end if;

  perform app.validate_exam_payload(p_payload);

  if v_exam_id is null then
    insert into public.exams (
      course_id, owner_id, title, instructions, duration_minutes, opens_at, closes_at,
      question_randomization, option_randomization, result_release, max_attempts,
      result_policy, state
    ) values (
      v_course_id, v_uid, btrim(p_payload->>'title'), coalesce(p_payload->>'instructions',''),
      (p_payload->>'duration_minutes')::int,
      (p_payload->>'opens_at')::timestamptz,
      (p_payload->>'closes_at')::timestamptz,
      coalesce((p_payload->>'question_randomization')::boolean, false),
      coalesce((p_payload->>'option_randomization')::boolean, false),
      coalesce((p_payload->>'result_release'), 'immediate')::public.result_release_policy,
      v_max_attempts, v_result_policy, 'draft'
    ) returning id into v_exam_id;
  else
    select state into v_state from public.exams where id = v_exam_id for update;
    if not found then raise exception 'Exam not found' using errcode = 'P0002'; end if;
    if not (app.owns_course((select course_id from public.exams where id = v_exam_id)) or app.is_admin()) then
      raise exception 'Not your exam' using errcode = '42501';
    end if;
    if v_state <> 'draft' then
      raise exception 'Published exams are immutable; duplicate it instead or edit its settings';
    end if;

    update public.exams set
      course_id = v_course_id,
      title = btrim(p_payload->>'title'),
      instructions = coalesce(p_payload->>'instructions',''),
      duration_minutes = (p_payload->>'duration_minutes')::int,
      opens_at = (p_payload->>'opens_at')::timestamptz,
      closes_at = (p_payload->>'closes_at')::timestamptz,
      question_randomization = coalesce((p_payload->>'question_randomization')::boolean, false),
      option_randomization = coalesce((p_payload->>'option_randomization')::boolean, false),
      result_release = coalesce((p_payload->>'result_release'),'immediate')::public.result_release_policy,
      max_attempts = v_max_attempts,
      result_policy = v_result_policy
    where id = v_exam_id;

    delete from public.exam_questions where exam_id = v_exam_id and version_id is null;
  end if;

  v_pos := 0;
  for v_q in select * from jsonb_array_elements(p_payload->'questions')
  loop
    v_pos := v_pos + 1;
    insert into public.exam_questions (exam_id, version_id, position, prompt, points)
    values (v_exam_id, null, v_pos, btrim(v_q->>'prompt'),
            coalesce((v_q->>'points')::numeric, 1))
    returning id into v_qid;

    v_correct_idx := (v_q->>'correct_index')::int;
    v_opts := v_q->'options';
    v_opos := 0;
    v_correct_option := null;
    for v_opt in select * from jsonb_array_elements(v_opts)
    loop
      v_opos := v_opos + 1;
      insert into public.question_options (question_id, position, label)
      values (v_qid, v_opos, btrim(v_opt->>'label'));

      if v_opos - 1 = v_correct_idx then
        select id into v_correct_option
        from public.question_options
        where question_id = v_qid and position = v_opos;
      end if;
    end loop;

    insert into public.answer_keys (question_id, correct_option_id, points)
    values (v_qid, v_correct_option, coalesce((v_q->>'points')::numeric, 1));
  end loop;

  perform app.write_audit(v_uid, 'exam.save_draft', 'exam', v_exam_id::text, '{}'::jsonb);
  return v_exam_id;
end;
$$;

create or replace function public.publish_exam(p_exam_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := app.require_user();
  v_exam public.exams;
  v_version_id uuid;
  v_version_no integer;
  v_item_count integer;
  v_max numeric(10,2);
begin
  select * into v_exam from public.exams where id = p_exam_id for update;
  if not found then raise exception 'Exam not found' using errcode = 'P0002'; end if;
  if not (app.owns_course(v_exam.course_id) or app.is_admin()) then
    raise exception 'Not your exam' using errcode = '42501';
  end if;
  if v_exam.archived then raise exception 'Archived exams cannot be published'; end if;

  select count(*), coalesce(sum(points),0) into v_item_count, v_max
  from public.exam_questions where exam_id = p_exam_id and version_id is null;

  if v_item_count < 1 then
    raise exception 'Cannot publish an exam without questions';
  end if;
  if exists (
    select 1
    from public.exam_questions q
    left join public.answer_keys ak on ak.question_id = q.id
    where q.exam_id = p_exam_id and q.version_id is null and ak.question_id is null
  ) then
    raise exception 'Cannot publish: a question is missing its answer key';
  end if;

  select coalesce(max(version_no), 0) + 1 into v_version_no
  from public.exam_versions where exam_id = p_exam_id;

  insert into public.exam_versions (
    exam_id, version_no, title, instructions, duration_minutes, opens_at, closes_at,
    question_randomization, option_randomization, result_release, violation_threshold,
    max_attempts, result_policy, item_count, max_score, frozen, published_by
  ) values (
    p_exam_id, v_version_no, v_exam.title, v_exam.instructions, v_exam.duration_minutes,
    v_exam.opens_at, v_exam.closes_at, v_exam.question_randomization,
    v_exam.option_randomization, v_exam.result_release, v_exam.violation_threshold,
    v_exam.max_attempts, v_exam.result_policy,
    v_item_count, v_max, true, v_uid
  ) returning id into v_version_id;

  declare
    v_new_qid uuid;
    v_draft_q record;
    v_o record;
    v_new_oid uuid;
    v_correct_pos integer;
    v_correct_new_id uuid;
  begin
    for v_draft_q in
      select * from public.exam_questions
      where exam_id = p_exam_id and version_id is null
      order by position
    loop
      insert into public.exam_questions (exam_id, version_id, position, prompt, points)
      values (p_exam_id, v_version_id, v_draft_q.position, v_draft_q.prompt, v_draft_q.points)
      returning id into v_new_qid;

      select po.position into v_correct_pos
      from public.answer_keys ak
      join public.question_options po on po.id = ak.correct_option_id
      where ak.question_id = v_draft_q.id;

      v_correct_new_id := null;
      for v_o in
        select * from public.question_options
        where question_id = v_draft_q.id order by position
      loop
        insert into public.question_options (question_id, position, label)
        values (v_new_qid, v_o.position, v_o.label)
        returning id into v_new_oid;

        if v_o.position = v_correct_pos then
          v_correct_new_id := v_new_oid;
        end if;
      end loop;

      if v_correct_new_id is null then
        raise exception 'Draft question % has no resolvable correct option', v_draft_q.id;
      end if;

      insert into public.answer_keys (question_id, correct_option_id, points)
      values (v_new_qid, v_correct_new_id, v_draft_q.points);
    end loop;
  end;

  update public.exams
     set state = 'published', current_version_id = v_version_id
   where id = p_exam_id;

  perform app.write_audit(v_uid, 'exam.publish', 'exam', p_exam_id::text,
    jsonb_build_object('version_id', v_version_id, 'version_no', v_version_no,
                       'item_count', v_item_count, 'max_score', v_max,
                       'max_attempts', v_exam.max_attempts, 'result_policy', v_exam.result_policy));

  return v_version_id;
end;
$$;

create or replace function public.duplicate_exam(p_exam_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := app.require_user();
  v_src public.exams;
  v_new_id uuid;
  v_payload jsonb;
begin
  select * into v_src from public.exams where id = p_exam_id;
  if not found then raise exception 'Exam not found' using errcode = 'P0002'; end if;
  if not (app.owns_course(v_src.course_id) or app.is_admin()) then
    raise exception 'Not your exam' using errcode = '42501';
  end if;

  declare
    v_source_version uuid := v_src.current_version_id;
    v_questions jsonb;
  begin
    select coalesce(jsonb_agg(jsonb_build_object(
      'prompt', q.prompt,
      'points', q.points,
      'correct_index', (
        select po.position - 1
        from public.answer_keys ak
        join public.question_options po on po.id = ak.correct_option_id
        where ak.question_id = q.id
      ),
      'options', (
        select jsonb_agg(jsonb_build_object('label', o.label) order by o.position)
        from public.question_options o where o.question_id = q.id
      )
    ) order by q.position), '[]'::jsonb) into v_questions
    from public.exam_questions q
    where q.exam_id = v_src.id
      and (
        (v_source_version is not null and q.version_id = v_source_version)
        or (v_source_version is null and q.version_id is null)
      );

    if jsonb_array_length(v_questions) = 0 then
      select coalesce(jsonb_agg(jsonb_build_object(
        'prompt', q.prompt,
        'points', q.points,
        'correct_index', (
          select po.position - 1
          from public.answer_keys ak
          join public.question_options po on po.id = ak.correct_option_id
          where ak.question_id = q.id
        ),
        'options', (
          select jsonb_agg(jsonb_build_object('label', o.label) order by o.position)
          from public.question_options o where o.question_id = q.id
        )
      ) order by q.position), '[]'::jsonb) into v_questions
      from public.exam_questions q
      where q.exam_id = v_src.id and q.version_id is null;
    end if;

    v_payload := jsonb_build_object(
      'course_id', v_src.course_id,
      'title', v_src.title || ' (copy)',
      'instructions', v_src.instructions,
      'duration_minutes', v_src.duration_minutes,
      'opens_at', now(),
      'closes_at', now() + interval '7 days',
      'question_randomization', v_src.question_randomization,
      'option_randomization', v_src.option_randomization,
      'result_release', v_src.result_release,
      'max_attempts', v_src.max_attempts,
      'result_policy', v_src.result_policy,
      'questions', v_questions
    );
  end;

  v_new_id := public.save_exam_draft(null, v_payload);
  perform app.write_audit(v_uid, 'exam.duplicate', 'exam', v_new_id::text,
    jsonb_build_object('source_exam_id', p_exam_id));
  return v_new_id;
end;
$$;

-- Exam settings edit. Questions/choices/keys are immutable once any version is
-- published; only schedule/settings change, and only prospectively (in-progress
-- attempt deadlines and finalized results are stored on the attempt row).
create or replace function public.update_exam_settings(
  p_exam_id uuid,
  p_title text,
  p_instructions text,
  p_opens_at timestamptz,
  p_closes_at timestamptz,
  p_duration_minutes integer,
  p_result_release public.result_release_policy,
  p_max_attempts integer,
  p_result_policy public.multi_attempt_policy
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := app.require_user();
  v_exam public.exams;
begin
  select * into v_exam from public.exams where id = p_exam_id for update;
  if not found then raise exception 'Exam not found' using errcode = 'P0002'; end if;
  if not (app.owns_course(v_exam.course_id) or app.is_admin()) then
    raise exception 'Not your exam' using errcode = '42501';
  end if;
  if v_exam.state = 'archived' then
    raise exception 'Restore the exam before editing its settings' using errcode = 'P0002';
  end if;
  if coalesce(length(btrim(p_title)), 0) = 0 then
    raise exception 'Exam title is required';
  end if;
  if p_duration_minutes <= 0 then
    raise exception 'Duration must be positive';
  end if;
  if p_opens_at >= p_closes_at then
    raise exception 'Opening time must be before closing time';
  end if;
  if p_max_attempts < 1 or p_max_attempts > 20 then
    raise exception 'Maximum attempts must be between 1 and 20';
  end if;

  update public.exams
     set title = btrim(p_title),
         instructions = coalesce(p_instructions, ''),
         opens_at = p_opens_at,
         closes_at = p_closes_at,
         duration_minutes = p_duration_minutes,
         result_release = p_result_release,
         max_attempts = p_max_attempts,
         result_policy = p_result_policy
   where id = p_exam_id;

  perform app.write_audit(v_uid, 'exam.update_settings', 'exam', p_exam_id::text,
    jsonb_build_object(
      'max_attempts', p_max_attempts, 'result_policy', p_result_policy,
      'result_release', p_result_release, 'duration_minutes', p_duration_minutes,
      'opens_at', p_opens_at, 'closes_at', p_closes_at));
end;
$$;

create or replace function public.restore_exam(p_exam_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := app.require_user();
  v_exam public.exams;
  v_state public.exam_state;
begin
  select * into v_exam from public.exams where id = p_exam_id for update;
  if not found then raise exception 'Exam not found' using errcode = 'P0002'; end if;
  if not (app.owns_course(v_exam.course_id) or app.is_admin()) then
    raise exception 'Not your exam' using errcode = '42501';
  end if;

  v_state := case when v_exam.current_version_id is null then 'draft' else 'published' end;
  update public.exams set archived = false, state = v_state where id = p_exam_id;
  perform app.write_audit(v_uid, 'exam.restore', 'exam', p_exam_id::text,
    jsonb_build_object('state', v_state));
end;
$$;

create or replace function public.delete_exam(p_exam_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := app.require_user();
  v_exam public.exams;
  v_attempts integer;
begin
  select * into v_exam from public.exams where id = p_exam_id for update;
  if not found then raise exception 'Exam not found' using errcode = 'P0002'; end if;
  if not (app.owns_course(v_exam.course_id) or app.is_admin()) then
    raise exception 'Not your exam' using errcode = '42501';
  end if;

  select count(*) into v_attempts from public.exam_attempts where exam_id = p_exam_id;
  if v_attempts > 0 or v_exam.current_version_id is not null or v_exam.state <> 'draft' then
    raise exception 'Only unused drafts with no attempts can be deleted; archive instead'
      using errcode = '23503';
  end if;

  delete from public.exams where id = p_exam_id;
  perform app.write_audit(v_uid, 'exam.delete', 'exam', p_exam_id::text, '{}'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. Attempts: start_attempt supports numbered attempts, live schedule changes,
--    archived-course rejection, and a per-attempt result-release snapshot.
-- ---------------------------------------------------------------------------
create or replace function public.start_attempt(
  p_exam_id uuid,
  p_current_token uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := app.require_user();
  v_exam public.exams;
  v_version public.exam_versions;
  v_existing public.exam_attempts;
  v_completed integer;
  v_attempt_id uuid;
  v_attempt_no integer;
  v_deadline timestamptz;
  v_qorder jsonb;
  v_oorder jsonb;
  v_token uuid;
begin
  if not app.has_role('student') then
    raise exception 'Only students may start attempts' using errcode = '42501';
  end if;

  select * into v_exam from public.exams where id = p_exam_id for update;
  if not found then raise exception 'Exam not found' using errcode = 'P0002'; end if;
  if v_exam.state <> 'published' or v_exam.archived then
    raise exception 'Exam is not available' using errcode = 'P0002';
  end if;
  if v_exam.current_version_id is null then
    raise exception 'Exam has no published version';
  end if;

  if exists (select 1 from public.courses c where c.id = v_exam.course_id and c.archived) then
    raise exception 'This course is archived; new attempts are not allowed' using errcode = 'P0002';
  end if;

  if now() < v_exam.opens_at then
    raise exception 'Exam has not opened yet' using errcode = 'P0002';
  end if;
  if now() >= v_exam.closes_at then
    raise exception 'Exam has closed' using errcode = 'P0002';
  end if;

  if not app.student_enrolled_approved(v_exam.course_id) then
    raise exception 'You are not enrolled in this course' using errcode = '42501';
  end if;

  select * into v_version from public.exam_versions where id = v_exam.current_version_id;
  if not found then raise exception 'Exam version not found' using errcode = 'P0002'; end if;

  -- Resume the single active attempt (if any). Resuming never consumes an attempt.
  select * into v_existing from public.exam_attempts
  where exam_id = p_exam_id and student_id = v_uid and state = 'in_progress'
  for update;

  if found then
    if p_current_token is not null and p_current_token = v_existing.controller_token then
      update public.exam_attempts
        set controller_lease_expires_at = now() + interval '30 seconds'
        where id = v_existing.id
        returning * into v_existing;
    elsif v_existing.controller_lease_expires_at is not null
          and v_existing.controller_lease_expires_at > now() then
      raise exception 'This attempt is active in another session' using errcode = '55006';
    else
      update public.exam_attempts
        set controller_token = gen_random_uuid(),
            controller_lease_expires_at = now() + interval '30 seconds'
        where id = v_existing.id
        returning * into v_existing;
    end if;

    return jsonb_build_object(
      'attempt_id', v_existing.id,
      'resumed', true,
      'attempt_no', v_existing.attempt_no,
      'max_attempts', v_exam.max_attempts,
      'controller_token', v_existing.controller_token,
      'deadline_at', v_existing.deadline_at,
      'started_at', v_existing.started_at,
      'violation_count', v_existing.violation_count,
      'violation_threshold', v_version.violation_threshold
    );
  end if;

  select count(*) into v_completed from public.exam_attempts
  where exam_id = p_exam_id and student_id = v_uid and state = 'submitted';

  if v_completed >= v_exam.max_attempts then
    raise exception 'You have reached the maximum of % attempts for this exam',
      v_exam.max_attempts using errcode = 'P0002';
  end if;

  v_attempt_no := v_completed + 1;
  v_deadline := least(now() + make_interval(mins => v_exam.duration_minutes), v_exam.closes_at);
  v_token := gen_random_uuid();

  if v_version.question_randomization then
    select coalesce(jsonb_agg(qid), '[]'::jsonb) into v_qorder
    from (
      select id as qid from public.exam_questions
      where version_id = v_version.id order by random()
    ) s;
  else
    select coalesce(jsonb_agg(qid), '[]'::jsonb) into v_qorder
    from (
      select id as qid from public.exam_questions
      where version_id = v_version.id order by position
    ) s;
  end if;

  if v_version.option_randomization then
    select coalesce(jsonb_object_agg(q.id::text, (
      select coalesce(jsonb_agg(oid), '[]'::jsonb)
      from (select id as oid from public.question_options where question_id = q.id order by random()) o
    )), '{}'::jsonb) into v_oorder
    from public.exam_questions q where q.version_id = v_version.id;
  else
    select coalesce(jsonb_object_agg(q.id::text, (
      select coalesce(jsonb_agg(oid), '[]'::jsonb)
      from (select id as oid from public.question_options where question_id = q.id order by position) o
    )), '{}'::jsonb) into v_oorder
    from public.exam_questions q where q.version_id = v_version.id;
  end if;

  insert into public.exam_attempts (
    exam_id, exam_version_id, student_id, attempt_no, result_release,
    deadline_at, question_order, option_order, controller_token, controller_lease_expires_at
  ) values (
    p_exam_id, v_version.id, v_uid, v_attempt_no, v_exam.result_release,
    v_deadline, v_qorder, v_oorder, v_token, now() + interval '30 seconds'
  ) returning id into v_attempt_id;

  return jsonb_build_object(
    'attempt_id', v_attempt_id,
    'resumed', false,
    'attempt_no', v_attempt_no,
    'max_attempts', v_exam.max_attempts,
    'controller_token', v_token,
    'deadline_at', v_deadline,
    'started_at', now(),
    'violation_count', 0,
    'violation_threshold', v_version.violation_threshold
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 9. finalize_attempt / get_result honor the per-attempt release snapshot and
--    the live exam close time.
-- ---------------------------------------------------------------------------
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
  if v_attempt.state = 'submitted' then
    return v_attempt; -- idempotent
  end if;

  if now() >= v_attempt.deadline_at then
    v_reason := 'time_expired';
  else
    v_reason := p_reason;
  end if;

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
  from public.attempt_answers where attempt_id = p_attempt_id;

  v_pct := case when v_max > 0 then round(v_earned / v_max * 100, 2) else 0 end;

  v_released := case when v_attempt.result_release = 'immediate' then now() else null end;

  update public.exam_attempts set
    state = 'submitted',
    submitted_at = now(),
    submission_reason = v_reason,
    earned_points = v_earned,
    max_points = v_max,
    percentage = v_pct,
    answered_count = v_answered,
    correct_count = v_correct,
    result_released_at = v_released
  where id = p_attempt_id
  returning * into v_attempt;

  return v_attempt;
end;
$$;

create or replace function public.get_result(p_attempt_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := app.require_user();
  v_attempt public.exam_attempts;
  v_version public.exam_versions;
  v_exam public.exams;
  v_is_privileged boolean;
  v_released boolean;
begin
  select * into v_attempt from public.exam_attempts where id = p_attempt_id;
  if not found then raise exception 'Attempt not found' using errcode = 'P0002'; end if;

  v_is_privileged := app.is_admin()
    or app.owns_attempt_course(p_attempt_id)
    or v_attempt.student_id = v_uid;

  if not v_is_privileged then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  if v_attempt.state <> 'submitted' then
    return jsonb_build_object('attempt_state', 'in_progress',
      'deadline_at', v_attempt.deadline_at,
      'violation_count', v_attempt.violation_count);
  end if;

  select * into v_version from public.exam_versions where id = v_attempt.exam_version_id;
  select * into v_exam from public.exams where id = v_attempt.exam_id;

  v_released := v_attempt.result_release = 'immediate'
    or (v_exam.id is not null and now() >= v_exam.closes_at)
    or app.is_admin()
    or app.owns_attempt_course(p_attempt_id);

  return jsonb_build_object(
    'attempt_state', 'submitted',
    'attempt_no', v_attempt.attempt_no,
    'submission_reason', v_attempt.submission_reason,
    'submitted_at', v_attempt.submitted_at,
    'violation_count', v_attempt.violation_count,
    'max_points', v_version.max_score,
    'result_release', v_attempt.result_release,
    'released', v_released,
    'earned_points', case when v_released then v_attempt.earned_points else null end,
    'percentage', case when v_released then v_attempt.percentage else null end,
    'correct_count', case when v_released then v_attempt.correct_count else null end,
    'answered_count', v_attempt.answered_count,
    'item_count', v_version.item_count
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 10. Student attempt summary + release-guarded history.
-- ---------------------------------------------------------------------------
create or replace function public.get_my_exam_attempts(p_exam_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := app.require_user();
  v_exam public.exams;
  v_used integer;
  v_remaining integer;
  v_attempts jsonb;
  v_active uuid;
  v_best jsonb;
begin
  select * into v_exam from public.exams where id = p_exam_id;
  if not found then raise exception 'Exam not found' using errcode = 'P0002'; end if;

  if not (v_exam.state = 'published' and v_exam.archived = false) then
    raise exception 'Exam is not available' using errcode = 'P0002';
  end if;
  if not app.student_enrolled_approved(v_exam.course_id) then
    raise exception 'You are not enrolled in this course' using errcode = '42501';
  end if;

  select count(*) into v_used from public.exam_attempts
  where exam_id = p_exam_id and student_id = v_uid and state = 'submitted';
  v_remaining := greatest(v_exam.max_attempts - v_used, 0);

  select id into v_active from public.exam_attempts
  where exam_id = p_exam_id and student_id = v_uid and state = 'in_progress'
  limit 1;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', a.id,
    'attempt_no', a.attempt_no,
    'state', a.state,
    'started_at', a.started_at,
    'deadline_at', a.deadline_at,
    'submitted_at', a.submitted_at,
    'submission_reason', a.submission_reason,
    'violation_count', a.violation_count,
    'released', (a.result_release = 'immediate' or now() >= v_exam.closes_at),
    'earned_points', case when a.result_release = 'immediate' or now() >= v_exam.closes_at
                          then a.earned_points else null end,
    'max_points', case when a.result_release = 'immediate' or now() >= v_exam.closes_at
                       then a.max_points else null end,
    'percentage', case when a.result_release = 'immediate' or now() >= v_exam.closes_at
                       then a.percentage else null end
  ) order by a.attempt_no), '[]'::jsonb) into v_attempts
  from public.exam_attempts a
  where a.exam_id = p_exam_id and a.student_id = v_uid;

  select jsonb_build_object(
    'attempt_no', x.attempt_no,
    'percentage', x.percentage,
    'earned_points', x.earned_points,
    'max_points', x.max_points
  ) into v_best
  from (
    select a.attempt_no, a.percentage, a.earned_points, a.max_points,
           (a.result_release = 'immediate' or now() >= v_exam.closes_at) as rel
    from public.exam_attempts a
    where a.exam_id = p_exam_id and a.student_id = v_uid and a.state = 'submitted'
    order by
      (case when v_exam.result_policy = 'highest' then a.percentage end) desc nulls last,
      a.attempt_no desc
    limit 1
  ) x
  where x.rel;

  return jsonb_build_object(
    'max_attempts', v_exam.max_attempts,
    'used', v_used,
    'remaining', v_remaining,
    'result_policy', v_exam.result_policy,
    'active_attempt_id', v_active,
    'attempts', v_attempts,
    'summary', v_best
  );
end;
$$;

create or replace function public.get_my_results()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := app.require_user();
  v_rows jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', a.id,
    'exam_id', a.exam_id,
    'exam_title', v.title,
    'course_id', e.course_id,
    'attempt_no', a.attempt_no,
    'state', a.state,
    'submission_reason', a.submission_reason,
    'started_at', a.started_at,
    'submitted_at', a.submitted_at,
    'violation_count', a.violation_count,
    'released', (a.result_release = 'immediate' or now() >= e.closes_at),
    'earned_points', case when a.result_release = 'immediate' or now() >= e.closes_at
                          then a.earned_points else null end,
    'max_points', case when a.result_release = 'immediate' or now() >= e.closes_at
                       then a.max_points else null end,
    'percentage', case when a.result_release = 'immediate' or now() >= e.closes_at
                       then a.percentage else null end
  ) order by a.started_at desc), '[]'::jsonb) into v_rows
  from public.exam_attempts a
  join public.exams e on e.id = a.exam_id
  left join public.exam_versions v on v.id = a.exam_version_id
  where a.student_id = v_uid and a.state = 'submitted';

  return v_rows;
end;
$$;

grant execute on function public.get_my_exam_attempts(uuid) to authenticated;
grant execute on function public.get_my_results() to authenticated;

-- ---------------------------------------------------------------------------
-- 11. Grants for the new teacher functions.
-- ---------------------------------------------------------------------------
grant execute on function public.update_course(uuid, text, text, text, text) to authenticated;
grant execute on function public.set_course_archived(uuid, boolean) to authenticated;
grant execute on function public.delete_course(uuid) to authenticated;
grant execute on function public.update_exam_settings(
  uuid, text, text, timestamptz, timestamptz, integer,
  public.result_release_policy, integer, public.multi_attempt_policy) to authenticated;
grant execute on function public.restore_exam(uuid) to authenticated;
grant execute on function public.delete_exam(uuid) to authenticated;
grant execute on function public.start_attempt(uuid, uuid) to authenticated;
