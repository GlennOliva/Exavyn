-- ===========================================================================
-- Anti-Cheating Exam — migration 0006
-- Authoritative RPC functions. All multi-step operations are transactional and
-- all authorization decisions are derived from the authenticated context.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Shared internal helpers
-- ---------------------------------------------------------------------------
create or replace function app.require_user()
returns uuid
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if not exists (
    select 1 from public.profiles p
    where p.id = v_uid and p.status = 'active'
  ) then
    raise exception 'Account is not active' using errcode = '28000';
  end if;
  return v_uid;
end;
$$;

create or replace function app.write_audit(
  p_actor uuid,
  p_action text,
  p_entity_type text,
  p_entity_id text,
  p_details jsonb default '{}'::jsonb
)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, details)
  values (p_actor, p_action, p_entity_type, p_entity_id, coalesce(p_details, '{}'::jsonb));
$$;

create or replace function app.generate_join_code()
returns text
language sql
volatile
as $$
  select string_agg(
    substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 1 + floor(random() * 32)::int, 1),
    ''
  )
  from generate_series(1, 8);
$$;

create or replace function app.hash_join_code(p_code text)
returns text
language sql
immutable
set search_path = extensions, public, pg_catalog
as $$
  select encode(digest(upper(btrim(p_code)), 'sha256'), 'hex');
$$;

-- ===========================================================================
-- Courses & enrollment
-- ===========================================================================
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
  insert into public.course_join_codes (course_id, code_hash, code_hint, created_by)
  values (v_course_id, app.hash_join_code(v_code), left(v_code, 2) || '****', v_uid);

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
  insert into public.course_join_codes (course_id, code_hash, code_hint, created_by)
  values (p_course_id, app.hash_join_code(v_code), left(v_code, 2) || '****', v_uid);

  perform app.write_audit(v_uid, 'join_code.rotate', 'course', p_course_id::text, '{}'::jsonb);
  return v_code;
end;
$$;

