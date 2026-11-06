import type { Candle } from './engine.ts';

// Classic MT5 indicators on candle arrays. Every function returns arrays
// aligned with the input (NaN until the indicator has enough bars).

export function sma(v: number[], n: number): number[] {
  const out = new Array<number>(v.length).fill(NaN);
  let sum = 0;
  for (let i = 0; i < v.length; i++) {
    sum += v[i];
    if (i >= n) sum -= v[i - n];
    if (i >= n - 1) out[i] = sum / n;
  }
  return out;
}

export function ema(v: number[], n: number): number[] {
  const out = new Array<number>(v.length).fill(NaN);
  const k = 2 / (n + 1);
  let prev = NaN;
  for (let i = 0; i < v.length; i++) {
    if (!Number.isFinite(v[i])) continue;
    prev = Number.isFinite(prev) ? v[i] * k + prev * (1 - k) : v[i];
    if (i >= n - 1) out[i] = prev;
  }
  return out;
}

function stdev(v: number[], n: number, mean: number[]): number[] {
  return v.map((_, i) => {
    if (i < n - 1) return NaN;
    let s = 0;
    for (let j = i - n + 1; j <= i; j++) s += (v[j] - mean[i]) ** 2;
    return Math.sqrt(s / n);
  });
}

export function bollinger(c: Candle[], n: number, k = 2) {
  const close = c.map((x) => x.close);
  const mid = sma(close, n);
  const sd = stdev(close, n, mid);
  return { mid, upper: mid.map((m, i) => m + k * sd[i]), lower: mid.map((m, i) => m - k * sd[i]) };
}

export function envelopes(c: Candle[], n: number, pct = 0.1) {
  const mid = sma(c.map((x) => x.close), n);
  return { upper: mid.map((m) => m * (1 + pct / 100)), lower: mid.map((m) => m * (1 - pct / 100)) };
}

export function rsi(c: Candle[], n: number): number[] {
  const out = new Array<number>(c.length).fill(NaN);
  let gain = 0;
  let loss = 0;
  for (let i = 1; i < c.length; i++) {
    const d = c[i].close - c[i - 1].close;
    const g = Math.max(0, d);
    const l = Math.max(0, -d);
    if (i <= n) {
      gain += g / n;
      loss += l / n;
    } else {
      gain = (gain * (n - 1) + g) / n;
      loss = (loss * (n - 1) + l) / n;
    }
    if (i >= n) out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  }
  return out;
}

export function macd(c: Candle[], fast = 12, slow = 26, signal = 9) {
  const close = c.map((x) => x.close);
  const f = ema(close, fast);
  const s = ema(close, slow);
  const line = f.map((x, i) => x - s[i]);
  const sig = ema(line, signal);
  return { line, signal: sig, hist: line.map((x, i) => x - sig[i]) };
}

export function stochastic(c: Candle[], k = 14, d = 3, slowing = 3) {
  const raw = c.map((_, i) => {
    if (i < k - 1) return NaN;
    let hi = -Infinity;
    let lo = Infinity;
    for (let j = i - k + 1; j <= i; j++) {
      hi = Math.max(hi, c[j].high);
      lo = Math.min(lo, c[j].low);
    }
    return hi === lo ? 50 : ((c[i].close - lo) / (hi - lo)) * 100;
  });
  const main = sma(raw.map((x) => (Number.isFinite(x) ? x : 0)), slowing).map((x, i) => (i < k + slowing - 2 ? NaN : x));
  const sig = sma(main.map((x) => (Number.isFinite(x) ? x : 0)), d).map((x, i) => (i < k + slowing + d - 3 ? NaN : x));
  return { main, signal: sig };
}

export function atr(c: Candle[], n: number): number[] {
  const tr = c.map((x, i) => (i === 0 ? x.high - x.low : Math.max(x.high - x.low, Math.abs(x.high - c[i - 1].close), Math.abs(x.low - c[i - 1].close))));
  const out = new Array<number>(c.length).fill(NaN);
  let prev = NaN;
  for (let i = 0; i < c.length; i++) {
    if (i === n - 1) prev = tr.slice(0, n).reduce((a, b) => a + b, 0) / n;
    else if (i >= n) prev = (prev * (n - 1) + tr[i]) / n;
    if (i >= n - 1) out[i] = prev;
  }
  return out;
}

