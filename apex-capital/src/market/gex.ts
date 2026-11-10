import { rand, strSeed } from './rng.ts';
import { midPrice } from './engine.ts';
import { SYMBOL_MAP } from './symbols.ts';

// ---------------------------------------------------------------------------
// GEX: dealer gamma exposure by strike, from the game's SIMULATED options
// market (there is no real options chain behind these instruments).
// Open interest is set each day around that day's opening price: heavier at
// round strikes, calls skewed above spot, puts below, like real chains.
// Convention: dealers long calls / short puts → call gamma +, put gamma −.
// ---------------------------------------------------------------------------

export interface GexStrike {
  strike: number;
  call: number;
  put: number;
  net: number;
}

export interface GexProfile {
  strikes: GexStrike[];
  callWall: number;
  putWall: number;
  /** Where net dealer gamma flips sign (below: moves accelerate). */
  zeroGamma: number | null;
  total: number;
}

function niceStep(x: number): number {
  const p = Math.pow(10, Math.floor(Math.log10(x)));
  const m = x / p;
  return (m < 1.5 ? 1 : m < 3.5 ? 2.5 : m < 7.5 ? 5 : 10) * p;
}

export function gexProfile(symId: string, spot: number, t: number, count = 15): GexProfile | null {
  const def = SYMBOL_MAP[symId];
  if (!def || !(spot > 0)) return null;
  const day = Math.floor(t / 86400);
  const anchor = midPrice(symId, day * 86400);
  const step = niceStep(anchor * 0.006);
  const atm = Math.round(anchor / step) * step;
  const seed = strSeed(`gex:${symId}`);
  // implied move used for the gamma bell (daily vol scaled from the 1-minute vol)
  const sigma = Math.max(def.vol1m * Math.sqrt(390), 0.004) * spot;
  const strikes: GexStrike[] = [];
  for (let i = -count; i <= count; i++) {
    const k = atm + i * step;
    if (k <= 0) continue;
    const round = Math.abs(k / (step * 4) - Math.round(k / (step * 4))) < 1e-6 ? 2.2 : 1;
    const oiBase = (0.35 + rand(seed, day, i + 500)) * round * Math.exp(-Math.abs(i) / (count * 0.6));
    const callOi = oiBase * (i >= 0 ? 1.25 : 0.55) * (0.7 + rand(seed, day, i + 900) * 0.6);
    const putOi = oiBase * (i <= 0 ? 1.3 : 0.5) * (0.7 + rand(seed, day, i + 1300) * 0.6);
    const g = Math.exp(-(((k - spot) / sigma) ** 2) / 2);
    const call = callOi * g;
    const put = -putOi * g;
    strikes.push({ strike: k, call, put, net: call + put });
  }
  if (!strikes.length) return null;
  const callWall = strikes.reduce((a, b) => (b.call > a.call ? b : a)).strike;
  const putWall = strikes.reduce((a, b) => (b.put < a.put ? b : a)).strike;
  let zeroGamma: number | null = null;
  for (let i = 1; i < strikes.length; i++) {
    const a = strikes[i - 1];
    const b = strikes[i];
    if (a.net < 0 && b.net >= 0) {
      zeroGamma = a.strike + ((b.strike - a.strike) * -a.net) / (b.net - a.net || 1);
      break;
    }
  }
  return { strikes, callWall, putWall, zeroGamma, total: strikes.reduce((s, x) => s + x.net, 0) };
}
