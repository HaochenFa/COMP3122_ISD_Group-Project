-- Create class via security definer to avoid RLS insert issues.

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

  insert into public.classes (owner_id, title, subject, level, description, join_code)
  values (v_user_id, p_title, p_subject, p_level, p_description, p_join_code)
  returning id into v_class_id;

  return v_class_id;
end;
$$;

grant execute on function public.create_class(text, text, text, text, text) to authenticated;
