import type { Candle } from './engine.ts';
import { atr, cvd, ema, highest, lowest, sma, stdevOf, volumeDelta, vwap, wma } from './indicators.ts';

// ---------------------------------------------------------------------------
// Custom indicators: a tiny, safe formula language (no eval, no globals).
//   ema(close, 9) - ema(close, 21)
//   (close - lowest(low, 14)) / (highest(high, 14) - lowest(low, 14)) * 100
//   sma(close, 20); sma(close, 20) + 2 * stdev(close, 20)     ← ';' = several lines
// Series: open high low close volume hl2 hlc3 ohlc4, x[n] = value n bars ago.
// Operators: + - * / ^ and parentheses.
// ---------------------------------------------------------------------------

type Val = number | number[];

export const SCRIPT_FUNCS: Record<string, string> = {
  sma: 'sma(src, n)',
  ema: 'ema(src, n)',
  wma: 'wma(src, n)',
  rsi: 'rsi(src, n)',
  stdev: 'stdev(src, n)',
  highest: 'highest(src, n)',
  lowest: 'lowest(src, n)',
  change: 'change(src, n)',
  roc: 'roc(src, n)',
  atr: 'atr(n)',
  vwap: 'vwap()',
  delta: 'delta()',
  cvd: 'cvd()',
  abs: 'abs(x)',
  sqrt: 'sqrt(x)',
  log: 'log(x)',
  max: 'max(a, b)',
  min: 'min(a, b)',
};
export const SCRIPT_VARS = ['open', 'high', 'low', 'close', 'volume', 'hl2', 'hlc3', 'ohlc4'];

type Tok = { k: 'num'; v: number } | { k: 'id'; v: string } | { k: 'op'; v: string };

function lex(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    const num = /^(\d+\.?\d*|\.\d+)/.exec(src.slice(i));
    if (num) {
      out.push({ k: 'num', v: Number(num[1]) });
      i += num[1].length;
      continue;
    }
    const id = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i));
    if (id) {
      out.push({ k: 'id', v: id[0].toLowerCase() });
      i += id[0].length;
      continue;
    }
    if ('+-*/^(),[];'.includes(ch)) {
      out.push({ k: 'op', v: ch });
      i++;
      continue;
    }
    throw new Error(`Unexpected “${ch}”`);
  }
  return out;
}

type Node =
  | { t: 'num'; v: number }
  | { t: 'var'; v: string }
  | { t: 'call'; f: string; args: Node[] }
  | { t: 'bin'; op: string; a: Node; b: Node }
  | { t: 'neg'; a: Node }
  | { t: 'ago'; a: Node; n: number };

function parse(tokens: Tok[]): Node[] {
  let p = 0;
  const peek = () => tokens[p];
  const isOp = (v: string) => peek()?.k === 'op' && peek().v === v;
  const expect = (v: string) => {
    if (!isOp(v)) throw new Error(`Expected “${v}”`);
    p++;
  };
  const primary = (): Node => {
    const tk = peek();
    if (!tk) throw new Error('Unexpected end of formula');
    if (tk.k === 'num') {
      p++;
      return { t: 'num', v: tk.v };
    }
    if (tk.k === 'id') {
      p++;
      if (isOp('(')) {
        p++;
        const args: Node[] = [];
        if (!isOp(')')) {
          args.push(add());
          while (isOp(',')) {
            p++;
            args.push(add());
          }
        }
        expect(')');
        if (!SCRIPT_FUNCS[tk.v]) throw new Error(`Unknown function “${tk.v}”`);
        return { t: 'call', f: tk.v, args };
      }
      if (!SCRIPT_VARS.includes(tk.v)) throw new Error(`Unknown series “${tk.v}”`);
      return { t: 'var', v: tk.v };
    }
    if (isOp('(')) {
      p++;
      const e = add();
      expect(')');
      return e;
    }
    throw new Error(`Unexpected “${tk.v}”`);
  };
  const postfix = (): Node => {
    let n = primary();
    while (isOp('[')) {
      p++;
      const tk = peek();
      if (tk?.k !== 'num') throw new Error('Use a number inside [ ]');
      p++;
      expect(']');
      n = { t: 'ago', a: n, n: Math.floor(tk.v) };
    }
    return n;
  };
  const unary = (): Node => {
    if (isOp('-')) {
      p++;
      return { t: 'neg', a: unary() };
    }
    if (isOp('+')) {
      p++;
      return unary();
    }
    return postfix();
  };
  const pow = (): Node => {
    const a = unary();
    if (isOp('^')) {
      p++;
      return { t: 'bin', op: '^', a, b: pow() };
    }
    return a;
  };
  const mul = (): Node => {
    let a = pow();
    while (isOp('*') || isOp('/')) {
      const op = tokens[p++].v as string;
      a = { t: 'bin', op, a, b: pow() };
    }
    return a;
  };
  const add = (): Node => {
    let a = mul();
    while (isOp('+') || isOp('-')) {
      const op = tokens[p++].v as string;
      a = { t: 'bin', op, a, b: mul() };
    }
    return a;
  };
  const lines: Node[] = [];
  while (p < tokens.length) {
    lines.push(add());
    if (isOp(';')) p++;
    else if (p < tokens.length) throw new Error(`Unexpected “${String(peek().v)}”`);
  }
  if (!lines.length) throw new Error('Empty formula');
  if (lines.length > 4) throw new Error('At most 4 lines');
  return lines;
}