create or replace function public.request_enrollment(p_join_code text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := app.require_user();
  v_course record;
  v_recent integer;
  v_existing public.enrollments;
  v_id uuid;
begin
  if not app.has_role('student') then
    raise exception 'Only students may request enrollment' using errcode = '42501';
  end if;

  select count(*) into v_recent
  from public.enrollments
  where student_id = v_uid and requested_at > now() - interval '60 seconds';
  if v_recent >= 5 then
    raise exception 'Too many enrollment attempts. Please wait a moment.'
      using errcode = '53400';
  end if;

  select c.* into v_course
  from public.course_join_codes jc
  join public.courses c on c.id = jc.course_id
  where jc.code_hash = app.hash_join_code(p_join_code)
    and jc.active = true
    and (jc.expires_at is null or jc.expires_at > now())
    and c.archived = false
  limit 1;

  if not found then
    raise exception 'Invalid or expired course code' using errcode = 'P0002';
  end if;

  select * into v_existing from public.enrollments
  where course_id = v_course.id and student_id = v_uid;

  if found then
    if v_existing.status = 'approved' then
      return jsonb_build_object('enrollment_id', v_existing.id, 'course_id', v_course.id,
        'status', 'approved', 'already', true);
    end if;
    if v_existing.status = 'pending' then
      return jsonb_build_object('enrollment_id', v_existing.id, 'course_id', v_course.id,
        'status', 'pending', 'already', true);
    end if;
    -- rejected/withdrawn: re-request
    update public.enrollments
       set status = 'pending', requested_at = now(), decided_at = null, decided_by = null
     where id = v_existing.id
     returning id into v_id;
    return jsonb_build_object('enrollment_id', v_id, 'course_id', v_course.id, 'status', 'pending');
  end if;

  insert into public.enrollments (course_id, student_id, status)
  values (v_course.id, v_uid, 'pending')
  returning id into v_id;

  return jsonb_build_object('enrollment_id', v_id, 'course_id', v_course.id, 'status', 'pending');
end;
$$;

create or replace function public.decide_enrollment(
  p_enrollment_id uuid,
  p_decision text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := app.require_user();
  v_enr public.enrollments;
  v_status public.enrollment_status;
begin
  if p_decision not in ('approved', 'rejected', 'withdrawn') then
    raise exception 'Invalid decision';
  end if;
  v_status := p_decision::public.enrollment_status;

  select * into v_enr from public.enrollments where id = p_enrollment_id for update;
  if not found then raise exception 'Enrollment not found' using errcode = 'P0002'; end if;

  if not (app.owns_course(v_enr.course_id) or app.is_admin()) then
    raise exception 'Not your course' using errcode = '42501';
  end if;

  update public.enrollments
     set status = v_status, decided_at = now(), decided_by = v_uid
   where id = p_enrollment_id;

  perform app.write_audit(v_uid, 'enrollment.' || p_decision, 'enrollment', p_enrollment_id::text,
    jsonb_build_object('course_id', v_enr.course_id, 'student_id', v_enr.student_id));

  return jsonb_build_object('enrollment_id', p_enrollment_id, 'status', v_status);
end;
$$;

-- ===========================================================================
-- Exam authoring
-- ===========================================================================
create or replace function app.validate_exam_payload(p_payload jsonb)
returns void
language plpgsql
as $$
declare
  v_q jsonb;
  v_opts jsonb;
  v_idx integer;
begin
  if coalesce(length(btrim(p_payload->>'title')), 0) = 0 then
    raise exception 'Exam title is required';
  end if;
  if coalesce((p_payload->>'duration_minutes')::int, 0) <= 0 then
    raise exception 'Duration must be positive';
  end if;
  if (p_payload->>'opens_at')::timestamptz >= (p_payload->>'closes_at')::timestamptz then
    raise exception 'Opening time must be before closing time';
  end if;
  if p_payload->'questions' is null or jsonb_array_length(p_payload->'questions') < 1 then
    raise exception 'At least one question is required';
  end if;

  for v_q in select * from jsonb_array_elements(p_payload->'questions')
  loop
    if coalesce(length(btrim(v_q->>'prompt')), 0) = 0 then
      raise exception 'Every question needs a non-empty prompt';
    end if;
    v_opts := v_q->'options';
    if v_opts is null or jsonb_array_length(v_opts) <> 4 then
      raise exception 'Every question needs exactly four choices';
    end if;
    if exists (
      select 1 from jsonb_array_elements(v_opts) o
      where coalesce(length(btrim(o->>'label')), 0) = 0
    ) then
      raise exception 'Choices may not be empty';
    end if;
    begin
      v_idx := (v_q->>'correct_index')::int;
    exception when others then
      raise exception 'Every question needs a correct option';
    end;
    if v_idx is null or v_idx < 0 or v_idx > 3 then
      raise exception 'Correct option must be one of the four choices';
    end if;
  end loop;
end;
$$;

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
begin
  if not (app.has_role('teacher') or app.is_admin()) then
    raise exception 'Only teachers may author exams' using errcode = '42501';
  end if;
  if not (app.owns_course(v_course_id) or app.is_admin()) then
    raise exception 'Not your course' using errcode = '42501';
  end if;

  perform app.validate_exam_payload(p_payload);

  if v_exam_id is null then
    insert into public.exams (
      course_id, owner_id, title, instructions, duration_minutes, opens_at, closes_at,
      question_randomization, option_randomization, result_release, state
    ) values (
      v_course_id, v_uid, btrim(p_payload->>'title'), coalesce(p_payload->>'instructions',''),
      (p_payload->>'duration_minutes')::int,
      (p_payload->>'opens_at')::timestamptz,
      (p_payload->>'closes_at')::timestamptz,
      coalesce((p_payload->>'question_randomization')::boolean, false),
      coalesce((p_payload->>'option_randomization')::boolean, false),
      coalesce((p_payload->>'result_release'), 'immediate')::public.result_release_policy,
      'draft'
    ) returning id into v_exam_id;
  else
    select state into v_state from public.exams where id = v_exam_id for update;
    if not found then raise exception 'Exam not found' using errcode = 'P0002'; end if;
    if not (app.owns_course((select course_id from public.exams where id = v_exam_id)) or app.is_admin()) then
      raise exception 'Not your exam' using errcode = '42501';
    end if;
    if v_state <> 'draft' then
      raise exception 'Published exams are immutable; duplicate it instead';
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
      result_release = coalesce((p_payload->>'result_release'),'immediate')::public.result_release_policy
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
  v_q record;
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
    item_count, max_score, frozen, published_by
  ) values (
    p_exam_id, v_version_no, v_exam.title, v_exam.instructions, v_exam.duration_minutes,
    v_exam.opens_at, v_exam.closes_at, v_exam.question_randomization,
    v_exam.option_randomization, v_exam.result_release, v_exam.violation_threshold,
    v_item_count, v_max, true, v_uid
  ) returning id into v_version_id;

  -- Clone draft question content into the frozen version. The correct option is
  -- identified by position in the draft and re-attached to the cloned option id.
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
                       'item_count', v_item_count, 'max_score', v_max));

  return v_version_id;
