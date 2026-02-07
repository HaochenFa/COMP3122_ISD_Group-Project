-- Auth hardening: immutable global account type + enrollment escalation protections.

do $$
begin
  if not exists (
    select 1 from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'account_type'
      and n.nspname = 'public'
  ) then
    create type public.account_type as enum ('teacher', 'student');
  end if;
end;
$$;

alter table public.profiles
  add column if not exists account_type public.account_type;

with inferred as (
  select
    u.id as user_id,
    (
      case
        when exists (select 1 from public.classes c where c.owner_id = u.id)
          or exists (
            select 1 from public.enrollments e
            where e.user_id = u.id
              and e.role in ('teacher', 'ta')
          )
          or exists (select 1 from public.admin_users a where a.user_id = u.id)
        then 'teacher'
        else 'student'
      end
    )::public.account_type as inferred_account_type
  from auth.users u
)
insert into public.profiles (id, account_type, created_at)
select i.user_id, i.inferred_account_type, now()
from inferred i
left join public.profiles p on p.id = i.user_id
where p.id is null;

with inferred as (
  select
    u.id as user_id,
    (
      case
        when exists (select 1 from public.classes c where c.owner_id = u.id)
          or exists (
            select 1 from public.enrollments e
            where e.user_id = u.id
              and e.role in ('teacher', 'ta')
          )
          or exists (select 1 from public.admin_users a where a.user_id = u.id)
        then 'teacher'
        else 'student'
      end
    )::public.account_type as inferred_account_type
  from auth.users u
)
update public.profiles p
set account_type = i.inferred_account_type
from inferred i
where p.id = i.user_id
  and p.account_type is null;

alter table public.profiles
  alter column account_type set not null;

create or replace function public.requesting_account_type()
returns public.account_type
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select p.account_type
  from public.profiles p
  where p.id = public.requesting_user_id();
$$;

create or replace function public.prevent_profile_account_type_change()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if old.account_type is distinct from new.account_type then
    raise exception 'account_type is immutable';
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_account_type_immutable on public.profiles;
create trigger profiles_account_type_immutable
before update on public.profiles
for each row execute function public.prevent_profile_account_type_change();

create or replace function public.sync_profile_from_auth_user()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  account_type_text text;
  parsed_account_type public.account_type;
begin
  account_type_text := lower(trim(coalesce(new.raw_user_meta_data ->> 'account_type', '')));
  if account_type_text not in ('teacher', 'student') then
    raise exception 'account_type is required and must be teacher or student';
  end if;

  parsed_account_type := account_type_text::public.account_type;

  insert into public.profiles (id, display_name, avatar_url, account_type)
  values (
    new.id,
    nullif(new.raw_user_meta_data ->> 'display_name', ''),
    nullif(new.raw_user_meta_data ->> 'avatar_url', ''),
    parsed_account_type
  )
  on conflict (id) do update
    set account_type = excluded.account_type;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created_profiles on auth.users;
create trigger on_auth_user_created_profiles
after insert on auth.users
for each row execute function public.sync_profile_from_auth_user();

create or replace function public.enforce_enrollment_role_matches_account_type()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  user_account_type public.account_type;
begin
  select p.account_type
    into user_account_type
    from public.profiles p
   where p.id = new.user_id;

  if user_account_type is null then
    raise exception 'Profile with account_type is required before enrollment';
  end if;

  if user_account_type = 'teacher' and new.role not in ('teacher', 'ta') then
    raise exception 'Teacher accounts may only use teacher or ta enrollment roles';
  end if;

  if user_account_type = 'student' and new.role <> 'student' then
    raise exception 'Student accounts may only use student enrollment role';
  end if;

  return new;
end;
$$;

drop trigger if exists enrollments_role_by_account_type on public.enrollments;
create trigger enrollments_role_by_account_type
before insert or update on public.enrollments
for each row execute function public.enforce_enrollment_role_matches_account_type();

create or replace function join_class_by_code(code text)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  target_class_id uuid;
  requester_id uuid;
begin
  requester_id := public.requesting_user_id();

  if requester_id is null then
    return null;
  end if;

  if public.requesting_account_type() <> 'student' then
    return null;
  end if;

  if code is null or length(trim(code)) = 0 then
    return null;
  end if;

  select id into target_class_id
  from public.classes
  where upper(join_code) = upper(trim(code))
  limit 1;

  if target_class_id is null then
    return null;
  end if;

  insert into public.enrollments (class_id, user_id, role)
  values (target_class_id, requester_id, 'student')
  on conflict (class_id, user_id) do nothing;

  return target_class_id;
end;
$$;

grant execute on function join_class_by_code(text) to authenticated;

create or replace function public.create_class(
  p_title text,
  p_subject text,
  p_level text,
  p_description text,
  p_join_code text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user_id uuid;
  v_class_id uuid;
begin
  v_user_id := public.requesting_user_id();
  if v_user_id is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  if public.requesting_account_type() <> 'teacher' then
    raise exception 'Only teacher accounts can create classes' using errcode = '42501';
  end if;

  if p_title is null or length(trim(p_title)) = 0 then
    raise exception 'Title is required' using errcode = '22023';
  end if;

  if p_join_code is null or length(trim(p_join_code)) = 0 then
    raise exception 'Join code is required' using errcode = '22023';
  end if;

  if char_length(p_title) > 200 then
    raise exception 'Title is too long (max 200 characters)' using errcode = '22023';
  end if;

  if p_subject is not null and char_length(p_subject) > 120 then
    raise exception 'Subject is too long (max 120 characters)' using errcode = '22023';
  end if;

  if p_level is not null and char_length(p_level) > 120 then
    raise exception 'Level is too long (max 120 characters)' using errcode = '22023';
  end if;

  if p_description is not null and char_length(p_description) > 2000 then
    raise exception 'Description is too long (max 2000 characters)' using errcode = '22023';
  end if;

  if char_length(p_join_code) > 32 then
    raise exception 'Join code is too long (max 32 characters)' using errcode = '22023';
  end if;

  insert into public.classes (owner_id, title, subject, level, description, join_code)
  values (v_user_id, p_title, p_subject, p_level, p_description, p_join_code)
  returning id into v_class_id;

  insert into public.enrollments (class_id, user_id, role)
  values (v_class_id, v_user_id, 'teacher')
  on conflict (class_id, user_id) do update set role = excluded.role;

  return v_class_id;
end;
$$;

grant execute on function public.create_class(text, text, text, text, text) to authenticated;

drop policy if exists classes_insert_authenticated on public.classes;
create policy classes_insert_teacher
on public.classes for insert
with check (public.requesting_account_type() = 'teacher');

drop policy if exists enrollments_insert_self on public.enrollments;

revoke insert on public.enrollments from anon, authenticated;
revoke update (role, user_id, class_id) on public.enrollments from anon, authenticated;
