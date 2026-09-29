-- Cloud auth/data migration for the Medication Tracker.
-- Run this once in Supabase SQL Editor after schema.sql.

alter table public.profiles
  add column if not exists username text;

alter table public.administrations
  add column if not exists legacy_id text,
  add column if not exists session_id text;

create unique index if not exists profiles_username_unique
  on public.profiles (lower(username))
  where username is not null and username <> '';

create unique index if not exists administrations_legacy_id_unique
  on public.administrations (legacy_id)
  where legacy_id is not null;

create index if not exists administrations_session_idx
  on public.administrations (session_id);

-- Create a safe profile automatically whenever an Auth user is created.
-- New users are caregivers by default; a manager must explicitly promote them.
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  desired_username text;
begin
  desired_username := lower(coalesce(
    nullif(new.raw_user_meta_data ->> 'username', ''),
    split_part(coalesce(new.email, ''), '@', 1)
  ));

  insert into public.profiles (
    id, role, username, display_name, language, address_gender
  )
  values (
    new.id,
    'caregiver',
    nullif(desired_username, ''),
    coalesce(
      nullif(new.raw_user_meta_data ->> 'display_name', ''),
      nullif(new.raw_user_meta_data ->> 'name', ''),
      split_part(coalesce(new.email, ''), '@', 1),
      ''
    ),
    case when new.raw_user_meta_data ->> 'language' = 'en' then 'en' else 'he' end,
    case when new.raw_user_meta_data ->> 'address_gender' = 'male' then 'male' else 'female' end
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created_medtrack on auth.users;

create trigger on_auth_user_created_medtrack
  after insert on auth.users
  for each row
  execute function public.handle_new_auth_user();

-- Allow a caregiver to remove their own administration record when an
-- in-progress medication action is undone.
drop policy if exists "administrations_delete_self_or_manager" on public.administrations;

create policy "administrations_delete_self_or_manager" on public.administrations
for delete to authenticated
using (caregiver_id = auth.uid() or public.is_manager());

grant select, insert, update, delete on public.administrations to authenticated;
grant select, insert, update on public.profiles to authenticated;


-- Defense in depth: a caregiver cannot change their own role even though
-- the profile update policy permits updates to their row.
create or replace function public.prevent_profile_role_escalation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.role is distinct from old.role and not public.is_manager() then
    raise exception 'Only a manager can change profile roles';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_prevent_role_escalation on public.profiles;

create trigger profiles_prevent_role_escalation
  before update on public.profiles
  for each row
  execute function public.prevent_profile_role_escalation();


-- Enable Postgres Changes for the shared operational tables.
do $$
declare
  tbl text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach tbl in array array[
      'profiles','residents','medications','resident_medications',
      'rounds','round_entries','round_entry_medications','administrations'
    ]
    loop
      if not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = tbl
      ) then
        execute format('alter publication supabase_realtime add table public.%I', tbl);
      end if;
    end loop;
  end if;
end $$;
