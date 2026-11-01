import { notional, pnlFor, quote, type Quote } from '../market/engine.ts';
import { SYMBOL_MAP } from '../market/symbols.ts';

export const START_BALANCE = 100;
/** Mandatory account-review lockout after a blown account (seconds). */
export const LOCKOUT_SECONDS = 5 * 3600;
/** Below this balance with nothing open, the account is considered blown. */
export const MIN_TRADABLE = 1;
export const STOP_OUT_LEVEL = 50; // %
export const MARGIN_CALL_LEVEL = 100; // %
export const HISTORY_LIMIT = 500;

export type Side = 1 | -1; // 1 = BUY, -1 = SELL
export type CloseReason = 'manual' | 'tp' | 'sl' | 'stopout' | 'frozen';

/** MT5 pending order types. */
export type PendingType = 'buy_limit' | 'sell_limit' | 'buy_stop' | 'sell_stop' | 'buy_stop_limit' | 'sell_stop_limit';
export type OrderKind = 'buy' | 'sell' | PendingType;
export type Expiry = { mode: 'gtc' } | { mode: 'today' } | { mode: 'specified'; at: number };

export const PENDING_LABEL: Record<OrderKind, string> = {
  buy: 'Buy',
  sell: 'Sell',
  buy_limit: 'Buy Limit',
  sell_limit: 'Sell Limit',
  buy_stop: 'Buy Stop',
  sell_stop: 'Sell Stop',
  buy_stop_limit: 'Buy Stop Limit',
  sell_stop_limit: 'Sell Stop Limit',
};

export const sideOf = (k: OrderKind): Side => (k.startsWith('buy') ? 1 : -1);

export interface Position {
  id: string;
  sym: string;
  side: Side;
  lots: number;
  open: number;
  openTime: number;
  sl: number | null;
  tp: number | null;
  /** Order that opened it (market ticket or triggered pending order). */
  orderKind?: OrderKind;
}

export interface Deal extends Position {
  close: number;
  closeTime: number;
  profit: number;
  reason: CloseReason;
}

export interface PendingOrder {
  id: string;
  sym: string;
  type: PendingType;
  lots: number;
  /** Trigger price (the stop price for stop-limit orders). */
  price: number;
  /** Stop-limit only: the limit order placed once `price` trades. */
  stopLimit: number | null;
  sl: number | null;
  tp: number | null;
  placedAt: number;
  /** Unix sec, null = Good till cancelled. */
  expiresAt: number | null;
}

export interface OrderRecord {
  id: string;
  sym: string;
  kind: OrderKind;
  lots: number;
  /** Requested price (market: price shown on the ticket). */
  price: number;
  sl: number | null;
  tp: number | null;
  placedAt: number;
  doneAt: number;
  state: 'filled' | 'canceled' | 'expired' | 'rejected';
  fillPrice?: number;
  note?: string;
}

export interface AccountState {
  /** MT5-style account number. */
  login: number;
  balance: number;
  positions: Position[];
  orders: PendingOrder[];
  history: Deal[];
  orderHistory: OrderRecord[];
  totalProfit: number;
  bestTrade: number;
  worstTrade: number;
  wins: number;
  losses: number;
  peakBalance: number;
  blownCount: number;
  createdAt: number;
  /** Last time SL/TP/stop-out were evaluated (unix sec). Persisted for replay. */
  checkedAt?: number;
  /** Account frozen for review until this unix time (sec). */
  lockedUntil?: number | null;
  /** Why it was frozen (shown on the review screen). */
  lockReason?: string | null;
}

export function freshAccount(login: number, blownCount = 0): AccountState {
  return {
    login,
    balance: START_BALANCE,
    positions: [],
    orders: [],
    history: [],
    orderHistory: [],
    totalProfit: 0,
    bestTrade: 0,
    worstTrade: 0,
    wins: 0,
    losses: 0,
    peakBalance: START_BALANCE,
    blownCount,
    createdAt: Date.now(),
    checkedAt: Date.now() / 1000,
  };
}

export function closePrice(p: { side: Side }, q: Quote): number {
  return p.side === 1 ? q.bid : q.ask;
}

