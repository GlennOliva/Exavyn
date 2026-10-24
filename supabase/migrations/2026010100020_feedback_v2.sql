-- EXAVYN V2: general and post-exam feedback. Existing exam feedback is retained.

alter table public.exam_feedback alter column exam_id drop not null;
alter table public.exam_feedback drop constraint if exists exam_feedback_unique_student_exam;
alter table public.exam_feedback
  add column if not exists course_id uuid references public.courses(id) on delete set null,
  add column if not exists question_id uuid references public.exam_questions(id) on delete set null,
  add column if not exists category text not null default 'other',
  add column if not exists subject text not null default 'Exam feedback',
  add column if not exists message text,
  add column if not exists status text not null default 'new',
  add column if not exists staff_notes text,
  add column if not exists response text,
  add column if not exists request_id uuid not null default gen_random_uuid();

update public.exam_feedback f
set course_id = e.course_id
from public.exams e
where f.exam_id = e.id and f.course_id is null;

update public.exam_feedback
set message = coalesce(nullif(comment, ''), 'Legacy exam feedback')
where message is null;

alter table public.exam_feedback alter column message set not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'exam_feedback_category_check') then
    alter table public.exam_feedback add constraint exam_feedback_category_check
      check (category in ('bug', 'suggestion', 'exam_concern', 'other'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'exam_feedback_status_check') then
    alter table public.exam_feedback add constraint exam_feedback_status_check
      check (status in ('new', 'in_review', 'resolved'));
  end if;
end
$$;

create unique index if not exists exam_feedback_request_unique
  on public.exam_feedback(student_id, request_id);
create index if not exists exam_feedback_staff_page_idx
  on public.exam_feedback(status, created_at desc, id desc);
create index if not exists exam_feedback_course_idx
  on public.exam_feedback(course_id, created_at desc, id desc);

drop policy if exists exam_feedback_select on public.exam_feedback;
revoke all on public.exam_feedback from public, anon, authenticated;

drop function if exists public.submit_feedback(uuid, integer, text);

create or replace function public.submit_feedback(
  p_category text,
  p_subject text,
  p_message text,
  p_rating integer default null,
  p_course_id uuid default null,
  p_exam_id uuid default null,
  p_question_id uuid default null,
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
  v_id uuid;
begin
  if p_category not in ('bug', 'suggestion', 'exam_concern', 'other') then
    raise exception 'Invalid feedback category';
  end if;
  if length(btrim(coalesce(p_subject, ''))) < 3 or length(btrim(p_subject)) > 160 then
    raise exception 'Subject must be between 3 and 160 characters';
  end if;
  if length(btrim(coalesce(p_message, ''))) < 10 or length(btrim(p_message)) > 5000 then
    raise exception 'Message must be between 10 and 5000 characters';
  end if;
  if p_rating is not null and (p_rating < 1 or p_rating > 5) then
    raise exception 'Rating must be between 1 and 5';
  end if;

  if p_question_id is not null then
    select exam_id into v_question_exam from public.exam_questions where id = p_question_id;
    if not found then raise exception 'Question not found' using errcode = 'P0002'; end if;
    if v_exam_id is not null and v_exam_id <> v_question_exam then
      raise exception 'Question does not belong to the selected exam';
    end if;
    v_exam_id := v_question_exam;
  end if;

  if v_exam_id is not null then
    select course_id into strict v_question_exam from public.exams where id = v_exam_id;
    if v_course_id is not null and v_course_id <> v_question_exam then
      raise exception 'Exam does not belong to the selected course';
    end if;
    v_course_id := v_question_exam;
  end if;

  if v_course_id is not null and not (
    app.is_admin() or app.owns_course(v_course_id) or app.student_enrolled_approved(v_course_id)
  ) then
    raise exception 'Not authorized for this course' using errcode = '42501';
  end if;

  insert into public.exam_feedback(
    student_id, category, subject, message, comment, rating,
    course_id, exam_id, question_id, request_id
  ) values (
    v_uid, p_category, btrim(p_subject), btrim(p_message), btrim(p_message), p_rating,
    v_course_id, v_exam_id, p_question_id, p_request_id
  )
  on conflict (student_id, request_id) do update set request_id = excluded.request_id
  returning id into v_id;

  return v_id;
end;
$$;

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
begin
  with filtered as (
    select f.id, f.category, f.subject, f.message, f.rating, f.status,
           f.course_id, c.title as course_title, f.exam_id, e.title as exam_title,
           f.question_id, f.response, f.created_at, f.updated_at
    from public.exam_feedback f
    left join public.courses c on c.id = f.course_id
    left join public.exams e on e.id = f.exam_id
    where f.student_id = v_uid
      and (coalesce(p_status, '') = '' or f.status = p_status)
      and (btrim(coalesce(p_search, '')) = '' or
           f.subject ilike '%' || btrim(p_search) || '%' or
           f.message ilike '%' || btrim(p_search) || '%')
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

create or replace function public.get_staff_feedback_page(
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
begin
  if not (app.is_admin() or app.has_role('teacher')) then
    raise exception 'Staff access required' using errcode = '42501';
  end if;
  with filtered as (
    select f.id, f.student_id, p.full_name as submitter_name, f.category, f.subject,
           f.message, f.rating, f.status, f.course_id, c.title as course_title,
           f.exam_id, e.title as exam_title, f.question_id, f.staff_notes,
           f.response, f.created_at, f.updated_at
    from public.exam_feedback f
    join public.profiles p on p.id = f.student_id
    left join public.courses c on c.id = f.course_id
    left join public.exams e on e.id = f.exam_id
    where (app.is_admin() or (f.course_id is not null and app.owns_course(f.course_id)))
      and (coalesce(p_status, '') = '' or f.status = p_status)
      and (btrim(coalesce(p_search, '')) = '' or
           f.subject ilike '%' || btrim(p_search) || '%' or
           f.message ilike '%' || btrim(p_search) || '%' or
           p.full_name ilike '%' || btrim(p_search) || '%')
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

create or replace function public.update_feedback(
  p_feedback_id uuid, p_status text, p_staff_notes text, p_response text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_feedback public.exam_feedback;
begin
  select * into v_feedback from public.exam_feedback where id = p_feedback_id for update;
  if not found then raise exception 'Feedback not found' using errcode = 'P0002'; end if;
  if not (app.is_admin() or (v_feedback.course_id is not null and app.owns_course(v_feedback.course_id))) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if p_status not in ('new', 'in_review', 'resolved') then
    raise exception 'Invalid feedback status';
  end if;
  update public.exam_feedback
  set status = p_status,
      staff_notes = nullif(btrim(coalesce(p_staff_notes, '')), ''),
      response = nullif(btrim(coalesce(p_response, '')), ''),
      updated_at = now()
  where id = p_feedback_id;
end;
$$;

grant execute on function public.submit_feedback(text,text,text,integer,uuid,uuid,uuid,uuid) to authenticated;
grant execute on function public.get_my_feedback_page(text,text,integer,integer) to authenticated;
grant execute on function public.get_staff_feedback_page(text,text,integer,integer) to authenticated;
grant execute on function public.update_feedback(uuid,text,text,text) to authenticated;
