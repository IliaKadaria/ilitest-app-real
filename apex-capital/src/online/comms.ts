import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';
import { useSyncExternalStore } from 'react';
import { getItem, setItem } from '../storage.ts';
import { net } from './net.ts';

// ---------------------------------------------------------------------------
// Communities: admin-created groups, WhatsApp-style chat, broadcast mode,
// polls, trade signals, moderation. Two interchangeable backends:
//   - SupabaseBackend: the real thing (RPCs enforce every rule server-side)
//   - LocalBackend: offline demo (same rules enforced client-side, persisted
//     locally, synced across tabs). Used only when the server is unreachable
//     or not set up, and labelled as such in the UI.
// ---------------------------------------------------------------------------

export type MsgKind = 'text' | 'announcement' | 'signal' | 'poll' | 'system';

export interface SignalPayload {
  sym: string;
  side: 1 | -1;
  entry: number;
  sl: number;
  tp: number;
}
export interface PollPayload {
  options: string[];
}

export interface Community {
  id: string;
  name: string;
  description: string;
  broadcast: boolean;
  createdAt: number;
}

export interface Member {
  communityId: string;
  playerId: string;
  role: 'admin' | 'member';
  banned: boolean;
}

export interface Msg {
  id: string;
  communityId: string;
  playerId: string | null;
  name: string;
  kind: MsgKind;
  body: string;
  payload: SignalPayload | PollPayload | null;
  deleted: boolean;
  createdAt: number;
}

export interface Vote {
  messageId: string;
  playerId: string;
  option: number;
}

export interface Me {
  id: string;
  secret: string;
  name: string;
}

interface Backend {
  readonly kind: 'online' | 'local';
  load(): Promise<{ communities: Community[]; members: Member[]; messages: Msg[]; votes: Vote[]; isAdmin: boolean }>;
  loadRoom(cid: string): Promise<{ messages: Msg[]; votes: Vote[] }>;
  create(name: string, description: string, broadcast: boolean): Promise<void>;
  join(cid: string): Promise<void>;
  leave(cid: string): Promise<void>;
  setBroadcast(cid: string, on: boolean): Promise<void>;
  post(cid: string, kind: MsgKind, body: string, payload: SignalPayload | PollPayload | null): Promise<void>;
  vote(mid: string, option: number): Promise<void>;
  remove(mid: string): Promise<void>;
  ban(cid: string, playerId: string): Promise<void>;
  onChange(cb: (what: 'all' | { room: string }) => void): void;
}

class RuleError extends Error {}

// ============================================================ local backend

const LOCAL_KEY = 'apex.comms.v1';
const AUTH_KEY = 'apex.auth.v1';
const HOUSE = 'house';

interface LocalDb {
  communities: Community[];
  members: Member[];
  messages: Msg[];
  votes: Vote[];
  seq: number;
}

function seedDb(): LocalDb {
  const now = Date.now() / 1000;
  const c = (id: string, name: string, description: string, broadcast: boolean): Community => ({ id, name, description, broadcast, createdAt: now });
  const sys = (id: string, communityId: string, body: string): Msg => ({ id, communityId, playerId: HOUSE, name: 'Liquidated', kind: 'system', body, payload: null, deleted: false, createdAt: now });
  // Real players only: rooms start empty and fill up with whoever joins.
  return {
    seq: 100,
    communities: [
      c('lounge', 'Liquidated Lounge', 'Open floor for all members. Keep it civil.', false),
      c('macro', 'Macro Desk', 'Briefings on CPI, FOMC and payrolls from the admins.', true),
      c('alpha', 'Alpha Signals', 'Admin trade ideas with entry, stop and target.', true),
    ],
    members: ['lounge', 'macro', 'alpha'].map((communityId) => ({ communityId, playerId: HOUSE, role: 'admin' as const, banned: false })),
    messages: [sys('s1', 'lounge', 'Community created'), sys('s2', 'macro', 'Broadcast mode on: only admins can send messages'), sys('s3', 'alpha', 'Broadcast mode on: only admins can send messages')],
    votes: [],
  };
}

/** Older builds seeded simulated traders and sample posts: remove them from saved data. */
const SAMPLE_IDS = new Set(['l1', 'l2', 'l3', 'a1', 'p1', 'g1']);
function purgeSamples(db: LocalDb): boolean {
  const before = db.members.length + db.messages.length + db.votes.length;
  db.members = db.members.filter((m) => !m.playerId.startsWith('npc-'));
  db.messages = db.messages.filter((m) => !SAMPLE_IDS.has(m.id) && !(m.playerId ?? '').startsWith('npc-'));
  db.votes = db.votes.filter((v) => !SAMPLE_IDS.has(v.messageId) && !v.playerId.startsWith('npc-'));
  return db.members.length + db.messages.length + db.votes.length !== before;
}

