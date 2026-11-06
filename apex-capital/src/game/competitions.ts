import { quote, type Quote } from '../market/engine.ts';
import { noise1, rand, strSeed } from '../market/rng.ts';
import { SYMBOL_MAP, type SymbolDef } from '../market/symbols.ts';
import { DIVISIONS } from './tiers.ts';
import type { Deal, Position, Side } from './account.ts';
import { liquidationPlan, marginSnapshot, type MarginRules, type MarginSnapshot } from './margin.ts';

// ---------------------------------------------------------------------------
// Competitions. Pure rules + deterministic event schedules: every player who
// joins the same competition (same seed) sees the same swings, scoops and
// pump curve without a game server. Money inside a competition is separate
// "competition money"; only the buy-in and the prizes touch the real account.
// ---------------------------------------------------------------------------

export type CompMode = 'whale' | 'roulette' | 'scoop' | 'pump';
export type CompStatus = 'open' | 'live' | 'finished' | 'cancelled';

export interface CompDef {
  mode: CompMode;
  name: string;
  tagline: string;
  rules: string[];
  /** Division index range allowed to enter (inclusive). */
  bracket: [number, number];
  prizes: [number, number, number];
  buyIn: number;
  /** Competition money each entrant starts with. */
  stack: number;
  margin: MarginRules;
  minutes: number;
  minPlayers: number;
  /** Instruments traded in this competition. */
  basket: string[];
}

const div = (label: string) => DIVISIONS.find((d) => d.label === label)!.idx;

export const PUMP_SYMBOL = 'MOONX';

export const COMP_DEFS: Record<CompMode, CompDef> = {
  whale: {
    mode: 'whale',
    name: '“Whale” Hunt',
    tagline: 'Hedge funds go to war. The Whale backs the winners.',
    rules: [
      'Join one of four hedge funds. Your fund’s score is the average return of its traders.',
      'Every 10 minutes the Whale invests in the best-performing fund: its traders get 4:1 margin (instead of 2:1) for the next round.',
      'Maintenance margin 30%. Fall below and you are liquidated, biggest loser first.',
      'Prizes go to the top 3 funds, split between their traders.',
    ],
    bracket: [div('Silver III'), div('Gold I')],
    prizes: [1000, 800, 500],
    buyIn: 250,
    stack: 10000,
    margin: { maxLeverage: 2, maintenancePct: 0.3, warningBuffer: 1.25 },
    minutes: 60,
    minPlayers: 4,
    basket: ['XAUUSD', 'EURUSD', 'NAS100', 'USOIL', 'NVDA', 'GER40'],
  },
  roulette: {
    mode: 'roulette',
    name: 'Margin Call Roulette',
    tagline: 'Start at 4:1 on volatile assets. Every 10 minutes the wheel spins.',
    rules: [
      'You start already leveraged 3.5:1 across two volatile assets (max 4:1).',
      'Every 10 minutes a big swing hits one asset on the wheel: ±4–9% in seconds.',
      'Margin call (equity below 20% of your gross position value) gives you 60 seconds to cover: close positions or borrow from another player.',
      'Not covered in time: eliminated. Loans are repaid with 10% interest at the end.',
      'Highest final equity wins.',
    ],
    bracket: [div('Gold V'), div('Platinum I')],
    prizes: [10000, 5000, 2500],
    buyIn: 2000,
    stack: 10000,
    margin: { maxLeverage: 4, maintenancePct: 0.2, warningBuffer: 1.2 },
    minutes: 60,
    minPlayers: 4,
    basket: ['TSLA', 'NVDA', 'NGAS', 'XPDUSD', 'COCOA', 'VIX'],
  },
  scoop: {
    mode: 'scoop',
    name: 'The Inside Scoop',
    tagline: 'Buy, sell or steal clues before the news goes public.',
    rules: [
      'Every 10 minutes a market-moving event hits one asset (3–7%).',
      'Clues leak before it: buy them with competition money, sell them back, or try to steal one (40% chance, a failed attempt costs a fine).',
      'Clues can be wrong. The closer to the event, the more reliable and the more expensive.',
      '2:1 margin, 30% maintenance. Highest final equity wins.',
    ],
    bracket: [div('Gold V'), div('Diamond I')],
    prizes: [50000, 25000, 10000],
    buyIn: 8000,
    stack: 25000,
    margin: { maxLeverage: 2, maintenancePct: 0.3, warningBuffer: 1.25 },
    minutes: 45,
    minPlayers: 4,
    basket: ['AAPL', 'MSFT', 'AMZN', 'META', 'AMD', 'NFLX'],
  },
  pump: {
    mode: 'pump',
    name: 'Pump & Dump',
    tagline: 'A worthless micro-cap. 15 minutes of hype. Then the rug.',
    rules: [
      `Everyone trades ${PUMP_SYMBOL}: a worthless, illiquid token quoted to 13 decimals.`,
      'For 15 minutes hype and every player’s buying push the price up.',
      'Then the mandatory dump: the price collapses about 92% within a minute.',
      'Sell before the rug. Highest final equity wins; holders at the dump get wrecked.',
    ],
    bracket: [div('Diamond I'), div('Quant I')],
    prizes: [100000, 50000, 35000],
    buyIn: 25000,
    stack: 100000,
    margin: { maxLeverage: 2, maintenancePct: 0.3, warningBuffer: 1.25 },
    minutes: 20,
    minPlayers: 4,
    basket: [PUMP_SYMBOL],
  },
};
export const COMP_MODES = Object.keys(COMP_DEFS) as CompMode[];

