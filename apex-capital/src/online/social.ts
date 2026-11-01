import type { SupabaseClient } from '@supabase/supabase-js';
import { useSyncExternalStore } from 'react';
import { rand, strSeed } from '../market/rng.ts';
import { getItem, setItem } from '../storage.ts';
import { divisionFor } from '../game/tiers.ts';
import { comms } from './comms.ts';
import { net } from './net.ts';
import { NPC_NAMES, npcBalance } from './npc.ts';

// ---------------------------------------------------------------------------
// Friends, player profiles and private direct messages.
// Online: Supabase. Friendships and DMs are NOT publicly readable; they only
// come back through secret-checked RPCs. Desk traders (NPCs) are simulated on
// the device, so they work in both modes and always reply.
// ---------------------------------------------------------------------------

export interface PlayerCard {
  id: string;
  name: string;
  avatar?: string;
  balance: number;
  totalProfit: number;
  bestTrade: number;
  wins: number;
  losses: number;
  blownCount: number;
  npc: boolean;
  lastSeen?: number;
}

export type FriendStatus = 'friends' | 'outgoing' | 'incoming';
export interface FriendRow {
  id: string;
  status: FriendStatus;
  since: number;
}

export interface Dm {
  id: string;
  from: string;
  to: string;
  body: string;
  at: number;
}

export interface SocialMe {
  id: string;
  secret: string;
  name: string;
}

const LOCAL_KEY = 'apex.social.v1';
interface LocalSocial {
  friends: FriendRow[];
  dms: Dm[];
  lastRead: Record<string, number>;
  seeded?: boolean;
}

const isNpc = (id: string) => id.startsWith('npc-');
const npcName = (id: string) => id.slice(4);

export function npcCard(name: string, t = Date.now() / 1000): PlayerCard {
  const s = strSeed(name);
  const balance = npcBalance(name, t);
  const trades = 40 + Math.floor(rand(s, 2) * 900);
  const wr = 0.38 + rand(s, 3) * 0.3;
  return {
    id: `npc-${name}`,
    name,
    avatar: `p:${s % 12}`,
    balance,
    totalProfit: balance - 100 * (1 + Math.floor(rand(s, 4) * 4)),
    bestTrade: balance * (0.04 + rand(s, 5) * 0.2),
    wins: Math.round(trades * wr),
    losses: Math.round(trades * (1 - wr)),
    blownCount: Math.floor(rand(s, 6) ** 2 * 6),
    npc: true,
    lastSeen: t - Math.floor(rand(s, Math.floor(t / 600)) * 3600),
  };
}

const NPC_REPLIES: [RegExp, string[]][] = [
  [/gold|xau/i, ['Gold is respecting the London range. I’m waiting for a sweep of the lows.', 'XAU looks heavy into the close, I’m flat.', 'Bought the dip on gold, stop under the session low.']],
  [/eur|fx|forex|usd|gbp|jpy/i, ['Fiber is chopping. Not touching it before the data.', 'Cable spread blew out on that headline, careful with size.', 'USDJPY: watch for MoF intervention chatter above 152.']],
  [/nas|nvda|tsla|aapl|tech|stock/i, ['Tech tape is all flow today. Scalping only.', 'NAS100 broke the morning high, trailing my stop.', 'I fade those block prints, they mean-revert in 10 minutes.']],
  [/hi|hello|hey|yo|sup/i, ['Hey! How’s the P&L today?', 'Yo. Green day so far?', 'Hey, good to see you on the desk.']],
  [/loss|lost|blown|liquidat|stop/i, ['Happens to all of us. Smaller size, wider stop, fewer trades.', 'Take a break after a stop-out. Revenge trades are the expensive ones.']],
  [/profit|win|green|tp/i, ['Nice one. Bank it and don’t give it back.', 'That’s the way. What was the setup?']],
];
function npcReply(text: string, seed: number): string {
  for (const [re, lines] of NPC_REPLIES) if (re.test(text)) return lines[seed % lines.length];
  const generic = ['Interesting. What timeframe are you trading?', 'I’m watching the macro calendar before sizing up.', 'Agreed. Risk first, then reward.', 'Send me your chart, I’ll take a look.'];
  return generic[seed % generic.length];
}

