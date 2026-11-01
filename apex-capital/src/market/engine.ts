import { noise1, rand, strSeed } from './rng.ts';
import { ACCOUNT_CCY, SYMBOLS, SYMBOL_MAP, effectiveTime, isOpen, type Ccy, type SymbolDef } from './symbols.ts';

// ---------------------------------------------------------------------------
// Price model: fractal value noise (Brownian-like up to ~12 days, then
// mean-reverting) + a volatility regime + deterministic news shocks.
// Pure function of (symbol, time): every device sees the same market.
// Closed sessions freeze the price at the close; reopening gaps naturally.
// ---------------------------------------------------------------------------

const WORLD_SEED = strSeed('apex-capital-world-v1');
const OCTAVES = 20; // periods 2s .. ~12 days
const CAL = 0.42; // calibrated so 1m std ≈ vol1m (see scripts/calibrate.ts)

interface SymState {
  key: string;
  seed: number;
  amps: number[];
  periods: number[];
}
const symState: Record<string, SymState> = {};
function stateOf(s: SymbolDef): SymState {
  const hit = symState[s.id];
  if (hit && hit.key === `${s.base}:${s.vol1m}`) return hit;
  const seed = strSeed(s.id) ^ WORLD_SEED;
  const sigmaSec = s.vol1m / Math.sqrt(60);
  const periods: number[] = [];
  const amps: number[] = [];
  for (let k = 0; k < OCTAVES; k++) {
    const p = 2 * Math.pow(2, k);
    periods.push(p);
    amps.push(sigmaSec * Math.sqrt(p) * CAL);
  }
  return (symState[s.id] = { seed, amps, periods, key: `${s.base}:${s.vol1m}` });
}

function volRegime(seed: number, t: number): number {
  const n = noise1(seed ^ 0x9e3779b9, t / 1800) * 0.6 + noise1(seed ^ 0x7f4a7c15, t / 300) * 0.4;
  return 0.55 + 1.2 * Math.abs(n);
}

function fbm(sym: SymbolDef, t: number): number {
  const st = stateOf(sym);
  const vr = volRegime(st.seed, t);
  let v = 0;
  for (let k = 0; k < OCTAVES; k++) {
    const p = st.periods[k];
    v += st.amps[k] * (p < 3600 ? vr : 1) * noise1(st.seed + k * 7919, t / p);
  }
  return v;
}

// ---------------------------------------------------------------------------
// News: deterministic, realistic wire headlines. Scheduled macro releases are
// announced with a countdown (direction unknown); desk chatter leaks early.
// ---------------------------------------------------------------------------

export const NEWS_SLOT = 75; // seconds
const RUMOR_LEAD = 20;
const MACRO_LEAD = 45;

export type NewsKind = 'up' | 'down' | 'shock' | 'macro';

export interface NewsEvent {
  id: number;
  t0: number;
  kind: NewsKind;
  symbol: string | null; // null = macro (all symbols, scaled by beta)
  dir: 1 | -1;
  mag: number;
  ramp: number;
  tau: number;
  headline: string;
  teaser: string;
  leadTime: number;
}

