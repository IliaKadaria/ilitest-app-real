export type AssetClass = 'fx' | 'metal' | 'nasdaq';
/** fx: Sun 22:00 → Fri 22:00 UTC. metal: same + daily 22:00–23:00 UTC break. always: 24/7. */
export type Session = 'fx' | 'metal' | 'always';
export type Ccy = 'USD' | 'EUR' | 'GBP' | 'JPY' | 'CHF' | 'AUD' | 'CAD' | 'NZD';

/** The account is denominated in EUR. */
export const ACCOUNT_CCY: Ccy = 'EUR';

export interface SymbolDef {
  id: string;
  name: string;
  desc: string;
  cls: AssetClass;
  session: Session;
  /** Two-letter monogram for the instrument badge. */
  mono: string;
  /** Reference price (primaries are simulated around it; crosses derive from their legs). */
  base: number;
  /** Target std-dev of 1-minute log return. */
  vol1m: number;
  /** Spread in price units (normal conditions). */
  spread: number;
  /** Units per 1.00 lot. */
  contract: number;
  digits: number;
  leverage: number;
  /** Currency the P&L is booked in (converted to the EUR account at the live rate). */
  quoteCcy: Ccy;
  /** Crosses: price = a × b or a ÷ b of two simulated legs (triangular consistency). */
  derive?: { a: string; b: string; op: 'mul' | 'div' };
  /** How hard instrument-specific news hits (log-return units). */
  newsMag: number;
  /** Sensitivity to macro (risk-on = +1) events. */
  beta: number;
  /** Relative odds of being the subject of a headline. */
  newsWeight?: number;
}

type FxRow = [id: string, desc: string, mono: string, base: number, vol1m: number, spread: number, quote: Ccy, beta: number, derive?: SymbolDef['derive']];

const fx = (rows: FxRow[]): SymbolDef[] =>
  rows.map(([id, desc, mono, base, vol1m, spread, quoteCcy, beta, derive]) => ({
    id,
    name: `${id.slice(0, 3)}/${id.slice(3)}`,
    desc,
    cls: 'fx',
    session: 'fx',
    mono,
    base,
    vol1m,
    spread,
    contract: 100000,
    digits: quoteCcy === 'JPY' ? 3 : 5,
    leverage: 500,
    quoteCcy,
    derive,
    newsMag: 0.0028,
    beta,
    newsWeight: derive ? 0 : ['EURUSD', 'GBPUSD', 'USDJPY'].includes(id) ? 3 : 1.5,
  }));

