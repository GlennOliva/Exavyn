-- ===========================================================================
-- EXAVYN V2 — migration 0025
-- Feedback routing, read state, and authorization hardening.
--
--   1. Every submission has an explicit recipient: the administration inbox or
--      the teacher who owns the selected course. The teacher is resolved on the
--      server from the course; the browser never supplies a teacher id.
--   2. Administration feedback stays with administrators even when it links a
--      course or exam, so a course teacher cannot read it.
--   3. Course-teacher feedback is visible only to the owning teacher (checked
--      again at read/update time) and administrators.
--   4. Unread indicators both ways: staff_read_at for the queue and
--      student_read_at + response_updated_at for replies.
--   5. Every definer function calls app.require_user(), so suspended accounts
--      cannot act through a still-valid token.
--   6. Staff notes and responses are length-limited; linked exams must be
--      published and visible to the student (no draft/unreleased metadata).
--   7. Repeated clicks return the same record even without a reused request id.
--
-- Forward-only: migrations 0000–0024 are untouched. Existing rows are
-- backfilled conservatively (course-linked feedback to the course owner,
-- general feedback to administration).
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Recipient + read-state columns
-- ---------------------------------------------------------------------------
alter table public.exam_feedback
  add column if not exists recipient_type text not null default 'administration',
  add column if not exists recipient_teacher_id uuid references public.profiles(id) on delete set null,
  add column if not exists student_read_at timestamptz,
  add column if not exists staff_read_at timestamptz,
  add column if not exists response_updated_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'exam_feedback_recipient_type_check') then
    alter table public.exam_feedback
      add constraint exam_feedback_recipient_type_check
      check (recipient_type in ('administration', 'course_teacher'));
  end if;
end
$$;

-- Existing course-linked feedback was authored for that course's teacher.
update public.exam_feedback f
   set recipient_type = 'course_teacher',
       recipient_teacher_id = c.owner_id
  from public.courses c
 where f.course_id = c.id
   and f.recipient_type = 'administration'
   and f.recipient_teacher_id is null;

-- A course without an owner (or a deleted owner) has no teacher inbox.
update public.exam_feedback
   set recipient_type = 'administration',
       recipient_teacher_id = null
 where recipient_type = 'course_teacher'
   and recipient_teacher_id is null;

create index if not exists exam_feedback_staff_unread_idx
  on public.exam_feedback(recipient_type, recipient_teacher_id, created_at desc)
  where staff_read_at is null;
create index if not exists exam_feedback_student_unread_idx
  on public.exam_feedback(student_id, created_at desc)
  where response is not null;

comment on column public.exam_feedback.recipient_type is
  'administration (admin inbox) or course_teacher (owner of course_id).';
comment on column public.exam_feedback.recipient_teacher_id is
  'Snapshotted course owner for course_teacher feedback; resolved server-side.';
comment on column public.exam_feedback.staff_read_at is
  'When the recipient last read this item in the staff queue.';
comment on column public.exam_feedback.student_read_at is
  'When the submitter last read the staff response.';

-- ---------------------------------------------------------------------------
-- 2. Submission with server-side recipient resolution
-- ---------------------------------------------------------------------------
drop function if exists public.submit_feedback(text, text, text, integer, uuid, uuid, uuid, uuid);