const UP_LINES: Record<string, string[]> = {
  EURUSD: ['Eurozone composite PMI beats at 52.4', 'ECB’s Lagarde: further tightening “cannot be excluded”', 'German Ifo climate improves for a third month'],
  GBPUSD: ['UK CPI hotter than expected at 4.2% y/y', 'BoE’s Bailey: rates on hold “for some time”', 'UK wage growth accelerates to 6.1%'],
  USDJPY: ['BoJ leaves yield-curve control unchanged', 'US–Japan 10Y spread widens to 2026 high', 'Japan trade deficit widens more than forecast'],
  USDCHF: ['Swiss CPI undershoots; SNB cut odds rise', 'SNB signals tolerance for a weaker franc'],
  AUDUSD: ['RBA holds with hawkish tilt', 'China stimulus lifts commodity currencies', 'Australian jobs beat forecasts by 30k'],
  USDCAD: ['Crude slides 3%; loonie under pressure', 'BoC cuts 25bp, signals more to come'],
  NZDUSD: ['RBNZ surprises with hawkish guidance', 'Global dairy auction prices jump 4.8%'],
  XAUUSD: ['Central-bank gold buying hits record quarter', 'Safe-haven bid lifts bullion as geopolitical risk rises', 'Gold ETF inflows turn positive for the first time in 6 weeks'],
  XAGUSD: ['Solar demand pushes 2027 silver deficit forecast higher', 'Silver supply disruption at a major Mexican mine'],
  XPTUSD: ['Platinum deficit forecast widens for 2027', 'South African smelter outage cuts platinum supply'],
  XPDUSD: ['Palladium supply tightens on smelter maintenance', 'Auto-catalyst demand rebounds; palladium bid'],
  XCUUSD: ['Grid-spending plan boosts copper demand outlook', 'Chilean mine strike threatens copper output'],
  XALUSD: ['Smelter power cuts tighten aluminium supply', 'Aluminium inventories fall to multi-year low'],
  XNIUSD: ['Battery-grade nickel demand beats forecasts', 'Export curbs tighten nickel ore supply'],
  XZNUSD: ['Zinc smelter closures tighten concentrate market', 'Galvanising demand lifts zinc premiums'],
  XPBUSD: ['Lead stocks draw as battery demand firms', 'Recycling plant outage tightens lead supply'],
  USOIL: ['OPEC+ extends output cuts into next quarter', 'US crude inventories draw 4.1M barrels', 'Pipeline outage tightens Cushing supply'],
  UKOIL: ['Tanker disruptions lift Brent premium', 'OPEC+ signals tighter supply into winter'],
  NGAS: ['Cold-weather forecast lifts natural gas demand', 'LNG export terminal restarts after maintenance'],
  CORN: ['USDA trims corn yield estimate', 'Dry weather in the Midwest lifts corn'],
  WHEAT: ['Black Sea export disruption lifts wheat', 'Wheat crop condition ratings fall'],
  SOYBEAN: ['Strong export sales support soybeans', 'Crush margins widen; soybeans bid'],
  COFFEE: ['Brazil frost risk lifts arabica', 'Certified coffee stocks hit multi-year low'],
  SUGAR: ['India curbs sugar exports', 'Brazil cane crush falls short of estimates'],
  COCOA: ['West African cocoa arrivals lag last season', 'Cocoa grindings beat forecasts'],
  NAS100: ['Tech rally broadens as yields ease', 'AI capex optimism lifts US Tech 100 futures', 'Megacap strength pushes NAS100 to session high'],
};
const DOWN_LINES: Record<string, string[]> = {
  EURUSD: ['Eurozone inflation undershoots; ECB cut bets rise', 'German factory orders slump 3.1% m/m', 'ECB minutes flag growing downside risks'],
  GBPUSD: ['UK retail sales contract 1.8% m/m', 'BoE votes 6–3 to cut Bank Rate', 'UK GDP unexpectedly contracts in Q3'],
  USDJPY: ['Japan MoF confirms yen intervention', 'BoJ Governor hints at policy normalisation', 'Tokyo CPI surprises higher; JGB yields jump'],
  USDCHF: ['Safe-haven flows bid the Swiss franc', 'SNB holds rates, drops intervention pledge'],
  AUDUSD: ['Australian jobs miss; RBA cut bets climb', 'Iron-ore slump weighs on the Aussie'],
  USDCAD: ['Canadian jobs blowout lifts the loonie', 'Crude jumps 4% on supply outage'],
  NZDUSD: ['RBNZ cuts 50bp in a surprise move', 'Global dairy auction prices slump 5.1%'],
  XAUUSD: ['Real yields climb; bullion under pressure', 'Gold ETF outflows accelerate for a fourth week'],
  XAGUSD: ['Industrial metals slide on weak China data', 'Silver inventories at COMEX rise sharply'],
  XPTUSD: ['Platinum surplus expected as auto demand cools', 'Russian platinum exports rise sharply'],
  XPDUSD: ['EV adoption forecast weighs on palladium', 'Palladium surplus forecast for 2027'],
  XCUUSD: ['LME copper inventories surge 12%', 'Weak China PMI drags base metals lower'],
  XALUSD: ['Aluminium output rebounds as power returns', 'LME aluminium stocks jump on deliveries'],
  XNIUSD: ['Nickel surplus widens as new capacity starts', 'Stainless steel demand slows sharply'],
  XZNUSD: ['Zinc stocks build on LME warehouses', 'Construction slowdown weighs on zinc'],
  XPBUSD: ['Lead demand softens as battery orders slip', 'LME lead inventories rise for a fifth day'],
  USOIL: ['US crude inventories build 5.3M barrels', 'OPEC+ members signal higher output'],
  UKOIL: ['Brent slips as demand outlook softens', 'Refinery run cuts weigh on crude'],
  NGAS: ['Mild weather forecast weighs on natural gas', 'Gas storage build beats estimates'],
  CORN: ['USDA raises corn yield estimate', 'Ideal weather boosts corn crop outlook'],
  WHEAT: ['Record Russian harvest weighs on wheat', 'Wheat export demand softens'],
  SOYBEAN: ['Soybean export sales disappoint', 'Brazil record soy crop pressures prices'],
  COFFEE: ['Brazil harvest beats estimates; coffee slides', 'Coffee stocks build at exchange warehouses'],
  SUGAR: ['Brazil cane crush surges', 'India allows additional sugar exports'],
  COCOA: ['Cocoa demand cools as grindings fall', 'Improved West African weather pressures cocoa'],
  NAS100: ['Tech selloff deepens as bond yields jump', 'Rotation out of growth stocks drags NAS100'],
};
// Single stocks are real listed names on a SIMULATED tape: headlines describe
// order flow on this venue only, never company fundamentals.
const STOCK_UP = ['Heavy buy-side block prints in {s}', '{s} squeezes higher as shorts cover', 'Call volume spikes in {s}', 'Bid stack builds in {s} on the desk'];
const STOCK_DOWN = ['Large sell imbalance hits {s}', '{s} slides as funds de-risk', 'Put volume spikes in {s}', 'Offers stack up in {s} on the desk'];
const SHOCK_LINE = (s: SymbolDef) =>
  s.cls === 'nasdaq' ? `Volatility halt: ${s.name} gaps lower on a sell sweep` : `${s.name} flash crash: liquidity vanishes`;
