import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';
import { useSyncExternalStore } from 'react';
import { getClient, hasServer } from './supabase.ts';

export type FeedItem =
  | { kind: 'open'; key: string; name: string; sym: string; side: 1 | -1; lots: number; at: number; npc: boolean; me?: boolean }
  | { kind: 'close'; key: string; name: string; sym: string; side: 1 | -1; lots: number; profit: number; at: number; npc: boolean; me?: boolean }
  | { kind: 'chat'; key: string; name: string; text: string; at: number; npc: boolean; me?: boolean }
  | { kind: 'blown'; key: string; name: string; blownCount: number; at: number; npc: boolean; me?: boolean }
  | { kind: 'frozen'; key: string; name: string; at: number; npc: boolean; me?: boolean };

export type PublishItem =
  | { kind: 'open'; sym: string; side: 1 | -1; lots: number }
  | { kind: 'close'; sym: string; side: 1 | -1; lots: number; profit: number }
  | { kind: 'chat'; text: string };

/** Everything the server needs to know about the local player. */
export interface Snapshot {
  id: string;
  secret: string;
  name: string;
  equity: number;
  balance: number;
  rank: string;
  blownCount: number;
  totalProfit: number;
  bestTrade: number;
  wins: number;
  losses: number;
}

export interface Peer {
  id: string;
  name: string;
  rank: string;
}

export interface LeaderRow {
  id: string;
  name: string;
  balance: number;
  rank: string;
  npc: boolean;
  blownCount?: number;
  me?: boolean;
}

interface PlayerRow {
  id: string;
  name: string;
  equity: number | string;
  rank: string;
  blown_count: number;
  updated_at: string;
}

interface FloorRow {
  id: number;
  player_id: string;
  name: string;
  kind: 'open' | 'close' | 'chat' | 'blown' | 'frozen';
  sym: string | null;
  side: number | null;
  lots: number | string | null;
  profit: number | string | null;
  text: string | null;
  blown_count: number | null;
  created_at: string;
}

const BOARD_WINDOW_MS = 7 * 86400_000;
const SYNC_EVERY_MS = 10_000;

type Listener = () => void;

class Net {
  mode: 'online' | 'solo' = hasServer ? 'online' : 'solo';
  status: 'connecting' | 'live' | 'offline' = this.mode === 'online' ? 'connecting' : 'offline';
  peers: Peer[] = [];
  feed: FeedItem[] = [];
  globalBoard: LeaderRow[] = [];
  lastError: string | null = null;

  private sb: SupabaseClient | null = null;
  private ch: RealtimeChannel | null = null;
  private snap: Snapshot | null = null;
  private registered: Promise<boolean> | null = null;
  private listeners = new Set<Listener>();
  private version = 0;
  private lastChatAt = 0;
  private lastSyncAt = 0;
  private syncing = false;
  private syncQueued = false;
  private trackedKey = '';

  subscribe = (l: Listener) => {
    this.listeners.add(l);
    return () => {
      this.listeners.delete(l);
    };
  };
  getVersion = () => this.version;
  private bump() {
    this.version++;
    this.listeners.forEach((l) => l());
  }

  private insertFeed(items: FeedItem[]) {
    const keys = new Set(this.feed.map((f) => f.key));
    const fresh = items.filter((i) => !keys.has(i.key));
    if (!fresh.length) return;
    this.feed = [...fresh, ...this.feed].sort((a, b) => b.at - a.at).slice(0, 150);
    this.bump();
  }

  // ------------------------------------------------------------------ lifecycle

  start(snap: Snapshot) {
    this.snap = snap;
    if (this.mode !== 'online' || this.sb) return;
    void this.connect();
  }

