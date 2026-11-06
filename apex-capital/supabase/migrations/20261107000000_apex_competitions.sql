-- Competitions: admin-run events with a buy-in and competition money.
-- Event schedules (swings, scoops, pump curve) are derived client-side from
-- `seed`, so every entrant sees the same market. The server keeps the field,
-- scores and player-to-player loans, and only admins open / start / cancel.

create table if not exists public.competitions (
  id uuid primary key default gen_random_uuid(),
  mode text not null check (mode in ('whale', 'roulette', 'scoop', 'pump')),
  status text not null default 'open' check (status in ('open', 'live', 'finished', 'cancelled')),
  seed int not null default floor(random() * 2147483647)::int,
  created_by uuid references public.players(id) on delete set null,
  created_at timestamptz not null default now(),
  starts_at timestamptz,
  ends_at timestamptz
);
create index if not exists competitions_status_idx on public.competitions (status, created_at desc);
alter table public.competitions enable row level security;
drop policy if exists competitions_read on public.competitions;
create policy competitions_read on public.competitions for select using (true);

create table if not exists public.competition_entries (
  comp_id uuid not null references public.competitions(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  name text not null check (name ~ '^[A-Za-z0-9_.-]{1,18}$'),
  team text check (team is null or team in ('obsidian', 'redkite', 'northwind', 'atlas')),
  equity numeric not null default 0,
  eliminated boolean not null default false,
  net_lots numeric not null default 0,
  place int,
  prize numeric not null default 0,
  claimed boolean not null default false,
  joined_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (comp_id, player_id)
);
alter table public.competition_entries enable row level security;
drop policy if exists competition_entries_read on public.competition_entries;
create policy competition_entries_read on public.competition_entries for select using (true);

-- Loans are private: only lender and borrower see them (through comp_my_loans).
create table if not exists public.competition_loans (
  id bigint generated always as identity primary key,
  comp_id uuid not null references public.competitions(id) on delete cascade,
  lender uuid not null references public.players(id) on delete cascade,
  borrower uuid not null references public.players(id) on delete cascade,
  amount numeric not null check (amount > 0),
  created_at timestamptz not null default now()
);
alter table public.competition_loans enable row level security;

create or replace function public.comp_stack(p_mode text) returns numeric language sql immutable as $$
  select case p_mode when 'whale' then 10000 when 'roulette' then 10000 when 'scoop' then 25000 else 100000 end::numeric;
$$;
create or replace function public.comp_minutes(p_mode text) returns int language sql immutable as $$
  select case p_mode when 'whale' then 60 when 'roulette' then 60 when 'scoop' then 45 else 20 end;
$$;

create or replace function public.comp_is_admin(p_id uuid, p_secret text) returns boolean
language sql stable security definer set search_path = public as $$
  select public.larp_check(p_id, p_secret) and exists (select 1 from public.players where id = p_id and is_admin);
$$;
revoke all on function public.comp_is_admin(uuid, text) from public, anon, authenticated;

create or replace function public.comp_create(p_id uuid, p_secret text, p_mode text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not public.comp_is_admin(p_id, p_secret) then raise exception 'admins only'; end if;
  if exists (select 1 from public.competitions where mode = p_mode and status in ('open', 'live')) then
    raise exception 'this competition is already open or running';
  end if;
  insert into public.competitions (mode, created_by) values (p_mode, p_id) returning id into v_id;
  return v_id;
end $$;

create or replace function public.comp_start(p_id uuid, p_secret text, p_comp uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_mode text; v_n int;
begin
  if not public.comp_is_admin(p_id, p_secret) then raise exception 'admins only'; end if;
  select mode into v_mode from public.competitions where id = p_comp and status = 'open' for update;
  if v_mode is null then raise exception 'not open'; end if;
  select count(*) into v_n from public.competition_entries where comp_id = p_comp;
  -- a thin field would let one player take the whole pot
  if v_n < 4 then raise exception 'needs at least 4 players (has %)', v_n; end if;
  update public.competitions
     set status = 'live', starts_at = now() + interval '10 seconds',
         ends_at = now() + interval '10 seconds' + make_interval(mins => public.comp_minutes(v_mode))
   where id = p_comp;
end $$;

create or replace function public.comp_cancel(p_id uuid, p_secret text, p_comp uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.comp_is_admin(p_id, p_secret) then raise exception 'admins only'; end if;
  update public.competitions set status = 'cancelled' where id = p_comp and status in ('open', 'live');
end $$;

create or replace function public.comp_join(p_id uuid, p_secret text, p_comp uuid, p_team text, p_name text)
returns void language plpgsql security definer set search_path = public as $$
declare v_mode text;
begin
  if not public.larp_check(p_id, p_secret) then raise exception 'not your account'; end if;
  select mode into v_mode from public.competitions where id = p_comp and status = 'open';
  if v_mode is null then raise exception 'registration is closed'; end if;
  if v_mode = 'whale' and p_team is null then raise exception 'pick a fund'; end if;
  insert into public.competition_entries (comp_id, player_id, name, team, equity)
  values (p_comp, p_id, p_name, case when v_mode = 'whale' then p_team end, public.comp_stack(v_mode))
  on conflict (comp_id, player_id) do nothing;
end $$;

create or replace function public.comp_report(p_id uuid, p_secret text, p_comp uuid, p_equity numeric, p_eliminated boolean, p_net_lots numeric)
returns void language plpgsql security definer set search_path = public as $$
declare v_mode text;
begin
  if not public.larp_check(p_id, p_secret) then raise exception 'not your account'; end if;
  select mode into v_mode from public.competitions
   where id = p_comp and status = 'live' and now() between starts_at and ends_at + interval '1 minute';
  if v_mode is null then return; end if;
  update public.competition_entries
     set equity = greatest(0, least(p_equity, public.comp_stack(v_mode) * 50)),
         eliminated = eliminated or coalesce(p_eliminated, false),
         net_lots = greatest(-10000, least(10000, coalesce(p_net_lots, 0))),
         updated_at = now()
   where comp_id = p_comp and player_id = p_id;
end $$;

create or replace function public.comp_lend(p_id uuid, p_secret text, p_comp uuid, p_to uuid, p_amount numeric)
returns void language plpgsql security definer set search_path = public as $$
declare v_eq numeric;
begin
  if not public.larp_check(p_id, p_secret) then raise exception 'not your account'; end if;
  if p_to = p_id then raise exception 'you cannot lend to yourself'; end if;
  if not exists (select 1 from public.competitions where id = p_comp and status = 'live' and mode = 'roulette' and now() < ends_at) then
    raise exception 'loans are only possible during a live Margin Call Roulette';
  end if;
  select equity into v_eq from public.competition_entries where comp_id = p_comp and player_id = p_id and not eliminated;
  if v_eq is null then raise exception 'you are not in this competition'; end if;
  if not exists (select 1 from public.competition_entries where comp_id = p_comp and player_id = p_to and not eliminated) then
    raise exception 'that player is not in the competition';
  end if;
  if p_amount <= 0 or p_amount > v_eq * 0.5 then raise exception 'you can lend up to half your equity'; end if;
  insert into public.competition_loans (comp_id, lender, borrower, amount) values (p_comp, p_id, p_to, p_amount);
end $$;

create or replace function public.comp_my_loans(p_id uuid, p_secret text)
returns setof public.competition_loans language plpgsql stable security definer set search_path = public as $$
begin
  if not public.larp_check(p_id, p_secret) then raise exception 'not your account'; end if;
  return query select * from public.competition_loans
    where (lender = p_id or borrower = p_id) and created_at > now() - interval '2 days'
    order by id;
end $$;

create or replace function public.comp_claim(p_id uuid, p_secret text, p_comp uuid, p_place int, p_prize numeric)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.larp_check(p_id, p_secret) then raise exception 'not your account'; end if;
  update public.competitions set status = 'finished' where id = p_comp and status = 'live' and ends_at < now();
  update public.competition_entries
     set place = p_place, prize = greatest(0, p_prize), claimed = true, updated_at = now()
   where comp_id = p_comp and player_id = p_id and not claimed
     and exists (select 1 from public.competitions where id = p_comp and status = 'finished');
end $$;

grant execute on function public.comp_create(uuid, text, text), public.comp_start(uuid, text, uuid), public.comp_cancel(uuid, text, uuid),
  public.comp_join(uuid, text, uuid, text, text), public.comp_report(uuid, text, uuid, numeric, boolean, numeric),
  public.comp_lend(uuid, text, uuid, uuid, numeric), public.comp_my_loans(uuid, text), public.comp_claim(uuid, text, uuid, int, numeric)
  to anon, authenticated;