// The pump token is reachable through SYMBOL_MAP (P&L, notional) but is not
// listed in SYMBOLS, so it never shows up in Quotes or news.
const MOON: SymbolDef = {
  id: PUMP_SYMBOL,
  name: PUMP_SYMBOL,
  desc: 'MoonX token (worthless, simulated)',
  cls: 'nasdaq',
  session: 'always',
  mono: 'MX',
  base: 0.0000042137,
  vol1m: 0.004,
  spread: 0.0000000842,
  contract: 1_000_000_000,
  digits: 13,
  leverage: 2,
  quoteCcy: 'EUR',
  newsMag: 0,
  beta: 0,
  newsWeight: 0,
};
SYMBOL_MAP[PUMP_SYMBOL] = MOON;

export interface Competition {
  id: string;
  mode: CompMode;
  status: CompStatus;
  seed: number;
  createdAt: number;
  startsAt: number | null;
  endsAt: number | null;
  /** Practice: solo, free, no prizes. */
  practice?: boolean;
}

export interface Entry {
  playerId: string;
  name: string;
  team?: string;
  equity: number;
  eliminated?: boolean;
  /** Pump & Dump: net lots held (moves the price for everyone). */
  netLots?: number;
  prize?: number;
}

export interface Fund {
  id: string;
  name: string;
  motto: string;
  color: string;
  mono: string;
}
export const FUNDS: Fund[] = [
  { id: 'obsidian', name: 'Obsidian Capital', motto: 'Patience is a position.', color: '#9aa3ad', mono: 'OC' },
  { id: 'redkite', name: 'Red Kite Partners', motto: 'We hunt volatility.', color: '#e5484d', mono: 'RK' },
  { id: 'northwind', name: 'Northwind Macro', motto: 'Trade the tide, not the waves.', color: '#7aa7ff', mono: 'NW' },
  { id: 'atlas', name: 'Atlas Quant', motto: 'The model is the edge.', color: '#4cc38a', mono: 'AQ' },
];

/** What one competition position means for my state (local, per player). */
export interface CompPlay {
  compId: string;
  balance: number;
  positions: Position[];
  history: Deal[];
  /** Cash borrowed from / lent to other players (repaid ×1.1 at the end). */
  borrowed: number;
  lent: number;
  clues: string[];
  stealsTried: string[];
  fines: number;
  graceUntil: number | null;
  eliminatedAt: number | null;
  joinedAt: number;
  team?: string;
  paid?: boolean;
  prize?: number;
  finalEquity?: number;
}

export const LOAN_INTEREST = 0.1;
export const GRACE_SECONDS = 60;
export const ROUND = 600;

// ------------------------------------------------------------------ prize pool