end;
$$;

create or replace function public.archive_exam(p_exam_id uuid)
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

  update public.exams set state = 'archived', archived = true where id = p_exam_id;
  perform app.write_audit(v_uid, 'exam.archive', 'exam', p_exam_id::text, '{}'::jsonb);
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

  -- Prefer the published version's questions; otherwise use the current draft.
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
      'questions', v_questions
    );
  end;

  v_new_id := public.save_exam_draft(null, v_payload);
  return v_new_id;
end;
$$;

-- ===========================================================================
-- Attempts, answers, violations, grading
-- ===========================================================================
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
  v_release public.result_release_policy;
  v_released timestamptz;
begin
  select * into v_attempt from public.exam_attempts where id = p_attempt_id for update;
  if not found then raise exception 'Attempt not found' using errcode = 'P0002'; end if;
  if v_attempt.state = 'submitted' then
    return v_attempt; -- idempotent
  end if;

  -- Precedence: an already-passed server deadline always wins.
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

  select result_release into v_release
  from public.exam_versions where id = v_attempt.exam_version_id;
  v_released := case when v_release = 'immediate' then now() else null end;

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

create or replace function public.start_attempt(p_exam_id uuid)
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
  v_attempt_id uuid;
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

  -- Availability is checked atomically against server time.
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

  select * into v_existing from public.exam_attempts
  where exam_id = p_exam_id and student_id = v_uid for update;

  if found then
    if v_existing.state = 'in_progress' then
      return jsonb_build_object(
        'attempt_id', v_existing.id,
        'resumed', true,
        'controller_token', v_existing.controller_token,
        'deadline_at', v_existing.deadline_at,
        'started_at', v_existing.started_at,
        'violation_count', v_existing.violation_count,
        'violation_threshold', v_version.violation_threshold
      );
    end if;
    raise exception 'You have already completed this exam' using errcode = 'P0002';
  end if;

  v_deadline := least(now() + make_interval(mins => v_version.duration_minutes), v_version.closes_at);
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
    exam_id, exam_version_id, student_id, deadline_at, question_order, option_order,
    controller_token, controller_lease_expires_at
  ) values (
    p_exam_id, v_version.id, v_uid, v_deadline, v_qorder, v_oorder,
    v_token, now() + interval '30 seconds'
  ) returning id into v_attempt_id;

  return jsonb_build_object(
    'attempt_id', v_attempt_id,
    'resumed', false,
    'controller_token', v_token,
    'deadline_at', v_deadline,
    'started_at', now(),
    'violation_count', 0,
    'violation_threshold', v_version.violation_threshold
  );
end;
$$;