type Listener = () => void;

class Social {
  mode: 'local' | 'online' = 'local';
  me: SocialMe | null = null;
  friends: FriendRow[] = [];
  dms: Dm[] = [];
  private cards = new Map<string, PlayerCard>();
  private local: LocalSocial = this.readLocal();
  private sb: SupabaseClient | null = null;
  private listeners = new Set<Listener>();
  private version = 0;
  private serverFriends: FriendRow[] = [];
  private serverDms: Dm[] = [];
  private lastDmAt = '1970-01-01T00:00:00Z';
  private timers: number[] = [];

  subscribe = (l: Listener) => {
    this.listeners.add(l);
    return () => {
      this.listeners.delete(l);
    };
  };
  getVersion = () => this.version;
  private bump() {
    this.merge();
    this.version++;
    this.listeners.forEach((l) => l());
  }

  private readLocal(): LocalSocial {
    try {
      const raw = getItem(LOCAL_KEY);
      if (raw) return JSON.parse(raw) as LocalSocial;
    } catch {
      /* reseed */
    }
    return { friends: [], dms: [], lastRead: {} };
  }
  private saveLocal() {
    setItem(LOCAL_KEY, JSON.stringify(this.local));
  }
  private merge() {
    const byId = new Map<string, FriendRow>();
    for (const f of [...this.serverFriends, ...this.local.friends]) byId.set(f.id, f);
    this.friends = [...byId.values()];
    this.dms = [...this.serverDms, ...this.local.dms].sort((a, b) => a.at - b.at);
  }

  async start(me: SocialMe) {
    if (this.me) return;
    this.me = me;
    if (!this.local.seeded) {
      // one desk trader already wants to connect, so the requests flow is discoverable
      const now = Date.now() / 1000;
      this.local.friends.push({ id: 'npc-K.Tanaka', status: 'incoming', since: now - 3600 });
      this.local.dms.push({ id: 'seed1', from: 'npc-K.Tanaka', to: me.id, body: 'Welcome to the desk. Add me if you want to swap setups.', at: now - 3500 });
      this.local.seeded = true;
      this.saveLocal();
    }
    this.bump();
    const sb = await net.client();
    if (!sb) return;
    const probe = await sb.rpc('my_friends', { p_id: me.id, p_secret: me.secret });
    if (probe.error) return; // social migration not applied yet: stay local-only
    this.sb = sb;
    this.mode = 'online';
    this.applyFriends(probe.data);
    await this.pollDms();
    this.timers.push(window.setInterval(() => void this.pollDms(), 4000));
    this.timers.push(window.setInterval(() => void this.pollFriends(), 15000));
  }

  private applyFriends(data: unknown) {
    const rows = (data ?? []) as { peer: string; status: string; outgoing: boolean; since: string }[];
    this.serverFriends = rows.map((r) => ({ id: r.peer, status: r.status === 'accepted' ? 'friends' : r.outgoing ? 'outgoing' : 'incoming', since: new Date(r.since).getTime() / 1000 }));
    void this.fetchCards(this.serverFriends.map((f) => f.id));
    this.bump();
  }
  private async pollFriends() {
    if (!this.sb || !this.me) return;
    const { data, error } = await this.sb.rpc('my_friends', { p_id: this.me.id, p_secret: this.me.secret });
    if (!error) this.applyFriends(data);
  }
  private async pollDms() {
    if (!this.sb || !this.me || document.visibilityState === 'hidden') return;
    const { data, error } = await this.sb.rpc('get_dms', { p_id: this.me.id, p_secret: this.me.secret, p_since: this.lastDmAt });
    if (error || !data) return;
    const rows = data as { id: number; sender: string; recipient: string; body: string; created_at: string }[];
    if (!rows.length) return;
    const known = new Set(this.serverDms.map((d) => d.id));
    for (const r of rows) {
      const id = `s${r.id}`;
      if (!known.has(id)) this.serverDms.push({ id, from: r.sender, to: r.recipient, body: r.body, at: new Date(r.created_at).getTime() / 1000 });
      if (r.created_at > this.lastDmAt) this.lastDmAt = r.created_at;
    }
    void this.fetchCards(rows.map((r) => (r.sender === this.me!.id ? r.recipient : r.sender)));
    this.bump();
  }

