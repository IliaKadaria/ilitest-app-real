import type { SupabaseClient } from '@supabase/supabase-js';
import { useSyncExternalStore } from 'react';
import { getItem, setItem } from '../storage.ts';
import { game } from '../game/store.ts';
import { mail } from '../game/mail.ts';
import type { Side } from '../game/account.ts';
import {
  COMP_DEFS,
  STEAL_FINE,
  closeCompPosition,
  cluePrice,
  eligible,
  newPlay,
  openCompPosition,
  playState,
  rulesFor,
  scoopEvents,
  seedRoulette,
  standings,
  stealSucceeds,
  tickPlay,
  whaleBacked,
  type CompMode,
  type CompPlay,
  type Competition,
  type Entry,
} from '../game/competitions.ts';
import { getClient } from './supabase.ts';

// ---------------------------------------------------------------------------
// Competition store. Online (Supabase): admins create and start competitions,
// players join with a buy-in, scores and loans are shared. Without the server
// (or before the migration runs) only solo practice runs are possible:
// there are no simulated opponents.
// ---------------------------------------------------------------------------

const KEY = 'apex.comps.v1';
interface Saved {
  comps: Competition[];
  plays: Record<string, CompPlay>;
  appliedLoans: number[];
}
type Listener = () => void;

function load(): Saved {
  try {
    const raw = getItem(KEY);
    if (raw) {
      const v = JSON.parse(raw) as Partial<Saved>;
      return { comps: v.comps ?? [], plays: v.plays ?? {}, appliedLoans: v.appliedLoans ?? [] };
    }
  } catch {
    /* fresh */
  }
  return { comps: [], plays: {}, appliedLoans: [] };
}

