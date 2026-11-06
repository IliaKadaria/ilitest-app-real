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

// ---------------------------------------------------------------------------
// Market personality: every instrument trades with its own character, so no
// two charts share a pattern.
//   hurst   < 0.5 mean-reverting (FX chop), > 0.5 trending (single stocks)
//   jump    size of sudden repricings (gaps, squeezes) in 1-minute vols
//   cluster how strongly volatility bunches up (calm → violent regimes)
//   micro   bid/ask bounce at tick level (relative to half the spread)
//   session intraday activity curve (London / New York / Asia / US cash hours)
// ---------------------------------------------------------------------------

interface Personality {
  hurst: number;
  jump: number;
  cluster: number;
  micro: number;
  /** [hour UTC, width h, extra activity] bumps on a 0.55 base. */
  session: [number, number, number][];
}

const FX_SESSION: Personality['session'] = [[8, 1.6, 0.9], [14.5, 2, 1.2], [1.5, 2.5, 0.25]];
const US_CASH: Personality['session'] = [[14, 0.8, 1.6], [17, 2.5, 0.7], [19.8, 0.5, 1.1]];
const EU_CASH: Personality['session'] = [[7.5, 0.8, 1.5], [11, 2.5, 0.5], [14.5, 1, 0.9]];
const ASIA_CASH: Personality['session'] = [[0.5, 0.8, 1.5], [3.5, 2, 0.6], [6, 0.6, 0.6]];
const AGRI_PIT: Personality['session'] = [[13.8, 0.6, 2.2], [16, 1.5, 0.9], [18.1, 0.4, 1.4]];
const ENERGY: Personality['session'] = [[13.5, 1.5, 1.4], [14.5, 0.4, 1.6], [8, 1.5, 0.5]];

const EU_IDX = new Set(['GER40', 'FRA40', 'EU50', 'ESP35', 'ITA40', 'NED25', 'SUI20', 'UK100']);
const ASIA_IDX = new Set(['JPN225', 'AUS200', 'CHINA50']);
const AGRI = new Set(['CORN', 'WHEAT', 'SOYBEAN', 'COFFEE', 'SUGAR', 'COCOA']);
const ENERGY_IDS = new Set(['USOIL', 'UKOIL', 'NGAS']);

function personalityOf(s: SymbolDef, seed: number): Personality {
  const j = (k: number) => rand(seed, 991, k) * 2 - 1; // per-symbol jitter
  let p: Personality;
  if (s.cls === 'fx') p = { hurst: 0.42, jump: 0.35, cluster: 0.8, micro: 0.25, session: FX_SESSION };
  else if (s.cls === 'nasdaq') p = { hurst: 0.6, jump: 2.4, cluster: 1.25, micro: 0.7, session: US_CASH };
  else if (s.cls === 'indices') p = { hurst: 0.56, jump: 1.1, cluster: 1.1, micro: 0.45, session: EU_IDX.has(s.id) ? EU_CASH : ASIA_IDX.has(s.id) ? ASIA_CASH : US_CASH };
  else if (AGRI.has(s.id)) p = { hurst: 0.5, jump: 1.8, cluster: 0.9, micro: 0.6, session: AGRI_PIT };
  else if (ENERGY_IDS.has(s.id)) p = { hurst: 0.54, jump: 1.5, cluster: 1.15, micro: 0.5, session: ENERGY };
  else p = { hurst: 0.5, jump: 0.8, cluster: 1, micro: 0.4, session: [[8, 1.5, 0.6], [14, 1.8, 1.2], [2, 2.5, 0.3]] };
  if (s.id === 'VIX') p = { ...p, hurst: 0.38, jump: 3.2, cluster: 1.4 };
  return {
    ...p,
    hurst: Math.max(0.3, Math.min(0.72, (s.hurst ?? p.hurst) + j(1) * 0.03)),
    jump: (s.jump ?? p.jump) * (0.8 + 0.4 * rand(seed, 991, 2)),
    cluster: p.cluster * (0.85 + 0.3 * rand(seed, 991, 3)),
    session: p.session.map(([h, w, a]) => [h + j(4) * 0.3, w, a] as [number, number, number]),
  };
}