/** Players needed to fund the full prize pool from buy-ins. */
export function targetPlayers(d: CompDef): number {
  return Math.ceil(d.prizes.reduce((a, b) => a + b, 0) / d.buyIn);
}

/** Prizes scale with the field: a thin field can't win the full pool. */
export function prizePool(d: CompDef, entrants: number): [number, number, number] {
  const fill = Math.min(1, entrants / targetPlayers(d));
  return d.prizes.map((p) => Math.round(p * fill)) as [number, number, number];
}

export function eligible(d: CompDef, balance: number): { ok: boolean; why?: string } {
  const lo = DIVISIONS[d.bracket[0]];
  const hi = DIVISIONS[d.bracket[1]];
  if (balance < lo.min) return { ok: false, why: `Open to ${lo.label} – ${hi.label}. Reach ${lo.label} (€${lo.min.toLocaleString()}) to enter.` };
  if (hi.max !== null && balance >= hi.max) return { ok: false, why: `Open to ${lo.label} – ${hi.label}. Your division is above this bracket.` };
  if (balance < d.buyIn) return { ok: false, why: `Buy-in is €${d.buyIn.toLocaleString()}.` };
  return { ok: true };
}

// ------------------------------------------------------------------ schedules

export interface Swing {
  at: number;
  sym: string;
  move: number; // log return
}

export function rouletteSwings(c: Competition): Swing[] {
  if (!c.startsAt) return [];
  const d = COMP_DEFS.roulette;
  const out: Swing[] = [];
  for (let k = 1; k * ROUND < d.minutes * 60; k++) {
    const sym = d.basket[Math.floor(rand(c.seed, k, 11) * d.basket.length) % d.basket.length];
    const size = 0.04 + rand(c.seed, k, 12) * 0.05;
    out.push({ at: c.startsAt + k * ROUND - 30 + Math.floor(rand(c.seed, k, 13) * 60), sym, move: (rand(c.seed, k, 14) < 0.5 ? -1 : 1) * size });
  }
  return out;
}

export interface ScoopEvent {
  id: string;
  at: number;
  sym: string;
  dir: 1 | -1;
  move: number;
  headline: string;
  clues: Clue[];
}
export interface Clue {
  id: string;
  eventId: string;
  /** Unlock time. */
  at: number;
  text: string;
  /** What the clue claims. */
  says: 1 | -1;
  /** Price in competition money at time t (see cluePrice). */
  basePrice: number;
}

const BULL_CLUES = ['A supplier just tripled its order book from {s}.', 'Unusual call buying in {s} ahead of an announcement.', 'A source on the board says {s} beat guidance comfortably.', 'Regulators are about to clear the {s} deal.'];
const BEAR_CLUES = ['{s}’s CFO cancelled every investor meeting this week.', 'Heavy put buying in {s} from a fund that is rarely wrong.', 'A source says {s} will miss and cut guidance.', 'A key {s} contract is about to be cancelled.'];
const BULL_NEWS = ['{s} beats estimates, raises full-year guidance', '{s} confirms takeover approach at a 30% premium', '{s} wins a multi-billion contract'];
const BEAR_NEWS = ['{s} misses estimates and cuts guidance', '{s} under investigation; shares tumble', '{s} loses its largest customer'];

export function scoopEvents(c: Competition): ScoopEvent[] {
  if (!c.startsAt) return [];
  const d = COMP_DEFS.scoop;
  const out: ScoopEvent[] = [];
  for (let k = 1; k * ROUND < d.minutes * 60; k++) {
    const sym = d.basket[Math.floor(rand(c.seed, k, 21) * d.basket.length) % d.basket.length];
    const name = SYMBOL_MAP[sym]?.name ?? sym;
    const dir: 1 | -1 = rand(c.seed, k, 22) < 0.5 ? 1 : -1;
    const at = c.startsAt + k * ROUND;
    const id = `e${k}`;
    const clues: Clue[] = [0, 1, 2].map((j) => {
      // earlier clues are cheaper and less reliable (60% → 75% → 90%)
      const truthful = rand(c.seed, k * 10 + j, 23) < [0.6, 0.75, 0.9][j];
      const says = (truthful ? dir : -dir) as 1 | -1;
      const pool = says === 1 ? BULL_CLUES : BEAR_CLUES;
      return { id: `${id}c${j}`, eventId: id, at: at - (8 - j * 3) * 60, says, text: pool[Math.floor(rand(c.seed, k * 10 + j, 24) * pool.length) % pool.length].replace('{s}', name), basePrice: d.stack * [0.02, 0.04, 0.07][j] };
    });
    const news = dir === 1 ? BULL_NEWS : BEAR_NEWS;
    out.push({ id, at, sym, dir, move: dir * (0.03 + rand(c.seed, k, 25) * 0.04), headline: news[Math.floor(rand(c.seed, k, 26) * news.length) % news.length].replace('{s}', name), clues });
  }
  return out;
}