create or replace function public.submit_feedback(
  p_category text,
  p_subject text,
  p_message text,
  p_rating integer default null,
  p_course_id uuid default null,
  p_exam_id uuid default null,
  p_question_id uuid default null,
  p_recipient_type text default 'administration',
  p_request_id uuid default gen_random_uuid()
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := app.require_user();
  v_course_id uuid := p_course_id;
  v_exam_id uuid := p_exam_id;
  v_question_exam uuid;
  v_exam_course uuid;
  v_exam_state public.exam_state;
  v_exam_archived boolean;
  v_course_owner uuid;
  v_recipient_teacher uuid;
  v_privileged boolean := false;
  v_subject text := btrim(coalesce(p_subject, ''));
  v_message text := btrim(coalesce(p_message, ''));
  v_id uuid;
begin
  if p_category not in ('bug', 'suggestion', 'exam_concern', 'other') then
    raise exception 'Invalid feedback category';
  end if;
  if p_recipient_type not in ('administration', 'course_teacher') then
    raise exception 'Invalid feedback recipient';
  end if;
  if length(v_subject) < 3 or length(v_subject) > 160 then
    raise exception 'Subject must be between 3 and 160 characters';
  end if;
  if length(v_message) < 10 or length(v_message) > 5000 then
    raise exception 'Message must be between 10 and 5000 characters';
  end if;
  if p_rating is not null and (p_rating < 1 or p_rating > 5) then
    raise exception 'Rating must be between 1 and 5';
  end if;

  -- Resolve the linked question -> exam first so a mismatched exam id cannot
  -- slip through.
  if p_question_id is not null then
    select exam_id into v_question_exam from public.exam_questions where id = p_question_id;
    if not found then raise exception 'Question not found' using errcode = 'P0002'; end if;
    if v_exam_id is not null and v_exam_id <> v_question_exam then
      raise exception 'Question does not belong to the selected exam';
    end if;
    v_exam_id := v_question_exam;
  end if;

  if v_exam_id is not null then
    select course_id, state, archived
      into v_exam_course, v_exam_state, v_exam_archived
      from public.exams
     where id = v_exam_id;
    if not found then raise exception 'Exam not found' using errcode = 'P0002'; end if;
    if v_course_id is not null and v_course_id <> v_exam_course then
      raise exception 'Exam does not belong to the selected course';
    end if;
    v_course_id := v_exam_course;
  end if;

  if v_course_id is not null then
    select owner_id into v_course_owner from public.courses where id = v_course_id;
    if not found then raise exception 'Course not found' using errcode = 'P0002'; end if;
  end if;

  v_privileged := app.is_admin() or (v_course_id is not null and app.owns_course(v_course_id));

  if v_course_id is not null and not (
    v_privileged or app.student_enrolled_approved(v_course_id)
  ) then
    raise exception 'Not authorized for this course' using errcode = '42501';
  end if;

  -- A student may only link an exam they can actually see. This also prevents
  -- leaking the title of a draft or archived exam through a linked record.
  if v_exam_id is not null and not v_privileged
     and (v_exam_state <> 'published' or coalesce(v_exam_archived, false)) then
    raise exception 'Feedback can only be linked to a published exam' using errcode = '42501';
  end if;

  if p_recipient_type = 'course_teacher' then
    if v_course_id is null then
      raise exception 'Select a course to send feedback to its teacher';
    end if;
    if v_course_owner is null then
      raise exception 'This course has no teacher to receive feedback';
    end if;
    v_recipient_teacher := v_course_owner;
  else
    v_recipient_teacher := null;
  end if;

  -- Idempotency: an explicit request id returns the original submission.
  select id into v_id
    from public.exam_feedback
   where student_id = v_uid and request_id = p_request_id;
  if found then
    return v_id;
  end if;

  -- Double-click protection without a request id: the same feedback from the
  -- same account within two minutes is the same submission.
  select id into v_id
    from public.exam_feedback f
   where f.student_id = v_uid
     and f.category = p_category
     and f.recipient_type = p_recipient_type
     and f.subject = v_subject
     and f.message = v_message
     and f.course_id is not distinct from v_course_id
     and f.exam_id is not distinct from v_exam_id
     and f.question_id is not distinct from p_question_id
     and f.created_at > now() - interval '2 minutes'
   order by f.created_at desc
   limit 1;
  if found then
    return v_id;
  end if;

  insert into public.exam_feedback(
    student_id, category, subject, message, comment, rating,
    course_id, exam_id, question_id, recipient_type, recipient_teacher_id, request_id
  ) values (
    v_uid, p_category, v_subject, v_message, v_message, p_rating,
    v_course_id, v_exam_id, p_question_id, p_recipient_type, v_recipient_teacher, p_request_id
  )
  on conflict (student_id, request_id) do update set request_id = excluded.request_id
  returning id into v_id;

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Student list with unread-response state
-- ---------------------------------------------------------------------------
create or replace function public.get_my_feedback_page(
  p_search text default '', p_status text default '',
  p_page integer default 1, p_page_size integer default 10
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := app.require_user();
  v_page integer := greatest(coalesce(p_page, 1), 1);
  v_size integer := least(greatest(coalesce(p_page_size, 10), 1), 50);
  v_rows jsonb;
  v_total bigint;
  v_search text := btrim(coalesce(p_search, ''));
begin
  with filtered as (
    select f.id, f.category, f.subject, f.message, f.rating, f.status,
           f.recipient_type,
           case when f.recipient_type = 'course_teacher' then rt.full_name else null end
             as recipient_teacher_name,
           f.course_id, c.title as course_title, f.exam_id, e.title as exam_title,
           f.question_id, f.response, f.created_at, f.updated_at,
           (f.response is not null and (
             f.student_read_at is null
             or (f.response_updated_at is not null and f.response_updated_at > f.student_read_at)
           )) as has_unread
    from public.exam_feedback f
    left join public.courses c on c.id = f.course_id
    left join public.exams e on e.id = f.exam_id
    left join public.profiles rt on rt.id = f.recipient_teacher_id
    where f.student_id = v_uid
      and (coalesce(p_status, '') = '' or f.status = p_status)
      and (v_search = '' or
           f.subject ilike '%' || v_search || '%' or
           f.message ilike '%' || v_search || '%' or
           replace(f.category, '_', ' ') ilike '%' || v_search || '%' or
           c.title ilike '%' || v_search || '%' or
           e.title ilike '%' || v_search || '%')
  ), page_rows as (
    select * from filtered order by created_at desc, id desc
    limit v_size offset (v_page - 1) * v_size
  )
  select coalesce(jsonb_agg(to_jsonb(page_rows.*) order by created_at desc, id desc), '[]'::jsonb),
         (select count(*) from filtered)
  into v_rows, v_total from page_rows;
  return jsonb_build_object('rows', v_rows, 'total', v_total, 'page', v_page, 'page_size', v_size);
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Staff queue with recipient/unread filters
-- ---------------------------------------------------------------------------
drop function if exists public.get_staff_feedback_page(text, text, integer, integer);

create or replace function public.get_staff_feedback_page(
  p_search text default '',
  p_status text default '',
  p_recipient text default '',
  p_unread_only boolean default false,
  p_page integer default 1,
  p_page_size integer default 10
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := app.require_user();
  v_page integer := greatest(coalesce(p_page, 1), 1);
  v_size integer := least(greatest(coalesce(p_page_size, 10), 1), 50);
  v_rows jsonb;
  v_total bigint;
  v_search text := btrim(coalesce(p_search, ''));
  v_recipient text := coalesce(p_recipient, '');
  v_admin boolean := app.is_admin();
begin
  if not (v_admin or app.has_role('teacher')) then
    raise exception 'Staff access required' using errcode = '42501';
  end if;
  if v_recipient not in ('', 'administration', 'course_teacher') then
    raise exception 'Invalid recipient filter';
  end if;

  with filtered as (
    select f.id, f.student_id, p.full_name as submitter_name, f.category, f.subject,
           f.message, f.rating, f.status, f.recipient_type,
           case when f.recipient_type = 'course_teacher' then rt.full_name else null end
             as recipient_teacher_name,
           f.course_id, c.title as course_title,
           f.exam_id, e.title as exam_title, f.question_id, f.staff_notes,
           f.response, f.created_at, f.updated_at,
           (f.staff_read_at is null) as has_unread
    from public.exam_feedback f
    join public.profiles p on p.id = f.student_id
    left join public.courses c on c.id = f.course_id
    left join public.exams e on e.id = f.exam_id
    left join public.profiles rt on rt.id = f.recipient_teacher_id
    where (
      v_admin
      or (
        f.recipient_type = 'course_teacher'
        and f.recipient_teacher_id = v_uid
        and f.course_id is not null
        and app.owns_course(f.course_id)
      )
    )
      and (coalesce(p_status, '') = '' or f.status = p_status)
      and (v_recipient = '' or f.recipient_type = v_recipient)
      and (not coalesce(p_unread_only, false) or f.staff_read_at is null)
      and (v_search = '' or
           f.subject ilike '%' || v_search || '%' or
           f.message ilike '%' || v_search || '%' or
           replace(f.category, '_', ' ') ilike '%' || v_search || '%' or
           p.full_name ilike '%' || v_search || '%' or
           c.title ilike '%' || v_search || '%' or
           e.title ilike '%' || v_search || '%')
  ), page_rows as (
    select * from filtered order by created_at desc, id desc
    limit v_size offset (v_page - 1) * v_size
  )
  select coalesce(jsonb_agg(to_jsonb(page_rows.*) order by created_at desc, id desc), '[]'::jsonb),
         (select count(*) from filtered)
  into v_rows, v_total from page_rows;
  return jsonb_build_object('rows', v_rows, 'total', v_total, 'page', v_page, 'page_size', v_size);
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Staff update: active user, recipient ownership, length limits, read state
-- ---------------------------------------------------------------------------
create or replace function public.update_feedback(
  p_feedback_id uuid, p_status text, p_staff_notes text, p_response text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := app.require_user();
  v_feedback public.exam_feedback;
  v_staff_notes text := nullif(btrim(coalesce(p_staff_notes, '')), '');
  v_response text := nullif(btrim(coalesce(p_response, '')), '');
begin
  select * into v_feedback from public.exam_feedback where id = p_feedback_id for update;
  if not found then raise exception 'Feedback not found' using errcode = 'P0002'; end if;
  if not (
    app.is_admin()
    or (
      v_feedback.recipient_type = 'course_teacher'
      and v_feedback.recipient_teacher_id = v_uid
      and v_feedback.course_id is not null
      and app.owns_course(v_feedback.course_id)
    )
  ) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if p_status not in ('new', 'in_review', 'resolved') then
    raise exception 'Invalid feedback status';
  end if;
  if length(coalesce(v_staff_notes, '')) > 5000 then
    raise exception 'Staff notes must be 5000 characters or fewer';
  end if;
  if length(coalesce(v_response, '')) > 5000 then
    raise exception 'Response must be 5000 characters or fewer';
  end if;

  update public.exam_feedback
  set status = p_status,
      staff_notes = v_staff_notes,
      response = v_response,
      response_updated_at = case
        when response is distinct from v_response then now()
        else response_updated_at
      end,
      staff_read_at = now(),
      updated_at = now()
  where id = p_feedback_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Read markers + unread counts
-- ---------------------------------------------------------------------------
create or replace function public.mark_my_feedback_read(p_feedback_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := app.require_user();
begin
  update public.exam_feedback
     set student_read_at = now()
   where id = p_feedback_id and student_id = v_uid;
  if not found then
    raise exception 'Feedback not found' using errcode = 'P0002';
  end if;
end;
$$;

create or replace function public.mark_feedback_read(p_feedback_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := app.require_user();
  v_feedback public.exam_feedback;
begin
  select * into v_feedback from public.exam_feedback where id = p_feedback_id for update;
  if not found then raise exception 'Feedback not found' using errcode = 'P0002'; end if;
  if not (
    app.is_admin()
    or (
      v_feedback.recipient_type = 'course_teacher'
      and v_feedback.recipient_teacher_id = v_uid
      and v_feedback.course_id is not null
      and app.owns_course(v_feedback.course_id)
    )
  ) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  update public.exam_feedback
     set staff_read_at = coalesce(staff_read_at, now())
   where id = p_feedback_id;
end;
$$;

create or replace function public.get_feedback_unread_counts()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := app.require_user();
  v_student bigint;
  v_staff bigint;
begin
  select count(*) into v_student
    from public.exam_feedback f
   where f.student_id = v_uid
     and f.response is not null
     and (
       f.student_read_at is null
       or (f.response_updated_at is not null and f.response_updated_at > f.student_read_at)
     );

  select count(*) into v_staff
    from public.exam_feedback f
   where f.staff_read_at is null
     and (
       app.is_admin()
       or (
         f.recipient_type = 'course_teacher'
         and f.recipient_teacher_id = v_uid
         and f.course_id is not null
         and app.owns_course(f.course_id)
       )
     );

  return jsonb_build_object('student_unread', v_student, 'staff_unread', v_staff);
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Legacy summary: close the suspended-account hole
-- ---------------------------------------------------------------------------
create or replace function public.get_feedback_summary(p_exam_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_exam public.exams;
begin
  perform app.require_user();
  select * into v_exam from public.exams where id = p_exam_id;
  if not found then raise exception 'Exam not found' using errcode = 'P0002'; end if;
  if not (app.owns_course(v_exam.course_id) or app.is_admin()) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'average', (select round(avg(rating)::numeric, 2) from public.exam_feedback where exam_id = p_exam_id and rating is not null),
    'count', (select count(*) from public.exam_feedback where exam_id = p_exam_id),
    'rating_count', (select count(*) from public.exam_feedback where exam_id = p_exam_id and rating is not null),
    'recent', coalesce((
      select jsonb_agg(jsonb_build_object(
        'rating', rating, 'comment', comment,
        'created_at', created_at, 'student_id', student_id
      ) order by created_at desc)
      from (
        select * from public.exam_feedback
        where exam_id = p_exam_id
        order by created_at desc
        limit 50
      ) f
    ), '[]'::jsonb)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. Privileges: authenticated only (definer functions still re-check)
-- ---------------------------------------------------------------------------
revoke all on function public.submit_feedback(text,text,text,integer,uuid,uuid,uuid,text,uuid) from public, anon, authenticated;
revoke all on function public.get_my_feedback_page(text,text,integer,integer) from public, anon, authenticated;
revoke all on function public.get_staff_feedback_page(text,text,text,boolean,integer,integer) from public, anon, authenticated;
revoke all on function public.update_feedback(uuid,text,text,text) from public, anon, authenticated;
revoke all on function public.mark_my_feedback_read(uuid) from public, anon, authenticated;
revoke all on function public.mark_feedback_read(uuid) from public, anon, authenticated;
revoke all on function public.get_feedback_unread_counts() from public, anon, authenticated;
revoke all on function public.get_feedback_summary(uuid) from public, anon, authenticated;

grant execute on function public.submit_feedback(text,text,text,integer,uuid,uuid,uuid,text,uuid) to authenticated;
grant execute on function public.get_my_feedback_page(text,text,integer,integer) to authenticated;
grant execute on function public.get_staff_feedback_page(text,text,text,boolean,integer,integer) to authenticated;
grant execute on function public.update_feedback(uuid,text,text,text) to authenticated;
grant execute on function public.mark_my_feedback_read(uuid) to authenticated;
grant execute on function public.mark_feedback_read(uuid) to authenticated;
grant execute on function public.get_feedback_unread_counts() to authenticated;
grant execute on function public.get_feedback_summary(uuid) to authenticated;
