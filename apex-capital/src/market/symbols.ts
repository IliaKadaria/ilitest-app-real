export type AssetClass = 'fx' | 'metal' | 'tech';
/** fx: Sun 22:00 → Fri 22:00 UTC. metal: same + daily 22:00–23:00 UTC break. always: 24/7. */
export type Session = 'fx' | 'metal' | 'always';

export interface SymbolDef {
  id: string;
  name: string;
  desc: string;
  cls: AssetClass;
  session: Session;
  /** Two-letter monogram for the instrument badge. */
  mono: string;
  base: number;
  /** Target std-dev of 1-minute log return. */
  vol1m: number;
  /** Spread in price units (normal conditions). */
  spread: number;
  /** Units per 1.00 lot. */
  contract: number;
  digits: number;
  leverage: number;
  /** USD-base pairs (USD/JPY): P&L is in the quote currency, convert by dividing by price. */
  usdBase?: boolean;
  /** How hard instrument-specific news hits (log-return units). */
  newsMag: number;
  /** Sensitivity to macro (risk-on = +1) events. */
  beta: number;
}

export const SYMBOLS: SymbolDef[] = [
  // ---------------- Forex (24/5)
  { id: 'EURUSD', name: 'EUR/USD', desc: 'Euro vs US Dollar', cls: 'fx', session: 'fx', mono: 'EU', base: 1.0842, vol1m: 0.00025, spread: 0.00008, contract: 100000, digits: 5, leverage: 500, newsMag: 0.0025, beta: 0.7 },
  { id: 'GBPUSD', name: 'GBP/USD', desc: 'British Pound vs US Dollar', cls: 'fx', session: 'fx', mono: 'GB', base: 1.271, vol1m: 0.0003, spread: 0.00012, contract: 100000, digits: 5, leverage: 500, newsMag: 0.003, beta: 0.7 },
  { id: 'USDJPY', name: 'USD/JPY', desc: 'US Dollar vs Japanese Yen', cls: 'fx', session: 'fx', mono: 'JP', base: 151.2, vol1m: 0.0003, spread: 0.01, contract: 100000, digits: 3, leverage: 500, usdBase: true, newsMag: 0.003, beta: -0.8 },
  // ---------------- Metals (24/5, daily break)
  { id: 'XAUUSD', name: 'XAU/USD', desc: 'Gold Spot', cls: 'metal', session: 'metal', mono: 'Au', base: 2650, vol1m: 0.0005, spread: 0.22, contract: 100, digits: 2, leverage: 200, newsMag: 0.006, beta: 0.9 },
  { id: 'XAGUSD', name: 'XAG/USD', desc: 'Silver Spot', cls: 'metal', session: 'metal', mono: 'Ag', base: 31.2, vol1m: 0.0008, spread: 0.022, contract: 5000, digits: 3, leverage: 200, newsMag: 0.009, beta: 1.0 },
  // ---------------- US Tech (simulated venue, open 24/7)
  { id: 'ATX100', name: 'ATX100', desc: 'Apex Tech 100 Index', cls: 'tech', session: 'always', mono: 'AT', base: 21000, vol1m: 0.0006, spread: 1.2, contract: 10, digits: 1, leverage: 200, newsMag: 0.007, beta: 1.0 },
  { id: 'NVRA', name: 'NVRA', desc: 'Novara Semiconductor', cls: 'tech', session: 'always', mono: 'NV', base: 182.4, vol1m: 0.0015, spread: 0.06, contract: 100, digits: 2, leverage: 20, newsMag: 0.03, beta: 1.4 },
  { id: 'QBTX', name: 'QBTX', desc: 'Qubitron Quantum Systems', cls: 'tech', session: 'always', mono: 'QB', base: 64.1, vol1m: 0.0022, spread: 0.04, contract: 100, digits: 2, leverage: 20, newsMag: 0.045, beta: 1.8 },
  { id: 'HELX', name: 'HELX', desc: 'Helix Robotics', cls: 'tech', session: 'always', mono: 'HX', base: 312.5, vol1m: 0.0016, spread: 0.1, contract: 100, digits: 2, leverage: 20, newsMag: 0.03, beta: 1.3 },
];

export const SYMBOL_MAP: Record<string, SymbolDef> = Object.fromEntries(SYMBOLS.map((s) => [s.id, s]));

export const CLASS_LABEL: Record<AssetClass, string> = { fx: 'Forex', metal: 'Metals', tech: 'US Tech · 24/7' };

export function fmtPrice(sym: SymbolDef, p: number): string {
  return p.toFixed(sym.digits);
}

/** Notional value in account currency. */
export function notional(sym: SymbolDef, lots: number, price: number): number {
  return sym.usdBase ? lots * sym.contract : lots * sym.contract * price;
}

/** P&L in account currency for a price difference. */
export function pnlFor(sym: SymbolDef, diff: number, lots: number, price: number): number {
  const raw = diff * lots * sym.contract;
  return sym.usdBase ? raw / price : raw;
}

// ---------------------------------------------------------------- sessions

const DAY = 86400;
const H = 3600;

/** Unix seconds of the Sunday 00:00 UTC that starts t's week. */
function weekStart(t: number): number {
  const d = new Date(t * 1000);
  return Math.floor(t / DAY) * DAY - d.getUTCDay() * DAY;
}

/**
 * Effective market time: t itself while the market is open, otherwise the
 * moment it last closed (prices freeze during closures, gap on reopen).
 */
export function effectiveTime(sym: SymbolDef, t: number): number {
  if (sym.session === 'always') return t;
  const ws = weekStart(t);
  const open = ws + (sym.session === 'metal' ? 23 : 22) * H; // Sunday
  const close = ws + 5 * DAY + 22 * H; // Friday 22:00
  if (t < open) return ws - 7 * DAY + 5 * DAY + 22 * H; // last Friday close
  if (t >= close) return close;
  if (sym.session === 'metal') {
    const dayStart = Math.floor(t / DAY) * DAY;
    const dow = new Date(t * 1000).getUTCDay();
    if (dow >= 1 && dow <= 4 && t >= dayStart + 22 * H && t < dayStart + 23 * H) return dayStart + 22 * H;
  }
  return t;
}

export function isOpen(sym: SymbolDef, t: number): boolean {
  return effectiveTime(sym, t) === t;
}

/** Next opening time (unix sec) if closed, else t. */
export function nextOpen(sym: SymbolDef, t: number): number {
  if (isOpen(sym, t)) return t;
  const ws = weekStart(t);
  const sundayOpen = (sym.session === 'metal' ? 23 : 22) * H;
  if (t < ws + sundayOpen) return ws + sundayOpen;
  if (t >= ws + 5 * DAY + 22 * H) return ws + 7 * DAY + sundayOpen;
  return Math.floor(t / DAY) * DAY + 23 * H; // metals daily break
}
