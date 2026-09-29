-- Remove the Developer role from an existing Supabase database.
-- Before running this migration, remove any existing Developer profile/account
-- from Supabase Auth, or change it to an approved Manager account intentionally.

do $$
begin
  if exists (select 1 from public.profiles where role = 'developer') then
    raise exception 'Developer profiles still exist. Remove or reassign them before applying this migration.';
  end if;
end $$;

alter table public.profiles
  drop constraint if exists profiles_role_check;

alter table public.profiles
  add constraint profiles_role_check
  check (role in ('manager', 'caregiver'));

create or replace function public.is_manager()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'manager'
  );
$$;
