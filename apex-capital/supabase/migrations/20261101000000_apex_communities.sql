-- Apex Capital: €100 accounts, 5-hour review lockout, new instruments,
-- admin-only communities with broadcast mode, polls, signals, moderation.
-- Same security model as before: public reads, writes only via
-- security-definer RPCs that check the per-device secret.

-- ------------------------------------------------------------- players
alter table public.players add column if not exists is_admin boolean not null default false;
alter table public.players add column if not exists locked_until timestamptz;
alter table public.players alter column equity set default 100;
alter table public.players alter column balance set default 100;
alter table public.players drop constraint if exists players_name_check;
alter table public.players add constraint players_name_check check (name ~ '^[A-Za-z0-9_.-]{1,18}$');

-- new instrument universe on the tape
alter table public.floor_events drop constraint if exists floor_events_sym_check;
alter table public.floor_events add constraint floor_events_sym_check
  check (sym is null or sym in ('EURUSD','GBPUSD','USDJPY','XAUUSD','XAGUSD','ATX100','NVRA','QBTX','HELX'));
alter table public.floor_events drop constraint if exists floor_events_kind_check;
alter table public.floor_events add constraint floor_events_kind_check check (kind in ('open', 'close', 'chat', 'blown', 'frozen'));

-- Freeze for review (client calls this on stop-out; server stamps the clock).
create or replace function public.lock_account(p_id uuid, p_secret text)
returns timestamptz language plpgsql security definer set search_path = ''
as $$
declare v_until timestamptz; v_name text;
begin
  if not public.larp_check(p_id, p_secret) then raise exception 'not your account'; end if;
  update public.players
     set locked_until = greatest(coalesce(locked_until, now()), now() + interval '5 hours'),
         equity = 0, updated_at = now()
   where id = p_id
     and (locked_until is null or locked_until < now())  -- don't extend an active lock
  returning locked_until, name into v_until, v_name;
  if v_until is null then
    select locked_until into v_until from public.players where id = p_id;
  else
    insert into public.floor_events (player_id, name, kind) values (p_id, v_name, 'frozen');
  end if;
  return v_until;
end;
$$;

-- New €100 credit line, only once the review period has elapsed.
create or replace function public.reset_account(p_id uuid, p_secret text)
returns int language plpgsql security definer set search_path = ''
as $$
declare v_blown int; v_name text; v_until timestamptz;
begin
  if not public.larp_check(p_id, p_secret) then raise exception 'not your account'; end if;
  select locked_until into v_until from public.players where id = p_id;
  if v_until is not null and v_until > now() then
    raise exception 'account under review until %', v_until;
  end if;
  update public.players set
    blown_count = blown_count + 1, equity = 100, balance = 100,
    total_profit = 0, best_trade = 0, wins = 0, losses = 0,
    rank = 'Bronze III', locked_until = null, updated_at = now()
  where id = p_id
  returning blown_count, name into v_blown, v_name;
  insert into public.floor_events (player_id, name, kind, blown_count) values (p_id, v_name, 'blown', v_blown);
  return v_blown;
end;
$$;

revoke all on function public.lock_account(uuid, text) from public;
grant execute on function public.lock_account(uuid, text) to anon, authenticated;