const now = () => Date.now() / 1000;
const rid = () => `p${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;

interface ServerComp {
  id: string;
  mode: CompMode;
  status: Competition['status'];
  seed: number;
  created_at: string;
  starts_at: string | null;
  ends_at: string | null;
}
const fromServer = (r: ServerComp): Competition => ({
  id: r.id,
  mode: r.mode,
  status: r.status,
  seed: r.seed,
  createdAt: new Date(r.created_at).getTime() / 1000,
  startsAt: r.starts_at ? new Date(r.starts_at).getTime() / 1000 : null,
  endsAt: r.ends_at ? new Date(r.ends_at).getTime() / 1000 : null,
});

class Comps {
  online = false;
  reason = 'Connecting…';
  private saved: Saved = load();
  private server: Competition[] = [];
  entries: Record<string, Entry[]> = {};
  notes: { at: number; text: string; compId: string }[] = [];
  private sb: SupabaseClient | null = null;
  private listeners = new Set<Listener>();
  private version = 0;
  private lastReport: Record<string, number> = {};
  private started = false;

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
  private persist() {
    setItem(KEY, JSON.stringify(this.saved));
    this.bump();
  }
  private me() {
    return game.profile;
  }

  get list(): Competition[] {
    const local = this.saved.comps.filter((c) => c.practice);
    return [...this.server, ...local].sort((a, b) => b.createdAt - a.createdAt);
  }
  play(id: string): CompPlay | null {
    return this.saved.plays[id] ?? null;
  }
  comp(id: string): Competition | null {
    return this.list.find((c) => c.id === id) ?? null;
  }
  /** Current (open or live) competition of a mode, if any. */
  current(mode: CompMode): Competition | null {
    return this.list.find((c) => c.mode === mode && !c.practice && (c.status === 'open' || c.status === 'live')) ?? null;
  }
  activePlay(): { c: Competition; play: CompPlay } | null {
    for (const c of this.list) {
      const p = this.play(c.id);
      if (p && c.status === 'live' && !p.paid) return { c, play: p };
    }
    return null;
  }

  // ---------------------------------------------------------------- server
  async start() {
    if (this.started) return;
    this.started = true;
    const c = getClient();
    if (!c) {
      this.reason = 'Offline: competitions need the online server. Practice runs work offline.';
      return this.bump();
    }
    const sb = await c;
    const probe = await sb.from('competitions').select('id').limit(1);
    if (probe.error) {
      this.reason = 'Competitions aren’t enabled on the server yet (migration pending). Practice runs work.';
      return this.bump();
    }
    this.sb = sb;
    this.online = true;
    this.reason = '';
    await this.refresh();
    window.setInterval(() => void this.refresh(), 5000);
  }

  async refresh() {
    if (!this.sb) return;
    const { data } = await this.sb.from('competitions').select('*').in('status', ['open', 'live', 'finished', 'cancelled']).order('created_at', { ascending: false }).limit(20);
    this.server = ((data ?? []) as ServerComp[]).map(fromServer);
    const ids = this.server.filter((c) => c.status !== 'finished' || this.saved.plays[c.id]).map((c) => c.id);
    if (ids.length) {
      const { data: rows } = await this.sb.from('competition_entries').select('comp_id, player_id, name, team, equity, eliminated, net_lots').in('comp_id', ids);
      const byComp: Record<string, Entry[]> = {};
      for (const r of (rows ?? []) as { comp_id: string; player_id: string; name: string; team: string | null; equity: number; eliminated: boolean; net_lots: number }[])
        (byComp[r.comp_id] ??= []).push({ playerId: r.player_id, name: r.name, team: r.team ?? undefined, equity: Number(r.equity), eliminated: r.eliminated, netLots: Number(r.net_lots) });
      this.entries = byComp;
    }
    await this.pullLoans();
    this.bump();
  }

  private async rpc(fn: string, args: Record<string, unknown>): Promise<{ data: unknown; error: string | null }> {
    const me = this.me();
    if (!this.sb || !me) return { data: null, error: 'Competitions need the online server.' };
    const { data, error } = await this.sb.rpc(fn, { p_id: me.id, p_secret: me.secret, ...args });
    return { data, error: error ? error.message.replace(/^.*?:\s*/, '') : null };
  }

  private async pullLoans() {
    if (!this.sb || !this.me()) return;
    const { data, error } = await this.rpc('comp_my_loans', {});
    if (error || !Array.isArray(data)) return;
    let changed = false;
    for (const l of data as { id: number; comp_id: string; lender: string; borrower: string; amount: number }[]) {
      if (this.saved.appliedLoans.includes(l.id)) continue;
      const p = this.saved.plays[l.comp_id];
      if (!p) continue;
      if (l.borrower === this.me()!.id) {
        this.saved.plays[l.comp_id] = { ...p, balance: p.balance + Number(l.amount), borrowed: p.borrowed + Number(l.amount) };
        this.note(l.comp_id, `Loan received: €${Number(l.amount).toLocaleString()}`);
      }
      this.saved.appliedLoans.push(l.id);
      changed = true;
    }
    if (changed) this.persist();
  }

  // ---------------------------------------------------------------- admin
  async create(mode: CompMode): Promise<string | null> {
    const { error } = await this.rpc('comp_create', { p_mode: mode });
    if (!error) await this.refresh();
    return error;
  }
  async begin(id: string): Promise<string | null> {
    const { error } = await this.rpc('comp_start', { p_comp: id });
    if (!error) await this.refresh();
    return error;
  }
  async cancel(id: string): Promise<string | null> {
    const { error } = await this.rpc('comp_cancel', { p_comp: id });
    if (!error) await this.refresh();
    return error;
  }

  // ---------------------------------------------------------------- players
  async join(c: Competition, team?: string): Promise<string | null> {
    const d = COMP_DEFS[c.mode];
    const me = this.me();
    if (!me) return 'Create your trader first.';
    const el = eligible(d, game.account.balance);
    if (!el.ok) return el.why!;
    if (c.mode === 'whale' && !team) return 'Pick a fund.';
    if (game.account.positions.length) return 'Close your open positions first: the buy-in comes out of your balance.';
    const { error } = await this.rpc('comp_join', { p_comp: c.id, p_team: team ?? null, p_name: me.name });
    if (error) return error;
    game.credit(-d.buyIn, `Buy-in · ${d.name}`);
    this.saved.plays[c.id] = newPlay(c, team);
    this.persist();
    await this.refresh();
    return null;
  }

  /** Solo, free, no prizes: learn a mode offline. */
  practice(mode: CompMode, team?: string): Competition {
    const t = now();
    const d = COMP_DEFS[mode];
    const c: Competition = { id: rid(), mode, status: 'live', seed: Math.floor(Math.random() * 2 ** 31), createdAt: t, startsAt: t, endsAt: t + d.minutes * 60, practice: true };
    let play = newPlay(c, mode === 'whale' ? (team ?? 'obsidian') : undefined);
    if (mode === 'roulette') play = seedRoulette(c, play, t);
    this.saved.comps = [c, ...this.saved.comps.filter((x) => x.status === 'live' || x.createdAt > t - 86400 * 3)].slice(0, 10);
    this.saved.plays[c.id] = play;
    this.persist();
    return c;
  }
  abandonPractice(id: string) {
    this.saved.comps = this.saved.comps.filter((c) => c.id !== id);
    delete this.saved.plays[id];
    this.persist();
  }

  private myEntry(c: Competition): Entry | null {
    const me = this.me();
    const p = this.play(c.id);
    if (!me || !p) return null;
    const st = playState(c, p, now(), rulesFor(c, p, null), this.crowd(c));
    return { playerId: me.id, name: me.name, team: p.team, equity: p.finalEquity ?? st.score, eliminated: !!p.eliminatedAt, netLots: p.positions.reduce((s, x) => s + x.side * x.lots, 0) };
  }
  /** Everyone in the competition, my live numbers included. */
  field(c: Competition): Entry[] {
    const mine = this.myEntry(c);
    const others = (this.entries[c.id] ?? []).filter((e) => e.playerId !== this.me()?.id);
    return mine ? [...others, mine] : others;
  }
  /** Other players' net lots in the pump token. */
  crowd(c: Competition): number {
    if (c.mode !== 'pump') return 0;
    return (this.entries[c.id] ?? []).filter((e) => e.playerId !== this.me()?.id).reduce((s, e) => s + (e.netLots ?? 0), 0);
  }
  rules(c: Competition, p: CompPlay) {
    return rulesFor(c, p, c.mode === 'whale' ? whaleBacked(c, this.field(c), now(), COMP_DEFS.whale.stack) : null);
  }

  private update(c: Competition, p: CompPlay) {
    this.saved.plays[c.id] = p;
    this.persist();
  }
  private note(compId: string, text: string) {
    this.notes = [{ at: now(), text, compId }, ...this.notes].slice(0, 30);
  }

  trade(c: Competition, sym: string, side: Side, lots: number): string | null {
    const p = this.play(c.id);
    if (!p) return 'Join first.';
    if (!c.startsAt || now() < c.startsAt) return 'Not started yet.';
    const r = openCompPosition(c, p, sym, side, lots, now(), this.rules(c, p), this.crowd(c));
    if (r.error) return r.error;
    this.update(c, r.play);
    return null;
  }
  close(c: Competition, posId: string) {
    const p = this.play(c.id);
    if (p) this.update(c, closeCompPosition(c, p, posId, now(), this.crowd(c)));
  }

  async lend(c: Competition, to: string, amount: number): Promise<string | null> {
    const p = this.play(c.id);
    if (!p) return 'Join first.';
    const st = playState(c, p, now(), this.rules(c, p), this.crowd(c));
    if (!(amount > 0) || amount > st.snap.cash || amount > st.snap.totalEquity * 0.5) return 'You can lend up to half your equity, from cash.';
    const { error } = await this.rpc('comp_lend', { p_comp: c.id, p_to: to, p_amount: amount });
    if (error) return error;
    this.update(c, { ...p, balance: p.balance - amount, lent: p.lent + amount });
    return null;
  }

  buyClue(c: Competition, clueId: string): string | null {
    const p = this.play(c.id);
    const clue = scoopEvents(c).flatMap((e) => e.clues).find((x) => x.id === clueId);
    if (!p || !clue) return 'Unknown clue.';
    if (p.clues.includes(clueId)) return 'You already have it.';
    const price = cluePrice(clue, now());
    const st = playState(c, p, now(), this.rules(c, p));
    if (price > st.snap.cash) return 'Not enough competition cash.';
    this.update(c, { ...p, balance: p.balance - price, clues: [...p.clues, clueId] });
    return null;
  }
  sellClue(c: Competition, clueId: string): string | null {
    const p = this.play(c.id);
    const clue = scoopEvents(c).flatMap((e) => e.clues).find((x) => x.id === clueId);
    if (!p || !clue || !p.clues.includes(clueId)) return 'You don’t hold that clue.';
    this.update(c, { ...p, balance: p.balance + Math.round(cluePrice(clue, now()) * 0.5), clues: p.clues.filter((x) => x !== clueId) });
    return null;
  }
  stealClue(c: Competition, clueId: string): { ok: boolean; msg: string } {
    const p = this.play(c.id);
    const me = this.me();
    if (!p || !me) return { ok: false, msg: 'Join first.' };
    if (p.stealsTried.includes(clueId)) return { ok: false, msg: 'One attempt per clue.' };
    const ok = stealSucceeds(c, me.id, clueId);
    const fine = ok ? 0 : Math.round(COMP_DEFS.scoop.stack * STEAL_FINE);
    this.update(c, { ...p, stealsTried: [...p.stealsTried, clueId], clues: ok ? [...p.clues, clueId] : p.clues, balance: p.balance - fine, fines: p.fines + fine });
    return { ok, msg: ok ? 'Clue stolen.' : `Caught. Fined €${fine.toLocaleString()}.` };
  }

  // ---------------------------------------------------------------- loop
  tick() {
    const t = now();
    for (const c of this.list) {
      const p = this.play(c.id);
      if (!p || p.paid || !c.startsAt || t < c.startsAt) continue;
      if (c.endsAt && t >= c.endsAt && p.finalEquity !== undefined) {
        if (t >= c.endsAt + 10) this.payout(c);
        continue;
      }
      if (c.status === 'cancelled') {
        if (!c.practice) game.credit(COMP_DEFS[c.mode].buyIn, `Refund · ${COMP_DEFS[c.mode].name} cancelled`);
        this.update(c, { ...p, paid: true, prize: 0 });
        continue;
      }
      // Roulette: everyone starts leveraged as soon as it goes live
      if (c.mode === 'roulette' && !p.positions.length && !p.history.length && !p.eliminatedAt && t < (c.endsAt ?? 0)) {
        this.update(c, seedRoulette(c, p, t));
        continue;
      }
      const r = tickPlay(c, p, t, this.rules(c, p), this.crowd(c));
      for (const n of r.notes) this.note(c.id, n);
      if (r.play !== p) this.update(c, r.play);
      if (!c.practice && (this.lastReport[c.id] ?? 0) < t - 4) {
        this.lastReport[c.id] = t;
        const e = this.myEntry(c);
        if (e) void this.rpc('comp_report', { p_comp: c.id, p_equity: Math.round(e.equity * 100) / 100, p_eliminated: !!e.eliminated, p_net_lots: e.netLots ?? 0 });
      }
      if (c.endsAt && t >= c.endsAt + 10) this.payout(c);
    }
  }

  private payout(c: Competition) {
    const p = this.play(c.id);
    const me = this.me();
    if (!p || p.paid || !me) return;
    const d = COMP_DEFS[c.mode];
    const field = this.field(c);
    const table = standings(c, field, Math.max(field.length, (this.entries[c.id] ?? []).length));
    const mine = table.find((e) => e.playerId === me.id);
    const prize = mine?.prize ?? 0;
    if (prize > 0) {
      game.credit(prize, `Prize · ${d.name} · place ${mine!.place}`);
      mail.add(`Payout certificate · ${d.name}`, `You finished #${mine!.place} of ${table.length} in ${d.name} and won €${prize.toLocaleString()}. The prize has been credited to your balance.`, 'good', 'Liquidated Competitions', {
        kind: 'prize',
        title: d.name,
        amount: prize,
        place: mine!.place,
        field: table.length,
        at: now(),
        ref: c.id.slice(0, 8).toUpperCase(),
        holder: me.name,
      });
    } else if (!c.practice) {
      mail.add(`${d.name} finished`, `You finished #${mine?.place ?? '—'} of ${table.length}. Final competition equity €${Math.round(mine?.equity ?? 0).toLocaleString()}.`, 'info', 'Liquidated Competitions');
    }
    if (!c.practice) void this.rpc('comp_claim', { p_comp: c.id, p_place: mine?.place ?? 0, p_prize: prize });
    this.update(c, { ...p, paid: true, prize, finalEquity: mine?.equity });
  }
}

export const comps = new Comps();

export function useComps() {
  useSyncExternalStore(comps.subscribe, comps.getVersion);
  return comps;
}
