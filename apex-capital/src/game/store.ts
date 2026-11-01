import { getItem, setItem } from '../storage.ts';
import { useSyncExternalStore } from 'react';
import { quote } from '../market/engine.ts';
import { SYMBOL_MAP, nextOpen } from '../market/symbols.ts';
import {
  LOCKOUT_SECONDS,
  MIN_TRADABLE,
  STOP_OUT_LEVEL,
  closePrice,
  freshAccount,
  metrics,
  newId,
  positionProfit,
  quotesFor,
  requiredMargin,
  type AccountState,
  type CloseReason,
  type Deal,
  type Position,
  type Side,
} from './account.ts';

const ACC_KEY = 'apex.account.v1';
const PROFILE_KEY = 'apex.profile.v1';

export interface Profile {
  id: string;
  name: string;
  /** Random per-device secret proving ownership of `id` to the server. */
  secret: string;
}

function newSecret(): string {
  const b = new Uint8Array(24);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

function loadProfile(): Profile | null {
  const p = load<Partial<Profile>>(PROFILE_KEY);
  if (!p?.id || !p.name) return null;
  if (!p.secret) {
    // v1 profiles had no secret: mint one (and a fresh id so nobody can pre-claim it)
    const up: Profile = { id: crypto.randomUUID(), name: p.name, secret: newSecret() };
    setItem(PROFILE_KEY, JSON.stringify(up));
    return up;
  }
  return p as Profile;
}

export type GameEvent =
  | { type: 'open'; pos: Position }
  | { type: 'close'; deal: Deal }
  | { type: 'stopout'; deal: Deal }
  | { type: 'frozen'; until: number; reason: string }
  | { type: 'error'; msg: string };

type Listener = () => void;
type EventListener = (e: GameEvent) => void;

function load<T>(key: string): T | null {
  try {
    const raw = getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

/** Never crash on stale saves: drop positions/deals on instruments that no longer exist. */
function sanitize(a: AccountState | null): AccountState {
  if (!a || typeof a.balance !== 'number') return freshAccount();
  return { ...a, positions: (a.positions ?? []).filter((p) => SYMBOL_MAP[p.sym]), history: (a.history ?? []).filter((d) => SYMBOL_MAP[d.sym]) };
}

class GameStore {
  account: AccountState = sanitize(load<AccountState>(ACC_KEY));
  profile: Profile | null = loadProfile();
  private listeners = new Set<Listener>();
  private eventListeners = new Set<EventListener>();
  private version = 0;
  private saveTimer: number | null = null;

  subscribe = (l: Listener) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };
  onEvent(l: EventListener) {
    this.eventListeners.add(l);
    return () => {
      this.eventListeners.delete(l);
    };
  }
  getVersion = () => this.version;

  private commit(next: AccountState) {
    this.account = next;
    this.version++;
    this.listeners.forEach((l) => l());
    if (this.saveTimer === null) {
      this.saveTimer = window.setTimeout(() => {
        this.saveTimer = null;
        setItem(ACC_KEY, JSON.stringify(this.account));
      }, 300);
    }
  }
  /** Write immediately (called on pagehide so a closing tab never loses a trade). */
  flush() {
    if (this.saveTimer !== null) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    setItem(ACC_KEY, JSON.stringify(this.account));
  }

  private emit(e: GameEvent) {
    this.eventListeners.forEach((l) => l(e));
  }

  setProfile(name: string) {
    const p: Profile = { id: this.profile?.id ?? crypto.randomUUID(), name: name.trim().slice(0, 18), secret: this.profile?.secret ?? newSecret() };
    this.profile = p;
    setItem(PROFILE_KEY, JSON.stringify(p));
    this.version++;
    this.listeners.forEach((l) => l());
  }

  open(sym: string, side: Side, lots: number, sl: number | null, tp: number | null): boolean {
    if (!Number.isFinite(lots) || lots < 0.01 || lots > 100) {
      this.emit({ type: 'error', msg: 'Lot size must be between 0.01 and 100.' });
      return false;
    }
    const t = Date.now() / 1000;
    if (this.isFrozen(t)) {
      this.emit({ type: 'error', msg: 'Account under review. Trading is suspended.' });
      return false;
    }
    const q = quote(sym, t);
    if (!q.open) {
      this.emit({ type: 'error', msg: `${SYMBOL_MAP[sym].name} market closed. Reopens ${fmtOpen(nextOpen(SYMBOL_MAP[sym], t))}.` });
      return false;
    }
    const price = side === 1 ? q.ask : q.bid;
    const acc = this.account;
    const m = metrics(acc, quotesFor(acc, t));
    const need = requiredMargin(sym, lots, price);
    if (need > m.free) {
      this.emit({ type: 'error', msg: `Insufficient margin: €${need.toFixed(2)} required, €${Math.max(0, m.free).toFixed(2)} free.` });
      return false;
    }
    if (sl !== null && (side === 1 ? sl >= q.bid : sl <= q.ask)) {
      this.emit({ type: 'error', msg: 'Invalid stop loss: level is through the market.' });
      return false;
    }
    if (tp !== null && (side === 1 ? tp <= q.bid : tp >= q.ask)) {
      this.emit({ type: 'error', msg: 'Invalid take profit: level is through the market.' });
      return false;
    }
    const pos: Position = { id: newId(), sym, side, lots, open: price, openTime: t, sl, tp };
    this.commit({ ...acc, positions: [pos, ...acc.positions] });
    this.emit({ type: 'open', pos });
    return true;
  }

  private closeInternal(acc: AccountState, p: Position, reason: CloseReason, t: number): [AccountState, Deal] {
    const q = quote(p.sym, t);
    const profit = positionProfit(p, q);
    const deal: Deal = { id: p.id, sym: p.sym, side: p.side, lots: p.lots, open: p.open, openTime: p.openTime, close: closePrice(p, q), closeTime: t, profit, reason };
    const balance = acc.balance + profit;
    return [
      {
        ...acc,
        balance,
        positions: acc.positions.filter((x) => x.id !== p.id),
        history: [deal, ...acc.history].slice(0, 200),
        totalProfit: acc.totalProfit + profit,
        bestTrade: Math.max(acc.bestTrade, profit),
        worstTrade: Math.min(acc.worstTrade, profit),
        wins: acc.wins + (profit > 0 ? 1 : 0),
        losses: acc.losses + (profit <= 0 ? 1 : 0),
        peakBalance: Math.max(acc.peakBalance, balance),
      },
      deal,
    ];
  }

  close(id: string, reason: CloseReason = 'manual', t = Date.now() / 1000) {
    const p = this.account.positions.find((x) => x.id === id);
    if (!p) return;
    if (reason === 'manual' && !quote(p.sym, t).open) {
      this.emit({ type: 'error', msg: `${SYMBOL_MAP[p.sym].name} market closed. Position will be closable at the open.` });
      return;
    }
    const [next, deal] = this.closeInternal(this.account, p, reason, t);
    this.commit(next);
    this.emit({ type: reason === 'stopout' ? 'stopout' : 'close', deal });
    this.checkBlown();
  }

  closeWhere(pred: (p: Position, profit: number) => boolean) {
    const t = Date.now() / 1000;
    let acc = this.account;
    const deals: Deal[] = [];
    for (const p of [...acc.positions]) {
      const q = quote(p.sym, t);
      if (!q.open || !pred(p, positionProfit(p, q))) continue;
      const [next, deal] = this.closeInternal(acc, p, 'manual', t);
      acc = next;
      deals.push(deal);
    }
    if (!deals.length) return;
    this.commit(acc);
    deals.forEach((deal) => this.emit({ type: 'close', deal }));
    this.checkBlown();
  }

  /** MT5-style modify: rejects levels that would trigger instantly. */
  modify(id: string, sl: number | null, tp: number | null): boolean {
    const p = this.account.positions.find((x) => x.id === id);
    if (!p) return false;
    const px = closePrice(p, quote(p.sym, Date.now() / 1000));
    if (sl !== null && (p.side === 1 ? sl >= px : sl <= px)) {
      this.emit({ type: 'error', msg: sl === p.open ? 'Breakeven unavailable: position is below entry.' : 'Invalid stop loss: level is through the market.' });
      return false;
    }
    if (tp !== null && (p.side === 1 ? tp <= px : tp >= px)) {
      this.emit({ type: 'error', msg: 'Invalid take profit: level is through the market.' });
      return false;
    }
    this.commit({ ...this.account, positions: this.account.positions.map((x) => (x.id === id ? { ...x, sl, tp } : x)) });
    return true;
  }

  /**
   * Called ~4x/sec. Triggers SL/TP and broker stop-out.
   * If the app was asleep (locked phone / background tab), it replays the
   * deterministic price path it missed and fills at the moment the level was
   * actually hit, so orders never get "stuck" and fills stay fair.
   */
  tick() {
    const now = Date.now() / 1000;
    // checkedAt is persisted, so time spent with the app fully closed is replayed too
    const from = this.account.checkedAt ?? now;
    this.account.checkedAt = now;
    if (!this.account.positions.length || this.account.lockedUntil) return;
    const gap = now - from;
    if (gap > 1.5) {
      const span = Math.min(gap, 86400);
      const step = Math.max(1, span / 20000);
      for (let t = now - span + step; t < now && this.account.positions.length; t += step) this.checkAt(t);
    }
    // a single tick can trigger several closes (one per pass); loop until stable
    for (let i = 0; i < 20 && this.account.positions.length; i++) if (!this.checkAt(now)) break;
  }

  /** Check SL/TP/stop-out at time t. Returns true if something was closed. */
  private checkAt(t: number): boolean {
    const acc = this.account;
    for (const p of acc.positions) {
      const px = closePrice(p, quote(p.sym, t));
      if (p.tp !== null && (p.side === 1 ? px >= p.tp : px <= p.tp)) {
        this.close(p.id, 'tp', t);
        return true;
      }
      if (p.sl !== null && (p.side === 1 ? px <= p.sl : px >= p.sl)) {
        this.close(p.id, 'sl', t);
        return true;
      }
    }
    const m = metrics(acc, quotesFor(acc, t));
    if (m.equity <= 0 || (m.level !== null && m.level < STOP_OUT_LEVEL)) {
      this.freeze(t, m.equity <= 0 ? 'Equity depleted' : `Stop-out at ${STOP_OUT_LEVEL}% margin level`);
      return true;
    }
    return false;
  }

  private checkBlown() {
    const a = this.account;
    if (!a.lockedUntil && a.positions.length === 0 && a.balance < MIN_TRADABLE) this.freeze(Date.now() / 1000, 'Equity depleted');
  }

  /** Blown account: liquidate everything at time t and freeze for review. */
  private freeze(t: number, reason: string) {
    let acc = this.account;
    const deals: Deal[] = [];
    // worst first, like a broker's liquidation engine
    const order = [...acc.positions].sort((x, y) => positionProfit(x, quote(x.sym, t)) - positionProfit(y, quote(y.sym, t)));
    for (const p of order) {
      const [next, deal] = this.closeInternal(acc, p, 'stopout', t);
      acc = next;
      deals.push(deal);
    }
    const until = t + LOCKOUT_SECONDS;
    // Negative balance protection (as EU retail brokers must): gaps never leave you owing money.
    const protectedBalance = Math.max(0, acc.balance);
    this.commit({ ...acc, balance: protectedBalance, lockedUntil: until, lockReason: acc.balance < 0 ? `${reason} · negative balance protection applied` : reason });
    this.flush();
    deals.forEach((deal) => this.emit({ type: 'stopout', deal }));
    this.emit({ type: 'frozen', until, reason });
  }

  isFrozen(t = Date.now() / 1000): boolean {
    const u = this.account.lockedUntil;
    return !!u && t < u;
  }

  /** Review pending = frozen, or the timer ran out but the new credit line isn't accepted yet. */
  underReview(): boolean {
    return !!this.account.lockedUntil;
  }

  /** After the lockout: approve a fresh €100 credit line. */
  completeReview(serverCount?: number | null): boolean {
    if (!this.account.lockedUntil || this.isFrozen()) return false;
    const local = this.account.blownCount + 1;
    this.commit(freshAccount(Math.max(local, serverCount ?? 0)));
    this.flush();
    return true;
  }

  setBlownCount(n: number) {
    if (n > this.account.blownCount) this.commit({ ...this.account, blownCount: n });
  }
}

export const game = new GameStore();

export function useGame() {
  useSyncExternalStore(game.subscribe, game.getVersion);
  return game;
}


function fmtOpen(t: number): string {
  return new Date(t * 1000).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' });
}