class LocalBackend implements Backend {
  readonly kind = 'local' as const;
  private bc: BroadcastChannel | null = null;
  private cb: ((w: 'all' | { room: string }) => void) | null = null;
  constructor(private me: Me) {
    try {
      this.bc = new BroadcastChannel('apex-comms');
      this.bc.onmessage = () => this.cb?.('all');
    } catch {
      /* not supported */
    }
  }
  private read(): LocalDb {
    try {
      const raw = getItem(LOCAL_KEY);
      if (raw) {
        const db = JSON.parse(raw) as LocalDb;
        if (purgeSamples(db)) setItem(LOCAL_KEY, JSON.stringify(db));
        return db;
      }
    } catch {
      /* corrupt → reseed */
    }
    const db = seedDb();
    setItem(LOCAL_KEY, JSON.stringify(db));
    return db;
  }
  private write(db: LocalDb) {
    setItem(LOCAL_KEY, JSON.stringify(db));
    this.bc?.postMessage('changed');
    this.cb?.('all');
  }
  private isAdmin() {
    // Offline there is no server to ask: only an account the server verified as
    // admin earlier (cached by auth) may run communities. No self-serve toggle.
    try {
      return !!(JSON.parse(getItem(AUTH_KEY) || 'null') as { isAdmin?: boolean } | null)?.isAdmin;
    } catch {
      return false;
    }
  }
  private roomAdmin(db: LocalDb, cid: string) {
    return this.isAdmin() || db.members.some((m) => m.communityId === cid && m.playerId === this.me.id && m.role === 'admin' && !m.banned);
  }
  private member(db: LocalDb, cid: string) {
    return db.members.find((m) => m.communityId === cid && m.playerId === this.me.id);
  }
  private sys(db: LocalDb, cid: string, body: string) {
    db.messages.push({ id: `m${++db.seq}`, communityId: cid, playerId: this.me.id, name: 'system', kind: 'system', body, payload: null, deleted: false, createdAt: Date.now() / 1000 });
  }
  onChange(cb: (w: 'all' | { room: string }) => void) {
    this.cb = cb;
  }
  async load() {
    const db = this.read();
    return { ...db, isAdmin: this.isAdmin() };
  }
  async loadRoom(cid: string) {
    const db = this.read();
    const messages = db.messages.filter((m) => m.communityId === cid);
    const ids = new Set(messages.map((m) => m.id));
    return { messages, votes: db.votes.filter((v) => ids.has(v.messageId)) };
  }
  async create(name: string, description: string, broadcast: boolean) {
    if (!this.isAdmin()) throw new RuleError('Only admins can create communities.');
    const db = this.read();
    const id = `c${++db.seq}`;
    db.communities.push({ id, name: name.trim(), description: description.trim(), broadcast, createdAt: Date.now() / 1000 });
    db.members.push({ communityId: id, playerId: this.me.id, role: 'admin', banned: false });
    this.sys(db, id, `${this.me.name} created the community`);
    this.write(db);
  }
  async join(cid: string) {
    const db = this.read();
    const m = this.member(db, cid);
    if (m?.banned) throw new RuleError('You were removed from this community.');
    if (!m) db.members.push({ communityId: cid, playerId: this.me.id, role: 'member', banned: false });
    this.write(db);
  }
  async leave(cid: string) {
    const db = this.read();
    db.members = db.members.filter((m) => !(m.communityId === cid && m.playerId === this.me.id && !m.banned));
    this.write(db);
  }
  async setBroadcast(cid: string, on: boolean) {
    const db = this.read();
    if (!this.roomAdmin(db, cid)) throw new RuleError('Only admins can change broadcast mode.');
    const c = db.communities.find((x) => x.id === cid);
    if (c) c.broadcast = on;
    this.sys(db, cid, on ? 'Broadcast mode on: only admins can send messages' : 'Chat reopened to all members');
    this.write(db);
  }
  async post(cid: string, kind: MsgKind, body: string, payload: Msg['payload']) {
    const db = this.read();
    const m = this.member(db, cid);
    const admin = this.roomAdmin(db, cid);
    if (!admin && (!m || m.banned)) throw new RuleError('Join the community to post.');
    const c = db.communities.find((x) => x.id === cid);
    if (c?.broadcast && !admin) throw new RuleError('Broadcast mode: only admins can post.');
    if (kind !== 'text' && !admin) throw new RuleError('Only admins can post this.');
    db.messages.push({ id: `m${++db.seq}`, communityId: cid, playerId: this.me.id, name: this.me.name, kind, body: body.trim().slice(0, 1000), payload, deleted: false, createdAt: Date.now() / 1000 });
    this.write(db);
  }
  async vote(mid: string, option: number) {
    const db = this.read();
    const msg = db.messages.find((x) => x.id === mid && x.kind === 'poll' && !x.deleted);
    if (!msg) throw new RuleError('Poll not found.');
    if (!this.member(db, msg.communityId) && !this.roomAdmin(db, msg.communityId)) throw new RuleError('Join the community to vote.');
    db.votes = db.votes.filter((v) => !(v.messageId === mid && v.playerId === this.me.id));
    db.votes.push({ messageId: mid, playerId: this.me.id, option });
    this.write(db);
  }
  async remove(mid: string) {
    const db = this.read();
    const msg = db.messages.find((x) => x.id === mid);
    if (!msg) return;
    if (msg.playerId !== this.me.id && !this.roomAdmin(db, msg.communityId)) throw new RuleError('Only admins can delete messages.');
    Object.assign(msg, { deleted: true, body: 'Message deleted', payload: null });
    this.write(db);
  }
  async ban(cid: string, playerId: string) {
    const db = this.read();
    if (!this.roomAdmin(db, cid)) throw new RuleError('Only admins can remove members.');
    if (playerId === this.me.id) throw new RuleError('You cannot remove yourself.');
    const m = db.members.find((x) => x.communityId === cid && x.playerId === playerId);
    if (m) Object.assign(m, { banned: true, role: 'member' });
    else db.members.push({ communityId: cid, playerId, role: 'member', banned: true });
    const name = db.messages.find((x) => x.playerId === playerId)?.name ?? 'A member';
    this.sys(db, cid, `${name} was removed by an admin`);
    this.write(db);
  }
}