export function positionProfit(p: Position, q: Quote): number {
  const px = closePrice(p, q);
  return pnlFor(SYMBOL_MAP[p.sym], (px - p.open) * p.side, p.lots, q.t);
}

export function requiredMargin(sym: string, lots: number, price: number, t: number): number {
  const def = SYMBOL_MAP[sym];
  return notional(def, lots, price, t) / def.leverage;
}

export interface Metrics {
  balance: number;
  equity: number;
  floating: number;
  margin: number;
  free: number;
  level: number | null;
}

export function metrics(acc: AccountState, quotes: Record<string, Quote>): Metrics {
  let floating = 0;
  let margin = 0;
  for (const p of acc.positions) {
    const q = quotes[p.sym] ?? quote(p.sym, Date.now() / 1000);
    floating += positionProfit(p, q);
    margin += requiredMargin(p.sym, p.lots, p.open, q.t);
  }
  const equity = acc.balance + floating;
  return { balance: acc.balance, equity, floating, margin, free: equity - margin, level: margin > 0 ? (equity / margin) * 100 : null };
}

let idCounter = 0;
export function newId(): string {
  idCounter = (idCounter + 1) % 1e6;
  return `${Date.now().toString(36)}${idCounter.toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
}

/** Numeric MT5-looking ticket for display. */
export function ticketNo(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (Math.imul(h, 31) + id.charCodeAt(i)) >>> 0;
  return String(10_000_000 + (h % 89_999_999));
}

/** Current quotes for every symbol the account touches (plus extras). */
export function quotesFor(acc: AccountState, t: number, extra: string[] = []): Record<string, Quote> {
  const out: Record<string, Quote> = {};
  for (const p of acc.positions) if (!out[p.sym]) out[p.sym] = quote(p.sym, t);
  for (const s of extra) if (!out[s]) out[s] = quote(s, t);
  return out;
}

/** Validates a pending order against the market. Returns an error message or null. */
export function validatePending(type: PendingType, price: number, stopLimit: number | null, sl: number | null, tp: number | null, q: Quote): string | null {
  if (!Number.isFinite(price) || price <= 0) return 'Invalid price.';
  switch (type) {
    case 'buy_limit':
      if (price >= q.ask) return 'Buy Limit must be below the Ask.';
      break;
    case 'sell_limit':
      if (price <= q.bid) return 'Sell Limit must be above the Bid.';
      break;
    case 'buy_stop':
      if (price <= q.ask) return 'Buy Stop must be above the Ask.';
      break;
    case 'sell_stop':
      if (price >= q.bid) return 'Sell Stop must be below the Bid.';
      break;
    case 'buy_stop_limit':
      if (price <= q.ask) return 'Buy Stop Limit: stop price must be above the Ask.';
      if (stopLimit === null || !(stopLimit < price)) return 'Buy Stop Limit: limit price must be below the stop price.';
      break;
    case 'sell_stop_limit':
      if (price >= q.bid) return 'Sell Stop Limit: stop price must be below the Bid.';
      if (stopLimit === null || !(stopLimit > price)) return 'Sell Stop Limit: limit price must be above the stop price.';
      break;
  }
  const entry = stopLimit ?? price;
  const side = sideOf(type);
  if (sl !== null && (side === 1 ? sl >= entry : sl <= entry)) return 'Invalid stop loss for this entry price.';
  if (tp !== null && (side === 1 ? tp <= entry : tp >= entry)) return 'Invalid take profit for this entry price.';
  return null;
}

/** Account balance after each closed deal, oldest first (for the equity curve). */
export function balanceCurve(acc: AccountState): { t: number; balance: number }[] {
  const deals = [...acc.history].sort((a, b) => a.closeTime - b.closeTime);
  let bal = acc.balance - deals.reduce((s, d) => s + d.profit, 0);
  const out = [{ t: acc.createdAt / 1000, balance: bal }];
  for (const d of deals) {
    bal += d.profit;
    out.push({ t: d.closeTime, balance: bal });
  }
  return out;
}
