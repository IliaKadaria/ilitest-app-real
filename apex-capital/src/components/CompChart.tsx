import { useEffect, useRef, useState } from 'react';
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  LineStyle,
  createChart,
  createSeriesMarkers,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type SeriesMarker,
  type Time,
  type UTCTimestamp,
} from 'lightweight-charts';
import { SYMBOL_MAP, displayDigits } from '../market/symbols.ts';
import type { Candle } from '../market/engine.ts';
import type { Position } from '../game/account.ts';
import { useSettings } from '../game/settings.ts';
import { compQuote, rouletteSwings, scoopEvents, type Competition } from '../game/competitions.ts';

// Candlestick chart of a competition's own price feed (swings, scoops, the
// pump curve), built from compQuote. Closed bars are cached per competition.

const TFS = [
  { id: '5s', sec: 5 },
  { id: '15s', sec: 15 },
  { id: '1m', sec: 60 },
  { id: '5m', sec: 300 },
];
const BARS = 90;
const ts = (t: number) => t as UTCTimestamp;

const cache = new Map<string, Candle>();

function compCandle(c: Competition, sym: string, tf: number, start: number, end: number, crowd: number): Candle {
  const step = Math.max(0.5, tf / 12);
  const open = compQuote(c, sym, start, crowd).mid;
  let high = open;
  let low = open;
  let close = open;
  for (let t = start + step; t <= end + 1e-9; t += step) {
    const p = compQuote(c, sym, Math.min(t, end), crowd).mid;
    if (p > high) high = p;
    if (p < low) low = p;
    close = p;
  }
  return { time: start, open, high, low, close, volume: 0 };
}

function compCandles(c: Competition, sym: string, tf: number, now: number, crowd: number): Candle[] {
  const cur = Math.floor(now / tf) * tf;
  const out: Candle[] = [];
  for (let start = cur - (BARS - 1) * tf; start < cur; start += tf) {
    const key = `${c.id}:${c.seed}:${sym}:${tf}:${start}`;
    let k = cache.get(key);
    if (!k) {
      k = compCandle(c, sym, tf, start, start + tf, crowd);
      cache.set(key, k);
    }
    out.push(k);
  }
  if (cache.size > 5000) cache.clear();
  out.push(compCandle(c, sym, tf, cur, now, crowd));
  return out;
}