const series = (v: Val, n: number): number[] => (typeof v === 'number' ? new Array<number>(n).fill(v) : v);
const period = (v: Val | undefined, fallback: number): number => {
  const x = typeof v === 'number' ? v : fallback;
  return Math.max(1, Math.min(500, Math.round(x)));
};
const map2 = (a: Val, b: Val, n: number, f: (x: number, y: number) => number): Val =>
  typeof a === 'number' && typeof b === 'number' ? f(a, b) : series(a, n).map((x, i) => f(x, series(b, n)[i]));

function rsiOf(v: number[], n: number): number[] {
  const out = new Array<number>(v.length).fill(NaN);
  let g = 0;
  let l = 0;
  for (let i = 1; i < v.length; i++) {
    const d = v[i] - v[i - 1];
    if (!Number.isFinite(d)) continue;
    if (i <= n) {
      g += Math.max(0, d) / n;
      l += Math.max(0, -d) / n;
    } else {
      g = (g * (n - 1) + Math.max(0, d)) / n;
      l = (l * (n - 1) + Math.max(0, -d)) / n;
    }
    if (i >= n) out[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
  }
  return out;
}

function evaluate(node: Node, c: Candle[]): Val {
  const n = c.length;
  switch (node.t) {
    case 'num':
      return node.v;
    case 'var':
      switch (node.v) {
        case 'open':
          return c.map((x) => x.open);
        case 'high':
          return c.map((x) => x.high);
        case 'low':
          return c.map((x) => x.low);
        case 'close':
          return c.map((x) => x.close);
        case 'volume':
          return c.map((x) => x.volume);
        case 'hl2':
          return c.map((x) => (x.high + x.low) / 2);
        case 'hlc3':
          return c.map((x) => (x.high + x.low + x.close) / 3);
        default:
          return c.map((x) => (x.open + x.high + x.low + x.close) / 4);
      }
    case 'neg': {
      const a = evaluate(node.a, c);
      return typeof a === 'number' ? -a : a.map((x) => -x);
    }
    case 'ago': {
      const a = series(evaluate(node.a, c), n);
      return a.map((_, i) => (i - node.n >= 0 ? a[i - node.n] : NaN));
    }
    case 'bin': {
      const a = evaluate(node.a, c);
      const b = evaluate(node.b, c);
      const f = node.op === '+' ? (x: number, y: number) => x + y : node.op === '-' ? (x: number, y: number) => x - y : node.op === '*' ? (x: number, y: number) => x * y : node.op === '/' ? (x: number, y: number) => (y === 0 ? NaN : x / y) : (x: number, y: number) => Math.pow(x, y);
      return map2(a, b, n, f);
    }
    case 'call': {
      const args = node.args.map((x) => evaluate(x, c));
      const src = () => series(args[0] ?? 0, n);
      switch (node.f) {
        case 'sma':
          return sma(src(), period(args[1], 14));
        case 'ema':
          return ema(src(), period(args[1], 14));
        case 'wma':
          return wma(src(), period(args[1], 14));
        case 'rsi':
          return rsiOf(src(), period(args[1], 14));
        case 'stdev':
          return stdevOf(src(), period(args[1], 20));
        case 'highest':
          return highest(src(), period(args[1], 14));
        case 'lowest':
          return lowest(src(), period(args[1], 14));
        case 'change': {
          const s = src();
          const k = period(args[1], 1);
          return s.map((x, i) => (i >= k ? x - s[i - k] : NaN));
        }
        case 'roc': {
          const s = src();
          const k = period(args[1], 10);
          return s.map((x, i) => (i >= k ? ((x - s[i - k]) / s[i - k]) * 100 : NaN));
        }
        case 'atr':
          return atr(c, period(args[0], 14));
        case 'vwap':
          return vwap(c);
        case 'delta':
          return volumeDelta(c);
        case 'cvd':
          return cvd(c);
        case 'abs':
          return typeof args[0] === 'number' ? Math.abs(args[0]) : src().map(Math.abs);
        case 'sqrt':
          return typeof args[0] === 'number' ? Math.sqrt(args[0]) : src().map(Math.sqrt);
        case 'log':
          return typeof args[0] === 'number' ? Math.log(args[0]) : src().map(Math.log);
        case 'max':
          return map2(args[0] ?? 0, args[1] ?? 0, n, Math.max);
        case 'min':
          return map2(args[0] ?? 0, args[1] ?? 0, n, Math.min);
      }
    }
  }
  return NaN;
}

const compiled = new Map<string, Node[] | Error>();

function compile(src: string): Node[] {
  let hit = compiled.get(src);
  if (!hit) {
    try {
      hit = parse(lex(src));
    } catch (e) {
      hit = e instanceof Error ? e : new Error(String(e));
    }
    if (compiled.size > 200) compiled.clear();
    compiled.set(src, hit);
  }
  if (hit instanceof Error) throw hit;
  return hit;
}

/** null if the formula is valid, else a readable error. */
export function checkScript(src: string): string | null {
  try {
    compile(src);
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}

/** One output series per line of the formula. Invalid formulas give []. */
export function runScript(src: string, c: Candle[]): number[][] {
  try {
    return compile(src).map((node) => series(evaluate(node, c), c.length).map((x) => (Number.isFinite(x) ? x : NaN)));
  } catch {
    return [];
  }
}
