import { quote, type Quote } from '../market/engine.ts';
import { SYMBOL_MAP, notional, pnlFor } from '../market/symbols.ts';

export const START_BALANCE = 100;
/** Mandatory account-review lockout after a blown account (seconds). */
export const LOCKOUT_SECONDS = 5 * 3600;
/** Below this balance with nothing open, the account is considered blown. */
export const MIN_TRADABLE = 1;
export const STOP_OUT_LEVEL = 50; // %
export const MARGIN_CALL_LEVEL = 100; // %

export type Side = 1 | -1; // 1 = BUY, -1 = SELL
export type CloseReason = 'manual' | 'tp' | 'sl' | 'stopout' | 'frozen';

export interface Position {
  id: string;
  sym: string;
  side: Side;
  lots: number;
  open: number;
  openTime: number;
  sl: number | null;
  tp: number | null;
}

export interface Deal extends Omit<Position, 'sl' | 'tp'> {
  close: number;
  closeTime: number;
  profit: number;
  reason: CloseReason;
}

export interface AccountState {
  balance: number;
  positions: Position[];
  history: Deal[];
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

export function freshAccount(blownCount = 0): AccountState {
  return {
    balance: START_BALANCE,
    positions: [],
    history: [],
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

export function closePrice(p: Position, q: Quote): number {
  return p.side === 1 ? q.bid : q.ask;
}

export function positionProfit(p: Position, q: Quote): number {
  const px = closePrice(p, q);
  return pnlFor(SYMBOL_MAP[p.sym], (px - p.open) * p.side, p.lots, px);
}

export function requiredMargin(sym: string, lots: number, price: number): number {
  const def = SYMBOL_MAP[sym];
  return notional(def, lots, price) / def.leverage;
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
    const q = quotes[p.sym];
    floating += positionProfit(p, q);
    margin += requiredMargin(p.sym, p.lots, p.open);
  }
  const equity = acc.balance + floating;
  return { balance: acc.balance, equity, floating, margin, free: equity - margin, level: margin > 0 ? (equity / margin) * 100 : null };
}

let idCounter = 0;
export function newId(): string {
  idCounter = (idCounter + 1) % 1e6;
  return `${Date.now().toString(36)}${idCounter.toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
}

/** Current quotes for every symbol the account touches (plus extras). */
export function quotesFor(acc: AccountState, t: number, extra: string[] = []): Record<string, Quote> {
  const out: Record<string, Quote> = {};
  for (const p of acc.positions) if (!out[p.sym]) out[p.sym] = quote(p.sym, t);
  for (const s of extra) if (!out[s]) out[s] = quote(s, t);
  return out;
}