const MACRO_UP = ['US CPI 2.9% y/y vs 3.1% expected', 'FOMC holds; Chair signals cuts ahead', 'US Non-Farm Payrolls +92k vs +180k expected', 'ECB and Fed coordinate liquidity support'];
const MACRO_DOWN = ['US CPI 3.6% y/y vs 3.2% expected', 'FOMC hikes 25bp in surprise move', 'US 10Y Treasury yield breaks 5.20%', 'US core PCE accelerates to 3.4%'];
const MACRO_TEASE = ['US CPI release', 'FOMC rate decision', 'US Non-Farm Payrolls', 'US Core PCE release'];
const SHOCK_TARGETS = ['NVDA', 'TSLA', 'AMD', 'NFLX', 'XAGUSD', 'XPDUSD', 'XNIUSD', 'NGAS', 'USOIL', 'COCOA'];

/** Weighted pool of instruments that carry their own headlines (crosses inherit from legs). */
const NEWS_POOL: SymbolDef[] = SYMBOLS.flatMap((s) => Array.from({ length: Math.round((s.newsWeight ?? 1) * 2) }, () => s));

function lineFor(sym: SymbolDef, dir: 1 | -1, r: number): string {
  const own = (dir > 0 ? UP_LINES : DOWN_LINES)[sym.id];
  if (own) return pick(own, r);
  return pick(dir > 0 ? STOCK_UP : STOCK_DOWN, r).replace('{s}', sym.name);
}