  private async connect() {
    const sb = await getClient()!;
    if (this.sb || !this.snap) return;
    this.sb = sb;

    // 1) register / claim our player row before posting anything
    this.registered = this.pushSnapshot();

    // 2) realtime: presence + feed inserts + leaderboard changes
    const me = this.snap;
    const ch = sb.channel('trading-floor', { config: { presence: { key: me.id } } });
    this.ch = ch;
    ch.on('presence', { event: 'sync' }, () => {
      const state = ch.presenceState<Peer>();
      this.peers = Object.values(state)
        .map((arr) => arr[0])
        .filter(Boolean);
      this.bump();
    });
    ch.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'floor_events' }, ({ new: row }) => {
      const r = row as FloorRow;
      if (r.player_id === this.snap?.id) return; // already shown optimistically
      const item = this.fromRow(r);
      if (item) this.insertFeed([item]);
    });
    ch.on('postgres_changes', { event: '*', schema: 'public', table: 'players' }, ({ new: row }) => {
      const r = row as PlayerRow;
      if (r?.id) this.upsertBoard([r]);
    });
    ch.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        this.status = 'live';
        this.trackedKey = '';
        this.trackMe();
        void this.loadInitial();
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        this.status = 'offline'; // supabase-js keeps retrying; flips back on SUBSCRIBED
      }
      this.bump();
    });
  }

  private async loadInitial() {
    if (!this.sb) return;
    const since = new Date(Date.now() - 2 * 3600_000).toISOString();
    const [feed] = await Promise.all([
      this.sb.from('floor_events').select('*').gte('created_at', since).order('created_at', { ascending: false }).limit(60),
      this.refreshBoard(),
    ]);
    if (feed.data) this.insertFeed((feed.data as FloorRow[]).map((r) => this.fromRow(r)).filter((x): x is FeedItem => !!x));
  }

  async refreshBoard() {
    if (!this.sb) return;
    const since = new Date(Date.now() - BOARD_WINDOW_MS).toISOString();
    const { data, error } = await this.sb
      .from('players')
      .select('id,name,equity,rank,blown_count,updated_at')
      .gte('updated_at', since)
      .order('equity', { ascending: false })
      .limit(100);
    if (error) {
      this.lastError = error.message;
      return;
    }
    this.globalBoard = [];
    this.upsertBoard((data ?? []) as PlayerRow[]);
  }

  private upsertBoard(rows: PlayerRow[]) {
    const map = new Map(this.globalBoard.map((r) => [r.id, r]));
    const cutoff = Date.now() - BOARD_WINDOW_MS;
    for (const r of rows) {
      if (new Date(r.updated_at).getTime() < cutoff) continue;
      map.set(r.id, { id: r.id, name: r.name, balance: Number(r.equity), rank: r.rank, blownCount: r.blown_count, npc: false });
    }
    this.globalBoard = [...map.values()].sort((a, b) => b.balance - a.balance).slice(0, 100);
    this.bump();
  }

  private fromRow(r: FloorRow): FeedItem | null {
    const base = { key: `db-${r.id}`, name: r.name, at: new Date(r.created_at).getTime() / 1000, npc: false, me: r.player_id === this.snap?.id };
    const side = (r.side === -1 ? -1 : 1) as 1 | -1;
    switch (r.kind) {
      case 'open':
        return r.sym ? { ...base, kind: 'open', sym: r.sym, side, lots: Number(r.lots) } : null;
      case 'close':
        return r.sym ? { ...base, kind: 'close', sym: r.sym, side, lots: Number(r.lots), profit: Number(r.profit) } : null;
      case 'chat':
        return r.text ? { ...base, kind: 'chat', text: r.text } : null;
      case 'blown':
        return { ...base, kind: 'blown', blownCount: r.blown_count ?? 1 };
      case 'frozen':
        return { ...base, kind: 'frozen' };
    }
  }

  private trackMe() {
    if (!this.ch || this.status !== 'live' || !this.snap) return;
    const peer: Peer = { id: this.snap.id, name: this.snap.name, rank: this.snap.rank };
    const key = `${peer.name}|${peer.rank}`;
    if (key === this.trackedKey) return;
    this.trackedKey = key;
    void this.ch.track(peer);
  }

  // ------------------------------------------------------------------ sync

  /** Update the local snapshot; pushes to the server at most every 10s unless forced. */
  update(snap: Snapshot, force = false) {
    this.snap = snap;
    this.onSnapshot?.(snap);
    this.trackMe();
    if (!this.sb) return;
    if (force || Date.now() - this.lastSyncAt > SYNC_EVERY_MS) void this.pushSnapshot();
  }

  private async pushSnapshot(): Promise<boolean> {
    if (!this.sb || !this.snap) return false;
    if (this.syncing) {
      this.syncQueued = true;
      return true;
    }
    this.syncing = true;
    this.lastSyncAt = Date.now();
    const s = this.snap;
    const r2 = (v: number) => Math.round(v * 100) / 100;
    const { error } = await this.sb.rpc('upsert_player', {
      p_id: s.id,
      p_secret: s.secret,
      p_name: s.name,
      p_equity: r2(s.equity),
      p_balance: r2(s.balance),
      p_rank: s.rank,
      p_blown_count: s.blownCount,
      p_total_profit: r2(s.totalProfit),
      p_best_trade: r2(s.bestTrade),
      p_wins: s.wins,
      p_losses: s.losses,
    });
    this.syncing = false;
    if (error) {
      this.lastError = error.message;
      this.bump();
    }
    if (this.syncQueued) {
      this.syncQueued = false;
      void this.pushSnapshot();
    }
    return !error;
  }

  /** Shared Supabase client (null in solo mode / before connect). */
  async client(): Promise<SupabaseClient | null> {
    if (this.mode !== 'online') return null;
    for (let i = 0; i < 50 && !this.sb; i++) await new Promise((r) => setTimeout(r, 100));
    return this.sb;
  }

  /** Resolves once our player row is registered server-side. */
  async ready(): Promise<boolean> {
    return (await this.registered) ?? false;
  }

  /** Server-stamped 5h review lock. Returns the lock expiry (unix sec) or null offline. */
  async lockAccount(): Promise<number | null> {
    if (!this.sb || !this.snap) return null;
    await this.registered;
    const { data, error } = await this.sb.rpc('lock_account', { p_id: this.snap.id, p_secret: this.snap.secret });
    if (error || !data) return null;
    return new Date(data as string).getTime() / 1000;
  }

  /** New €100 credit line after review. Returns the new blown count (or null offline). */
  async resetAccount(): Promise<number | null> {
    if (!this.sb || !this.snap) return null;
    await this.registered;
    const { data, error } = await this.sb.rpc('reset_account', { p_id: this.snap.id, p_secret: this.snap.secret });
    if (error) {
      this.lastError = error.message;
      return null;
    }
    return typeof data === 'number' ? data : null;
  }

  // ------------------------------------------------------------------ publish

  /** Local player action → feed instantly (optimistic) + persisted & streamed via RPC. */
  publish(item: PublishItem) {
    if (!this.snap) return;
    const base = { key: `me-${Date.now()}-${Math.random().toString(36).slice(2)}`, name: this.snap.name, at: Date.now() / 1000, npc: false, me: true };
    this.insertFeed([{ ...base, ...item } as FeedItem]);
    if (!this.sb) return;
    const s = this.snap;
    const sb = this.sb;
    void (async () => {
      await this.registered;
      const { error } = await sb.rpc('post_floor_event', {
        p_id: s.id,
        p_secret: s.secret,
        p_kind: item.kind,
        p_sym: item.kind === 'chat' ? null : item.sym,
        p_side: item.kind === 'chat' ? null : item.side,
        p_lots: item.kind === 'chat' ? null : item.lots,
        p_profit: item.kind === 'close' ? Math.round(item.profit * 100) / 100 : null,
        p_text: item.kind === 'chat' ? item.text : null,
      });
      if (error) {
        this.lastError = error.message;
        this.bump();
      }
    })();
  }

  /** Show our own blow-up locally (the server posts the public one in reset_account). */
  publishBlown(blownCount: number) {
    if (!this.snap) return;
    this.insertFeed([{ kind: 'blown', key: `me-blown-${Date.now()}`, name: this.snap.name, blownCount, at: Date.now() / 1000, npc: false, me: true }]);
  }

  chat(text: string): boolean {
    const t = Date.now();
    if (t - this.lastChatAt < 2500) return false;
    this.lastChatAt = t;
    this.publish({ kind: 'chat', text });
    return true;
  }

  // ------------------------------------------------------------------ views

  /** Live players from the artifact's shared database (claude.ai build). */
  setExternalBoard(rows: LeaderRow[]) {
    this.globalBoard = rows;
    this.bump();
  }
  /** Called with every local snapshot (the artifact build mirrors it to the shared board). */
  onSnapshot: ((s: Snapshot) => void) | null = null;

  leaderboard(me: LeaderRow): LeaderRow[] {
    const humans = this.globalBoard.filter((r) => r.id !== me.id);
    return [...humans, { ...me, me: true }].sort((a, b) => b.balance - a.balance);
  }

  onlineCount(): number {
    return this.status === 'live' ? Math.max(1, this.peers.length) : 1;
  }
}

export const net = new Net();

export function useNet() {
  useSyncExternalStore(net.subscribe, net.getVersion);
  return net;
}