// ============================================================ supabase backend

interface MsgRow {
  id: number;
  community_id: string;
  player_id: string | null;
  name: string;
  kind: MsgKind;
  body: string;
  payload: Msg['payload'];
  deleted: boolean;
  created_at: string;
}
const toMsg = (r: MsgRow): Msg => ({ id: String(r.id), communityId: r.community_id, playerId: r.player_id, name: r.name, kind: r.kind, body: r.body, payload: r.payload, deleted: r.deleted, createdAt: new Date(r.created_at).getTime() / 1000 });

class SupabaseBackend implements Backend {
  readonly kind = 'online' as const;
  private cb: ((w: 'all' | { room: string }) => void) | null = null;
  private ch: RealtimeChannel | null = null;
  constructor(private sb: SupabaseClient, private me: Me) {}

  private async rpc(fn: string, args: Record<string, unknown>) {
    await net.ready();
    const { error } = await this.sb.rpc(fn, { p_id: this.me.id, p_secret: this.me.secret, ...args });
    if (error) throw new RuleError(humanize(error.message));
  }
  onChange(cb: (w: 'all' | { room: string }) => void) {
    this.cb = cb;
    if (this.ch) return;
    const ch = this.sb.channel('apex-comms');
    const room = (row: unknown) => (row as { community_id?: string })?.community_id;
    ch.on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, (p) => {
      const cid = room(p.new) ?? room(p.old);
      this.cb?.(cid ? { room: cid } : 'all');
    });
    ch.on('postgres_changes', { event: '*', schema: 'public', table: 'poll_votes' }, () => this.cb?.('all'));
    ch.on('postgres_changes', { event: '*', schema: 'public', table: 'communities' }, () => this.cb?.('all'));
    ch.on('postgres_changes', { event: '*', schema: 'public', table: 'community_members' }, () => this.cb?.('all'));
    ch.subscribe();
    this.ch = ch;
  }
  async load() {
    const [c, m, msgs, me] = await Promise.all([
      this.sb.from('communities').select('*').order('created_at'),
      this.sb.from('community_members').select('community_id,player_id,role,banned'),
      this.sb.from('messages').select('*').order('created_at', { ascending: false }).limit(300),
      this.sb.from('players').select('is_admin').eq('id', this.me.id).maybeSingle(),
    ]);
    if (c.error) throw new Error(c.error.message);
    const messages = ((msgs.data ?? []) as MsgRow[]).map(toMsg).reverse();
    const pollIds = messages.filter((x) => x.kind === 'poll').map((x) => Number(x.id));
    const votes = pollIds.length ? await this.sb.from('poll_votes').select('message_id,player_id,option').in('message_id', pollIds) : { data: [] };
    return {
      communities: (c.data ?? []).map((r) => ({ id: r.id, name: r.name, description: r.description, broadcast: r.broadcast, createdAt: new Date(r.created_at).getTime() / 1000 })),
      members: (m.data ?? []).map((r) => ({ communityId: r.community_id, playerId: r.player_id, role: r.role, banned: r.banned })),
      messages,
      votes: ((votes.data ?? []) as { message_id: number; player_id: string; option: number }[]).map((v) => ({ messageId: String(v.message_id), playerId: v.player_id, option: v.option })),
      isAdmin: !!me.data?.is_admin,
    };
  }
  async loadRoom(cid: string) {
    const { data } = await this.sb.from('messages').select('*').eq('community_id', cid).order('created_at', { ascending: false }).limit(150);
    const messages = ((data ?? []) as MsgRow[]).map(toMsg).reverse();
    const pollIds = messages.filter((x) => x.kind === 'poll').map((x) => Number(x.id));
    const v = pollIds.length ? await this.sb.from('poll_votes').select('message_id,player_id,option').in('message_id', pollIds) : { data: [] };
    return { messages, votes: ((v.data ?? []) as { message_id: number; player_id: string; option: number }[]).map((x) => ({ messageId: String(x.message_id), playerId: x.player_id, option: x.option })) };
  }
  create(name: string, description: string, broadcast: boolean) {
    return this.rpc('create_community', { p_name: name, p_description: description, p_broadcast: broadcast });
  }
  join(cid: string) {
    return this.rpc('join_community', { p_room: cid });
  }
  leave(cid: string) {
    return this.rpc('leave_community', { p_room: cid });
  }
  setBroadcast(cid: string, on: boolean) {
    return this.rpc('set_broadcast', { p_room: cid, p_on: on });
  }
  post(cid: string, kind: MsgKind, body: string, payload: Msg['payload']) {
    return this.rpc('post_message', { p_room: cid, p_kind: kind, p_body: body, p_payload: payload });
  }
  vote(mid: string, option: number) {
    return this.rpc('vote_poll', { p_message: Number(mid), p_option: option });
  }
  remove(mid: string) {
    return this.rpc('delete_message', { p_message: Number(mid) });
  }
  ban(cid: string, playerId: string) {
    return this.rpc('ban_member', { p_room: cid, p_target: playerId });
  }
}