const newsMemo = new Map<number, NewsEvent | null>();
const pick = <T,>(arr: T[], r: number): T => arr[Math.floor(r * arr.length) % arr.length];
const FX_PROBE = SYMBOL_MAP.EURUSD;

export function newsForSlot(slot: number): NewsEvent | null {
  const cached = newsMemo.get(slot);
  if (cached !== undefined) return cached;
  if (newsMemo.size > 20000) newsMemo.clear();
  const s = WORLD_SEED ^ 0x51ed270b;
  let ev: NewsEvent | null = null;
  if (rand(s, slot, 1) < 0.4) {
    const r1 = rand(s, slot, 2);
    const r2 = rand(s, slot, 3);
    const r3 = rand(s, slot, 4);
    const t0 = slot * NEWS_SLOT + Math.floor(rand(s, slot, 5) * (NEWS_SLOT - 10));
    const open = NEWS_POOL.filter((x) => isOpen(x, t0));
    const fxOpen = isOpen(FX_PROBE, t0);
    if (r1 < 0.035) {
      const targets = SHOCK_TARGETS.filter((id) => isOpen(SYMBOL_MAP[id], t0));
      if (targets.length) {
        const id = pick(targets, r2);
        ev = { id: slot, t0, kind: 'shock', symbol: id, dir: -1, mag: SYMBOL_MAP[id].newsMag * 2.4, ramp: 8, tau: 1400, headline: SHOCK_LINE(SYMBOL_MAP[id]), teaser: `Desk chatter: heavy sell flow in ${SYMBOL_MAP[id].name}`, leadTime: RUMOR_LEAD };
      }
    } else if (r1 < 0.22 && fxOpen) {
      // scheduled macro data only during the FX week
      const dir: 1 | -1 = r2 < 0.5 ? 1 : -1;
      ev = { id: slot, t0, kind: 'macro', symbol: null, dir, mag: 1, ramp: 5, tau: 700, headline: pick(dir > 0 ? MACRO_UP : MACRO_DOWN, r3), teaser: pick(MACRO_TEASE, rand(s, slot, 6)), leadTime: MACRO_LEAD };
    } else if (open.length) {
      const sym = pick(open, r2);
      const dir: 1 | -1 = rand(s, slot, 7) < 0.52 ? 1 : -1;
      ev = {
        id: slot,
        t0,
        kind: dir > 0 ? 'up' : 'down',
        symbol: sym.id,
        dir,
        mag: sym.newsMag * (0.45 + r3 * 0.9),
        ramp: 6 + rand(s, slot, 8) * 22,
        tau: 200 + rand(s, slot, 9) * 700,
        headline: lineFor(sym, dir, rand(s, slot, 10)),
        teaser: `Desk chatter: unusual flow in ${sym.name}`,
        leadTime: RUMOR_LEAD,
      };
    }
  }
  newsMemo.set(slot, ev);
  return ev;
}

function shape(ev: NewsEvent, dt: number): number {
  if (dt <= 0) return 0;
  if (dt < ev.ramp) {
    const x = dt / ev.ramp;
    return x * x * (3 - 2 * x);
  }
  return Math.exp(-(dt - ev.ramp) / ev.tau);
}

const CUTOFF = 1500 * 5;

function newsEffect(sym: SymbolDef, t: number): number {
  let v = 0;
  const from = Math.floor((t - CUTOFF) / NEWS_SLOT);
  const to = Math.floor(t / NEWS_SLOT);
  for (let slot = from; slot <= to; slot++) {
    const ev = newsForSlot(slot);
    if (!ev) continue;
    const dt = t - ev.t0;
    if (dt <= 0 || dt > ev.tau * 5 + ev.ramp) continue;
    const imp = ev.symbol === null ? ev.dir * sym.newsMag * 0.55 * sym.beta : ev.symbol === sym.id ? ev.dir * ev.mag : 0;
    if (imp !== 0) v += imp * shape(ev, dt);
  }
  return v;
}

