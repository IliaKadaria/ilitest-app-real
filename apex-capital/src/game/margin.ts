import { notional, quote, type Quote } from '../market/engine.ts';
import { SYMBOL_MAP } from '../market/symbols.ts';
import type { AccountState, Position } from './account.ts';

// ---------------------------------------------------------------------------
// Margin account (Reg-T style), used by "Margin 2:1" accounts and by every
// competition. All money is in the account currency (EUR).
//
//   Cash               = what you hold in currency. Buying on margin pushes it
//                        below zero (that negative part is the loan); selling
//                        short adds the sale proceeds.
//   Position Value     = market value of what you hold, marked to market:
//                        longs count positive, shorts negative.
//   Total Equity       = Cash + Position Value   (what you would keep if you
//                        closed everything right now)
//   Gross Exposure     = |longs| + |shorts|
//   Maintenance Req.   = MAINTENANCE_PCT × Gross Exposure
//   Used Margin        = borrowed amount = max(0, Gross Exposure − Total Equity)
//   Buying Power       = MAX_LEVERAGE × Total Equity − Gross Exposure
//
// Margin call: Total Equity < Maintenance Requirement. The account is then
// liquidated position by position (biggest loser first) until it complies.
// ---------------------------------------------------------------------------

export interface MarginRules {
  /** Max leverage: gross exposure may reach maxLeverage × equity (2:1). */
  maxLeverage: number;
  /** Maintenance margin as a share of gross exposure. */
  maintenancePct: number;
  /** Warn once equity falls within this multiple of the requirement. */
  warningBuffer: number;
}
export const MARGIN_RULES: MarginRules = { maxLeverage: 2, maintenancePct: 0.3, warningBuffer: 1.25 };

export type MarginStatus = 'ok' | 'warning' | 'margin_call';

export interface HoldingValue {
  positionId: string;
  sym: string;
  /** Signed market value (shorts negative). */
  marketValue: number;
  /** Market value at entry (signed). */
  costBasis: number;
  unrealized: number;
}

export interface MarginSnapshot {
  cash: number;
  positionValue: number;
  totalEquity: number;
  grossExposure: number;
  maintenanceRequirement: number;
  usedMargin: number;
  buyingPower: number;
  /** Equity above the maintenance requirement (negative = in margin call). */
  excessEquity: number;
  /** Gross exposure ÷ equity. */
  leverage: number;
  status: MarginStatus;
  holdings: HoldingValue[];
}

function signedValue(p: Position, price: number, t: number): number {
  return p.side * notional(SYMBOL_MAP[p.sym], p.lots, price, t);
}

/** Value every holding at its closing price (bid for longs, ask for shorts). */
export function valueHoldings(positions: Position[], quotes: Record<string, Quote>, t: number): HoldingValue[] {
  return positions.map((p) => {
    const q = quotes[p.sym] ?? quote(p.sym, t);
    const px = p.side === 1 ? q.bid : q.ask;
    const marketValue = signedValue(p, px, q.t);
    const costBasis = signedValue(p, p.open, q.t);
    return { positionId: p.id, sym: p.sym, marketValue, costBasis, unrealized: marketValue - costBasis };
  });
}

export function marginSnapshot(acc: Pick<AccountState, 'balance' | 'positions'>, quotes: Record<string, Quote>, t = Date.now() / 1000, rules: MarginRules = MARGIN_RULES): MarginSnapshot {
  const holdings = valueHoldings(acc.positions, quotes, t);
  const positionValue = holdings.reduce((s, h) => s + h.marketValue, 0);
  const grossExposure = holdings.reduce((s, h) => s + Math.abs(h.marketValue), 0);
  // Cash = realized balance minus what longs cost plus what shorts raised.
  const cash = acc.balance - holdings.reduce((s, h) => s + h.costBasis, 0);
  const totalEquity = cash + positionValue; // = balance + unrealized
  const maintenanceRequirement = rules.maintenancePct * grossExposure;
  const usedMargin = Math.max(0, grossExposure - totalEquity);
  const buyingPower = Math.max(0, rules.maxLeverage * totalEquity - grossExposure);
  const excessEquity = totalEquity - maintenanceRequirement;
  return {
    cash,
    positionValue,
    totalEquity,
    grossExposure,
    maintenanceRequirement,
    usedMargin,
    buyingPower,
    excessEquity,
    leverage: totalEquity > 0 ? grossExposure / totalEquity : Infinity,
    status: checkMarginCall({ totalEquity, maintenanceRequirement, grossExposure }, rules),
    holdings,
  };
}

/** The margin-call test on its own. */
export function checkMarginCall(s: { totalEquity: number; maintenanceRequirement: number; grossExposure: number }, rules: MarginRules = MARGIN_RULES): MarginStatus {
  if (s.grossExposure <= 0) return 'ok';
  if (s.totalEquity < s.maintenanceRequirement) return 'margin_call';
  if (s.totalEquity < s.maintenanceRequirement * rules.warningBuffer) return 'warning';
  return 'ok';
}

/** Can a new order of `orderValue` (unsigned, EUR) be opened within 2:1? */
export function canOpen(s: MarginSnapshot, orderValue: number, rules: MarginRules = MARGIN_RULES): { ok: boolean; reason?: string } {
  if (orderValue <= s.buyingPower + 1e-9) return { ok: true };
  return { ok: false, reason: `Exceeds ${rules.maxLeverage}:1 leverage: buying power is €${s.buyingPower.toFixed(2)}, the order is €${orderValue.toFixed(2)}.` };
}

/** Margin required to hold an order on a margin account (EUR). */
export function marginAccountRequirement(sym: string, lots: number, price: number, t: number): number {
  return notional(SYMBOL_MAP[sym], lots, price, t) / MARGIN_RULES.maxLeverage;
}

/**
 * Which positions to close, in order, to bring the account back into
 * compliance. Biggest loser first; stops as soon as equity covers the
 * requirement again. Pure: returns ids, the caller closes them.
 */
export function liquidationPlan(acc: Pick<AccountState, 'balance' | 'positions'>, quotes: Record<string, Quote>, t: number, rules: MarginRules = MARGIN_RULES): string[] {
  let s = marginSnapshot(acc, quotes, t, rules);
  if (s.status !== 'margin_call') return [];
  const plan: string[] = [];
  let left = [...acc.positions];
  const order = [...s.holdings].sort((a, b) => a.unrealized - b.unrealized);
  let balance = acc.balance;
  for (const h of order) {
    plan.push(h.positionId);
    balance += h.unrealized;
    left = left.filter((p) => p.id !== h.positionId);
    s = marginSnapshot({ balance, positions: left }, quotes, t, rules);
    if (s.status !== 'margin_call') break;
  }
  return plan;
}