const FX: SymbolDef[] = fx([
  ['EURUSD', 'Euro vs US Dollar', 'EU', 1.0842, 0.00025, 0.00008, 'USD', 0.7],
  ['GBPUSD', 'British Pound vs US Dollar', 'GB', 1.271, 0.0003, 0.00012, 'USD', 0.7],
  ['USDJPY', 'US Dollar vs Japanese Yen', 'JP', 151.2, 0.0003, 0.012, 'JPY', -0.8],
  ['USDCHF', 'US Dollar vs Swiss Franc', 'CH', 0.882, 0.00026, 0.00012, 'CHF', -0.7],
  ['AUDUSD', 'Australian Dollar vs US Dollar', 'AU', 0.661, 0.0003, 0.0001, 'USD', 1.0],
  ['USDCAD', 'US Dollar vs Canadian Dollar', 'CA', 1.365, 0.00022, 0.00013, 'CAD', -0.6],
  ['NZDUSD', 'New Zealand Dollar vs US Dollar', 'NZ', 0.603, 0.00032, 0.00014, 'USD', 1.0],
  ['EURGBP', 'Euro vs British Pound', 'EG', 0, 0, 0.00012, 'GBP', 0, { a: 'EURUSD', b: 'GBPUSD', op: 'div' }],
  ['EURJPY', 'Euro vs Japanese Yen', 'EJ', 0, 0, 0.018, 'JPY', 0, { a: 'EURUSD', b: 'USDJPY', op: 'mul' }],
  ['GBPJPY', 'British Pound vs Japanese Yen', 'GJ', 0, 0, 0.025, 'JPY', 0, { a: 'GBPUSD', b: 'USDJPY', op: 'mul' }],
  ['EURCHF', 'Euro vs Swiss Franc', 'EC', 0, 0, 0.00015, 'CHF', 0, { a: 'EURUSD', b: 'USDCHF', op: 'mul' }],
  ['AUDJPY', 'Australian Dollar vs Japanese Yen', 'AJ', 0, 0, 0.016, 'JPY', 0, { a: 'AUDUSD', b: 'USDJPY', op: 'mul' }],
  ['EURAUD', 'Euro vs Australian Dollar', 'EA', 0, 0, 0.0002, 'AUD', 0, { a: 'EURUSD', b: 'AUDUSD', op: 'div' }],
  ['GBPCHF', 'British Pound vs Swiss Franc', 'GC', 0, 0, 0.0002, 'CHF', 0, { a: 'GBPUSD', b: 'USDCHF', op: 'mul' }],
  ['CADJPY', 'Canadian Dollar vs Japanese Yen', 'CJ', 0, 0, 0.018, 'JPY', 0, { a: 'USDJPY', b: 'USDCAD', op: 'div' }],
  ['EURCAD', 'Euro vs Canadian Dollar', 'EK', 0, 0, 0.0002, 'CAD', 0, { a: 'EURUSD', b: 'USDCAD', op: 'mul' }],
  ['NZDJPY', 'New Zealand Dollar vs Japanese Yen', 'NJ', 0, 0, 0.02, 'JPY', 0, { a: 'NZDUSD', b: 'USDJPY', op: 'mul' }],
  ['AUDCAD', 'Australian Dollar vs Canadian Dollar', 'AC', 0, 0, 0.0002, 'CAD', 0, { a: 'AUDUSD', b: 'USDCAD', op: 'mul' }],
]);

const metal = (s: Omit<SymbolDef, 'cls' | 'session' | 'leverage'> & { leverage?: number }): SymbolDef => ({ cls: 'metal', session: 'metal', leverage: 200, ...s });