-- ------------------------------------------------------------- communities
create table if not exists public.communities (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 40),
  description text not null default '' check (char_length(description) <= 200),
  broadcast boolean not null default false,
  created_by uuid references public.players(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.community_members (
  community_id uuid not null references public.communities(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  role text not null default 'member' check (role in ('admin', 'member')),
  banned boolean not null default false,
  joined_at timestamptz not null default now(),
  primary key (community_id, player_id)
);
create index if not exists community_members_player_idx on public.community_members (player_id);

create table if not exists public.messages (
  id bigint generated always as identity primary key,
  community_id uuid not null references public.communities(id) on delete cascade,
  player_id uuid references public.players(id) on delete set null,
  name text not null,
  kind text not null check (kind in ('text', 'announcement', 'signal', 'poll', 'system')),
  body text not null check (char_length(body) between 1 and 1000),
  payload jsonb,
  deleted boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists messages_room_idx on public.messages (community_id, created_at desc);

create table if not exists public.poll_votes (
  message_id bigint not null references public.messages(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  option smallint not null check (option between 0 and 5),
  created_at timestamptz not null default now(),
  primary key (message_id, player_id)
);

alter table public.communities enable row level security;
alter table public.community_members enable row level security;
alter table public.messages enable row level security;
alter table public.poll_votes enable row level security;
create policy "communities are public" on public.communities for select to anon, authenticated using (true);
create policy "members are public" on public.community_members for select to anon, authenticated using (true);
create policy "messages are public" on public.messages for select to anon, authenticated using (true);
create policy "votes are public" on public.poll_votes for select to anon, authenticated using (true);

-- helpers ---------------------------------------------------------------
create or replace function public.apex_is_room_admin(p_id uuid, p_room uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.players where id = p_id and is_admin)
      or exists (select 1 from public.community_members where community_id = p_room and player_id = p_id and role = 'admin' and not banned);
$$;
revoke all on function public.apex_is_room_admin(uuid, uuid) from public, anon, authenticated;

-- Only global admins can create communities.
create or replace function public.create_community(p_id uuid, p_secret text, p_name text, p_description text default '', p_broadcast boolean default false)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare v_id uuid; v_name text;
begin
  if not public.larp_check(p_id, p_secret) then raise exception 'not your account'; end if;
  if not exists (select 1 from public.players where id = p_id and is_admin) then raise exception 'admins only'; end if;
  insert into public.communities (name, description, broadcast, created_by) values (trim(p_name), coalesce(p_description, ''), p_broadcast, p_id) returning id into v_id;
  insert into public.community_members (community_id, player_id, role) values (v_id, p_id, 'admin');
  select name into v_name from public.players where id = p_id;
  insert into public.messages (community_id, player_id, name, kind, body) values (v_id, p_id, v_name, 'system', v_name || ' created the community');
  return v_id;
end;
$$;

create or replace function public.join_community(p_id uuid, p_secret text, p_room uuid)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if not public.larp_check(p_id, p_secret) then raise exception 'not your account'; end if;
  if exists (select 1 from public.community_members where community_id = p_room and player_id = p_id and banned) then raise exception 'banned'; end if;
  insert into public.community_members (community_id, player_id) values (p_room, p_id) on conflict do nothing;
end;
$$;

create or replace function public.leave_community(p_id uuid, p_secret text, p_room uuid)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if not public.larp_check(p_id, p_secret) then raise exception 'not your account'; end if;
  delete from public.community_members where community_id = p_room and player_id = p_id and not banned;
end;
$$;

-- Admin: toggle open chat ↔ read-only broadcast.
create or replace function public.set_broadcast(p_id uuid, p_secret text, p_room uuid, p_on boolean)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_name text;
begin
  if not public.larp_check(p_id, p_secret) then raise exception 'not your account'; end if;
  if not public.apex_is_room_admin(p_id, p_room) then raise exception 'admins only'; end if;
  update public.communities set broadcast = p_on where id = p_room;
  select name into v_name from public.players where id = p_id;
  insert into public.messages (community_id, player_id, name, kind, body)
  values (p_room, p_id, v_name, 'system', case when p_on then 'Broadcast mode on: only admins can send messages' else 'Chat reopened to all members' end);
end;
$$;

create or replace function public.post_message(p_id uuid, p_secret text, p_room uuid, p_kind text, p_body text, p_payload jsonb default null)
returns bigint language plpgsql security definer set search_path = ''
as $$
declare v_name text; v_admin boolean; v_recent int; v_mid bigint; v_broadcast boolean;
begin
  if not public.larp_check(p_id, p_secret) then raise exception 'not your account'; end if;
  if not exists (select 1 from public.community_members where community_id = p_room and player_id = p_id and not banned) then raise exception 'not a member'; end if;
  v_admin := public.apex_is_room_admin(p_id, p_room);
  select broadcast into v_broadcast from public.communities where id = p_room;
  if v_broadcast and not v_admin then raise exception 'broadcast mode: only admins can post'; end if;
  if p_kind not in ('text', 'announcement', 'signal', 'poll') then raise exception 'bad kind'; end if;
  if p_kind <> 'text' and not v_admin then raise exception 'admins only'; end if;
  if p_kind = 'poll' and (jsonb_typeof(p_payload -> 'options') <> 'array' or jsonb_array_length(p_payload -> 'options') not between 2 and 6) then raise exception 'poll needs 2-6 options'; end if;
  select count(*) into v_recent from public.messages where player_id = p_id and created_at > now() - interval '10 seconds';
  if v_recent >= 6 then raise exception 'slow down'; end if;
  select name into v_name from public.players where id = p_id;
  insert into public.messages (community_id, player_id, name, kind, body, payload)
  values (p_room, p_id, v_name, p_kind, left(trim(p_body), 1000), p_payload) returning id into v_mid;
  return v_mid;
end;
$$;

create or replace function public.vote_poll(p_id uuid, p_secret text, p_message bigint, p_option smallint)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_room uuid; v_n int;
begin
  if not public.larp_check(p_id, p_secret) then raise exception 'not your account'; end if;
  select community_id, jsonb_array_length(payload -> 'options') into v_room, v_n from public.messages where id = p_message and kind = 'poll' and not deleted;
  if v_room is null then raise exception 'no such poll'; end if;
  if p_option < 0 or p_option >= v_n then raise exception 'bad option'; end if;
  if not exists (select 1 from public.community_members where community_id = v_room and player_id = p_id and not banned) then raise exception 'not a member'; end if;
  insert into public.poll_votes (message_id, player_id, option) values (p_message, p_id, p_option)
  on conflict (message_id, player_id) do update set option = excluded.option, created_at = now();
end;
$$;

-- Moderation: authors can delete their own messages; admins can delete any.
create or replace function public.delete_message(p_id uuid, p_secret text, p_message bigint)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_room uuid; v_author uuid;
begin
  if not public.larp_check(p_id, p_secret) then raise exception 'not your account'; end if;
  select community_id, player_id into v_room, v_author from public.messages where id = p_message;
  if v_room is null then return; end if;
  if v_author is distinct from p_id and not public.apex_is_room_admin(p_id, v_room) then raise exception 'admins only'; end if;
  -- wipe content (not just hide) so realtime pushes the redaction to every open client
  update public.messages set deleted = true, body = 'Message deleted', payload = null where id = p_message;
end;
$$;

create or replace function public.ban_member(p_id uuid, p_secret text, p_room uuid, p_target uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_name text;
begin
  if not public.larp_check(p_id, p_secret) then raise exception 'not your account'; end if;
  if not public.apex_is_room_admin(p_id, p_room) then raise exception 'admins only'; end if;
  if p_target = p_id then raise exception 'cannot ban yourself'; end if;
  insert into public.community_members (community_id, player_id, banned) values (p_room, p_target, true)
  on conflict (community_id, player_id) do update set banned = true, role = 'member';
  select name into v_name from public.players where id = p_target;
  insert into public.messages (community_id, player_id, name, kind, body) values (p_room, p_id, 'system', 'system', coalesce(v_name, 'A member') || ' was removed by an admin');
end;
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'create_community(uuid, text, text, text, boolean)',
    'join_community(uuid, text, uuid)',
    'leave_community(uuid, text, uuid)',
    'set_broadcast(uuid, text, uuid, boolean)',
    'post_message(uuid, text, uuid, text, text, jsonb)',
    'vote_poll(uuid, text, bigint, smallint)',
    'delete_message(uuid, text, bigint)',
    'ban_member(uuid, text, uuid, uuid)'
  ] loop
    execute format('revoke all on function public.%s from public', f);
    execute format('grant execute on function public.%s to anon, authenticated', f);
  end loop;
end $$;

alter publication supabase_realtime add table public.communities;
alter publication supabase_realtime add table public.community_members;
alter publication supabase_realtime add table public.messages;
alter publication supabase_realtime add table public.poll_votes;

-- Seed house communities (owned by the house, admins = players with is_admin).
insert into public.communities (name, description, broadcast) values
  ('Liquidated Lounge', 'Open floor for all members. Keep it civil.', false),
  ('Macro Desk', 'Pre-release briefings on CPI, FOMC and payrolls.', true),
  ('Alpha Signals', 'Desk trade ideas with entry, stop and target.', true)
on conflict do nothing;

-- To make yourself an admin after signing in once:
--   update public.players set is_admin = true where name = 'YourAlias';
