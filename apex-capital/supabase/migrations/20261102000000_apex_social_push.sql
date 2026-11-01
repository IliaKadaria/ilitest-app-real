-- Apex Capital: new instrument universe, avatars, friends, private DMs and
-- server-delivered push notifications for TP/SL fills while the app is closed.
-- Same security model as before: tables are either public-read or fully
-- private; every write (and every private read) goes through a
-- security-definer RPC that checks the per-device secret.

-- ------------------------------------------------------------- instruments
-- 52 symbols now (Forex / Metals / Nasdaq); validate shape instead of a list.
alter table public.floor_events drop constraint if exists floor_events_sym_check;
alter table public.floor_events add constraint floor_events_sym_check check (sym is null or sym ~ '^[A-Z0-9]{2,8}$');

-- ------------------------------------------------------------- avatars
alter table public.players add column if not exists avatar text check (avatar is null or char_length(avatar) <= 24000);
create index if not exists players_name_lower_idx on public.players (lower(name));

create or replace function public.set_avatar(p_id uuid, p_secret text, p_avatar text)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if not public.larp_check(p_id, p_secret) then raise exception 'not your account'; end if;
  if p_avatar is not null and not (p_avatar ~ '^p:[0-9]{1,2}$' or p_avatar like 'data:image/jpeg;base64,%') then
    raise exception 'bad avatar';
  end if;
  update public.players set avatar = p_avatar, updated_at = now() where id = p_id;
end;
$$;