export function cci(c: Candle[], n: number): number[] {
  const tp = c.map((x) => (x.high + x.low + x.close) / 3);
  const m = sma(tp, n);
  return tp.map((v, i) => {
    if (i < n - 1) return NaN;
    let md = 0;
    for (let j = i - n + 1; j <= i; j++) md += Math.abs(tp[j] - m[i]);
    md /= n;
    return md === 0 ? 0 : (v - m[i]) / (0.015 * md);
  });
}

export function parabolicSar(c: Candle[], step = 0.02, max = 0.2): number[] {
  const out = new Array<number>(c.length).fill(NaN);
  if (c.length < 3) return out;
  let up = c[1].close >= c[0].close;
  let sar = up ? c[0].low : c[0].high;
  let ep = up ? c[1].high : c[1].low;
  let af = step;
  for (let i = 1; i < c.length; i++) {
    sar = sar + af * (ep - sar);
    if (up) {
      sar = Math.min(sar, c[i - 1].low, i > 1 ? c[i - 2].low : c[i - 1].low);
      if (c[i].low < sar) {
        up = false;
        sar = ep;
        ep = c[i].low;
        af = step;
      } else if (c[i].high > ep) {
        ep = c[i].high;
        af = Math.min(max, af + step);
      }
    } else {
      sar = Math.max(sar, c[i - 1].high, i > 1 ? c[i - 2].high : c[i - 1].high);
      if (c[i].high > sar) {
        up = true;
        sar = ep;
        ep = c[i].high;
        af = step;
      } else if (c[i].low < ep) {
        ep = c[i].low;
        af = Math.min(max, af + step);
      }
    }
    out[i] = sar;
  }
  return out;
}

// ---------------------------------------------------------------------------
// More built-ins (TradingView / MT5 staples)
// ---------------------------------------------------------------------------

export function stdevOf(v: number[], n: number): number[] {
  return stdev(v, n, sma(v, n));
}

export function wma(v: number[], n: number): number[] {
  const out = new Array<number>(v.length).fill(NaN);
  const den = (n * (n + 1)) / 2;
  for (let i = n - 1; i < v.length; i++) {
    let s = 0;
    for (let j = 0; j < n; j++) s += v[i - j] * (n - j);
    out[i] = s / den;
  }
  return out;
}

export function highest(v: number[], n: number): number[] {
  return v.map((_, i) => (i < n - 1 ? NaN : Math.max(...v.slice(i - n + 1, i + 1))));
}
export function lowest(v: number[], n: number): number[] {
  return v.map((_, i) => (i < n - 1 ? NaN : Math.min(...v.slice(i - n + 1, i + 1))));
}

/** Session VWAP (resets at 00:00 UTC). */
export function vwap(c: Candle[]): number[] {
  let pv = 0;
  let vol = 0;
  let day = -1;
  return c.map((x) => {
    const d = Math.floor(x.time / 86400);
    if (d !== day) {
      day = d;
      pv = 0;
      vol = 0;
    }
    const tp = (x.high + x.low + x.close) / 3;
    pv += tp * x.volume;
    vol += x.volume;
    return vol ? pv / vol : tp;
  });
}

export function donchian(c: Candle[], n: number) {
  const upper = highest(c.map((x) => x.high), n);
  const lower = lowest(c.map((x) => x.low), n);
  return { upper, lower, mid: upper.map((u, i) => (u + lower[i]) / 2) };
}

export function keltner(c: Candle[], n: number, mult = 2) {
  const mid = ema(c.map((x) => x.close), n);
  const a = atr(c, n);
  return { mid, upper: mid.map((m, i) => m + mult * a[i]), lower: mid.map((m, i) => m - mult * a[i]) };
}

