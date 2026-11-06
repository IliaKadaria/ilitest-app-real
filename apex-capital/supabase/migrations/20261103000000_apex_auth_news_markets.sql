-- Apex Capital: real logins (Supabase Auth), cloud saves, server-verified
-- admins, admin-created markets and the live news feed.

-- ------------------------------------------------------------- admins
-- Admin rights come ONLY from this table (never from the client). Add yours
-- once, outside version control:
--   insert into public.admin_emails (email) values ('you@example.com');
-- The account must sign in with that e-mail AND have it verified.
create table if not exists public.admin_emails (email text primary key check (email = lower(email)));
alter table public.admin_emails enable row level security; -- no policies: private

-- ------------------------------------------------------------- auth ↔ player link
create table if not exists public.auth_links (
  user_id uuid primary key references auth.users(id) on delete cascade,
  player_id uuid not null unique references public.players(id) on delete cascade,
  secret text not null,
  created_at timestamptz not null default now()
);
alter table public.auth_links enable row level security; -- no policies: RPC only

create or replace function public.apex_sync_admin(p_user uuid, p_player uuid)
returns boolean language plpgsql security definer set search_path = ''
as $$
declare v_admin boolean;
begin
  select exists (
    select 1 from auth.users u join public.admin_emails a on a.email = lower(u.email)
    where u.id = p_user and u.email_confirmed_at is not null
  ) into v_admin;
  -- both ways: only verified e-mails in admin_emails stay admin
  update public.players set is_admin = v_admin where id = p_player and is_admin is distinct from v_admin;
  return coalesce((select is_admin from public.players where id = p_player), false);
end;
$$;
revoke all on function public.apex_sync_admin(uuid, uuid) from public, anon, authenticated;

-- Signed-in user: the game profile linked to this login (any device), or null.
create or replace function public.get_link()
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_link public.auth_links;
  v_player public.players;
begin
  if v_uid is null then return null; end if;
  select * into v_link from public.auth_links where user_id = v_uid;
  if not found then return null; end if;
  select * into v_player from public.players where id = v_link.player_id;
  return jsonb_build_object(
    'player_id', v_link.player_id, 'secret', v_link.secret, 'name', v_player.name,
    'avatar', v_player.avatar, 'is_admin', public.apex_sync_admin(v_uid, v_link.player_id)
  );
end;
$$;

