-- LARP Capital core schema.
-- Security model: clients can READ everything public, but can only WRITE through
-- security-definer RPCs that check a per-player secret (sha256-hashed, unreadable).

create table public.players (
  id uuid primary key,
  name text not null check (name ~ '^[A-Za-z0-9_.-]{1,18}$'),
  equity numeric not null default 10000 check (equity > -1e9 and equity < 1e12),
  balance numeric not null default 10000 check (balance > -1e9 and balance < 1e12),
  rank text not null default '' check (char_length(rank) <= 40),
  blown_count int not null default 0 check (blown_count >= 0),
  total_profit numeric not null default 0,
  best_trade numeric not null default 0,
  wins int not null default 0,
  losses int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index players_equity_idx on public.players (equity desc);
create index players_updated_idx on public.players (updated_at desc);

-- RLS on, no policies: unreadable by clients.
create table public.player_secrets (
  id uuid primary key references public.players(id) on delete cascade,
  secret_hash text not null
);

-- Persistent trading-floor feed (real players only; NPCs are client-deterministic).
create table public.floor_events (
  id bigint generated always as identity primary key,
  player_id uuid not null references public.players(id) on delete cascade,
  name text not null,
  kind text not null check (kind in ('open', 'close', 'chat', 'blown')),
  sym text check (sym is null or sym in ('HOPIUM','GOLD','NASDOG','EURCOPE','WAGMI','LMBO')),
  side smallint check (side is null or side in (-1, 1)),
  lots numeric check (lots is null or (lots > 0 and lots <= 100)),
  profit numeric check (profit is null or (profit > -1e10 and profit < 1e10)),
  text text check (text is null or char_length(text) <= 60),
  blown_count int,
  created_at timestamptz not null default now()
);
create index floor_events_created_idx on public.floor_events (created_at desc);
create index floor_events_player_idx on public.floor_events (player_id, created_at desc);

alter table public.players enable row level security;
alter table public.player_secrets enable row level security;
alter table public.floor_events enable row level security;

create policy "players are public" on public.players for select to anon, authenticated using (true);
create policy "floor is public" on public.floor_events for select to anon, authenticated using (true);

create or replace function public.larp_check(p_id uuid, p_secret text)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.player_secrets s
    where s.id = p_id
      and s.secret_hash = encode(sha256(convert_to(p_secret, 'UTF8')), 'hex')
  );
$$;
revoke all on function public.larp_check(uuid, text) from public, anon, authenticated;

-- Sync profile + stats. First call registers the player and claims the id.
create or replace function public.upsert_player(
  p_id uuid, p_secret text, p_name text,
  p_equity numeric, p_balance numeric, p_rank text, p_blown_count int,
  p_total_profit numeric, p_best_trade numeric, p_wins int, p_losses int
) returns void language plpgsql security definer set search_path = ''
as $$
begin
  if p_secret is null or char_length(p_secret) < 32 then
    raise exception 'bad secret';
  end if;
  if not exists (select 1 from public.player_secrets where id = p_id) then
    insert into public.players (id, name, equity, balance, rank, blown_count, total_profit, best_trade, wins, losses)
    values (p_id, p_name, p_equity, p_balance, coalesce(p_rank, ''), greatest(p_blown_count, 0), p_total_profit, p_best_trade, greatest(p_wins, 0), greatest(p_losses, 0));
    insert into public.player_secrets (id, secret_hash)
    values (p_id, encode(sha256(convert_to(p_secret, 'UTF8')), 'hex'));
    return;
  end if;
  if not public.larp_check(p_id, p_secret) then
    raise exception 'not your account';
  end if;
  update public.players set
    name = p_name, equity = p_equity, balance = p_balance, rank = coalesce(p_rank, ''),
    blown_count = greatest(blown_count, p_blown_count), -- shame only goes up
    total_profit = p_total_profit, best_trade = p_best_trade,
    wins = greatest(p_wins, 0), losses = greatest(p_losses, 0),
    updated_at = now()
  where id = p_id;
end;
$$;

-- Post to the floor. Preset chat only (no moderation needed), rate-limited.
create or replace function public.post_floor_event(
  p_id uuid, p_secret text, p_kind text,
  p_sym text default null, p_side smallint default null, p_lots numeric default null,
  p_profit numeric default null, p_text text default null
) returns void language plpgsql security definer set search_path = ''
as $$
declare
  v_name text;
  v_recent int;
begin
  if not public.larp_check(p_id, p_secret) then
    raise exception 'not your account';
  end if;
  if p_kind not in ('open', 'close', 'chat') then
    raise exception 'bad kind';
  end if;
  if p_kind = 'chat' and p_text not in (
    'WAGMI 🚀', 'just a retest 😐', 'sir this is a casino', 'buy the dip!!', 'liquidated again 💀', 'lambo soon 🏎️',
    'who is selling?? 😡', 'my mentor said this would happen', 'this is manipulation', 'up 400% this week (demo)',
    'revenge trading time', 'stop hunting my SL bro'
  ) then
    raise exception 'presets only';
  end if;
  if p_kind in ('open', 'close') and (p_sym is null or p_side is null or p_lots is null) then
    raise exception 'missing trade fields';
  end if;
  select count(*) into v_recent from public.floor_events
  where player_id = p_id and created_at > now() - interval '10 seconds';
  if v_recent >= 8 then
    return; -- silently drop spam
  end if;
  select name into v_name from public.players where id = p_id;
  insert into public.floor_events (player_id, name, kind, sym, side, lots, profit, text)
  values (
    p_id, v_name, p_kind,
    case when p_kind = 'chat' then null else p_sym end,
    case when p_kind = 'chat' then null else p_side end,
    case when p_kind = 'chat' then null else p_lots end,
    case when p_kind = 'close' then p_profit else null end,
    case when p_kind = 'chat' then p_text else null end
  );
  delete from public.floor_events where created_at < now() - interval '48 hours';
end;
$$;

-- "Ask mom for another $10k": server-side reset + public shame event.
create or replace function public.reset_account(p_id uuid, p_secret text)
returns int language plpgsql security definer set search_path = ''
as $$
declare
  v_blown int;
  v_name text;
begin
  if not public.larp_check(p_id, p_secret) then
    raise exception 'not your account';
  end if;
  update public.players set
    blown_count = blown_count + 1, equity = 10000, balance = 10000,
    total_profit = 0, best_trade = 0, wins = 0, losses = 0,
    rank = 'Discord Signal Seller', updated_at = now()
  where id = p_id
  returning blown_count, name into v_blown, v_name;
  insert into public.floor_events (player_id, name, kind, blown_count)
  values (p_id, v_name, 'blown', v_blown);
  return v_blown;
end;
$$;

revoke all on function public.upsert_player(uuid, text, text, numeric, numeric, text, int, numeric, numeric, int, int) from public;
revoke all on function public.post_floor_event(uuid, text, text, text, smallint, numeric, numeric, text) from public;
revoke all on function public.reset_account(uuid, text) from public;
grant execute on function public.upsert_player(uuid, text, text, numeric, numeric, text, int, numeric, numeric, int, int) to anon, authenticated;
grant execute on function public.post_floor_event(uuid, text, text, text, smallint, numeric, numeric, text) to anon, authenticated;
grant execute on function public.reset_account(uuid, text) to anon, authenticated;

-- Realtime: stream feed inserts + leaderboard changes to every client.
alter publication supabase_realtime add table public.floor_events;
alter publication supabase_realtime add table public.players;
