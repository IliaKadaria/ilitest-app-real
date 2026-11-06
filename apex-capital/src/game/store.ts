import { getItem, setItem } from '../storage.ts';
import { useSyncExternalStore } from 'react';
import { quote } from '../market/engine.ts';
import { SYMBOL_MAP, nextOpen, pointOf } from '../market/symbols.ts';
import {
  START_BALANCE,
  freshAccount,
  type AccountType,
  metrics,
  newId,
  positionProfit,
  quotesFor,
  requiredMargin,
  validatePending,
  type AccountState,
  type CloseReason,
  type Deal,
  type Expiry,
  type OrderRecord,
  type PendingOrder,
  type PendingType,
  type Position,
  type Side,
} from './account.ts';
import { GRID, advance, closeInternal, freeze, recordOrder, settleAt, type SimEvent } from './sim.ts';

const LEGACY_ACC_KEY = 'apex.account.v1';
const ACCOUNTS_KEY = 'apex.accounts.v2';
const accKey = (login: number) => `apex.acct.${login}`;
const PROFILE_KEY = 'apex.profile.v1';
export const MAX_ACCOUNTS = 5;

export interface Profile {
  id: string;
  name: string;
  /** Random per-device secret proving ownership of `id` to the server. */
  secret: string;
  /** Preset key ("p:3") or a small JPEG data URL. */
  avatar?: string;
}

export interface AccountMeta {
  login: number;
  createdAt: number;
}
interface AccountIndex {
  active: number;
  list: AccountMeta[];
}