-- Signed-in user claims the device profile they just created (or already had).
create or replace function public.link_account(p_id uuid, p_secret text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'sign in first'; end if;
  if not public.larp_check(p_id, p_secret) then raise exception 'not your account'; end if;
  if exists (select 1 from public.auth_links where player_id = p_id and user_id <> v_uid) then
    raise exception 'profile already linked to another login';
  end if;
  insert into public.auth_links (user_id, player_id, secret) values (v_uid, p_id, p_secret)
  on conflict (user_id) do update set player_id = excluded.player_id, secret = excluded.secret;
  return jsonb_build_object('player_id', p_id, 'is_admin', public.apex_sync_admin(v_uid, p_id));
end;
$$;

revoke all on function public.get_link() from public, anon;
revoke all on function public.link_account(uuid, text) from public, anon;
grant execute on function public.get_link() to authenticated;
grant execute on function public.link_account(uuid, text) to authenticated;

-- Usernames are unique (case-insensitive) now that they are real identities.
create unique index if not exists players_name_unique_idx on public.players (lower(name));

-- ------------------------------------------------------------- cloud saves (private)
create table if not exists public.cloud_saves (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null check (octet_length(data::text) < 3000000),
  updated_at timestamptz not null default now()
);
alter table public.cloud_saves enable row level security;
create policy "own save: read" on public.cloud_saves for select to authenticated using (user_id = (select auth.uid()));
create policy "own save: insert" on public.cloud_saves for insert to authenticated with check (user_id = (select auth.uid()));
create policy "own save: update" on public.cloud_saves for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- ------------------------------------------------------------- admin-created markets
create table if not exists public.custom_markets (
  id text primary key check (id ~ '^[A-Z0-9]{2,10}$'),
  name text not null check (char_length(name) between 1 and 24),
  description text not null default '' check (char_length(description) <= 80),
  cls text not null check (cls in ('fx', 'futures', 'indices', 'nasdaq')),
  base numeric not null check (base > 0),
  vol1m numeric not null check (vol1m between 0.00001 and 0.05),
  digits int not null check (digits between 0 and 13),
  contract numeric not null check (contract > 0),
  leverage int not null check (leverage between 1 and 1000),
  spread numeric not null check (spread > 0),
  quote_ccy text not null default 'USD' check (quote_ccy in ('USD','EUR','GBP','JPY','CHF','AUD','CAD','NZD')),
  created_by uuid references public.players(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.custom_markets enable row level security;
create policy "markets are public" on public.custom_markets for select to anon, authenticated using (true);

create or replace function public.add_market(p_id uuid, p_secret text, p_market jsonb)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if not public.larp_check(p_id, p_secret) then raise exception 'not your account'; end if;
  if not exists (select 1 from public.players where id = p_id and is_admin) then raise exception 'admins only'; end if;
  insert into public.custom_markets (id, name, description, cls, base, vol1m, digits, contract, leverage, spread, quote_ccy, created_by)
  values (
    upper(p_market->>'id'), p_market->>'name', coalesce(p_market->>'description', ''), p_market->>'cls',
    (p_market->>'base')::numeric, (p_market->>'vol1m')::numeric, (p_market->>'digits')::int,
    (p_market->>'contract')::numeric, (p_market->>'leverage')::int, (p_market->>'spread')::numeric,
    coalesce(p_market->>'quote_ccy', 'USD'), p_id
  )
  on conflict (id) do update set
    name = excluded.name, description = excluded.description, cls = excluded.cls, spread = excluded.spread,
    leverage = excluded.leverage, contract = excluded.contract, digits = excluded.digits;
    -- base & vol1m are fixed after creation: changing them would rewrite every chart's history
end;
$$;

create or replace function public.remove_market(p_id uuid, p_secret text, p_symbol text)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if not public.larp_check(p_id, p_secret) then raise exception 'not your account'; end if;
  if not exists (select 1 from public.players where id = p_id and is_admin) then raise exception 'admins only'; end if;
  delete from public.custom_markets where id = p_symbol;
end;
$$;

-- floor feed accepts custom symbols too
alter table public.floor_events drop constraint if exists floor_events_sym_check;
alter table public.floor_events add constraint floor_events_sym_check check (sym is null or sym ~ '^[A-Z0-9]{2,10}$');

-- ------------------------------------------------------------- live news (public read, written by the edge function)
create table if not exists public.news_items (
  id text primary key,
  headline text not null check (char_length(headline) <= 300),
  summary text not null default '' check (char_length(summary) <= 400),
  source text not null check (char_length(source) <= 60),
  url text not null check (url like 'https://%' or url like 'http://%'),
  image text,
  category text not null default 'general',
  symbols text[] not null default '{}',
  published_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists news_items_published_idx on public.news_items (published_at desc);
alter table public.news_items enable row level security;
create policy "news is public" on public.news_items for select to anon, authenticated using (true);

-- breaking-news push opt-in
alter table public.push_subscriptions add column if not exists news boolean not null default false;
create or replace function public.set_news_alerts(p_id uuid, p_secret text, p_on boolean)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if not public.larp_check(p_id, p_secret) then raise exception 'not your account'; end if;
  update public.push_subscriptions set news = p_on where player_id = p_id;
end;
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'add_market(uuid, text, jsonb)',
    'remove_market(uuid, text, text)',
    'set_news_alerts(uuid, text, boolean)'
  ] loop
    execute format('revoke all on function public.%s from public', f);
    execute format('grant execute on function public.%s to anon, authenticated', f);
  end loop;
end $$;

alter publication supabase_realtime add table public.custom_markets;
alter publication supabase_realtime add table public.news_items;

-- ------------------------------------------------------------- schedule the news pull (after deploying fetch-news)
--   select vault.create_secret('https://<ref>.supabase.co/functions/v1/fetch-news', 'news_fn_url');
--   select cron.schedule('apex-fetch-news', '*/2 * * * *', $cron$
--     select net.http_post(
--       url := (select decrypted_secret from vault.decrypted_secrets where name = 'news_fn_url'),
--       headers := jsonb_build_object('content-type', 'application/json',
--                  'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'push_cron_secret')),
--       body := '{}'::jsonb)
--   $cron$);