create or replace function public.acquire_attempt_controller(
  p_attempt_id uuid,
  p_current_token uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := app.require_user();
  v_attempt public.exam_attempts;
begin
  select * into v_attempt from public.exam_attempts
  where id = p_attempt_id and student_id = v_uid for update;
  if not found then raise exception 'Attempt not found' using errcode = 'P0002'; end if;

  if v_attempt.state = 'submitted' then
    return jsonb_build_object('state', 'submitted', 'controller_token', v_attempt.controller_token);
  end if;

  if p_current_token is not null and p_current_token = v_attempt.controller_token then
    update public.exam_attempts
       set controller_lease_expires_at = now() + interval '30 seconds'
     where id = p_attempt_id;
    return jsonb_build_object(
      'controller_token', v_attempt.controller_token,
      'lease_expires_at', now() + interval '30 seconds'
    );
  end if;

  if v_attempt.controller_lease_expires_at > now() then
    raise exception 'This attempt is active in another session' using errcode = '55006';
  end if;

  update public.exam_attempts
     set controller_token = gen_random_uuid(),
         controller_lease_expires_at = now() + interval '30 seconds'
   where id = p_attempt_id
   returning controller_token into v_attempt.controller_token;

  return jsonb_build_object(
    'controller_token', v_attempt.controller_token,
    'lease_expires_at', now() + interval '30 seconds',
    'rotated', true
  );
end;
$$;

create or replace function public.get_attempt_payload(p_attempt_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := app.require_user();
  v_attempt public.exam_attempts;
  v_version public.exam_versions;
  v_questions jsonb;
begin
  select * into v_attempt from public.exam_attempts
  where id = p_attempt_id and student_id = v_uid;
  if not found then raise exception 'Attempt not found' using errcode = 'P0002'; end if;

  select * into v_version from public.exam_versions where id = v_attempt.exam_version_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', q.id,
    'prompt', q.prompt,
    'points', q.points,
    'options', (
      select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'label', o.label) order by oo.ord), '[]'::jsonb)
      from jsonb_array_elements_text(v_attempt.option_order -> q.id::text)
           with ordinality as oo(oid, ord)
      join public.question_options o on o.id = oo.oid::uuid
    ),
    'saved_option_id', aa.selected_option_id
  ) order by qord.ord), '[]'::jsonb) into v_questions
  from jsonb_array_elements_text(v_attempt.question_order) with ordinality as qord(qid, ord)
  join public.exam_questions q on q.id = qord.qid::uuid
  left join public.attempt_answers aa
    on aa.attempt_id = p_attempt_id and aa.question_id = q.id;

  return jsonb_build_object(
    'attempt', jsonb_build_object(
      'id', v_attempt.id,
      'state', v_attempt.state,
      'started_at', v_attempt.started_at,
      'deadline_at', v_attempt.deadline_at,
      'violation_count', v_attempt.violation_count,
      'violation_threshold', v_version.violation_threshold,
      'submission_reason', v_attempt.submission_reason
    ),
    'exam', jsonb_build_object(
      'title', v_version.title,
      'instructions', v_version.instructions,
      'duration_minutes', v_version.duration_minutes,
      'item_count', v_version.item_count,
      'result_release', v_version.result_release,
      'closes_at', v_version.closes_at
    ),
    'questions', v_questions
  );
end;
$$;