function newSecret(): string {
  const b = new Uint8Array(24);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

function load<T>(key: string): T | null {
  try {
    const raw = getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function loadProfile(): Profile | null {
  const p = load<Partial<Profile>>(PROFILE_KEY);
  if (!p?.id || !p.name) return null;
  if (!p.secret) {
    const up: Profile = { id: crypto.randomUUID(), name: p.name, secret: newSecret() };
    setItem(PROFILE_KEY, JSON.stringify(up));
    return up;
  }
  return p as Profile;
}

const newLogin = () => 5_000_000 + Math.floor(Math.random() * 4_000_000);

/** Never crash on stale saves: fill new fields, drop positions on instruments that no longer exist. */
function sanitize(a: Partial<AccountState> | null, login: number): AccountState {
  if (!a || typeof a.balance !== 'number') return freshAccount(login);
  const base = freshAccount(login, a.blownCount ?? 0);
  return {
    ...base,
    ...a,
    login: a.login ?? login,
    positions: (a.positions ?? []).filter((p) => SYMBOL_MAP[p.sym]),
    orders: (a.orders ?? []).filter((o) => SYMBOL_MAP[o.sym]),
    history: (a.history ?? []).filter((d) => SYMBOL_MAP[d.sym]).map((d) => ({ ...d, sl: d.sl ?? null, tp: d.tp ?? null })),
    orderHistory: (a.orderHistory ?? []).filter((o) => SYMBOL_MAP[o.sym]),
  } as AccountState;
}

function loadIndex(): { index: AccountIndex; account: AccountState } {
  let index = load<AccountIndex>(ACCOUNTS_KEY);
  if (!index?.list?.length) {
    const login = newLogin();
    const legacy = load<Partial<AccountState>>(LEGACY_ACC_KEY);
    const account = sanitize(legacy, login);
    index = { active: login, list: [{ login, createdAt: account.createdAt }] };
    setItem(ACCOUNTS_KEY, JSON.stringify(index));
    setItem(accKey(login), JSON.stringify(account));
    return { index, account };
  }
  return { index, account: sanitize(load<AccountState>(accKey(index.active)), index.active) };
}

export type GameEvent =
  | ({ away?: boolean } & SimEvent)
  | { type: 'open'; pos: Position }
  | { type: 'placed'; order: PendingOrder }
  | { type: 'canceled'; record: OrderRecord }
  | { type: 'account'; login: number }
  | { type: 'error'; msg: string };

type Listener = () => void;
type EventListener = (e: GameEvent) => void;

export interface MarketOpts {
  /** Price the trader saw; with `deviation` (points) enables MT5-style requotes. */
  expected?: number;
  deviation?: number;
}

class GameStore {
  private idx = loadIndex();
  account: AccountState = this.idx.account;
  accounts: AccountMeta[] = this.idx.index.list;
  profile: Profile | null = loadProfile();
  private listeners = new Set<Listener>();
  private eventListeners = new Set<EventListener>();
  private version = 0;
  private saveTimer: number | null = null;

  subscribe = (l: Listener) => {
    this.listeners.add(l);
    return () => {
      this.listeners.delete(l);
    };
  };
  onEvent(l: EventListener) {
    this.eventListeners.add(l);
    return () => {
      this.eventListeners.delete(l);
    };
  }
  getVersion = () => this.version;

  private bump() {
    this.version++;
    this.listeners.forEach((l) => l());
  }
  private commit(next: AccountState) {
    this.account = next;
    this.bump();
    if (this.saveTimer === null) {
      this.saveTimer = window.setTimeout(() => {
        this.saveTimer = null;
        this.persist();
      }, 300);
    }
  }
  private persist() {
    setItem(accKey(this.account.login), JSON.stringify(this.account));
  }
  /** Write immediately (called on pagehide so a closing tab never loses a trade). */
  flush() {
    if (this.saveTimer !== null) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    this.persist();
  }
  private emit(e: GameEvent) {
    this.eventListeners.forEach((l) => l(e));
  }
  private err(msg: string): false {
    this.emit({ type: 'error', msg });
    return false;
  }

  // ---------------------------------------------------------------- profile
  setProfile(name: string) {
    const p: Profile = { id: this.profile?.id ?? crypto.randomUUID(), name: name.trim().slice(0, 18), secret: this.profile?.secret ?? newSecret(), avatar: this.profile?.avatar };
    this.profile = p;
    setItem(PROFILE_KEY, JSON.stringify(p));
    this.bump();
  }
  /** Take over a profile that already exists on the server (same login on a new device). */
  adoptProfile(p: Profile) {
    this.profile = p;
    setItem(PROFILE_KEY, JSON.stringify(p));
    this.bump();
  }
  setAvatar(avatar: string | undefined) {
    if (!this.profile) return;
    this.profile = { ...this.profile, avatar };
    setItem(PROFILE_KEY, JSON.stringify(this.profile));
    this.bump();
  }

  // ---------------------------------------------------------------- accounts
  canOpenNewAccount(): { ok: boolean; why?: string } {
    if (this.underReview()) return { ok: false, why: 'Account under review.' };
    if (this.accounts.length >= MAX_ACCOUNTS) return { ok: false, why: `Maximum ${MAX_ACCOUNTS} demo accounts.` };
    if (this.account.balance < START_BALANCE || this.account.positions.length)
      return { ok: false, why: `Close all positions and hold at least €${START_BALANCE} on this account first. New accounts can't be used to escape a drawdown.` };
    return { ok: true };
  }
  openNewAccount(type: AccountType = 'mt5'): boolean {
    const c = this.canOpenNewAccount();
    if (!c.ok) return this.err(c.why!);
    this.flush();
    const login = newLogin();
    const acc = freshAccount(login, this.account.blownCount, type);
    this.accounts = [...this.accounts, { login, createdAt: acc.createdAt }];
    this.saveIndex(login);
    this.account = acc;
    this.persist();
    this.bump();
    this.emit({ type: 'account', login });
    return true;
  }
  switchAccount(login: number): boolean {
    if (login === this.account.login) return true;
    if (this.underReview()) return this.err('Account under review.');
    if (!this.accounts.some((a) => a.login === login)) return false;
    this.flush();
    this.account = sanitize(load<AccountState>(accKey(login)), login);
    this.saveIndex(login);
    this.bump();
    this.emit({ type: 'account', login });
    this.tick();
    return true;
  }
  accountSummary(login: number): AccountState | null {
    if (login === this.account.login) return this.account;
    return load<AccountState>(accKey(login));
  }
  private saveIndex(active: number) {
    setItem(ACCOUNTS_KEY, JSON.stringify({ active, list: this.accounts } satisfies AccountIndex));
  }

  /** Balance operation (competition buy-in, prize, refund). Returns false if it would go negative. */
  credit(amount: number, note: string): boolean {
    const acc = this.account;
    if (!Number.isFinite(amount) || amount === 0) return false;
    if (acc.balance + amount < 0) return this.err('Not enough balance.');
    const op = { id: newId(), at: Date.now() / 1000, amount, note };
    const balance = acc.balance + amount;
    this.commit({ ...acc, balance, peakBalance: Math.max(acc.peakBalance, balance), credits: [op, ...(acc.credits ?? [])].slice(0, 200) });
    return true;
  }

  // ---------------------------------------------------------------- trading
  private guard(sym: string, lots: number, t: number): boolean {
    if (!SYMBOL_MAP[sym]) return this.err('Unknown symbol.');
    if (!Number.isFinite(lots) || lots < 0.01 || lots > 100) return this.err('Volume must be between 0.01 and 100.00 lots.');
    if (this.isFrozen(t)) return this.err('Account under review. Trading is suspended.');
    if (!quote(sym, t).open) return this.err(`${SYMBOL_MAP[sym].name}: market closed. Reopens ${fmtOpen(nextOpen(SYMBOL_MAP[sym], t))}.`);
    return true;
  }

  open(sym: string, side: Side, lots: number, sl: number | null, tp: number | null, opts: MarketOpts = {}): boolean {
    const t = Date.now() / 1000;
    if (!this.guard(sym, lots, t)) return false;
    const def = SYMBOL_MAP[sym];
    const q = quote(sym, t);
    const price = side === 1 ? q.ask : q.bid;
    if (opts.expected !== undefined && opts.deviation !== undefined && Math.abs(price - opts.expected) > opts.deviation * pointOf(def) + 1e-12)
      return this.err(`Requote: price moved to ${price.toFixed(def.digits)} (deviation ${opts.deviation} pts).`);
    const acc = this.account;
    const m = metrics(acc, quotesFor(acc, t));
    const need = requiredMargin(sym, lots, price, t, acc.type);
    if (need > m.free) return this.err(acc.type === 'margin' ? `Exceeds 2:1 leverage: €${need.toFixed(2)} margin required, €${Math.max(0, m.free).toFixed(2)} buying power left (÷2).` : `Not enough money: €${need.toFixed(2)} margin required, €${Math.max(0, m.free).toFixed(2)} free.`);
    if (sl !== null && (side === 1 ? sl >= q.bid : sl <= q.ask)) return this.err('Invalid stops: stop loss is through the market.');
    if (tp !== null && (side === 1 ? tp <= q.bid : tp >= q.ask)) return this.err('Invalid stops: take profit is through the market.');
    const pos: Position = { id: newId(), sym, side, lots, open: price, openTime: t, sl, tp, orderKind: side === 1 ? 'buy' : 'sell' };
    const rec: OrderRecord = { id: pos.id, sym, kind: pos.orderKind!, lots, price: opts.expected ?? price, sl, tp, placedAt: t, doneAt: t, state: 'filled', fillPrice: price };
    this.commit(recordOrder({ ...acc, positions: [pos, ...acc.positions] }, rec));
    this.emit({ type: 'open', pos });
    return true;
  }

  placeOrder(sym: string, type: PendingType, lots: number, price: number, stopLimit: number | null, sl: number | null, tp: number | null, expiry: Expiry): boolean {
    const t = Date.now() / 1000;
    if (!this.guard(sym, lots, t)) return false;
    if (this.account.orders.length >= 50) return this.err('Too many pending orders (max 50).');
    const e = validatePending(type, price, stopLimit, sl, tp, quote(sym, t));
    if (e) return this.err(e);
    const expiresAt = expiry.mode === 'gtc' ? null : expiry.mode === 'today' ? Math.ceil((t + 1) / 86400) * 86400 - 1 : expiry.at;
    if (expiresAt !== null && expiresAt <= t + 60) return this.err('Expiration must be at least a minute in the future.');
    const o: PendingOrder = { id: newId(), sym, type, lots, price, stopLimit: type.endsWith('stop_limit') ? stopLimit : null, sl, tp, placedAt: t, expiresAt };
    this.commit({ ...this.account, orders: [o, ...this.account.orders] });
    this.emit({ type: 'placed', order: o });
    return true;
  }

  cancelOrder(id: string) {
    const o = this.account.orders.find((x) => x.id === id);
    if (!o) return;
    const t = Date.now() / 1000;
    const record: OrderRecord = { id: o.id, sym: o.sym, kind: o.type, lots: o.lots, price: o.stopLimit ?? o.price, sl: o.sl, tp: o.tp, placedAt: o.placedAt, doneAt: t, state: 'canceled' };
    this.commit(recordOrder({ ...this.account, orders: this.account.orders.filter((x) => x.id !== id) }, record));
    this.emit({ type: 'canceled', record });
  }

  modifyOrder(id: string, price: number, stopLimit: number | null, sl: number | null, tp: number | null): boolean {
    const o = this.account.orders.find((x) => x.id === id);
    if (!o) return false;
    const e = validatePending(o.type, price, stopLimit, sl, tp, quote(o.sym, Date.now() / 1000));
    if (e) return this.err(e);
    this.commit({ ...this.account, orders: this.account.orders.map((x) => (x.id === id ? { ...x, price, stopLimit: o.type.endsWith('stop_limit') ? stopLimit : null, sl, tp } : x)) });
    return true;
  }

  close(id: string, reason: CloseReason = 'manual', t = Date.now() / 1000) {
    const p = this.account.positions.find((x) => x.id === id);
    if (!p) return;
    if (reason === 'manual' && !quote(p.sym, t).open) {
      this.err(`${SYMBOL_MAP[p.sym].name}: market closed. Position will be closable at the open.`);
      return;
    }
    const [next, deal] = closeInternal(this.account, p, reason, t);
    this.commit(next);
    this.emit({ type: 'close', deal });
    this.checkBlown(t);
  }

  closeWhere(pred: (p: Position, profit: number) => boolean) {
    const t = Date.now() / 1000;
    let acc = this.account;
    const deals: Deal[] = [];
    for (const p of [...acc.positions]) {
      const q = quote(p.sym, t);
      if (!q.open || !pred(p, positionProfit(p, q))) continue;
      const [next, deal] = closeInternal(acc, p, 'manual', t);
      acc = next;
      deals.push(deal);
    }
    if (!deals.length) return;
    this.commit(acc);
    deals.forEach((deal) => this.emit({ type: 'close', deal }));
    this.checkBlown(t);
  }

  /** MT5-style modify: rejects levels that would trigger instantly. */
  modify(id: string, sl: number | null, tp: number | null): boolean {
    const p = this.account.positions.find((x) => x.id === id);
    if (!p) return false;
    const q = quote(p.sym, Date.now() / 1000);
    const px = p.side === 1 ? q.bid : q.ask;
    if (sl !== null && (p.side === 1 ? sl >= px : sl <= px)) return this.err(sl === p.open ? 'Breakeven unavailable: position is not in profit.' : 'Invalid stops: stop loss is through the market.');
    if (tp !== null && (p.side === 1 ? tp <= px : tp >= px)) return this.err('Invalid stops: take profit is through the market.');
    this.commit({ ...this.account, positions: this.account.positions.map((x) => (x.id === id ? { ...x, sl, tp } : x)) });
    return true;
  }

  private apply(next: AccountState, events: SimEvent[], away: boolean) {
    if (next === this.account) return;
    this.commit(next);
    if (next.lockedUntil) this.flush();
    for (const e of events) this.emit({ ...e, away });
  }

  /**
   * Called ~4x/sec. Triggers pending orders, SL/TP and broker stop-out.
   * Time the app spent asleep or closed is replayed on the absolute GRID (same
   * as the push forecaster) and fills happen at the moment the level was hit.
   */
  tick() {
    const now = Date.now() / 1000;
    const from = this.account.checkedAt ?? now;
    this.account.checkedAt = now;
    if (this.account.lockedUntil || (!this.account.positions.length && !this.account.orders.length)) return;
    if (now - from > GRID) {
      const span = Math.min(now - from, 3 * 86400);
      const [next, ev] = advance(this.account, now - span, now);
      this.apply({ ...next, checkedAt: now }, ev, now - from > 30);
    }
    const [next, ev] = settleAt(this.account, now);
    this.apply(next, ev, false);
  }

  private checkBlown(t: number) {
    const a = this.account;
    if (!a.lockedUntil && a.positions.length === 0 && a.balance < 1) {
      const [next, ev] = freeze(a, t, 'Equity depleted');
      this.apply(next, ev, false);
    }
  }

  isFrozen(t = Date.now() / 1000): boolean {
    const u = this.account.lockedUntil;
    return !!u && t < u;
  }

  /** Review pending = frozen, or the timer ran out but the new credit line isn't accepted yet. */
  underReview(): boolean {
    return !!this.account.lockedUntil;
  }

  /** After the lockout: approve a fresh €100 credit line on the same login. */
  completeReview(serverCount?: number | null): boolean {
    if (!this.account.lockedUntil || this.isFrozen()) return false;
    const local = this.account.blownCount + 1;
    this.commit(freshAccount(this.account.login, Math.max(local, serverCount ?? 0)));
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