const METALS: SymbolDef[] = [
  metal({ id: 'XAUUSD', name: 'XAU/USD', desc: 'Gold vs US Dollar', mono: 'Au', base: 2650, vol1m: 0.0005, spread: 0.22, contract: 100, digits: 2, quoteCcy: 'USD', newsMag: 0.006, beta: 0.9, newsWeight: 3 }),
  metal({ id: 'XAGUSD', name: 'XAG/USD', desc: 'Silver vs US Dollar', mono: 'Ag', base: 31.2, vol1m: 0.0008, spread: 0.022, contract: 5000, digits: 3, quoteCcy: 'USD', newsMag: 0.009, beta: 1.0, newsWeight: 2 }),
  metal({ id: 'XPTUSD', name: 'XPT/USD', desc: 'Platinum vs US Dollar', mono: 'Pt', base: 980, vol1m: 0.0008, spread: 0.9, contract: 100, digits: 2, quoteCcy: 'USD', newsMag: 0.009, beta: 1.0 }),
  metal({ id: 'XPDUSD', name: 'XPD/USD', desc: 'Palladium vs US Dollar', mono: 'Pd', base: 1020, vol1m: 0.0011, spread: 1.6, contract: 100, digits: 2, quoteCcy: 'USD', newsMag: 0.012, beta: 1.1 }),
  metal({ id: 'XCUUSD', name: 'COPPER', desc: 'Copper vs US Dollar (per lb)', mono: 'Cu', base: 4.45, vol1m: 0.0006, spread: 0.004, contract: 10000, digits: 4, quoteCcy: 'USD', newsMag: 0.008, beta: 1.2, leverage: 100 }),
  metal({ id: 'XALUSD', name: 'ALUMINIUM', desc: 'Aluminium vs US Dollar (per t)', mono: 'Al', base: 2550, vol1m: 0.0005, spread: 2.5, contract: 10, digits: 1, quoteCcy: 'USD', newsMag: 0.007, beta: 1.0, leverage: 100 }),
  metal({ id: 'XNIUSD', name: 'NICKEL', desc: 'Nickel vs US Dollar (per t)', mono: 'Ni', base: 16200, vol1m: 0.0008, spread: 22, contract: 1, digits: 0, quoteCcy: 'USD', newsMag: 0.01, beta: 1.1, leverage: 100 }),
  metal({ id: 'XZNUSD', name: 'ZINC', desc: 'Zinc vs US Dollar (per t)', mono: 'Zn', base: 2850, vol1m: 0.0006, spread: 3, contract: 10, digits: 1, quoteCcy: 'USD', newsMag: 0.008, beta: 1.0, leverage: 100 }),
  metal({ id: 'XPBUSD', name: 'LEAD', desc: 'Lead vs US Dollar (per t)', mono: 'Pb', base: 2050, vol1m: 0.0005, spread: 2.5, contract: 10, digits: 1, quoteCcy: 'USD', newsMag: 0.007, beta: 0.9, leverage: 100 }),
  metal({ id: 'XAUEUR', name: 'XAU/EUR', desc: 'Gold vs Euro', mono: 'Au', base: 0, vol1m: 0, spread: 0.3, contract: 100, digits: 2, quoteCcy: 'EUR', newsMag: 0, beta: 0, derive: { a: 'XAUUSD', b: 'EURUSD', op: 'div' } }),
  metal({ id: 'XAUGBP', name: 'XAU/GBP', desc: 'Gold vs British Pound', mono: 'Au', base: 0, vol1m: 0, spread: 0.3, contract: 100, digits: 2, quoteCcy: 'GBP', newsMag: 0, beta: 0, derive: { a: 'XAUUSD', b: 'GBPUSD', op: 'div' } }),
  metal({ id: 'XAUJPY', name: 'XAU/JPY', desc: 'Gold vs Japanese Yen', mono: 'Au', base: 0, vol1m: 0, spread: 45, contract: 100, digits: 0, quoteCcy: 'JPY', newsMag: 0, beta: 0, derive: { a: 'XAUUSD', b: 'USDJPY', op: 'mul' } }),
  metal({ id: 'XAUCHF', name: 'XAU/CHF', desc: 'Gold vs Swiss Franc', mono: 'Au', base: 0, vol1m: 0, spread: 0.3, contract: 100, digits: 2, quoteCcy: 'CHF', newsMag: 0, beta: 0, derive: { a: 'XAUUSD', b: 'USDCHF', op: 'mul' } }),
  metal({ id: 'XAUAUD', name: 'XAU/AUD', desc: 'Gold vs Australian Dollar', mono: 'Au', base: 0, vol1m: 0, spread: 0.4, contract: 100, digits: 2, quoteCcy: 'AUD', newsMag: 0, beta: 0, derive: { a: 'XAUUSD', b: 'AUDUSD', op: 'div' } }),
  metal({ id: 'XAGEUR', name: 'XAG/EUR', desc: 'Silver vs Euro', mono: 'Ag', base: 0, vol1m: 0, spread: 0.03, contract: 5000, digits: 3, quoteCcy: 'EUR', newsMag: 0, beta: 0, derive: { a: 'XAGUSD', b: 'EURUSD', op: 'div' } }),
  metal({ id: 'XAGAUD', name: 'XAG/AUD', desc: 'Silver vs Australian Dollar', mono: 'Ag', base: 0, vol1m: 0, spread: 0.04, contract: 5000, digits: 3, quoteCcy: 'AUD', newsMag: 0, beta: 0, derive: { a: 'XAGUSD', b: 'AUDUSD', op: 'div' } }),
];

