-- Medication Tracker — Supabase schema
-- Run this in Supabase SQL Editor after creating a project.
-- Security model: authenticated users only; managers can administer shared data,
-- caregivers can read operational data and write administration records.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('manager','caregiver','developer')),
  display_name text not null default '',
  language text not null default 'he' check (language in ('he','en')),
  address_gender text not null default 'female' check (address_gender in ('female','male')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.residents (
  id text primary key,
  name text not null,
  room text not null default '',
  notes text not null default '',
  photo_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.medications (
  id text primary key,
  name text not null,
  type text not null default '',
  dose text not null default '',
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.resident_medications (
  resident_id text not null references public.residents(id) on delete cascade,
  medication_id text not null references public.medications(id) on delete cascade,
  primary key (resident_id, medication_id)
);

create table if not exists public.rounds (
  id text primary key,
  name text not null,
  time time not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.round_entries (
  round_id text not null references public.rounds(id) on delete cascade,
  resident_id text not null references public.residents(id) on delete cascade,
  notes text not null default '',
  primary key (round_id, resident_id)
);

create table if not exists public.round_entry_medications (
  round_id text not null,
  resident_id text not null,
  medication_id text not null references public.medications(id) on delete cascade,
  primary key (round_id, resident_id, medication_id),
  foreign key (round_id, resident_id)
    references public.round_entries(round_id, resident_id) on delete cascade
);

create table if not exists public.administrations (
  id uuid primary key default gen_random_uuid(),
  round_id text not null references public.rounds(id) on delete cascade,
  resident_id text not null references public.residents(id) on delete cascade,
  medication_id text not null references public.medications(id) on delete cascade,
  caregiver_id uuid not null references public.profiles(id),
  status text not null check (status in ('given','skipped')),
  administered_at timestamptz not null default now(),
  note text not null default '',
  unique (round_id, resident_id, medication_id, caregiver_id, administered_at)
);

create table if not exists public.notification_preferences (
  caregiver_id uuid primary key references public.profiles(id) on delete cascade,
  enabled boolean not null default true,
  muted_round_ids text[] not null default '{}',
  updated_at timestamptz not null default now()
);

create index if not exists administrations_round_idx on public.administrations(round_id);
create index if not exists administrations_date_idx on public.administrations(administered_at);
create index if not exists administrations_caregiver_idx on public.administrations(caregiver_id);

create or replace function public.current_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid();
$$;

create or replace function public.is_manager()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role in ('manager','developer')
  );
$$;

alter table public.profiles enable row level security;
alter table public.residents enable row level security;
alter table public.medications enable row level security;
alter table public.resident_medications enable row level security;
alter table public.rounds enable row level security;
alter table public.round_entries enable row level security;
alter table public.round_entry_medications enable row level security;
alter table public.administrations enable row level security;
alter table public.notification_preferences enable row level security;

drop policy if exists "profiles_read_authenticated" on public.profiles;
drop policy if exists "profiles_update_self_or_manager" on public.profiles;
drop policy if exists "profiles_update_self" on public.profiles;
drop policy if exists "profiles_manager_update" on public.profiles;

create policy "profiles_read_authenticated" on public.profiles
for select to authenticated using (true);

-- A user may update only their display/language/address preferences.
-- Role changes are manager/developer-only and cannot be self-escalated.
create policy "profiles_update_self" on public.profiles
for update to authenticated
using (id = auth.uid())
with check (id = auth.uid());

create policy "profiles_manager_update" on public.profiles
for update to authenticated
using (public.is_manager())
with check (public.is_manager());

drop policy if exists "shared_read_authenticated" on public.residents;
drop policy if exists "shared_read_authenticated" on public.medications;
drop policy if exists "shared_read_authenticated" on public.resident_medications;
drop policy if exists "shared_read_authenticated" on public.rounds;
drop policy if exists "shared_read_authenticated" on public.round_entries;
drop policy if exists "shared_read_authenticated" on public.round_entry_medications;

create policy "shared_read_authenticated" on public.residents
for select to authenticated using (true);
create policy "shared_read_authenticated" on public.medications
for select to authenticated using (true);
create policy "shared_read_authenticated" on public.resident_medications
for select to authenticated using (true);
create policy "shared_read_authenticated" on public.rounds
for select to authenticated using (true);
create policy "shared_read_authenticated" on public.round_entries
for select to authenticated using (true);
create policy "shared_read_authenticated" on public.round_entry_medications
for select to authenticated using (true);

drop policy if exists "admin_write_residents" on public.residents;
drop policy if exists "admin_write_medications" on public.medications;
drop policy if exists "admin_write_resident_medications" on public.resident_medications;
drop policy if exists "admin_write_rounds" on public.rounds;
drop policy if exists "admin_write_round_entries" on public.round_entries;
drop policy if exists "admin_write_round_entry_medications" on public.round_entry_medications;

create policy "admin_write_residents" on public.residents
for all to authenticated using (public.is_manager()) with check (public.is_manager());
create policy "admin_write_medications" on public.medications
for all to authenticated using (public.is_manager()) with check (public.is_manager());
create policy "admin_write_resident_medications" on public.resident_medications
for all to authenticated using (public.is_manager()) with check (public.is_manager());
create policy "admin_write_rounds" on public.rounds
for all to authenticated using (public.is_manager()) with check (public.is_manager());
create policy "admin_write_round_entries" on public.round_entries
for all to authenticated using (public.is_manager()) with check (public.is_manager());
create policy "admin_write_round_entry_medications" on public.round_entry_medications
for all to authenticated using (public.is_manager()) with check (public.is_manager());

drop policy if exists "administrations_read_authenticated" on public.administrations;
drop policy if exists "administrations_insert_self" on public.administrations;
drop policy if exists "administrations_update_self_or_manager" on public.administrations;

create policy "administrations_read_authenticated" on public.administrations
for select to authenticated using (true);
create policy "administrations_insert_self" on public.administrations
for insert to authenticated
with check (caregiver_id = auth.uid());
create policy "administrations_update_self_or_manager" on public.administrations
for update to authenticated
using (caregiver_id = auth.uid() or public.is_manager())
with check (caregiver_id = auth.uid() or public.is_manager());

drop policy if exists "notification_preferences_own" on public.notification_preferences;
create policy "notification_preferences_own" on public.notification_preferences
for all to authenticated
using (caregiver_id = auth.uid())
with check (caregiver_id = auth.uid());

grant select on public.profiles, public.residents, public.medications,
  public.resident_medications, public.rounds, public.round_entries,
  public.round_entry_medications, public.administrations,
  public.notification_preferences to authenticated;

grant insert, update, delete on public.profiles, public.residents, public.medications,
  public.resident_medications, public.rounds, public.round_entries,
  public.round_entry_medications, public.administrations,
  public.notification_preferences to authenticated;

-- Realtime: enable operational tables in the Supabase Dashboard after running this SQL.
