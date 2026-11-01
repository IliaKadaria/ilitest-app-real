import { quote } from '../market/engine.ts';
import {
  HISTORY_LIMIT,
  LOCKOUT_SECONDS,
  MIN_TRADABLE,
  STOP_OUT_LEVEL,
  closePrice,
  metrics,
  positionProfit,
  quotesFor,
  requiredMargin,
  sideOf,
  type AccountState,
  type CloseReason,
  type Deal,
  type OrderRecord,
  type PendingOrder,
  type Position,
} from './account.ts';

// ---------------------------------------------------------------------------
// Pure account simulation. The store uses it live and to replay time the app
// spent closed; the notification forecaster runs the exact same code forward,
// on the same absolute time grid, so a "Take profit filled" push matches the
// fill you see when you reopen the app.
// ---------------------------------------------------------------------------

/** Replay / forecast grid (seconds). Absolute multiples, so every run checks identical instants. */
export const GRID = 5;

export type SimEvent =
  | { type: 'close'; deal: Deal }
  | { type: 'stopout'; deal: Deal }
  | { type: 'fill'; pos: Position; record: OrderRecord }
  | { type: 'order_done'; record: OrderRecord }
  | { type: 'frozen'; until: number; reason: string };

export function closeInternal(acc: AccountState, p: Position, reason: CloseReason, t: number): [AccountState, Deal] {
  const q = quote(p.sym, t);
  const profit = positionProfit(p, q);
  const deal: Deal = { ...p, close: closePrice(p, q), closeTime: t, profit, reason };
  const balance = acc.balance + profit;
  return [
    {
      ...acc,
      balance,
      positions: acc.positions.filter((x) => x.id !== p.id),
      history: [deal, ...acc.history].slice(0, HISTORY_LIMIT),
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

export function recordOrder(acc: AccountState, r: OrderRecord): AccountState {
  return { ...acc, orderHistory: [r, ...acc.orderHistory].slice(0, HISTORY_LIMIT) };
}

function pendingRecord(o: PendingOrder, t: number, state: OrderRecord['state'], fillPrice?: number, note?: string): OrderRecord {
  return { id: o.id, sym: o.sym, kind: o.type, lots: o.lots, price: o.stopLimit ?? o.price, sl: o.sl, tp: o.tp, placedAt: o.placedAt, doneAt: t, state, fillPrice, note };
}

/** Blown account: liquidate everything at time t, cancel orders and freeze for review. */
export function freeze(acc: AccountState, t: number, reason: string): [AccountState, SimEvent[]] {
  const events: SimEvent[] = [];
  const order = [...acc.positions].sort((x, y) => positionProfit(x, quote(x.sym, t)) - positionProfit(y, quote(y.sym, t)));
  for (const p of order) {
    const [next, deal] = closeInternal(acc, p, 'stopout', t);
    acc = next;
    events.push({ type: 'stopout', deal });
  }
  for (const o of acc.orders) {
    const r = pendingRecord(o, t, 'canceled', undefined, 'Account frozen');
    acc = recordOrder(acc, r);
  }
  const until = t + LOCKOUT_SECONDS;
  // Negative balance protection (as EU retail brokers must): gaps never leave you owing money.
  const lockReason = acc.balance < 0 ? `${reason} · negative balance protection applied` : reason;
  acc = { ...acc, orders: [], balance: Math.max(0, acc.balance), lockedUntil: until, lockReason };
  events.push({ type: 'frozen', until, reason });
  return [acc, events];
}

/** One evaluation at time t. Returns null if nothing happened. */
export function checkAt(acc: AccountState, t: number): [AccountState, SimEvent[]] | null {
  if (acc.lockedUntil) return null;
  // 1) pending orders: expiry + triggers
  for (const o of acc.orders) {
    if (o.expiresAt !== null && t >= o.expiresAt) {
      const r = pendingRecord(o, o.expiresAt, 'expired');
      return [recordOrder({ ...acc, orders: acc.orders.filter((x) => x.id !== o.id) }, r), [{ type: 'order_done', record: r }]];
    }
    const q = quote(o.sym, t);
    if (!q.open) continue;
    const side = sideOf(o.type);
    const px = side === 1 ? q.ask : q.bid;
    const hit =
      o.type === 'buy_limit' ? q.ask <= o.price :
      o.type === 'sell_limit' ? q.bid >= o.price :
      o.type === 'buy_stop' || o.type === 'buy_stop_limit' ? q.ask >= o.price :
      q.bid <= o.price;
    if (!hit) continue;
    if (o.type === 'buy_stop_limit' || o.type === 'sell_stop_limit') {
      // stop traded → becomes a limit order at the stop-limit price (MT5 behaviour)
      const lim: PendingOrder = { ...o, type: side === 1 ? 'buy_limit' : 'sell_limit', price: o.stopLimit ?? o.price, stopLimit: null };
      return [{ ...acc, orders: acc.orders.map((x) => (x.id === o.id ? lim : x)) }, []];
    }
    const without = { ...acc, orders: acc.orders.filter((x) => x.id !== o.id) };
    const m = metrics(without, quotesFor(without, t));
    const need = requiredMargin(o.sym, o.lots, px, t);
    if (need > m.free) {
      const r = pendingRecord(o, t, 'rejected', undefined, `No money: €${need.toFixed(2)} margin required`);
      return [recordOrder(without, r), [{ type: 'order_done', record: r }]];
    }
    const pos: Position = { id: o.id, sym: o.sym, side, lots: o.lots, open: px, openTime: t, sl: o.sl, tp: o.tp, orderKind: o.type };
    const r = pendingRecord(o, t, 'filled', px);
    return [recordOrder({ ...without, positions: [pos, ...without.positions] }, r), [{ type: 'fill', pos, record: r }]];
  }
  // 2) SL / TP
  for (const p of acc.positions) {
    const q = quote(p.sym, t);
    const px = closePrice(p, q);
    const reason: CloseReason | null =
      p.tp !== null && (p.side === 1 ? px >= p.tp : px <= p.tp) ? 'tp' : p.sl !== null && (p.side === 1 ? px <= p.sl : px >= p.sl) ? 'sl' : null;
    if (!reason) continue;
    const [next, deal] = closeInternal(acc, p, reason, t);
    const ev: SimEvent[] = [{ type: 'close', deal }];
    if (!next.positions.length && next.balance < MIN_TRADABLE) {
      const [frozen, fe] = freeze(next, t, 'Equity depleted');
      return [frozen, [...ev, ...fe]];
    }
    return [next, ev];
  }
  // 3) broker stop-out
  if (acc.positions.length) {
    const m = metrics(acc, quotesFor(acc, t));
    if (m.equity <= 0 || (m.level !== null && m.level < STOP_OUT_LEVEL)) return freeze(acc, t, m.equity <= 0 ? 'Equity depleted' : `Stop-out at ${STOP_OUT_LEVEL}% margin level`);
  }
  return null;
}

/** Run checkAt until stable at time t (one tick can close several positions). */
export function settleAt(acc: AccountState, t: number): [AccountState, SimEvent[]] {
  const out: SimEvent[] = [];
  for (let i = 0; i < 40; i++) {
    const r = checkAt(acc, t);
    if (!r) break;
    acc = r[0];
    out.push(...r[1]);
  }
  return [acc, out];
}

const active = (a: AccountState) => !a.lockedUntil && (a.positions.length > 0 || a.orders.length > 0);

/** Replay every grid instant in (from, to). */
export function advance(acc: AccountState, from: number, to: number, onEvent?: (e: SimEvent, t: number) => boolean | void): [AccountState, SimEvent[]] {
  const out: SimEvent[] = [];
  for (let t = Math.floor(from / GRID) * GRID + GRID; t < to && active(acc); t += GRID) {
    const [next, ev] = settleAt(acc, t);
    acc = next;
    for (const e of ev) {
      out.push(e);
      if (onEvent?.(e, t) === false) return [acc, out];
    }
  }
  return [acc, out];
}