create or replace function public.save_answer(
  p_attempt_id uuid,
  p_question_id uuid,
  p_option_id uuid,
  p_revision bigint,
  p_request_id uuid,
  p_controller_token uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := app.require_user();
  v_attempt public.exam_attempts;
  v_valid integer;
  v_accepted boolean := false;
  v_existing_req uuid;
begin
  select * into v_attempt from public.exam_attempts
  where id = p_attempt_id and student_id = v_uid for update;
  if not found then raise exception 'Attempt not found' using errcode = 'P0002'; end if;

  if v_attempt.state = 'submitted' then
    return jsonb_build_object('accepted', false, 'reason', 'finalized',
      'attempt_state', 'submitted', 'violation_count', v_attempt.violation_count,
      'deadline_at', v_attempt.deadline_at);
  end if;

  if now() >= v_attempt.deadline_at then
    perform app.finalize_attempt(p_attempt_id, 'time_expired');
    return jsonb_build_object('accepted', false, 'reason', 'time_expired',
      'attempt_state', 'submitted');
  end if;

  if p_controller_token <> v_attempt.controller_token then
    return jsonb_build_object('accepted', false, 'reason', 'controller');
  end if;

  -- Idempotent retry of the same request.
  select request_id into v_existing_req from public.attempt_answers
  where attempt_id = p_attempt_id and request_id = p_request_id;
  if found then
    return jsonb_build_object('accepted', true, 'reason', 'duplicate', 'revision', p_revision);
  end if;

  -- Option must belong to a question in this attempt's frozen version.
  select 1 into v_valid
  from public.question_options o
  join public.exam_questions q on q.id = o.question_id
  where o.id = p_option_id and q.id = p_question_id
    and q.version_id = v_attempt.exam_version_id;
  if v_valid is null then
    return jsonb_build_object('accepted', false, 'reason', 'invalid_option');
  end if;

  insert into public.attempt_answers (
    attempt_id, question_id, selected_option_id, revision, request_id, answered_at
  ) values (p_attempt_id, p_question_id, p_option_id, p_revision, p_request_id, now())
  on conflict (attempt_id, question_id) do update
    set selected_option_id = excluded.selected_option_id,
        revision = excluded.revision,
        request_id = excluded.request_id,
        answered_at = now()
    where public.attempt_answers.revision < excluded.revision;

  get diagnostics v_valid = row_count;
  v_accepted := v_valid > 0;

  if v_accepted then
    update public.exam_attempts
       set controller_lease_expires_at = now() + interval '30 seconds'
     where id = p_attempt_id;
  end if;

  return jsonb_build_object(
    'accepted', v_accepted,
    'reason', case when v_accepted then 'saved' else 'stale' end,
    'revision', p_revision
  );
end;
$$;

create or replace function public.record_violation(
  p_attempt_id uuid,
  p_episode_id uuid,
  p_signals text[],
  p_observed_at timestamptz,
  p_controller_token uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := app.require_user();
  v_attempt public.exam_attempts;
  v_version public.exam_versions;
  v_event_id bigint;
  v_new_count integer;
begin
  select * into v_attempt from public.exam_attempts
  where id = p_attempt_id and student_id = v_uid for update;
  if not found then raise exception 'Attempt not found' using errcode = 'P0002'; end if;

  select * into v_version from public.exam_versions where id = v_attempt.exam_version_id;

  if v_attempt.state = 'submitted' then
    return jsonb_build_object(
      'violation_count', v_attempt.violation_count,
      'attempt_state', 'submitted',
      'submission_reason', v_attempt.submission_reason,
      'finalized', true,
      'duplicate', true
    );
  end if;

  if p_controller_token <> v_attempt.controller_token then
    return jsonb_build_object('error', 'controller',
      'attempt_state', v_attempt.state, 'violation_count', v_attempt.violation_count);
  end if;

  insert into public.violation_events (attempt_id, episode_id, signals, observed_at, details)
  values (p_attempt_id, p_episode_id, coalesce(p_signals, '{}'),
          p_observed_at, jsonb_build_object('received_via', 'rpc'))
  on conflict (attempt_id, episode_id) do nothing
  returning id into v_event_id;

  if v_event_id is null then
    -- Duplicate episode: never double count.
    return jsonb_build_object(
      'violation_count', v_attempt.violation_count,
      'attempt_state', v_attempt.state,
      'duplicate', true,
      'violation_threshold', v_version.violation_threshold,
      'finalized', v_attempt.state = 'submitted'
    );
  end if;

  v_new_count := v_attempt.violation_count + 1;

  update public.exam_attempts
     set violation_count = v_new_count,
         controller_lease_expires_at = now() + interval '30 seconds'
   where id = p_attempt_id;

  if v_new_count >= v_version.violation_threshold then
    perform app.finalize_attempt(p_attempt_id, 'violation_limit');
  end if;

  select * into v_attempt from public.exam_attempts where id = p_attempt_id;

  return jsonb_build_object(
    'violation_count', v_attempt.violation_count,
    'attempt_state', v_attempt.state,
    'submission_reason', v_attempt.submission_reason,
    'violation_threshold', v_version.violation_threshold,
    'duplicate', false,
    'finalized', v_attempt.state = 'submitted'
  );
end;
$$;

create or replace function public.submit_attempt(
  p_attempt_id uuid,
  p_controller_token uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := app.require_user();
  v_attempt public.exam_attempts;
begin
  select * into v_attempt from public.exam_attempts
  where id = p_attempt_id and student_id = v_uid for update;
  if not found then raise exception 'Attempt not found' using errcode = 'P0002'; end if;

  if v_attempt.state = 'submitted' then
    return public.get_result(p_attempt_id);
  end if;

  if p_controller_token <> v_attempt.controller_token then
    return jsonb_build_object('error', 'controller');
  end if;

  perform app.finalize_attempt(p_attempt_id, 'manual');
  return public.get_result(p_attempt_id);
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

  v_released := v_version.result_release = 'immediate'
    or now() >= v_version.closes_at
    or app.is_admin()
    or app.owns_attempt_course(p_attempt_id);

  return jsonb_build_object(
    'attempt_state', 'submitted',
    'submission_reason', v_attempt.submission_reason,
    'submitted_at', v_attempt.submitted_at,
    'violation_count', v_attempt.violation_count,
    'max_points', v_version.max_score,
    'result_release', v_version.result_release,
    'released', v_released,
    'earned_points', case when v_released then v_attempt.earned_points else null end,
    'percentage', case when v_released then v_attempt.percentage else null end,
    'correct_count', case when v_released then v_attempt.correct_count else null end,
    'answered_count', v_attempt.answered_count,
    'item_count', v_version.item_count
  );
end;
$$;

create or replace function public.heartbeat(
  p_attempt_id uuid,
  p_controller_token uuid,
  p_seq bigint
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := app.require_user();
begin
  if not exists (
    select 1 from public.exam_attempts
    where id = p_attempt_id and student_id = v_uid
      and controller_token = p_controller_token
  ) then
    raise exception 'Not the active controller' using errcode = '55006';
  end if;
  insert into public.attempt_heartbeats (attempt_id, last_seen_at, client_seq)
  values (p_attempt_id, now(), coalesce(p_seq, 0))
  on conflict (attempt_id) do update
    set last_seen_at = now(), client_seq = greatest(public.attempt_heartbeats.client_seq, excluded.client_seq);
end;
$$;

create or replace function public.finalize_expired_attempts()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row record;
  v_count integer := 0;
begin
  for v_row in
    select id from public.exam_attempts
    where state = 'in_progress' and deadline_at <= now()
    order by deadline_at
    limit 500
  loop
    perform app.finalize_attempt(v_row.id, 'time_expired');
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- ===========================================================================
-- Admin operations
-- ===========================================================================
create or replace function public.admin_set_account_status(
  p_user_id uuid,
  p_status public.account_status
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := app.require_user();
begin
  if not app.is_admin() then
    raise exception 'Administrator only' using errcode = '42501';
  end if;
  if p_user_id = v_uid then
    raise exception 'Administrators cannot change their own status';
  end if;
  update public.profiles set status = p_status where id = p_user_id;
  perform app.write_audit(v_uid, 'account.set_status', 'profile', p_user_id::text,
    jsonb_build_object('status', p_status));
end;
$$;

create or replace function public.admin_set_role(
  p_user_id uuid,
  p_role public.app_role
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := app.require_user();
begin
  if not app.is_admin() then
    raise exception 'Administrator only' using errcode = '42501';
  end if;
  if p_user_id = v_uid then
    raise exception 'Administrators cannot change their own role';
  end if;
  insert into public.user_roles (user_id, role, granted_by)
  values (p_user_id, p_role, v_uid)
  on conflict (user_id) do update set role = excluded.role, granted_by = v_uid;
  perform app.write_audit(v_uid, 'account.set_role', 'profile', p_user_id::text,
    jsonb_build_object('role', p_role));
end;
$$;

create or replace function public.admin_dashboard_stats()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := app.require_user();
begin
  if not app.is_admin() then
    raise exception 'Administrator only' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'users', (select count(*) from public.profiles),
    'teachers', (select count(*) from public.user_roles where role = 'teacher'),
    'students', (select count(*) from public.user_roles where role = 'student'),
    'courses', (select count(*) from public.courses where archived = false),
    'exams', (select count(*) from public.exams),
    'published_exams', (select count(*) from public.exams where state = 'published'),
    'attempts', (select count(*) from public.exam_attempts),
    'submitted_attempts', (select count(*) from public.exam_attempts where state = 'submitted'),
    'flagged_attempts', (select count(*) from public.exam_attempts where violation_count > 0)
  );
end;
$$;