/** Clues get pricier as the event approaches. */
export function cluePrice(clue: Clue, t: number): number {
  return Math.round(clue.basePrice * (1 + Math.max(0, Math.min(1, (t - clue.at) / 300))));
}
export const STEAL_ODDS = 0.4;
export const STEAL_FINE = 0.05; // of the stack

/** Deterministic steal outcome: retrying never changes it. */
export function stealSucceeds(c: Competition, playerId: string, clueId: string): boolean {
  return rand(c.seed ^ strSeed(playerId), strSeed(clueId), 31) < STEAL_ODDS;
}

// ------------------------------------------------------------------ prices

const smooth = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

/** Pump & Dump: hype multiplier (log) from the schedule alone. */
function pumpHype(c: Competition, t: number): number {
  if (!c.startsAt) return 0;
  const el = t - c.startsAt;
  const hypeEnd = 15 * 60;
  const peak = Math.log(3 + rand(c.seed, 1, 41) * 3); // ×3 to ×6 by the end of the hype
  let v = peak * smooth(el / hypeEnd) + 0.18 * noise1(c.seed ^ 0x51, el / 40) + 0.08 * noise1(c.seed ^ 0x77, el / 7);
  // "influencer posts": sudden bursts
  for (let k = 0; k < 4; k++) {
    const at = 120 + rand(c.seed, k, 42) * (hypeEnd - 240);
    v += 0.25 * smooth((el - at) / 20) * Math.exp(-Math.max(0, el - at - 20) / 180);
  }
  if (el > hypeEnd) v += Math.log(0.08) * smooth((el - hypeEnd) / 50); // the rug
  return v;
}

/** Competition price: the real model plus the competition's own events. */
export function compQuote(c: Competition, sym: string, t: number, crowdLots = 0): Quote {
  const base = quote(sym, t);
  let lr = 0;
  if (c.mode === 'roulette') for (const s of rouletteSwings(c)) if (s.sym === sym && t > s.at) lr += s.move * smooth((t - s.at) / 12);
  if (c.mode === 'scoop') for (const e of scoopEvents(c)) if (e.sym === sym && t > e.at) lr += e.move * smooth((t - e.at) / 8);
  if (c.mode === 'pump' && sym === PUMP_SYMBOL) {
    lr += pumpHype(c, t);
    // price impact of everyone's net holdings (illiquid book)
    lr += Math.max(-1, Math.min(2.5, crowdLots * 0.012));
  }
  if (!lr) return base;
  const k = Math.exp(lr);
  const mid = base.mid * k;
  const spread = sym === PUMP_SYMBOL ? mid * 0.02 : base.spread * k;
  return { ...base, mid, spread, bid: mid - spread / 2, ask: mid + spread / 2, open: base.open || sym === PUMP_SYMBOL };
}

export function compQuotes(c: Competition, t: number, crowdLots = 0): Record<string, Quote> {
  const out: Record<string, Quote> = {};
  for (const s of COMP_DEFS[c.mode].basket) out[s] = compQuote(c, s, t, crowdLots);
  return out;
}

// ------------------------------------------------------------------ whale

/** Fund backed by the Whale for the round containing t (from the previous round's scores). */
export function whaleBacked(c: Competition, entries: Entry[], t: number, stack: number): string | null {
  if (!c.startsAt || t < c.startsAt + ROUND) return null;
  const scores = fundScores(entries, stack);
  const best = scores.filter((s) => s.members > 0).sort((a, b) => b.ret - a.ret)[0];
  return best?.fund ?? null;
}