interface SymState {
  key: string;
  seed: number;
  amps: number[];
  periods: number[];
  pers: Personality;
  /** Jump amplitudes (log units) at 15 min / 1 h / 6 h. */
  jumps: number[];
  /** Tick-level bounce amplitude (log units). */
  micro: number;
}
const JUMP_PERIODS = [900, 3600, 21600];
const symState: Record<string, SymState> = {};
function stateOf(s: SymbolDef): SymState {
  const hit = symState[s.id];
  if (hit && hit.key === `${s.base}:${s.vol1m}`) return hit;
  const seed = strSeed(s.id) ^ WORLD_SEED;
  const pers = personalityOf(s, seed);
  const sigmaSec = s.vol1m / Math.sqrt(60);
  const periods: number[] = [];
  const amps: number[] = [];
  for (let k = 0; k < OCTAVES; k++) {
    const p = 2 * Math.pow(2, k);
    periods.push(p);
    // H = 0.5 is a plain random walk; the exponent bends long horizons into trends or chop
    amps.push(sigmaSec * Math.sqrt(p) * CAL * Math.pow(p / 60, pers.hurst - 0.5));
  }
  const jumps = JUMP_PERIODS.map((_, i) => s.vol1m * pers.jump * [0.9, 0.7, 0.55][i]);
  const micro = s.base > 0 ? (pers.micro * s.spread) / 2 / s.base : 0;
  return (symState[s.id] = { seed, amps, periods, key: `${s.base}:${s.vol1m}`, pers, jumps, micro });
}

/** Intraday activity multiplier (mean ≈ 1). */
function sessionActivity(p: Personality, t: number): number {
  const h = (t % 86400) / 3600;
  let v = 0.55;
  for (const [c, w, a] of p.session) {
    const d = Math.min(Math.abs(h - c), 24 - Math.abs(h - c));
    v += a * Math.exp(-(d * d) / (2 * w * w));
  }
  return v / 1.15;
}

function volRegime(st: SymState, t: number): number {
  const n = noise1(st.seed ^ 0x9e3779b9, t / 1800) * 0.6 + noise1(st.seed ^ 0x7f4a7c15, t / 300) * 0.4;
  return (0.55 + 1.2 * Math.pow(Math.abs(n), 1 / st.pers.cluster)) * sessionActivity(st.pers, t);
}

/** Value noise whose transitions are squeezed into the last `w` of each cell: a step. */
function stepNoise(seed: number, x: number, w: number): number {
  const i = Math.floor(x);
  const f = x - i;
  const a = rand(seed, i | 0, 3) * 2 - 1;
  if (f < 1 - w) return a;
  const b = rand(seed, (i + 1) | 0, 3) * 2 - 1;
  const u = (f - (1 - w)) / w;
  return a + (b - a) * u * u * (3 - 2 * u);
}