-- ------------------------------------------------------------- friends (private)
create table if not exists public.friendships (
  requester uuid not null references public.players(id) on delete cascade,
  addressee uuid not null references public.players(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  primary key (requester, addressee),
  check (requester <> addressee)
);
create index if not exists friendships_addressee_idx on public.friendships (addressee);
alter table public.friendships enable row level security; -- no policies: RPC only

create or replace function public.apex_are_friends(a uuid, b uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.friendships
    where status = 'accepted' and ((requester = a and addressee = b) or (requester = b and addressee = a))
  );
$$;
revoke all on function public.apex_are_friends(uuid, uuid) from public, anon, authenticated;

create or replace function public.my_friends(p_id uuid, p_secret text)
returns table (peer uuid, status text, outgoing boolean, since timestamptz)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.larp_check(p_id, p_secret) then raise exception 'not your account'; end if;
  return query
    select case when f.requester = p_id then f.addressee else f.requester end, f.status, f.requester = p_id, f.created_at
    from public.friendships f
    where f.requester = p_id or f.addressee = p_id;
end;
$$;

create or replace function public.request_friend(p_id uuid, p_secret text, p_peer uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_recent int;
begin
  if not public.larp_check(p_id, p_secret) then raise exception 'not your account'; end if;
  if p_peer = p_id then raise exception 'cannot friend yourself'; end if;
  if not exists (select 1 from public.players where id = p_peer) then raise exception 'unknown player'; end if;
  select count(*) into v_recent from public.friendships where requester = p_id and created_at > now() - interval '1 minute';
  if v_recent >= 10 then raise exception 'slow down'; end if;
  -- they already asked us: accept
  if exists (select 1 from public.friendships where requester = p_peer and addressee = p_id) then
    update public.friendships set status = 'accepted' where requester = p_peer and addressee = p_id;
    return;
  end if;
  insert into public.friendships (requester, addressee) values (p_id, p_peer) on conflict do nothing;
end;
$$;

create or replace function public.respond_friend(p_id uuid, p_secret text, p_peer uuid, p_accept boolean)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if not public.larp_check(p_id, p_secret) then raise exception 'not your account'; end if;
  if p_accept then
    update public.friendships set status = 'accepted' where requester = p_peer and addressee = p_id;
  else
    delete from public.friendships where requester = p_peer and addressee = p_id and status = 'pending';
  end if;
end;
$$;

create or replace function public.remove_friend(p_id uuid, p_secret text, p_peer uuid)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if not public.larp_check(p_id, p_secret) then raise exception 'not your account'; end if;
  delete from public.friendships where (requester = p_id and addressee = p_peer) or (requester = p_peer and addressee = p_id);
end;
$$;

-- ------------------------------------------------------------- direct messages (private)
create table if not exists public.direct_messages (
  id bigint generated always as identity primary key,
  sender uuid not null references public.players(id) on delete cascade,
  recipient uuid not null references public.players(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 1000),
  created_at timestamptz not null default now()
);
create index if not exists dm_recipient_idx on public.direct_messages (recipient, created_at);
create index if not exists dm_sender_idx on public.direct_messages (sender, created_at);
alter table public.direct_messages enable row level security; -- no policies: RPC only

create or replace function public.send_dm(p_id uuid, p_secret text, p_to uuid, p_body text)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_recent int;
begin
  if not public.larp_check(p_id, p_secret) then raise exception 'not your account'; end if;
  if not public.apex_are_friends(p_id, p_to) then raise exception 'not friends'; end if;
  select count(*) into v_recent from public.direct_messages where sender = p_id and created_at > now() - interval '10 seconds';
  if v_recent >= 8 then raise exception 'slow down'; end if;
  insert into public.direct_messages (sender, recipient, body) values (p_id, p_to, left(trim(p_body), 1000));
end;
$$;

create or replace function public.get_dms(p_id uuid, p_secret text, p_since timestamptz)
returns table (id bigint, sender uuid, recipient uuid, body text, created_at timestamptz)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.larp_check(p_id, p_secret) then raise exception 'not your account'; end if;
  return query
    select d.id, d.sender, d.recipient, d.body, d.created_at
    from public.direct_messages d
    where (d.sender = p_id or d.recipient = p_id) and d.created_at > p_since
    order by d.created_at
    limit 500;
end;
$$;

-- ------------------------------------------------------------- push notifications
create table if not exists public.push_subscriptions (
  player_id uuid not null references public.players(id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now(),
  primary key (player_id, endpoint)
);
alter table public.push_subscriptions enable row level security; -- private

create table if not exists public.scheduled_pushes (
  id bigint generated always as identity primary key,
  player_id uuid not null references public.players(id) on delete cascade,
  fire_at timestamptz not null,
  title text not null check (char_length(title) <= 120),
  body text not null check (char_length(body) <= 300),
  tag text not null check (char_length(tag) <= 80),
  sent_at timestamptz
);
create index if not exists scheduled_pushes_due_idx on public.scheduled_pushes (fire_at) where sent_at is null;
alter table public.scheduled_pushes enable row level security; -- private

create or replace function public.save_push_subscription(p_id uuid, p_secret text, p_sub jsonb)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if not public.larp_check(p_id, p_secret) then raise exception 'not your account'; end if;
  if p_sub->>'endpoint' is null or p_sub->>'endpoint' not like 'https://%' then raise exception 'bad subscription'; end if;
  insert into public.push_subscriptions (player_id, endpoint, p256dh, auth)
  values (p_id, p_sub->>'endpoint', p_sub->'keys'->>'p256dh', p_sub->'keys'->>'auth')
  on conflict (player_id, endpoint) do update set p256dh = excluded.p256dh, auth = excluded.auth;
  -- keep the 3 most recent devices
  delete from public.push_subscriptions where player_id = p_id and endpoint not in (
    select endpoint from public.push_subscriptions where player_id = p_id order by created_at desc limit 3
  );
end;
$$;

-- The client forecasts fills (deterministic market) and REPLACES its schedule.
create or replace function public.schedule_pushes(p_id uuid, p_secret text, p_items jsonb)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if not public.larp_check(p_id, p_secret) then raise exception 'not your account'; end if;
  delete from public.scheduled_pushes where player_id = p_id and sent_at is null;
  insert into public.scheduled_pushes (player_id, fire_at, title, body, tag)
  select p_id, (i->>'at')::timestamptz, left(i->>'title', 120), left(i->>'body', 300), left(i->>'tag', 80)
  from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) as i
  where (i->>'at')::timestamptz between now() - interval '1 minute' and now() + interval '4 days'
  limit 40;
  delete from public.scheduled_pushes where sent_at < now() - interval '2 days';
end;
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'set_avatar(uuid, text, text)',
    'my_friends(uuid, text)',
    'request_friend(uuid, text, uuid)',
    'respond_friend(uuid, text, uuid, boolean)',
    'remove_friend(uuid, text, uuid)',
    'send_dm(uuid, text, uuid, text)',
    'get_dms(uuid, text, timestamptz)',
    'save_push_subscription(uuid, text, jsonb)',
    'schedule_pushes(uuid, text, jsonb)'
  ] loop
    execute format('revoke all on function public.%s from public', f);
    execute format('grant execute on function public.%s to anon, authenticated', f);
  end loop;
end $$;

-- ------------------------------------------------------------- delivery (cron → edge function)
-- Requires the pg_cron + pg_net extensions and the `send-due-pushes` edge function
-- (supabase/functions/send-due-pushes). Store the function URL and a shared
-- secret in Vault first:
--   select vault.create_secret('https://<ref>.supabase.co/functions/v1/send-due-pushes', 'push_fn_url');
--   select vault.create_secret('<random string, same as CRON_SECRET env of the function>', 'push_cron_secret');
-- Then schedule it:
--   select cron.schedule('apex-send-due-pushes', '* * * * *', $cron$
--     select net.http_post(
--       url := (select decrypted_secret from vault.decrypted_secrets where name = 'push_fn_url'),
--       headers := jsonb_build_object('content-type', 'application/json',
--                  'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'push_cron_secret')),
--       body := '{}'::jsonb)
--   $cron$);

-- Atomically claim due pushes (service role only; used by the edge function).
create or replace function public.claim_due_pushes(p_limit int default 500)
returns table (id bigint, player_id uuid, title text, body text, tag text, endpoint text, p256dh text, auth text)
language sql security definer set search_path = ''
as $$
  with due as (
    update public.scheduled_pushes s set sent_at = now()
    where s.id in (
      select x.id from public.scheduled_pushes x
      where x.sent_at is null and x.fire_at <= now()
      order by x.fire_at
      limit p_limit
      for update skip locked
    )
    returning s.id, s.player_id, s.title, s.body, s.tag
  )
  select d.id, d.player_id, d.title, d.body, d.tag, p.endpoint, p.p256dh, p.auth
  from due d join public.push_subscriptions p on p.player_id = d.player_id;
$$;
revoke all on function public.claim_due_pushes(int) from public, anon, authenticated;
grant execute on function public.claim_due_pushes(int) to service_role;

create or replace function public.drop_push_endpoint(p_endpoint text)
returns void language sql security definer set search_path = ''
as $$ delete from public.push_subscriptions where endpoint = p_endpoint; $$;
revoke all on function public.drop_push_endpoint(text) from public, anon, authenticated;
grant execute on function public.drop_push_endpoint(text) to service_role;