export function fundScores(entries: Entry[], stack: number): { fund: string; ret: number; members: number }[] {
  return FUNDS.map((f) => {
    const m = entries.filter((e) => e.team === f.id);
    const ret = m.length ? m.reduce((s, e) => s + (e.equity - stack) / stack, 0) / m.length : -Infinity;
    return { fund: f.id, ret, members: m.length };
  });
}

export function rulesFor(c: Competition, play: CompPlay, backed: string | null): MarginRules {
  const d = COMP_DEFS[c.mode];
  if (c.mode === 'whale' && backed && play.team === backed) return { ...d.margin, maxLeverage: 4 };
  return d.margin;
}

// ------------------------------------------------------------------ play

export function newPlay(c: Competition, team?: string): CompPlay {
  const d = COMP_DEFS[c.mode];
  return { compId: c.id, balance: d.stack, positions: [], history: [], borrowed: 0, lent: 0, clues: [], stealsTried: [], fines: 0, graceUntil: null, eliminatedAt: null, joinedAt: Date.now() / 1000, team };
}

/** Margin Call Roulette starts everyone leveraged 3.5:1 on two assets. */
export function seedRoulette(c: Competition, play: CompPlay, t: number): CompPlay {
  const d = COMP_DEFS.roulette;
  const qs = compQuotes(c, t);
  const a = d.basket[Math.floor(rand(c.seed, 7, 51) * d.basket.length) % d.basket.length];
  const b = d.basket[(d.basket.indexOf(a) + 1 + Math.floor(rand(c.seed, 7, 52) * (d.basket.length - 1))) % d.basket.length];
  const positions: Position[] = [];
  for (const [sym, side] of [[a, 1], [b, -1]] as [string, Side][]) {
    const def = SYMBOL_MAP[sym];
    const q = qs[sym];
    const px = side === 1 ? q.ask : q.bid;
    const perLot = def.contract * px;
    const lots = Math.max(0.01, Math.floor(((d.stack * 1.75) / perLot) * 100) / 100);
    positions.push({ id: `seed-${sym}`, sym, side, lots, open: px, openTime: t, sl: null, tp: null });
  }
  return { ...play, positions };
}

export interface PlayState {
  snap: MarginSnapshot;
  /** Final score: equity ± loans with interest. */
  score: number;
}

export function playState(c: Competition, play: CompPlay, t: number, rules: MarginRules, crowdLots = 0): PlayState {
  const snap = marginSnapshot(play, compQuotes(c, t, crowdLots), t, rules);
  const score = play.eliminatedAt ? Math.max(0, play.finalEquity ?? 0) : snap.totalEquity + play.lent * (1 + LOAN_INTEREST) - play.borrowed * (1 + LOAN_INTEREST);
  return { snap, score };
}

/** Close a competition position at competition prices. */
export function closeCompPosition(c: Competition, play: CompPlay, id: string, t: number, crowdLots = 0, reason: Deal['reason'] = 'manual'): CompPlay {
  const p = play.positions.find((x) => x.id === id);
  if (!p) return play;
  const q = compQuote(c, p.sym, t, crowdLots);
  const px = p.side === 1 ? q.bid : q.ask;
  const def = SYMBOL_MAP[p.sym];
  const s = marginSnapshot({ balance: 0, positions: [p] }, { [p.sym]: q }, t);
  const profit = s.holdings[0]?.unrealized ?? (px - p.open) * p.side * p.lots * def.contract;
  const deal: Deal = { ...p, close: px, closeTime: t, profit, reason };
  return { ...play, balance: play.balance + profit, positions: play.positions.filter((x) => x.id !== id), history: [deal, ...play.history].slice(0, 100) };
}