/** Mid price at unix time t (frozen at the last close while the market is shut). */
export function midPrice(symId: string, t: number): number {
  const sym = SYMBOL_MAP[symId];
  const te = effectiveTime(sym, t);
  if (sym.derive) {
    const a = midPrice(sym.derive.a, te);
    const b = midPrice(sym.derive.b, te);
    return sym.derive.op === 'mul' ? a * b : a / b;
  }
  return sym.base * Math.exp(fbm(sym, te) + newsEffect(sym, te));
}

/** Spread widens 4x for 20s around news on that instrument. */
export function spreadAt(symId: string, t: number): number {
  const sym = SYMBOL_MAP[symId];
  const slot = Math.floor(t / NEWS_SLOT);
  for (let s = slot - 1; s <= slot; s++) {
    const ev = newsForSlot(s);
    if (!ev || (ev.symbol !== null && ev.symbol !== symId && ev.symbol !== sym.derive?.a && ev.symbol !== sym.derive?.b)) continue;
    const dt = t - ev.t0;
    if (dt > -3 && dt < 20) return sym.spread * 4;
  }
  return sym.spread;
}

export interface Quote {
  t: number;
  bid: number;
  ask: number;
  mid: number;
  spread: number;
  open: boolean;
}

export function quote(symId: string, t: number): Quote {
  const sym = SYMBOL_MAP[symId];
  const open = isOpen(sym, t);
  const mid = midPrice(symId, t);
  const spread = open ? spreadAt(symId, t) : sym.spread;
  return { t, mid, spread, bid: mid - spread / 2, ask: mid + spread / 2, open };
}

/** News that has hit (t0 <= t), newest first. */
export function recentNews(t: number, lookbackSec: number): NewsEvent[] {
  const out: NewsEvent[] = [];
  const to = Math.floor(t / NEWS_SLOT);
  const from = Math.floor((t - lookbackSec) / NEWS_SLOT);
  for (let s = to; s >= from; s--) {
    const ev = newsForSlot(s);
    if (ev && ev.t0 <= t && ev.t0 >= t - lookbackSec) out.push(ev);
  }
  return out;
}