  // ---------------------------------------------------------------- profiles
  private rowToCard(r: Record<string, unknown>): PlayerCard {
    return {
      id: String(r.id),
      name: String(r.name),
      avatar: (r.avatar as string) || undefined,
      balance: Number(r.balance ?? r.equity ?? 0),
      totalProfit: Number(r.total_profit ?? 0),
      bestTrade: Number(r.best_trade ?? 0),
      wins: Number(r.wins ?? 0),
      losses: Number(r.losses ?? 0),
      blownCount: Number(r.blown_count ?? 0),
      npc: false,
      lastSeen: r.updated_at ? new Date(String(r.updated_at)).getTime() / 1000 : undefined,
    };
  }
  private async fetchCards(ids: string[]) {
    const need = [...new Set(ids)].filter((id) => !isNpc(id) && !this.cards.has(id));
    if (!need.length || !this.sb) return;
    const { data } = await this.sb.from('players').select('*').in('id', need);
    for (const r of (data ?? []) as Record<string, unknown>[]) this.cards.set(String(r.id), this.rowToCard(r));
    this.bump();
  }

  /** Best-known card for any player id (NPCs computed live). */
  card(id: string): PlayerCard | null {
    if (isNpc(id)) return npcCard(npcName(id));
    const hit = this.cards.get(id);
    if (hit) return hit;
    const b = net.globalBoard.find((r) => r.id === id);
    if (b) return { id, name: b.name, balance: b.balance, totalProfit: 0, bestTrade: 0, wins: 0, losses: 0, blownCount: b.blownCount ?? 0, npc: false };
    void this.fetchCards([id]);
    return null;
  }
  remember(c: PlayerCard) {
    this.cards.set(c.id, c);
  }

  async search(q: string): Promise<PlayerCard[]> {
    const term = q.trim();
    if (term.length < 2) return [];
    const lower = term.toLowerCase();
    const npcs = NPC_NAMES.filter((n) => n.toLowerCase().includes(lower)).map((n) => npcCard(n));
    const client = await net.client();
    if (!client) return npcs;
    const { data } = await client.from('players').select('*').ilike('name', `%${term.replace(/[%_]/g, '')}%`).order('updated_at', { ascending: false }).limit(25);
    const humans = ((data ?? []) as Record<string, unknown>[]).map((r) => this.rowToCard(r)).filter((c) => c.id !== this.me?.id);
    humans.forEach((c) => this.cards.set(c.id, c));
    return [...humans, ...npcs];
  }

  /** Communities a player belongs to. */
  groupsOf(id: string): string[] {
    const own = comms.members.filter((m) => m.playerId === id && !m.banned).map((m) => m.communityId);
    if (own.length || !isNpc(id)) return own;
    const s = strSeed(id);
    return comms.communities.filter((_, i) => (s >> i) & 1 || i === s % Math.max(1, comms.communities.length)).map((c) => c.id);
  }