export function openCompPosition(c: Competition, play: CompPlay, sym: string, side: Side, lots: number, t: number, rules: MarginRules, crowdLots = 0): { play: CompPlay; error?: string } {
  if (play.eliminatedAt) return { play, error: 'You are eliminated.' };
  if (!c.endsAt || t >= c.endsAt) return { play, error: 'The competition is over.' };
  const q = compQuote(c, sym, t, crowdLots);
  const px = side === 1 ? q.ask : q.bid;
  const pos: Position = { id: `${Math.floor(t * 1000).toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`, sym, side, lots, open: px, openTime: t, sl: null, tp: null };
  const before = marginSnapshot(play, compQuotes(c, t, crowdLots), t, rules);
  const value = marginSnapshot({ balance: 0, positions: [pos] }, { [sym]: q }, t).grossExposure;
  if (value > before.buyingPower + 1e-6) return { play, error: `Exceeds ${rules.maxLeverage}:1: buying power €${before.buyingPower.toFixed(2)}, order €${value.toFixed(2)}.` };
  return { play: { ...play, positions: [pos, ...play.positions] } };
}

export interface TickResult {
  play: CompPlay;
  notes: string[];
}

/** Margin rules for one instant: liquidation, or Roulette's grace window and elimination. */
export function tickPlay(c: Competition, play: CompPlay, t: number, rules: MarginRules, crowdLots = 0): TickResult {
  const notes: string[] = [];
  if (play.eliminatedAt || !c.endsAt) return { play, notes };
  // the end: close everything at the final price
  if (t >= c.endsAt) {
    let p = play;
    for (const pos of [...p.positions]) p = closeCompPosition(c, p, pos.id, c.endsAt, crowdLots);
    const { score } = playState(c, p, c.endsAt, rules, crowdLots);
    return { play: { ...p, finalEquity: score }, notes };
  }
  const qs = compQuotes(c, t, crowdLots);
  const snap = marginSnapshot(play, qs, t, rules);
  if (snap.status !== 'margin_call') {
    if (play.graceUntil) notes.push('Margin call covered.');
    return { play: play.graceUntil ? { ...play, graceUntil: null } : play, notes };
  }
  if (c.mode === 'roulette') {
    if (!play.graceUntil) {
      notes.push(`MARGIN CALL: cover within ${GRACE_SECONDS}s (close positions or borrow) or you are eliminated.`);
      return { play: { ...play, graceUntil: t + GRACE_SECONDS }, notes };
    }
    if (t < play.graceUntil) return { play, notes };
    let p = play;
    for (const pos of [...p.positions]) p = closeCompPosition(c, p, pos.id, t, crowdLots, 'stopout');
    notes.push('Eliminated: the margin call was not covered.');
    return { play: { ...p, eliminatedAt: t, graceUntil: null, finalEquity: Math.max(0, p.balance + p.lent * (1 + LOAN_INTEREST) - p.borrowed * (1 + LOAN_INTEREST)) }, notes };
  }
  // everyone else: liquidate the biggest loser until compliant
  let p = play;
  for (const id of liquidationPlan(play, qs, t, rules)) {
    const pos = p.positions.find((x) => x.id === id);
    p = closeCompPosition(c, p, id, t, crowdLots, 'stopout');
    if (pos) notes.push(`Margin call: ${SYMBOL_MAP[pos.sym]?.name ?? pos.sym} liquidated.`);
  }
  return { play: p, notes };
}

/** Rank entries; ties keep join order. Prizes go to places 1–3 (whale: to funds, split). */
export function standings(c: Competition, entries: Entry[], entrants: number): (Entry & { place: number; prize: number })[] {
  const d = COMP_DEFS[c.mode];
  const pool = c.practice ? [0, 0, 0] : prizePool(d, entrants);
  if (c.mode === 'whale') {
    const order = fundScores(entries, d.stack).filter((f) => f.members > 0).sort((a, b) => b.ret - a.ret);
    return [...entries]
      .sort((a, b) => order.findIndex((o) => o.fund === a.team) - order.findIndex((o) => o.fund === b.team) || b.equity - a.equity)
      .map((e, i) => {
        const fi = order.findIndex((o) => o.fund === e.team);
        return { ...e, place: i + 1, prize: fi >= 0 && fi < 3 ? Math.round(pool[fi] / order[fi].members) : 0 };
      });
  }
  return [...entries]
    .sort((a, b) => Number(!!a.eliminated) - Number(!!b.eliminated) || b.equity - a.equity)
    .map((e, i) => ({ ...e, place: i + 1, prize: i < 3 ? pool[i] : 0 }));
}