/** Upcoming news whose teaser is already public. */
export function upcomingNews(t: number): NewsEvent[] {
  const out: NewsEvent[] = [];
  const slot = Math.floor(t / NEWS_SLOT);
  for (let s = slot; s <= slot + 2; s++) {
    const ev = newsForSlot(s);
    if (ev && ev.t0 > t && ev.t0 - ev.leadTime <= t) out.push(ev);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Candles (closed-session buckets are skipped, like MT5)
// ---------------------------------------------------------------------------

export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  /** Synthetic tick volume (deterministic, scales with range and activity). */
  volume: number;
}

export const TIMEFRAMES = [
  { id: 'M1', sec: 60 },
  { id: 'M5', sec: 300 },
  { id: 'M15', sec: 900 },
  { id: 'M30', sec: 1800 },
  { id: 'H1', sec: 3600 },
  { id: 'H4', sec: 14400 },
  { id: 'D1', sec: 86400 },
] as const;
export type TfId = (typeof TIMEFRAMES)[number]['id'];

function tickVolume(symId: string, tfSec: number, start: number, high: number, low: number, mid: number, frac = 1): number {
  const sym = SYMBOL_MAP[symId];
  const expected = mid * sym.vol1m * Math.sqrt(tfSec / 60) * 2.2;
  const activity = 0.55 + rand(strSeed(symId) ^ tfSec, Math.floor(start / 60), 77) * 0.9;
  const perMin = 38 * activity * (0.6 + Math.min(4, (high - low) / (expected || 1)));
  return Math.max(1, Math.round(perMin * (tfSec / 60) * frac));
}

export function bucketOpen(sym: SymbolDef, start: number, tfSec: number): boolean {
  return isOpen(sym, start) || isOpen(sym, start + tfSec - 1);
}

export function buildCandle(symId: string, tfSec: number, start: number, end?: number): Candle {
  const step = Math.max(1, tfSec / 60);
  const stop = end ?? start + tfSec;
  const open = midPrice(symId, start);
  let high = open;
  let low = open;
  let close = open;
  for (let t = start + step; t <= stop; t += step) {
    const p = midPrice(symId, Math.min(t, stop));
    if (p > high) high = p;
    if (p < low) low = p;
    close = p;
  }
  const frac = Math.min(1, Math.max(0.02, (stop - start) / tfSec));
  return { time: start, open, high, low, close, volume: tickVolume(symId, tfSec, start, high, low, open, frac) };
}

const candleCache = new Map<string, Map<number, Candle>>();

/** Closed candles (deterministic, cached) + the live one when the market is open. */
export function candles(symId: string, tfSec: number, count: number, now: number): Candle[] {
  const sym = SYMBOL_MAP[symId];
  const key = `${symId}:${tfSec}`;
  let cache = candleCache.get(key);
  if (!cache) {
    cache = new Map();
    candleCache.set(key, cache);
  }
  const cur = Math.floor(now / tfSec) * tfSec;
  const out: Candle[] = [];
  if (isOpen(sym, now)) out.push(buildCandle(symId, tfSec, cur, now));
  let start = cur - tfSec;
  for (let guard = 0; out.length < count && guard < 20000; guard++, start -= tfSec) {
    if (!bucketOpen(sym, start, tfSec)) continue;
    let c = cache.get(start);
    if (!c) {
      c = buildCandle(symId, tfSec, start);
      cache.set(start, c);
    }
    out.push(c);
  }
  if (cache.size > count * 3) for (const k of cache.keys()) if (k < start) cache.delete(k);
  return out.reverse();
}

// ---------------------------------------------------------------------------
// Currency conversion into the EUR account, at the live (deterministic) rate.
// ---------------------------------------------------------------------------

const USD_LEG: Record<Ccy, { sym: string; inv: boolean } | null> = {
  USD: null,
  EUR: { sym: 'EURUSD', inv: false },
  GBP: { sym: 'GBPUSD', inv: false },
  AUD: { sym: 'AUDUSD', inv: false },
  NZD: { sym: 'NZDUSD', inv: false },
  JPY: { sym: 'USDJPY', inv: true },
  CHF: { sym: 'USDCHF', inv: true },
  CAD: { sym: 'USDCAD', inv: true },
};
const rateMemo = new Map<string, number>();

/** How many USD one unit of `ccy` buys at time t. */
function usdPer(ccy: Ccy, t: number): number {
  const leg = USD_LEG[ccy];
  if (!leg) return 1;
  const sec = Math.floor(t);
  const key = `${ccy}${sec}`;
  let v = rateMemo.get(key);
  if (v === undefined) {
    if (rateMemo.size > 4000) rateMemo.clear();
    const px = midPrice(leg.sym, sec);
    v = leg.inv ? 1 / px : px;
    rateMemo.set(key, v);
  }
  return v;
}

/** Convert an amount in `ccy` into account currency (EUR) at time t. */
export function toAccount(amount: number, ccy: Ccy, t: number): number {
  if (ccy === ACCOUNT_CCY) return amount;
  return (amount * usdPer(ccy, t)) / usdPer(ACCOUNT_CCY, t);
}

/** P&L in account currency for a price difference (in quote units). */
export function pnlFor(sym: SymbolDef, diff: number, lots: number, t: number): number {
  return toAccount(diff * lots * sym.contract, sym.quoteCcy, t);
}

/** Notional value in account currency. */
export function notional(sym: SymbolDef, lots: number, price: number, t: number): number {
  return toAccount(lots * sym.contract * price, sym.quoteCcy, t);
}