  // ---------------------------------------------------------------- friends
  status(id: string): FriendStatus | null {
    return this.friends.find((f) => f.id === id)?.status ?? null;
  }
  private async rpc(fn: string, args: Record<string, unknown>): Promise<string | null> {
    if (!this.sb || !this.me) return 'Server unavailable.';
    await net.ready();
    const { error } = await this.sb.rpc(fn, { p_id: this.me.id, p_secret: this.me.secret, ...args });
    return error ? (/not friends/i.test(error.message) ? 'You can only message friends.' : /slow down/i.test(error.message) ? 'Slow down a little.' : error.message) : null;
  }
  async request(id: string): Promise<string | null> {
    if (id === this.me?.id) return 'That’s you.';
    if (isNpc(id)) {
      const incoming = this.status(id) === 'incoming';
      this.local.friends = [...this.local.friends.filter((f) => f.id !== id), { id, status: incoming ? 'friends' : 'outgoing', since: Date.now() / 1000 }];
      this.saveLocal();
      this.bump();
      if (!incoming)
        window.setTimeout(() => {
          this.local.friends = this.local.friends.map((f) => (f.id === id ? { ...f, status: 'friends' } : f));
          this.saveLocal();
          this.bump();
        }, 1500 + (strSeed(id) % 2000));
      return null;
    }
    const err = await this.rpc('request_friend', { p_peer: id });
    if (!err) await this.pollFriends();
    return err;
  }
  async respond(id: string, accept: boolean): Promise<string | null> {
    if (isNpc(id)) {
      this.local.friends = accept ? this.local.friends.map((f) => (f.id === id ? { ...f, status: 'friends' as const } : f)) : this.local.friends.filter((f) => f.id !== id);
      this.saveLocal();
      this.bump();
      return null;
    }
    const err = await this.rpc('respond_friend', { p_peer: id, p_accept: accept });
    if (!err) await this.pollFriends();
    return err;
  }
  async remove(id: string): Promise<string | null> {
    if (isNpc(id)) {
      this.local.friends = this.local.friends.filter((f) => f.id !== id);
      this.saveLocal();
      this.bump();
      return null;
    }
    const err = await this.rpc('remove_friend', { p_peer: id });
    if (!err) await this.pollFriends();
    return err;
  }

  // ---------------------------------------------------------------- DMs
  thread(peer: string): Dm[] {
    return this.dms.filter((d) => d.from === peer || d.to === peer);
  }
  threads(): { peer: string; last: Dm; unread: number }[] {
    const me = this.me?.id;
    const map = new Map<string, Dm>();
    for (const d of this.dms) map.set(d.from === me ? d.to : d.from, d);
    return [...map.entries()].map(([peer, last]) => ({ peer, last, unread: this.unread(peer) })).sort((a, b) => b.last.at - a.last.at);
  }
  unread(peer: string): number {
    const since = this.local.lastRead[peer] ?? 0;
    return this.dms.filter((d) => d.from === peer && d.at > since).length;
  }
  totalUnread(): number {
    return this.threads().reduce((s, x) => s + x.unread, 0) + this.friends.filter((f) => f.status === 'incoming').length;
  }
  markRead(peer: string) {
    const last = this.thread(peer).at(-1);
    if (!last || (this.local.lastRead[peer] ?? 0) >= last.at) return;
    this.local.lastRead[peer] = last.at;
    this.saveLocal();
    this.bump();
  }
  async send(peer: string, body: string): Promise<string | null> {
    const text = body.trim().slice(0, 1000);
    if (!text || !this.me) return 'Message is empty.';
    if (this.status(peer) !== 'friends') return 'You can only message friends. Send a friend request first.';
    if (isNpc(peer)) {
      const now = Date.now() / 1000;
      this.local.dms.push({ id: `l${now}${Math.random()}`, from: this.me.id, to: peer, body: text, at: now });
      this.saveLocal();
      this.bump();
      const seed = strSeed(text + peer);
      window.setTimeout(() => {
        this.local.dms.push({ id: `l${Date.now()}`, from: peer, to: this.me!.id, body: npcReply(text, seed), at: Date.now() / 1000 });
        this.saveLocal();
        this.bump();
      }, 1800 + (seed % 3500));
      return null;
    }
    const err = await this.rpc('send_dm', { p_to: peer, p_body: text });
    if (!err) await this.pollDms();
    return err;
  }

  async setAvatar(avatar: string | undefined) {
    if (this.sb && this.me) await this.rpc('set_avatar', { p_avatar: avatar ?? null });
  }
}

export const social = new Social();

export function useSocial() {
  useSyncExternalStore(social.subscribe, social.getVersion);
  return social;
}

export function rankLabel(balance: number): string {
  return divisionFor(balance).label;
}
