-- ===========================================================================
-- EXAVYN — migration 0026
-- Server-side teacher enrollment search.
--
-- PostgREST cannot apply an `or` filter to columns of an embedded relationship
-- using the embed alias (`student.full_name.ilike...`); it parses the string as
-- a logical tree before resolving the embed and returns PGRST100. This RPC does
-- the search in parameterized SQL instead, so names/emails can be matched with
-- literal substring semantics and special characters never become filter
-- syntax.
--
-- Security:
--   * SECURITY DEFINER is required to join the student profile without relying
--     on a second PostgREST request.
--   * The caller must be active and own the course (or be an administrator).
--   * Search input is a bound parameter; `strpos(lower(...), lower(...))` gives
--     case-insensitive partial matches with `%`, `_`, backslash, commas,
--     parentheses, and apostrophes treated literally.
--   * Only the requested page is returned; the count covers the same filtered
--     authorized set before pagination.
-- ===========================================================================

create or replace function public.get_course_enrollments_page(
  p_course_id uuid,
  p_search text default '',
  p_status public.enrollment_status default null,
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
    raise exception 'You do not have permission to view this course'
      using errcode = '42501';
  end if;

  if not (app.owns_course(p_course_id) or app.is_admin()) then
    raise exception 'You do not have permission to view this course'
      using errcode = '42501';
  end if;

  select count(*)
    into v_total
    from public.enrollments e
    join public.profiles p on p.id = e.student_id
   where e.course_id = p_course_id
     and (p_status is null or e.status = p_status)
     and (
       v_search = ''
       or strpos(lower(p.full_name), lower(v_search)) > 0
       or strpos(lower(coalesce(p.email, '')), lower(v_search)) > 0
     );

  select coalesce(
           jsonb_agg(to_jsonb(page_rows) order by page_rows.requested_at desc, page_rows.id desc),
           '[]'::jsonb
         )
    into v_rows
    from (
      select
        e.id,
        e.course_id,
        e.student_id,
        e.status,
        e.requested_at,
        e.decided_at,
        e.decided_by,
        p.full_name as student_full_name,
        p.email as student_email
        from public.enrollments e
        join public.profiles p on p.id = e.student_id
       where e.course_id = p_course_id
         and (p_status is null or e.status = p_status)
         and (
           v_search = ''
           or strpos(lower(p.full_name), lower(v_search)) > 0
           or strpos(lower(coalesce(p.email, '')), lower(v_search)) > 0
         )
       order by e.requested_at desc, e.id desc
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

comment on function public.get_course_enrollments_page(uuid, text, public.enrollment_status, integer, integer)
  is 'Authorized teacher/admin enrollment search with literal case-insensitive name/email matching, status filtering, ordering, and exact filtered counts.';

revoke all on function public.get_course_enrollments_page(uuid, text, public.enrollment_status, integer, integer)
  from public, anon;
grant execute on function public.get_course_enrollments_page(uuid, text, public.enrollment_status, integer, integer)
  to authenticated;
