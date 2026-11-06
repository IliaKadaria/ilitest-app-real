export type AssetClass = 'fx' | 'futures' | 'indices' | 'nasdaq';
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
  /** Exchange tick size: prices move in these steps (futures, indices, stocks). */
  tick?: number;
  /** Market character (defaults by asset class, see engine.ts personality). */
  hurst?: number;
  jump?: number;
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

const metal = (s: Omit<SymbolDef, 'cls' | 'session' | 'leverage'> & { leverage?: number }): SymbolDef => ({ cls: 'futures', session: 'metal', leverage: 200, ...s });

const FUTURES: SymbolDef[] = [
  metal({ tick: 0.01, id: 'XAUUSD', name: 'XAU/USD', desc: 'Gold vs US Dollar', mono: 'Au', base: 2650, vol1m: 0.0005, spread: 0.22, contract: 100, digits: 2, quoteCcy: 'USD', newsMag: 0.006, beta: 0.9, newsWeight: 3 }),
  metal({ tick: 0.005, id: 'XAGUSD', name: 'XAG/USD', desc: 'Silver vs US Dollar', mono: 'Ag', base: 31.2, vol1m: 0.0008, spread: 0.022, contract: 5000, digits: 3, quoteCcy: 'USD', newsMag: 0.009, beta: 1.0, newsWeight: 2 }),
  metal({ tick: 0.1, id: 'XPTUSD', name: 'XPT/USD', desc: 'Platinum vs US Dollar', mono: 'Pt', base: 980, vol1m: 0.0008, spread: 0.9, contract: 100, digits: 2, quoteCcy: 'USD', newsMag: 0.009, beta: 1.0 }),
  metal({ tick: 0.5, jump: 2, id: 'XPDUSD', name: 'XPD/USD', desc: 'Palladium vs US Dollar', mono: 'Pd', base: 1020, vol1m: 0.0011, spread: 1.6, contract: 100, digits: 2, quoteCcy: 'USD', newsMag: 0.012, beta: 1.1 }),
  metal({ tick: 0.0005, id: 'XCUUSD', name: 'COPPER', desc: 'Copper vs US Dollar (per lb)', mono: 'Cu', base: 4.45, vol1m: 0.0006, spread: 0.004, contract: 10000, digits: 4, quoteCcy: 'USD', newsMag: 0.008, beta: 1.2, leverage: 100 }),
  metal({ tick: 0.5, id: 'XALUSD', name: 'ALUMINIUM', desc: 'Aluminium vs US Dollar (per t)', mono: 'Al', base: 2550, vol1m: 0.0005, spread: 2.5, contract: 10, digits: 1, quoteCcy: 'USD', newsMag: 0.007, beta: 1.0, leverage: 100 }),
  metal({ tick: 5, jump: 2.2, id: 'XNIUSD', name: 'NICKEL', desc: 'Nickel vs US Dollar (per t)', mono: 'Ni', base: 16200, vol1m: 0.0008, spread: 22, contract: 1, digits: 0, quoteCcy: 'USD', newsMag: 0.01, beta: 1.1, leverage: 100 }),
  metal({ tick: 0.5, id: 'XZNUSD', name: 'ZINC', desc: 'Zinc vs US Dollar (per t)', mono: 'Zn', base: 2850, vol1m: 0.0006, spread: 3, contract: 10, digits: 1, quoteCcy: 'USD', newsMag: 0.008, beta: 1.0, leverage: 100 }),
  metal({ tick: 0.5, id: 'XPBUSD', name: 'LEAD', desc: 'Lead vs US Dollar (per t)', mono: 'Pb', base: 2050, vol1m: 0.0005, spread: 2.5, contract: 10, digits: 1, quoteCcy: 'USD', newsMag: 0.007, beta: 0.9, leverage: 100 }),
  metal({ id: 'XAUEUR', name: 'XAU/EUR', desc: 'Gold vs Euro', mono: 'Au', base: 0, vol1m: 0, spread: 0.3, contract: 100, digits: 2, quoteCcy: 'EUR', newsMag: 0, beta: 0, derive: { a: 'XAUUSD', b: 'EURUSD', op: 'div' } }),
  metal({ id: 'XAUGBP', name: 'XAU/GBP', desc: 'Gold vs British Pound', mono: 'Au', base: 0, vol1m: 0, spread: 0.3, contract: 100, digits: 2, quoteCcy: 'GBP', newsMag: 0, beta: 0, derive: { a: 'XAUUSD', b: 'GBPUSD', op: 'div' } }),
  metal({ id: 'XAUJPY', name: 'XAU/JPY', desc: 'Gold vs Japanese Yen', mono: 'Au', base: 0, vol1m: 0, spread: 45, contract: 100, digits: 0, quoteCcy: 'JPY', newsMag: 0, beta: 0, derive: { a: 'XAUUSD', b: 'USDJPY', op: 'mul' } }),
  metal({ id: 'XAUCHF', name: 'XAU/CHF', desc: 'Gold vs Swiss Franc', mono: 'Au', base: 0, vol1m: 0, spread: 0.3, contract: 100, digits: 2, quoteCcy: 'CHF', newsMag: 0, beta: 0, derive: { a: 'XAUUSD', b: 'USDCHF', op: 'mul' } }),
  metal({ id: 'XAUAUD', name: 'XAU/AUD', desc: 'Gold vs Australian Dollar', mono: 'Au', base: 0, vol1m: 0, spread: 0.4, contract: 100, digits: 2, quoteCcy: 'AUD', newsMag: 0, beta: 0, derive: { a: 'XAUUSD', b: 'AUDUSD', op: 'div' } }),
  metal({ id: 'XAGEUR', name: 'XAG/EUR', desc: 'Silver vs Euro', mono: 'Ag', base: 0, vol1m: 0, spread: 0.03, contract: 5000, digits: 3, quoteCcy: 'EUR', newsMag: 0, beta: 0, derive: { a: 'XAGUSD', b: 'EURUSD', op: 'div' } }),
  metal({ id: 'XAGAUD', name: 'XAG/AUD', desc: 'Silver vs Australian Dollar', mono: 'Ag', base: 0, vol1m: 0, spread: 0.04, contract: 5000, digits: 3, quoteCcy: 'AUD', newsMag: 0, beta: 0, derive: { a: 'XAGUSD', b: 'AUDUSD', op: 'div' } }),
  // energy & agricultural futures (continuous front-month, simulated)
  metal({ tick: 0.01, id: 'USOIL', name: 'USOIL', desc: 'WTI Crude Oil Futures', mono: 'CL', base: 71.5, vol1m: 0.0009, spread: 0.03, contract: 1000, digits: 2, quoteCcy: 'USD', newsMag: 0.01, beta: 0.8, leverage: 100, newsWeight: 3 }),
  metal({ tick: 0.01, id: 'UKOIL', name: 'UKOIL', desc: 'Brent Crude Oil Futures', mono: 'BZ', base: 75.2, vol1m: 0.00085, spread: 0.03, contract: 1000, digits: 2, quoteCcy: 'USD', newsMag: 0.01, beta: 0.8, leverage: 100, newsWeight: 2 }),
  metal({ tick: 0.001, jump: 3, id: 'NGAS', name: 'NATGAS', desc: 'Natural Gas Futures', mono: 'NG', base: 2.85, vol1m: 0.0016, spread: 0.006, contract: 10000, digits: 3, quoteCcy: 'USD', newsMag: 0.018, beta: 0.5, leverage: 50 }),
  metal({ tick: 0.0025, id: 'CORN', name: 'CORN', desc: 'Corn Futures (USD/bu)', mono: 'ZC', base: 4.25, vol1m: 0.0007, spread: 0.005, contract: 5000, digits: 4, quoteCcy: 'USD', newsMag: 0.008, beta: 0.3, leverage: 50 }),
  metal({ tick: 0.0025, id: 'WHEAT', name: 'WHEAT', desc: 'Wheat Futures (USD/bu)', mono: 'ZW', base: 5.65, vol1m: 0.0008, spread: 0.006, contract: 5000, digits: 4, quoteCcy: 'USD', newsMag: 0.009, beta: 0.3, leverage: 50 }),
  metal({ tick: 0.0025, id: 'SOYBEAN', name: 'SOYBEAN', desc: 'Soybean Futures (USD/bu)', mono: 'ZS', base: 10.2, vol1m: 0.0006, spread: 0.008, contract: 5000, digits: 4, quoteCcy: 'USD', newsMag: 0.008, beta: 0.3, leverage: 50 }),
  metal({ tick: 0.0005, jump: 2.2, id: 'COFFEE', name: 'COFFEE', desc: 'Arabica Coffee Futures (USD/lb)', mono: 'KC', base: 2.45, vol1m: 0.0011, spread: 0.004, contract: 37500, digits: 4, quoteCcy: 'USD', newsMag: 0.012, beta: 0.2, leverage: 50 }),
  metal({ tick: 0.0001, id: 'SUGAR', name: 'SUGAR', desc: 'Raw Sugar No.11 Futures (USD/lb)', mono: 'SB', base: 0.21, vol1m: 0.001, spread: 0.0003, contract: 112000, digits: 4, quoteCcy: 'USD', newsMag: 0.011, beta: 0.2, leverage: 50 }),
  metal({ tick: 1, jump: 3, id: 'COCOA', name: 'COCOA', desc: 'Cocoa Futures (USD/t)', mono: 'CC', base: 7800, vol1m: 0.0013, spread: 8, contract: 10, digits: 0, quoteCcy: 'USD', newsMag: 0.014, beta: 0.2, leverage: 50 }),
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
    tick: 0.01,
  }));