function fbm(sym: SymbolDef, t: number): number {
  const st = stateOf(sym);
  const vr = volRegime(st, t);
  let v = 0;
  for (let k = 0; k < OCTAVES; k++) {
    const p = st.periods[k];
    v += st.amps[k] * (p < 3600 ? vr : 1) * noise1(st.seed + k * 7919, t / p);
  }
  // sudden repricings: only some cells actually jump (fat tails, not constant drift)
  for (let k = 0; k < JUMP_PERIODS.length; k++) v += st.jumps[k] * stepNoise(st.seed ^ (0x5bd1e995 + k), t / JUMP_PERIODS[k], 0.035);
  // tick-level bid/ask bounce
  if (st.micro) v += st.micro * noise1(st.seed ^ 0x27d4eb2f, t / 0.7);
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

const INDEX_UP = ['{s} futures climb as earnings season beats', 'Dip buyers step in; {s} reclaims session high', 'Short covering lifts {s} into the close', 'Bond yields ease; {s} extends gains'];
const INDEX_DOWN = ['{s} slides as risk appetite fades', 'Profit-taking drags {s} off the highs', 'Hawkish central-bank remarks weigh on {s}', 'Heavy futures selling hits {s}'];

function lineFor(sym: SymbolDef, dir: 1 | -1, r: number): string {
  const own = (dir > 0 ? UP_LINES : DOWN_LINES)[sym.id];
  if (own) return pick(own, r);
  if (sym.cls === 'indices') return pick(dir > 0 ? INDEX_UP : INDEX_DOWN, r).replace('{s}', sym.name);
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
    const fxOpen = isOpen(FX_PROBE, t0);
    // a few deterministic draws from the pool until one is trading (cheap: no full scan)
    let pickOpen: SymbolDef | null = null;
    for (let k = 0; k < 8 && !pickOpen; k++) {
      const c = NEWS_POOL[Math.floor(rand(s, slot, 40 + k) * NEWS_POOL.length) % NEWS_POOL.length];
      if (c.session === 'always' || (c.session === 'fx' ? fxOpen : isOpen(c, t0))) pickOpen = c;
    }
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
    } else if (pickOpen) {
      const sym = pickOpen;
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

/**
 * Mid price at unix time t (frozen at the last close while the market is shut).
 * `coarse` skips the news transients (minutes long): used only to build closed
 * 4h / daily / weekly bars, where they are invisible but cost the most.
 */
export function midPrice(symId: string, t: number, coarse = false): number {
  const sym = SYMBOL_MAP[symId];
  const te = effectiveTime(sym, t);
  if (sym.derive) {
    const a = midPrice(sym.derive.a, te, coarse);
    const b = midPrice(sym.derive.b, te, coarse);
    return sym.derive.op === 'mul' ? a * b : a / b;
  }
  const p = sym.base * Math.exp(fbm(sym, te) + (coarse ? 0 : newsEffect(sym, te)));
  return sym.tick ? Math.max(sym.tick, Math.round(p / sym.tick) * sym.tick) : p;
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
  { id: '1s', sec: 1, name: '1 second' },
  { id: '5s', sec: 5, name: '5 seconds' },
  { id: '10s', sec: 10, name: '10 seconds' },
  { id: '15s', sec: 15, name: '15 seconds' },
  { id: '30s', sec: 30, name: '30 seconds' },
  { id: '1m', sec: 60, name: '1 minute' },
  { id: '5m', sec: 300, name: '5 minutes' },
  { id: '15m', sec: 900, name: '15 minutes' },
  { id: '30m', sec: 1800, name: '30 minutes' },
  { id: '1h', sec: 3600, name: '1 hour' },
  { id: '4h', sec: 14400, name: '4 hours' },
  { id: '1D', sec: 86400, name: '1 day' },
  { id: '1W', sec: 604800, name: '1 week' },
] as const;
export type TfId = (typeof TIMEFRAMES)[number]['id'];

const WEEK = 604800;
/** Weekly bars start Monday 00:00 UTC (the epoch was a Thursday). */
const WEEK_OFFSET = 4 * 86400;
/** Start of the bar containing t. */
export function bucketStart(t: number, tfSec: number): number {
  if (tfSec === WEEK) return Math.floor((t - WEEK_OFFSET) / WEEK) * WEEK + WEEK_OFFSET;
  return Math.floor(t / tfSec) * tfSec;
}

function tickVolume(symId: string, tfSec: number, start: number, high: number, low: number, mid: number, frac = 1): number {
  const sym = SYMBOL_MAP[symId];
  const expected = mid * sym.vol1m * Math.sqrt(tfSec / 60) * 2.2;
  const activity = (0.55 + rand(strSeed(symId) ^ tfSec, Math.floor(start / 60), 77) * 0.9) * (sym.base > 0 ? sessionActivity(stateOf(sym).pers, start) : 1);
  const perMin = 38 * activity * (0.6 + Math.min(4, (high - low) / (expected || 1)));
  return Math.max(1, Math.round(perMin * (tfSec / 60) * frac));
}

export function bucketOpen(sym: SymbolDef, start: number, tfSec: number): boolean {
  return isOpen(sym, start) || isOpen(sym, start + tfSec - 1);
}

/** Price samples per bar: dense for second bars, capped for daily / weekly. */
function sampleStep(tfSec: number): number {
  if (tfSec < 60) return Math.max(0.25, tfSec / 60);
  return tfSec < 14400 ? tfSec / 60 : tfSec / 48;
}

export function buildCandle(symId: string, tfSec: number, start: number, end?: number): Candle {
  const step = sampleStep(tfSec);
  const stop = end ?? start + tfSec;
  const coarse = end === undefined && tfSec >= 14400;
  const open = midPrice(symId, start, coarse);
  let high = open;
  let low = open;
  let close = open;
  for (let t = start + step; t <= stop; t += step) {
    const p = midPrice(symId, Math.min(t, stop), coarse);
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
  const cur = bucketStart(now, tfSec);
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

/** Bullish (1) when price is above where it was 20 bars ago on this timeframe. */
export function trendOf(symId: string, tfSec: number, now: number): 1 | -1 {
  const cs = candles(symId, tfSec, 21, now);
  if (cs.length < 2) return 1;
  return cs[cs.length - 1].close >= cs[0].close ? 1 : -1;
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
