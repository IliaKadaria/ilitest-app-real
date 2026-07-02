-- Run this once in the Supabase SQL Editor (Project > SQL Editor > New query).

-- Table that records every signup (id + email + when).
create table if not exists public.users (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  created_at timestamptz not null default now()
);

alter table public.users enable row level security;

-- Users can read only their own row. No insert policy is needed: rows are
-- created by the trigger below (security definer), which bypasses RLS, so
-- there is no direct-insert path for the public "anon" role to abuse.
create policy "Users can view own row"
  on public.users for select
  using (auth.uid() = id);

-- Whenever someone signs up via Supabase Auth, mirror them into public.users.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.users (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