type IdxRow = [id: string, desc: string, mono: string, base: number, vol1m: number, spread: number, ccy: Ccy, beta: number, tick: number, digits: number, weight?: number];
const indices = (rows: IdxRow[]): SymbolDef[] =>
  rows.map(([id, desc, mono, base, vol1m, spread, quoteCcy, beta, tick, digits, weight]) => ({
    id,
    name: id,
    desc,
    cls: 'indices',
    session: 'metal',
    mono,
    base,
    vol1m,
    spread,
    contract: 1,
    digits,
    leverage: 100,
    quoteCcy,
    newsMag: vol1m * 12,
    beta,
    newsWeight: weight ?? 1,
    tick,
  }));

// Cash indices (CFDs on the index, simulated). Contract = 1 × index points.
const INDICES: SymbolDef[] = indices([
  ['NAS100', 'US Tech 100 Index', 'NQ', 24500, 0.0006, 1.2, 'USD', 1.0, 0.25, 2, 3],
  ['US500', 'US 500 Index', 'ES', 6050, 0.00045, 0.5, 'USD', 0.9, 0.25, 2, 2.5],
  ['US30', 'Wall Street 30 Index', 'YM', 44200, 0.0004, 2.4, 'USD', 0.8, 1, 0, 2],
  ['US2000', 'US Small Cap 2000', 'RT', 2380, 0.0007, 0.4, 'USD', 1.2, 0.1, 1],
  ['VIX', 'CBOE Volatility Index', 'VX', 16.4, 0.0025, 0.05, 'USD', -2.5, 0.05, 2, 1.5],
  ['GER40', 'Germany 40 Index', 'DX', 19650, 0.00045, 1.2, 'EUR', 0.8, 0.5, 1, 2],
  ['UK100', 'UK 100 Index', 'UK', 8320, 0.0004, 1.0, 'GBP', 0.6, 0.5, 1],
  ['FRA40', 'France 40 Index', 'FR', 7380, 0.00045, 1.0, 'EUR', 0.7, 0.5, 1],
  ['EU50', 'Euro Stoxx 50 Index', 'EX', 4980, 0.00045, 1.0, 'EUR', 0.8, 1, 0],
  ['ESP35', 'Spain 35 Index', 'ES', 11800, 0.00045, 3, 'EUR', 0.7, 1, 0],
  ['ITA40', 'Italy 40 Index', 'IT', 34500, 0.0005, 6, 'EUR', 0.8, 5, 0],
  ['NED25', 'Netherlands 25 Index', 'NL', 905, 0.00045, 0.2, 'EUR', 0.8, 0.05, 2],
  ['SUI20', 'Switzerland 20 Index', 'SW', 11950, 0.00035, 2, 'CHF', 0.5, 1, 0],
  ['JPN225', 'Japan 225 Index', 'NK', 39200, 0.0005, 7, 'JPY', 0.9, 5, 0, 1.5],
  ['AUS200', 'Australia 200 Index', 'AU', 8350, 0.0004, 1.5, 'AUD', 0.6, 1, 0],
  ['CHINA50', 'China A50 Index', 'CN', 13500, 0.0007, 5, 'USD', 0.7, 1, 0],
  ['CAN60', 'Canada 60 Index', 'CA', 1520, 0.0004, 0.4, 'CAD', 0.6, 0.1, 1],
]);

