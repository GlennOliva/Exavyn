-- Feedback attachments: private bucket, validation, quotas, ownership, authorized access
create table if not exists public.feedback_attachments (
  id uuid primary key default gen_random_uuid(),
  feedback_id uuid not null references public.feedback (id) on delete cascade,
  object_path text not null,
  original_name text not null,
  mime_type text not null,
  size_bytes integer not null check (size_bytes > 0 and size_bytes <= 5242880),
  width integer,
  height integer,
  uploaded_by uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint feedback_attachments_path_unique unique (object_path),
  constraint feedback_attachments_mime_check check (mime_type in ('image/png','image/jpeg','image/webp'))
);

alter table public.feedback_attachments enable row level security;

revoke all on public.feedback_attachments from anon, authenticated;
grant select, insert, update, delete on public.feedback_attachments to authenticated;

-- Storage bucket (private)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'feedback-attachments',
  'feedback-attachments',
  false,
  5242880,
  array['image/png','image/jpeg','image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Helper: check if user can access feedback
create or replace function public.can_access_feedback(p_feedback_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_fb public.feedback;
  v_role text;
begin
  if v_uid is null then return false; end if;
  select * into v_fb from public.feedback where id = p_feedback_id;
  if not found then return false; end if;
  if v_fb.student_id = v_uid then return true; end if;
  if app.is_admin() then return true; end if;
  -- teacher of course
  if v_fb.recipient_teacher_id = v_uid then return true; end if;
  if v_fb.recipient_type = 'course_teacher' and v_fb.course_id is not null then
    select role into v_role from public.user_roles where user_id = v_uid and role = 'teacher' limit 1;
    if v_role is not null then
      -- allow if teacher owns course or is enrolled? owned courses
      if exists (select 1 from public.courses where id = v_fb.course_id and owner_id = v_uid) then return true; end if;
    end if;
  end if;
  return false;
end;
$$;

create or replace function public.is_feedback_owner(p_feedback_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_fb public.feedback;
begin
  if v_uid is null then return false; end if;
  select student_id into v_fb.student_id from public.feedback where id = p_feedback_id;
  -- simpler
  select student_id into v_fb.student_id from (select student_id from public.feedback where id = p_feedback_id) x(student_id);
  -- avoid record type issues
  select student_id into v_fb from public.feedback where id = p_feedback_id;
  return v_fb.student_id = v_uid;
end;
$$;

drop function if exists public.is_feedback_owner(uuid);
create or replace function public.is_feedback_owner(p_feedback_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_sid uuid;
begin
  if v_uid is null then return false; end if;
  select student_id into v_sid from public.feedback where id = p_feedback_id;
  return v_sid = v_uid;
end;
$$;

-- RLS policies for attachments
drop policy if exists feedback_attachments_select on public.feedback_attachments;
create policy feedback_attachments_select on public.feedback_attachments
  for select to authenticated
  using (public.can_access_feedback(feedback_id));

drop policy if exists feedback_attachments_insert on public.feedback_attachments;
create policy feedback_attachments_insert on public.feedback_attachments
  for insert to authenticated
  with check (uploaded_by = auth.uid() and public.is_feedback_owner(feedback_id));

drop policy if exists feedback_attachments_delete on public.feedback_attachments;
create policy feedback_attachments_delete on public.feedback_attachments
  for delete to authenticated
  using (uploaded_by = auth.uid() and public.is_feedback_owner(feedback_id));

-- RPCs
create or replace function public.request_feedback_attachment_upload(
  p_feedback_id uuid,
  p_file_name text,
  p_mime_type text,
  p_size_bytes integer,
  p_content_type text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := app.require_user();
  v_fb public.feedback;
  v_ext text;
  v_path text;
  v_id uuid;
  v_count integer;
begin
  if not app.has_role('student') then raise exception 'Only students can attach screenshots' using errcode = '42501'; end if;
  select * into v_fb from public.feedback where id = p_feedback_id and student_id = v_uid for update;
  if not found then raise exception 'Feedback not found or not owned' using errcode = 'P0002'; end if;
  if p_mime_type not in ('image/png','image/jpeg','image/webp') then raise exception 'Unsupported file type' using errcode = '22023'; end if;
  if p_size_bytes < 1 or p_size_bytes > 5242880 then raise exception 'Invalid file size' using errcode = '22023'; end if;
  if lower(p_file_name) like '%.svg' or lower(p_file_name) like '%.exe' or lower(p_file_name) like '%.sh' or lower(p_file_name) like '%.bat' or lower(p_file_name) like '%.php' or lower(p_file_name) like '%.js' or lower(p_file_name) like '%.html' then
    raise exception 'Unsupported file type' using errcode = '22023';
  end if;
  select count(*) into v_count from public.feedback_attachments where feedback_id = p_feedback_id;
  if v_count >= 3 then raise exception 'Attachment limit exceeded' using errcode = '22023'; end if;

  v_ext := case p_mime_type when 'image/png' then 'png' when 'image/jpeg' then 'jpg' when 'image/webp' then 'webp' else 'bin' end;
  v_path := 'feedback/' || p_feedback_id || '/' || gen_random_uuid() || '.' || v_ext;
  insert into public.feedback_attachments (feedback_id, object_path, original_name, mime_type, size_bytes, uploaded_by)
  values (p_feedback_id, v_path, p_file_name, p_mime_type, p_size_bytes, v_uid)
  returning id into v_id;

  -- Generate signed upload URL
  return jsonb_build_object('upload_url', storage.create_signed_upload_url('feedback-attachments', v_path), 'object_path', v_path, 'attachment_id', v_id);
exception
  when others then raise;
end;
$$;

create or replace function public.confirm_feedback_attachment_upload(
  p_attachment_id uuid,
  p_feedback_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := app.require_user();
  v_att public.feedback_attachments;
begin
  if not app.has_role('student') then raise exception 'Only students can confirm attachments' using errcode = '42501'; end if;
  select * into v_att from public.feedback_attachments where id = p_attachment_id and feedback_id = p_feedback_id;
  if not found then raise exception 'Attachment not found' using errcode = 'P0002'; end if;
  if v_att.uploaded_by <> v_uid then raise exception 'Not owner' using errcode = '42501'; end if;
  if not public.is_feedback_owner(p_feedback_id) then raise exception 'Not owner of feedback' using errcode = '42501'; end if;
  -- Attachment exists in bucket if uploaded; RLS/storage policies enforced separately
end;
$$;

create or replace function public.get_feedback_attachment_url(
  p_attachment_id uuid,
  p_feedback_id uuid
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_att public.feedback_attachments;
  v_url text;
begin
  v_uid_check: declare v_uid uuid := auth.uid(); begin end;
  if auth.uid() is null then raise exception 'Not authenticated' using errcode = '42501'; end if;
  select * into v_att from public.feedback_attachments where id = p_attachment_id and feedback_id = p_feedback_id;
  if not found then raise exception 'Attachment not found' using errcode = 'P0002'; end if;
  if not public.can_access_feedback(p_feedback_id) then raise exception 'Not authorized' using errcode = '42501'; end if;
  select storage.create_signed_url('feedback-attachments', v_att.object_path, 3600) into v_url;
  return v_url;
end;
$$;

create or replace function public.list_feedback_attachments(
  p_feedback_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then raise exception 'Not authenticated' using errcode = '42501'; end if;
  if not public.can_access_feedback(p_feedback_id) then raise exception 'Not authorized' using errcode = '42501'; end if;
  return coalesce(
    (select jsonb_agg(jsonb_build_object(
      'id', id,
      'feedback_id', feedback_id,
      'object_path', object_path,
      'original_name', original_name,
      'mime_type', mime_type,
      'size_bytes', size_bytes,
      'width', width,
      'height', height,
      'created_at', created_at
    ) order by created_at)
    from public.feedback_attachments where feedback_id = p_feedback_id),
    '[]'::jsonb
  );
end;
$$;

create or replace function public.delete_feedback_attachment(
  p_attachment_id uuid,
  p_feedback_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := app.require_user();
  v_att public.feedback_attachments;
begin
  if not app.has_role('student') then raise exception 'Only students can delete attachments' using errcode = '42501'; end if;
  select * into v_att from public.feedback_attachments where id = p_attachment_id and feedback_id = p_feedback_id;
  if not found then return; end if;
  if v_att.uploaded_by <> v_uid or not public.is_feedback_owner(p_feedback_id) then raise exception 'Not authorized' using errcode = '42501'; end if;
  -- Note: storage object cleanup should be handled by storage policies/triggers; we remove DB record
  delete from public.feedback_attachments where id = p_attachment_id;
end;
$$;

-- Storage policies
drop policy if exists feedback_attachments_storage_select on storage.objects;
create policy feedback_attachments_storage_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'feedback-attachments' and
    exists (
      select 1 from public.feedback_attachments fa
      join public.feedback f on f.id = fa.feedback_id
      where fa.object_path = storage.objects.name
        and public.can_access_feedback(fa.feedback_id)
    )
  );

drop policy if exists feedback_attachments_storage_insert on storage.objects;
create policy feedback_attachments_storage_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'feedback-attachments' and
    exists (
      select 1 from public.feedback_attachments fa
      where fa.object_path = storage.objects.name
        and fa.uploaded_by = auth.uid()
        and public.is_feedback_owner(fa.feedback_id)
    )
  );

drop policy if exists feedback_attachments_storage_delete on storage.objects;
create policy feedback_attachments_storage_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'feedback-attachments' and
    exists (
      select 1 from public.feedback_attachments fa
      where fa.object_path = storage.objects.name
        and fa.uploaded_by = auth.uid()
        and public.is_feedback_owner(fa.feedback_id)
    )
  );

grant execute on function public.request_feedback_attachment_upload(uuid,text,text,integer,text) to authenticated;
grant execute on function public.confirm_feedback_attachment_upload(uuid,uuid) to authenticated;
grant execute on function public.get_feedback_attachment_url(uuid,uuid) to authenticated;
grant execute on function public.list_feedback_attachments(uuid) to authenticated;
grant execute on function public.delete_feedback_attachment(uuid,uuid) to authenticated;
grant execute on function public.can_access_feedback(uuid) to authenticated;
grant execute on function public.is_feedback_owner(uuid) to authenticated;