export function CompChart({ c, sym, now, crowd, positions }: { c: Competition; sym: string; now: number; crowd: number; positions: Position[] }) {
  const st = useSettings();
  const colors = st.colors;
  const el = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const series = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const markers = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const lines = useRef<IPriceLine[]>([]);
  const last = useRef<Candle | null>(null);
  const [tf, setTf] = useState(15);
  const def = SYMBOL_MAP[sym];

  // create once
  useEffect(() => {
    if (!el.current) return;
    const ch = createChart(el.current, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: colors.background }, textColor: colors.foreground, fontSize: 10, fontFamily: "'Geist Mono Variable', ui-monospace, monospace", attributionLogo: false },
      grid: { vertLines: { color: colors.grid }, horzLines: { color: colors.grid } },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: colors.grid, scaleMargins: { top: 0.12, bottom: 0.08 } },
      timeScale: { borderColor: colors.grid, timeVisible: true, secondsVisible: true, rightOffset: 4, barSpacing: 6 },
      handleScale: { pinch: true, mouseWheel: true, axisPressedMouseMove: true },
      handleScroll: { horzTouchDrag: true, vertTouchDrag: false, pressedMouseMove: true },
    });
    chart.current = ch;
    return () => {
      ch.remove();
      chart.current = null;
      series.current = null;
      markers.current = null;
      lines.current = [];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // (re)build series + history
  useEffect(() => {
    const ch = chart.current;
    if (!ch) return;
    if (series.current) {
      try {
        ch.removeSeries(series.current);
      } catch {
        /* disposed */
      }
    }
    lines.current = [];
    ch.applyOptions({ layout: { background: { type: ColorType.Solid, color: colors.background }, textColor: colors.foreground }, grid: { vertLines: { color: colors.grid }, horzLines: { color: colors.grid } }, timeScale: { secondsVisible: tf < 60 } });
    const digits = displayDigits(def);
    const s = ch.addSeries(CandlestickSeries, {
      upColor: colors.bullCandle,
      downColor: colors.bearCandle,
      borderUpColor: colors.barUp,
      borderDownColor: colors.barDown,
      wickUpColor: colors.barUp,
      wickDownColor: colors.barDown,
      priceFormat: { type: 'price', precision: digits, minMove: Math.pow(10, -digits) },
      priceLineColor: colors.bidLine,
    });
    series.current = s;
    const t = Date.now() / 1000;
    const data = compCandles(c, sym, tf, t, crowd);
    s.setData(data.map((k) => ({ ...k, time: ts(k.time) })));
    last.current = data[data.length - 1];
    // competition events on the chart
    const ev: SeriesMarker<Time>[] = [];
    const from = data[0].time;
    const bucket = (x: number) => ts(Math.floor(x / tf) * tf);
    if (c.mode === 'roulette') for (const w of rouletteSwings(c)) if (w.sym === sym && w.at >= from && w.at <= t) ev.push({ time: bucket(w.at), position: w.move > 0 ? 'belowBar' : 'aboveBar', shape: w.move > 0 ? 'arrowUp' : 'arrowDown', color: '#d6b26e', text: 'SPIN' });
    if (c.mode === 'scoop') for (const e of scoopEvents(c)) if (e.sym === sym && e.at >= from && e.at <= t) ev.push({ time: bucket(e.at), position: e.dir > 0 ? 'belowBar' : 'aboveBar', shape: e.dir > 0 ? 'arrowUp' : 'arrowDown', color: '#d6b26e', text: 'NEWS' });
    if (c.mode === 'pump' && c.startsAt && c.startsAt + 900 >= from && c.startsAt + 900 <= t) ev.push({ time: bucket(c.startsAt + 900), position: 'aboveBar', shape: 'arrowDown', color: '#e5484d', text: 'RUG' });
    markers.current = createSeriesMarkers(s, ev);
    ch.timeScale().scrollToRealTime();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c.id, sym, tf, colors]);

  // live bar
  useEffect(() => {
    const s = series.current;
    const lc = last.current;
    if (!s || !lc) return;
    const q = compQuote(c, sym, now, crowd).mid;
    const start = Math.floor(now / tf) * tf;
    if (start > lc.time) {
      const closed = compCandle(c, sym, tf, lc.time, lc.time + tf, crowd);
      s.update({ ...closed, time: ts(closed.time) });
      const next: Candle = { time: start, open: closed.close, high: Math.max(closed.close, q), low: Math.min(closed.close, q), close: q, volume: 0 };
      s.update({ ...next, time: ts(start) });
      last.current = next;
    } else if (start === lc.time) {
      const next = { ...lc, high: Math.max(lc.high, q), low: Math.min(lc.low, q), close: q };
      s.update({ ...next, time: ts(start) });
      last.current = next;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [now]);

  // my positions as entry lines
  const posKey = positions.filter((p) => p.sym === sym).map((p) => `${p.id}:${p.open}`).join(',');
  useEffect(() => {
    const s = series.current;
    if (!s) return;
    for (const l of lines.current) s.removePriceLine(l);
    lines.current = positions
      .filter((p) => p.sym === sym)
      .map((p) => s.createPriceLine({ price: p.open, color: p.side === 1 ? '#7aa7ff' : '#ff7a7f', lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: `${p.side === 1 ? 'BUY' : 'SELL'} ${p.lots.toFixed(2)}` }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [posKey, sym, tf, c.id, colors]);

  return (
    <>
      <div className="comptf">
        {TFS.map((x) => (
          <button key={x.id} className={tf === x.sec ? 'on' : ''} onClick={() => setTf(x.sec)}>{x.id}</button>
        ))}
      </div>
      <div className="compchart" ref={el} />
    </>
  );
}
