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