const NASDAQ: SymbolDef[] = [
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

export const SYMBOLS: SymbolDef[] = [...FX, ...FUTURES, ...INDICES, ...NASDAQ];
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

export const CLASSES: AssetClass[] = ['fx', 'futures', 'indices', 'nasdaq'];
export const CLASS_LABEL: Record<AssetClass, string> = { fx: 'Forex', futures: 'Futures', indices: 'Indices', nasdaq: 'Nasdaq' };

/** Admin-created market: same deterministic price model as built-ins, seeded by its id. */
export interface CustomMarket {
  id: string;
  name: string;
  desc: string;
  cls: AssetClass;
  base: number;
  vol1m: number;
  digits: number;
  contract: number;
  leverage: number;
  spread: number;
  quoteCcy: Ccy;
}

export const BUILTIN_IDS = new Set(SYMBOLS.map((s) => s.id));

export function registerCustom(m: CustomMarket): SymbolDef | null {
  if (BUILTIN_IDS.has(m.id) || !/^[A-Z0-9]{2,10}$/.test(m.id)) return null;
  const def: SymbolDef = {
    id: m.id,
    name: m.name || m.id,
    desc: m.desc || 'Custom market',
    cls: m.cls,
    session: m.cls === 'fx' ? 'fx' : m.cls === 'futures' || m.cls === 'indices' ? 'metal' : 'always',
    mono: m.id.slice(0, 2),
    base: m.base,
    vol1m: m.vol1m,
    spread: m.spread,
    contract: m.contract,
    digits: m.digits,
    leverage: m.leverage,
    quoteCcy: m.quoteCcy,
    newsMag: m.vol1m * 15,
    beta: 0.8,
    newsWeight: 0,
  };
  const i = SYMBOLS.findIndex((x) => x.id === m.id);
  if (i >= 0) SYMBOLS[i] = def;
  else SYMBOLS.push(def);
  SYMBOL_MAP[m.id] = def;
  return def;
}

export function unregisterCustom(id: string) {
  if (BUILTIN_IDS.has(id)) return;
  const i = SYMBOLS.findIndex((x) => x.id === id);
  if (i >= 0) SYMBOLS.splice(i, 1);
  delete SYMBOL_MAP[id];
}

/** Display precision: 'standard' = instrument digits, 'extended' = 13 decimals. */
let extendedPrecision = false;
export const MAX_DIGITS = 13;
export function setExtendedPrecision(on: boolean) {
  extendedPrecision = on;
}
export function displayDigits(sym: SymbolDef): number {
  return extendedPrecision ? MAX_DIGITS : sym.digits;
}
export function fmtPrice(sym: SymbolDef, p: number): string {
  return p.toFixed(displayDigits(sym));
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