export function ichimoku(c: Candle[], tenkan = 9, kijun = 26, senkouB = 52) {
  const hi = c.map((x) => x.high);
  const lo = c.map((x) => x.low);
  const mid = (n: number) => highest(hi, n).map((h, i) => (h + lowest(lo, n)[i]) / 2);
  const t = mid(tenkan);
  const k = mid(kijun);
  const b = mid(senkouB);
  // spans are plotted shifted forward in real Ichimoku; aligned here so they stay on existing bars
  const spanA = t.map((x, i) => (x + k[i]) / 2);
  return { tenkan: t, kijun: k, spanA, spanB: b };
}

export function supertrend(c: Candle[], n = 10, mult = 3): number[] {
  const a = atr(c, n);
  const out = new Array<number>(c.length).fill(NaN);
  let upper = NaN;
  let lower = NaN;
  let up = true;
  for (let i = 0; i < c.length; i++) {
    if (!Number.isFinite(a[i])) continue;
    const hl2 = (c[i].high + c[i].low) / 2;
    const bu = hl2 + mult * a[i];
    const bl = hl2 - mult * a[i];
    upper = Number.isFinite(upper) && (bu < upper || c[i - 1].close > upper) ? Math.min(bu, upper) : bu;
    lower = Number.isFinite(lower) && (bl > lower || c[i - 1].close < lower) ? Math.max(bl, lower) : bl;
    if (up && c[i].close < lower) up = false;
    else if (!up && c[i].close > upper) up = true;
    out[i] = up ? lower : upper;
  }
  return out;
}

export function williamsR(c: Candle[], n: number): number[] {
  const h = highest(c.map((x) => x.high), n);
  const l = lowest(c.map((x) => x.low), n);
  return c.map((x, i) => (h[i] === l[i] ? -50 : ((h[i] - x.close) / (h[i] - l[i])) * -100));
}

export function momentum(c: Candle[], n: number): number[] {
  return c.map((x, i) => (i < n ? NaN : (x.close / c[i - n].close) * 100));
}

export function adx(c: Candle[], n: number) {
  const len = c.length;
  const plus = new Array<number>(len).fill(0);
  const minus = new Array<number>(len).fill(0);
  const tr = new Array<number>(len).fill(0);
  for (let i = 1; i < len; i++) {
    const upMove = c[i].high - c[i - 1].high;
    const dnMove = c[i - 1].low - c[i].low;
    plus[i] = upMove > dnMove && upMove > 0 ? upMove : 0;
    minus[i] = dnMove > upMove && dnMove > 0 ? dnMove : 0;
    tr[i] = Math.max(c[i].high - c[i].low, Math.abs(c[i].high - c[i - 1].close), Math.abs(c[i].low - c[i - 1].close));
  }
  const rma = (v: number[]) => {
    const out = new Array<number>(len).fill(NaN);
    let prev = NaN;
    for (let i = 1; i < len; i++) {
      if (i === n) prev = v.slice(1, n + 1).reduce((a, b) => a + b, 0) / n;
      else if (i > n) prev = (prev * (n - 1) + v[i]) / n;
      if (i >= n) out[i] = prev;
    }
    return out;
  };
  const atrv = rma(tr);
  const pdi = rma(plus).map((x, i) => (100 * x) / atrv[i]);
  const mdi = rma(minus).map((x, i) => (100 * x) / atrv[i]);
  const dx = pdi.map((p, i) => (p + mdi[i] === 0 ? 0 : (100 * Math.abs(p - mdi[i])) / (p + mdi[i])));
  const adxv = ema(dx.map((x) => (Number.isFinite(x) ? x : NaN)), n);
  return { adx: adxv, plus: pdi, minus: mdi };
}

export function obv(c: Candle[]): number[] {
  let v = 0;
  return c.map((x, i) => (i === 0 ? 0 : (v += x.close > c[i - 1].close ? x.volume : x.close < c[i - 1].close ? -x.volume : 0)));
}