function humanize(m: string): string {
  if (/admins only/i.test(m)) return 'Only admins can do that.';
  if (/broadcast/i.test(m)) return 'Broadcast mode: only admins can post.';
  if (/not a member/i.test(m)) return 'Join the community to post.';
  if (/banned/i.test(m)) return 'You were removed from this community.';
  if (/slow down/i.test(m)) return 'Slow down: max 6 messages per 10 seconds.';
  return m;
}

// ============================================================ store

type Listener = () => void;
const READ_KEY = 'apex.lastRead.v1';

class Comms {
  mode: 'connecting' | 'online' | 'local' = 'connecting';
  /** Why we fell back to local demo (shown in UI). */
  localReason = '';
  isAdmin = false;
  communities: Community[] = [];
  members: Member[] = [];
  messages = new Map<string, Msg[]>();
  votes: Vote[] = [];
  me: Me | null = null;
  private backend: Backend | null = null;
  private listeners = new Set<Listener>();
  private version = 0;
  private lastRead: Record<string, number> = JSON.parse(getItem(READ_KEY) ?? '{}');

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

  async start(me: Me) {
    if (this.me) return;
    this.me = me;
    let backend: Backend | null = null;
    const sb = await net.client();
    if (sb) {
      const probe = await Promise.race([
        sb.from('communities').select('id').limit(1).then((r) => (r.error ? r.error.message : 'ok')),
        new Promise<string>((r) => setTimeout(() => r('timeout'), 5000)),
      ]).catch((e: unknown) => String(e));
      if (probe === 'ok') backend = new SupabaseBackend(sb, me);
      else this.localReason = /does not exist|schema cache/i.test(probe) ? 'Server not set up yet (run the communities migration).' : 'Server unreachable.';
    } else {
      this.localReason = 'No server configured.';
    }
    this.backend = backend ?? new LocalBackend(me);
    this.mode = this.backend.kind;
    this.backend.onChange((w) => void (w === 'all' ? this.reload() : this.reloadRoom(w.room)));
    await this.reload();
  }

