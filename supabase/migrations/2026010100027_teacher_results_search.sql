-- ===========================================================================
-- EXAVYN — migration 0027
-- Server-side teacher attempt/result search.
--
-- The results page previously built a PostgREST `or` filter against an embedded
-- relationship (`student.full_name.ilike...`). PostgREST parses the logical tree
-- before resolving the embed and returns PGRST100. These RPCs perform the search
-- in parameterized SQL so names/emails are matched with literal substring
-- semantics and special characters never become filter syntax.
--
-- Security:
--   * SECURITY DEFINER is required to join the student profile without a second
--     PostgREST request that would be subject to profiles RLS.
--   * The caller must be active. A teacher must own the exam's course; admins
--     may query any exam/course.
--   * Controller tokens are deliberately omitted from the row payload. Teachers
--     do not need them to view results.
--   * Search input is a bound parameter; `strpos(lower(...), lower(...))` gives
--     case-insensitive partial matches with `%`, `_`, backslash, commas,
--     parentheses, and apostrophes treated literally.
--   * Exact counts and pagination are applied to the same filtered authorized
--     set, with stable `(started_at desc, id desc)` ordering.
-- ===========================================================================

create or replace function public.get_exam_attempts_page(
  p_exam_id uuid,
  p_search text default '',
  p_state public.attempt_state default null,
  p_page integer default 1,
  p_page_size integer default 10
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_search text := btrim(coalesce(p_search, ''));
  v_page integer := greatest(1, coalesce(p_page, 1));
  v_page_size integer := least(100, greatest(1, coalesce(p_page_size, 10)));
  v_course_id uuid;
  v_total bigint;
  v_rows jsonb;
begin
  if not app.is_active() then
    raise exception 'You do not have permission to view these results'
      using errcode = '42501';
  end if;

  if not app.is_admin() then
    select e.course_id
      into v_course_id
      from public.exams e
     where e.id = p_exam_id;

    if v_course_id is null or not app.owns_course(v_course_id) then
      raise exception 'You do not have permission to view these results'
        using errcode = '42501';
    end if;
  end if;

  select count(*)
    into v_total
    from public.exam_attempts a
    join public.profiles p on p.id = a.student_id
   where a.exam_id = p_exam_id
     and (p_state is null or a.state = p_state)
     and (
       v_search = ''
       or strpos(lower(coalesce(p.full_name, '')), lower(v_search)) > 0
       or strpos(lower(coalesce(p.email, '')), lower(v_search)) > 0
     );

  select coalesce(
           jsonb_agg(
             page_rows.payload || jsonb_build_object(
               'student', jsonb_build_object(
                 'id', page_rows.student_id,
                 'full_name', page_rows.student_full_name,
                 'email', page_rows.student_email
               )
             )
             order by page_rows.started_at desc, page_rows.id desc
           ),
           '[]'::jsonb
         )
    into v_rows
    from (
      select
        a.id,
        a.started_at,
        to_jsonb(a) - 'controller_token' as payload,
        p.id as student_id,
        p.full_name as student_full_name,
        p.email as student_email
        from public.exam_attempts a
        join public.profiles p on p.id = a.student_id
       where a.exam_id = p_exam_id
         and (p_state is null or a.state = p_state)
         and (
           v_search = ''
           or strpos(lower(coalesce(p.full_name, '')), lower(v_search)) > 0
           or strpos(lower(coalesce(p.email, '')), lower(v_search)) > 0
         )
       order by a.started_at desc, a.id desc
       limit v_page_size
      offset (v_page - 1) * v_page_size
    ) page_rows;

  return jsonb_build_object(
    'rows', v_rows,
    'total', v_total,
    'page', v_page,
    'page_size', v_page_size
  );
end;
$$;

comment on function public.get_exam_attempts_page(uuid, text, public.attempt_state, integer, integer)
  is 'Authorized teacher/admin exam-result search with literal case-insensitive name/email matching, state filtering, ordering, exact filtered counts, and controller-token omission.';

revoke all on function public.get_exam_attempts_page(uuid, text, public.attempt_state, integer, integer)
  from public, anon;
grant execute on function public.get_exam_attempts_page(uuid, text, public.attempt_state, integer, integer)
  to authenticated;

create or replace function public.get_course_attempts_page(
  p_course_id uuid,
  p_search text default '',
  p_state public.attempt_state default null,
  p_page integer default 1,
  p_page_size integer default 10
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_search text := btrim(coalesce(p_search, ''));
  v_page integer := greatest(1, coalesce(p_page, 1));
  v_page_size integer := least(100, greatest(1, coalesce(p_page_size, 10)));
  v_total bigint;
  v_rows jsonb;
begin
  if not app.is_active() then
    raise exception 'You do not have permission to view these results'
      using errcode = '42501';
  end if;

  if not (app.owns_course(p_course_id) or app.is_admin()) then
    raise exception 'You do not have permission to view these results'
      using errcode = '42501';
  end if;

  select count(*)
    into v_total
    from public.exam_attempts a
    join public.exams e on e.id = a.exam_id
    join public.profiles p on p.id = a.student_id
   where e.course_id = p_course_id
     and (p_state is null or a.state = p_state)
     and (
       v_search = ''
       or strpos(lower(coalesce(p.full_name, '')), lower(v_search)) > 0
       or strpos(lower(coalesce(p.email, '')), lower(v_search)) > 0
     );

  select coalesce(
           jsonb_agg(
             page_rows.payload || jsonb_build_object(
               'student', jsonb_build_object(
                 'id', page_rows.student_id,
                 'full_name', page_rows.student_full_name,
                 'email', page_rows.student_email
               )
             )
             order by page_rows.started_at desc, page_rows.id desc
           ),
           '[]'::jsonb
         )
    into v_rows
    from (
      select
        a.id,
        a.started_at,
        to_jsonb(a) - 'controller_token' as payload,
        p.id as student_id,
        p.full_name as student_full_name,
        p.email as student_email
        from public.exam_attempts a
        join public.exams e on e.id = a.exam_id
        join public.profiles p on p.id = a.student_id
       where e.course_id = p_course_id
         and (p_state is null or a.state = p_state)
         and (
           v_search = ''
           or strpos(lower(coalesce(p.full_name, '')), lower(v_search)) > 0
           or strpos(lower(coalesce(p.email, '')), lower(v_search)) > 0
         )
       order by a.started_at desc, a.id desc
       limit v_page_size
      offset (v_page - 1) * v_page_size
    ) page_rows;

  return jsonb_build_object(
    'rows', v_rows,
    'total', v_total,
    'page', v_page,
    'page_size', v_page_size
  );
end;
$$;

comment on function public.get_course_attempts_page(uuid, text, public.attempt_state, integer, integer)
  is 'Authorized teacher/admin course-result search with literal case-insensitive name/email matching, state filtering, ordering, exact filtered counts, and controller-token omission.';

revoke all on function public.get_course_attempts_page(uuid, text, public.attempt_state, integer, integer)
  from public, anon;
grant execute on function public.get_course_attempts_page(uuid, text, public.attempt_state, integer, integer)
  to authenticated;