type StockRow = [id: string, desc: string, base: number, vol1m: number, beta: number];
const stocks = (rows: StockRow[]): SymbolDef[] =>
  rows.map(([id, desc, base, vol1m, beta]) => ({
    id,
    name: id,
    desc,
    cls: 'nasdaq',
    session: 'always',
    mono: id.slice(0, 2),
    base,
    vol1m,
    spread: Math.max(0.01, Math.round(base * 0.00025 * 100) / 100),
    contract: 100,
    digits: 2,
    leverage: 20,
    quoteCcy: 'USD',
    newsMag: vol1m * 18,
    beta,
    newsWeight: 0.8,
  }));

const NASDAQ: SymbolDef[] = [
  { id: 'NAS100', name: 'NAS100', desc: 'US Tech 100 Index', cls: 'nasdaq', session: 'always', mono: 'NQ', base: 24500, vol1m: 0.0006, spread: 1.2, contract: 10, digits: 1, leverage: 200, quoteCcy: 'USD', newsMag: 0.007, beta: 1.0, newsWeight: 3 },
  ...stocks([
    ['AAPL', 'Apple Inc.', 228.5, 0.0011, 1.1],
    ['MSFT', 'Microsoft Corp.', 425.2, 0.001, 1.0],
    ['NVDA', 'NVIDIA Corp.', 138.4, 0.0018, 1.5],
    ['AMZN', 'Amazon.com Inc.', 205.1, 0.0013, 1.2],
    ['GOOGL', 'Alphabet Inc. Class A', 172.3, 0.0012, 1.1],
    ['META', 'Meta Platforms Inc.', 575.6, 0.0014, 1.2],
    ['TSLA', 'Tesla Inc.', 255.8, 0.0022, 1.6],
    ['AVGO', 'Broadcom Inc.', 172.9, 0.0016, 1.3],
    ['NFLX', 'Netflix Inc.', 760.4, 0.0014, 1.1],
    ['AMD', 'Advanced Micro Devices', 140.2, 0.0019, 1.5],
    ['INTC', 'Intel Corp.', 22.6, 0.0016, 1.1],
    ['ADBE', 'Adobe Inc.', 505.3, 0.0012, 1.0],
    ['CSCO', 'Cisco Systems Inc.', 58.1, 0.0009, 0.8],
    ['QCOM', 'Qualcomm Inc.', 162.4, 0.0014, 1.2],
    ['PEP', 'PepsiCo Inc.', 162.0, 0.0008, 0.4],
    ['COST', 'Costco Wholesale Corp.', 905.7, 0.0009, 0.6],
    ['PYPL', 'PayPal Holdings Inc.', 82.3, 0.0015, 1.2],
  ]),
];

export const SYMBOLS: SymbolDef[] = [...FX, ...METALS, ...NASDAQ];
export const SYMBOL_MAP: Record<string, SymbolDef> = Object.fromEntries(SYMBOLS.map((s) => [s.id, s]));

// derived instruments inherit reference price & volatility from their legs
for (const s of SYMBOLS) {
  if (!s.derive) continue;
  const a = SYMBOL_MAP[s.derive.a];
  const b = SYMBOL_MAP[s.derive.b];
  s.base = s.derive.op === 'mul' ? a.base * b.base : a.base / b.base;
  s.vol1m = Math.sqrt(a.vol1m ** 2 + b.vol1m ** 2);
  s.newsMag = Math.max(a.newsMag, b.newsMag);
  s.beta = s.derive.op === 'mul' ? a.beta + b.beta : a.beta - b.beta;
}

export const CLASSES: AssetClass[] = ['fx', 'metal', 'nasdaq'];
export const CLASS_LABEL: Record<AssetClass, string> = { fx: 'Forex', metal: 'Metals', nasdaq: 'Nasdaq' };

export function fmtPrice(sym: SymbolDef, p: number): string {
  return p.toFixed(sym.digits);
}

/** Smallest price increment. */
export function pointOf(sym: SymbolDef): number {
  return Math.pow(10, -sym.digits);
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