  private async reload() {
    if (!this.backend) return;
    try {
      const d = await this.backend.load();
      this.communities = d.communities;
      this.members = d.members;
      this.votes = d.votes;
      this.isAdmin = d.isAdmin;
      const byRoom = new Map<string, Msg[]>();
      for (const m of d.messages) {
        const arr = byRoom.get(m.communityId) ?? [];
        arr.push(m);
        byRoom.set(m.communityId, arr);
      }
      this.messages = byRoom;
    } catch (e) {
      this.localReason = String(e);
    }
    this.bump();
  }

  private async reloadRoom(cid: string) {
    if (!this.backend) return;
    const d = await this.backend.loadRoom(cid);
    this.messages.set(cid, d.messages);
    const ids = new Set(d.messages.map((m) => m.id));
    this.votes = [...this.votes.filter((v) => !ids.has(v.messageId)), ...d.votes];
    this.bump();
  }

  // ---------------------------------------------------------------- queries
  membership(cid: string): Member | null {
    return this.members.find((m) => m.communityId === cid && m.playerId === this.me?.id) ?? null;
  }
  isRoomAdmin(cid: string): boolean {
    const m = this.membership(cid);
    return this.isAdmin || (!!m && m.role === 'admin' && !m.banned);
  }
  canPost(cid: string): { ok: boolean; why?: string } {
    const c = this.communities.find((x) => x.id === cid);
    const m = this.membership(cid);
    const admin = this.isRoomAdmin(cid);
    if (m?.banned) return { ok: false, why: 'You were removed from this community.' };
    if (!m && !admin) return { ok: false, why: 'Join to take part in the conversation.' };
    if (c?.broadcast && !admin) return { ok: false, why: 'Only admins can send messages' };
    return { ok: true };
  }
  memberCount(cid: string): number {
    return this.members.filter((m) => m.communityId === cid && !m.banned).length;
  }
  roomMessages(cid: string): Msg[] {
    return this.messages.get(cid) ?? [];
  }
  lastMessage(cid: string): Msg | null {
    const arr = this.roomMessages(cid);
    return arr[arr.length - 1] ?? null;
  }
  unread(cid: string): number {
    const since = this.lastRead[cid] ?? 0;
    return this.roomMessages(cid).filter((m) => m.createdAt > since && m.playerId !== this.me?.id && m.kind !== 'system').length;
  }
  markRead(cid: string) {
    const last = this.lastMessage(cid);
    if (!last || (this.lastRead[cid] ?? 0) >= last.createdAt) return;
    this.lastRead[cid] = last.createdAt;
    setItem(READ_KEY, JSON.stringify(this.lastRead));
    this.bump();
  }
  pollResults(mid: string, n: number): { counts: number[]; total: number; mine: number | null } {
    const counts = Array.from({ length: n }, () => 0);
    let mine: number | null = null;
    for (const v of this.votes) {
      if (v.messageId !== mid) continue;
      if (v.option >= 0 && v.option < n) counts[v.option]++;
      if (v.playerId === this.me?.id) mine = v.option;
    }
    return { counts, total: counts.reduce((a, b) => a + b, 0), mine };
  }

  // ---------------------------------------------------------------- actions
  private async run(fn: (b: Backend) => Promise<void>): Promise<string | null> {
    if (!this.backend) return 'Not connected.';
    try {
      await fn(this.backend);
      if (this.backend.kind === 'online') await this.reload();
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
  }
  create(name: string, description: string, broadcast: boolean) {
    if (!this.isAdmin) return Promise.resolve('Only admins can create communities.');
    if (name.trim().length < 2) return Promise.resolve('Name must be at least 2 characters.');
    return this.run((b) => b.create(name, description, broadcast));
  }
  join = (cid: string) => this.run((b) => b.join(cid));
  leave = (cid: string) => this.run((b) => b.leave(cid));
  setBroadcast = (cid: string, on: boolean) => this.run((b) => b.setBroadcast(cid, on));
  post(cid: string, kind: MsgKind, body: string, payload: Msg['payload'] = null) {
    const check = this.canPost(cid);
    if (!check.ok) return Promise.resolve(check.why ?? 'Not allowed.');
    if (!body.trim()) return Promise.resolve('Message is empty.');
    return this.run((b) => b.post(cid, kind, body, payload));
  }
  vote = (mid: string, option: number) => this.run((b) => b.vote(mid, option));
  remove = (mid: string) => this.run((b) => b.remove(mid));
  ban = (cid: string, playerId: string) => this.run((b) => b.ban(cid, playerId));

  /** Local demo only: impersonate an admin to try the admin tools. */
  get canToggleDemoAdmin() {
    return this.mode === 'local';
  }
}

export const comms = new Comms();

export function useComms() {
  useSyncExternalStore(comms.subscribe, comms.getVersion);
  return comms;
}