export function mfi(c: Candle[], n: number): number[] {
  const tp = c.map((x) => (x.high + x.low + x.close) / 3);
  return c.map((_, i) => {
    if (i < n) return NaN;
    let pos = 0;
    let neg = 0;
    for (let j = i - n + 1; j <= i; j++) {
      const flow = tp[j] * c[j].volume;
      if (tp[j] > tp[j - 1]) pos += flow;
      else if (tp[j] < tp[j - 1]) neg += flow;
    }
    return neg === 0 ? 100 : 100 - 100 / (1 + pos / neg);
  });
}

export function awesome(c: Candle[]): number[] {
  const hl2 = c.map((x) => (x.high + x.low) / 2);
  const f = sma(hl2, 5);
  const s = sma(hl2, 34);
  return f.map((x, i) => x - s[i]);
}

// ---------------------------------------------------------------------------
// Order flow (from the simulated tape). Each bar's volume is split into
// aggressive buys and sells from where it closed inside its range, plus a
// deterministic imbalance, the way footprint tools approximate delta.
// ---------------------------------------------------------------------------

function frac(t: number): number {
  const x = Math.sin(t * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

/** Per-bar volume delta (aggressive buys − sells). */
export function volumeDelta(c: Candle[]): number[] {
  return c.map((x) => {
    const range = x.high - x.low;
    const pos = range > 0 ? (x.close - x.open) / range : 0; // −1..1
    const imbalance = (frac(x.time) - 0.5) * 0.35;
    return Math.round(x.volume * Math.max(-0.95, Math.min(0.95, pos * 0.7 + imbalance)));
  });
}

/** Cumulative volume delta (resets daily, like most CVD tools). */
export function cvd(c: Candle[]): number[] {
  const d = volumeDelta(c);
  let sum = 0;
  let day = -1;
  return d.map((x, i) => {
    const dd = Math.floor(c[i].time / 86400);
    if (dd !== day) {
      day = dd;
      sum = 0;
    }
    return (sum += x);
  });
}

export interface ProfileBin {
  lo: number;
  hi: number;
  buy: number;
  sell: number;
}
export interface VolumeProfile {
  bins: ProfileBin[];
  poc: number;
  vah: number;
  val: number;
}

/** Volume profile over the given bars: volume spread across each bar's range. */
export function volumeProfile(c: Candle[], rows = 28): VolumeProfile | null {
  if (!c.length) return null;
  let lo = Infinity;
  let hi = -Infinity;
  for (const x of c) {
    lo = Math.min(lo, x.low);
    hi = Math.max(hi, x.high);
  }
  if (!(hi > lo)) return null;
  const step = (hi - lo) / rows;
  const bins: ProfileBin[] = Array.from({ length: rows }, (_, i) => ({ lo: lo + i * step, hi: lo + (i + 1) * step, buy: 0, sell: 0 }));
  const delta = volumeDelta(c);
  c.forEach((x, k) => {
    const a = Math.max(0, Math.floor((x.low - lo) / step));
    const b = Math.min(rows - 1, Math.floor((x.high - lo) / step));
    const n = b - a + 1;
    const buyShare = x.volume ? (x.volume + delta[k]) / 2 / x.volume : 0.5;
    for (let i = a; i <= b; i++) {
      bins[i].buy += (x.volume / n) * buyShare;
      bins[i].sell += (x.volume / n) * (1 - buyShare);
    }
  });
  const tot = (b: ProfileBin) => b.buy + b.sell;
  let pocI = 0;
  bins.forEach((b, i) => {
    if (tot(b) > tot(bins[pocI])) pocI = i;
  });
  // value area: 70% of volume around the POC
  const all = bins.reduce((s, b) => s + tot(b), 0);
  let inside = tot(bins[pocI]);
  let up = pocI;
  let dn = pocI;
  while (inside < all * 0.7 && (up < rows - 1 || dn > 0)) {
    const nu = up < rows - 1 ? tot(bins[up + 1]) : -1;
    const nd = dn > 0 ? tot(bins[dn - 1]) : -1;
    if (nu >= nd) inside += tot(bins[++up]);
    else inside += tot(bins[--dn]);
  }
  return { bins, poc: (bins[pocI].lo + bins[pocI].hi) / 2, vah: bins[up].hi, val: bins[dn].lo };
}
