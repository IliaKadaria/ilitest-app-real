import { useEffect, useRef } from 'react';
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  LineSeries,
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
import { buildCandle, candles, quote, recentNews, type Candle } from '../market/engine.ts';
import { SYMBOL_MAP } from '../market/symbols.ts';
import type { Position } from '../game/account.ts';

const COUNT = 240;
const C = { bg: '#121214', grid: 'rgba(229,229,231,0.045)', text: '#8e8e93', up: '#4cc38a', down: '#e5484d', buy: '#7aa7ff', sell: '#ff7a7f', line: 'rgba(229,229,231,0.09)' };

function ema(data: Candle[], period: number) {
  const k = 2 / (period + 1);
  let prev = data[0]?.close ?? 0;
  return data.map((c, i) => {
    prev = i === 0 ? c.close : c.close * k + prev * (1 - k);
    return { time: c.time as UTCTimestamp, value: prev };
  });
}

interface Props {
  sym: string;
  tfSec: number;
  now: number;
  positions: Position[];
  showEma: boolean;
}

export function Chart({ sym, tfSec, now, positions, showEma }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const series = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const ema20 = useRef<ISeriesApi<'Line'> | null>(null);
  const ema50 = useRef<ISeriesApi<'Line'> | null>(null);
  const markers = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const live = useRef<Candle | null>(null);
  const bidLine = useRef<IPriceLine | null>(null);
  const askLine = useRef<IPriceLine | null>(null);
  const posLines = useRef<IPriceLine[]>([]);
  const markerKey = useRef('');
  const data = useRef<Candle[]>([]);

  // create once
  useEffect(() => {
    if (!el.current) return;
    const c = createChart(el.current, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: C.bg }, textColor: C.text, fontSize: 10.5, fontFamily: "'Geist Mono Variable', ui-monospace, monospace", attributionLogo: true },
      grid: { vertLines: { color: C.grid }, horzLines: { color: C.grid } },
      crosshair: { mode: CrosshairMode.Normal, vertLine: { color: 'rgba(229,229,231,0.25)', labelBackgroundColor: '#26282c' }, horzLine: { color: 'rgba(229,229,231,0.25)', labelBackgroundColor: '#26282c' } },
      rightPriceScale: { borderColor: C.line, scaleMargins: { top: 0.12, bottom: 0.08 } },
      timeScale: { borderColor: C.line, timeVisible: true, secondsVisible: false, rightOffset: 6, barSpacing: 7 },
      handleScale: { axisPressedMouseMove: true, pinch: true, mouseWheel: true },
    });
    series.current = c.addSeries(CandlestickSeries, {
      upColor: C.up,
      downColor: C.down,
      borderVisible: false,
      wickUpColor: C.up,
      wickDownColor: C.down,
      lastValueVisible: false,
      priceLineVisible: false,
    });
    ema20.current = c.addSeries(LineSeries, { color: 'rgba(229,229,231,0.55)', lineWidth: 1, lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false });
    ema50.current = c.addSeries(LineSeries, { color: 'rgba(122,167,255,0.55)', lineWidth: 1, lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false });
    markers.current = createSeriesMarkers(series.current, []);
    chart.current = c;
    return () => {
      c.remove();
      chart.current = null;
      series.current = null;
      bidLine.current = null;
      askLine.current = null;
      posLines.current = [];
    };
  }, []);

  const load = () => {
    const s = series.current;
    if (!s) return;
    const def = SYMBOL_MAP[sym];
    const minMove = Math.pow(10, -def.digits);
    s.applyOptions({ priceFormat: { type: 'price', precision: def.digits, minMove } });
    const t = Date.now() / 1000;
    const d = candles(sym, tfSec, COUNT, t);
    data.current = d;
    live.current = { ...d[d.length - 1] };
    s.setData(d.map((c) => ({ ...c, time: c.time as UTCTimestamp })));
    ema20.current?.setData(ema(d, 20));
    ema50.current?.setData(ema(d, 50));
    chart.current?.timeScale().applyOptions({ secondsVisible: tfSec < 60 });
    chart.current?.timeScale().scrollToRealTime();
    if (bidLine.current) s.removePriceLine(bidLine.current);
    if (askLine.current) s.removePriceLine(askLine.current);
    const q = quote(sym, t);
    bidLine.current = s.createPriceLine({ price: q.bid, color: '#8e8e93', lineWidth: 1, lineStyle: LineStyle.Solid, axisLabelVisible: true, title: 'BID' });
    askLine.current = s.createPriceLine({ price: q.ask, color: 'rgba(255,122,127,0.6)', lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: false, title: '' });
    markerKey.current = '';
  };
  const loadRef = useRef(load);
  loadRef.current = load;

  // load history on symbol / timeframe change
  useEffect(() => loadRef.current(), [sym, tfSec]);

  useEffect(() => {
    ema20.current?.applyOptions({ visible: showEma });
    ema50.current?.applyOptions({ visible: showEma });
  }, [showEma]);

  // live tick
  useEffect(() => {
    const s = series.current;
    if (!s || !live.current) return;
    const q = quote(sym, now);
    if (!q.open) {
      // market closed: frozen price, no live candle
      bidLine.current?.applyOptions({ price: q.bid });
      askLine.current?.applyOptions({ price: q.ask });
      return;
    }
    const start = Math.floor(now / tfSec) * tfSec;
    let lc = live.current;
    if (lc.time > start) return;
    if (start - lc.time > tfSec) {
      loadRef.current(); // tab slept through several candles: rebuild
      return;
    }
    if (start !== lc.time) {
      // previous candle closed: replace with canonical deterministic version
      const closed = buildCandle(sym, tfSec, lc.time);
      s.update({ ...closed, time: closed.time as UTCTimestamp });
      data.current = [...data.current.slice(-COUNT), closed];
      lc = { time: start, open: closed.close, high: Math.max(closed.close, q.mid), low: Math.min(closed.close, q.mid), close: q.mid };
    } else {
      lc = { ...lc, high: Math.max(lc.high, q.mid), low: Math.min(lc.low, q.mid), close: q.mid };
    }
    live.current = lc;
    s.update({ ...lc, time: lc.time as UTCTimestamp });
    data.current[data.current.length - 1] = lc;
    if (showEma && Math.floor(now * 4) % 4 === 0) {
      const tail = ema(data.current, 20);
      const tail50 = ema(data.current, 50);
      ema20.current?.update(tail[tail.length - 1]);
      ema50.current?.update(tail50[tail50.length - 1]);
    }
    bidLine.current?.applyOptions({ price: q.bid });
    askLine.current?.applyOptions({ price: q.ask });

    // news markers (recompute when the set changes)
    const news = recentNews(now, Math.min(COUNT * tfSec, 6 * 3600)).filter((e) => e.symbol === sym || e.symbol === null);
    const key = `${tfSec}:${news.map((n) => n.id).join(',')}`;
    if (key !== markerKey.current) {
      markerKey.current = key;
      const ms: SeriesMarker<Time>[] = news
        .map((e) => ({
          time: (Math.floor(e.t0 / tfSec) * tfSec) as UTCTimestamp,
          position: e.dir > 0 ? ('belowBar' as const) : ('aboveBar' as const),
          shape: e.dir > 0 ? ('arrowUp' as const) : ('arrowDown' as const),
          color: e.kind === 'shock' ? C.down : e.kind === 'macro' ? '#d6b26e' : e.dir > 0 ? C.up : C.down,
          text: e.kind === 'shock' ? 'HALT' : e.kind === 'macro' ? 'DATA' : 'NEWS',
        }))
        .sort((a, b) => (a.time as number) - (b.time as number));
      markers.current?.setMarkers(ms);
    }
  }, [now, sym, tfSec, showEma]);

  // position / SL / TP lines
  useEffect(() => {
    const s = series.current;
    if (!s) return;
    posLines.current.forEach((l) => s.removePriceLine(l));
    posLines.current = [];
    for (const p of positions.filter((x) => x.sym === sym)) {
      posLines.current.push(s.createPriceLine({ price: p.open, color: p.side === 1 ? C.buy : C.sell, lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: `${p.side === 1 ? 'BUY' : 'SELL'} ${p.lots.toFixed(2)}` }));
      if (p.sl !== null) posLines.current.push(s.createPriceLine({ price: p.sl, color: C.down, lineWidth: 1, lineStyle: LineStyle.SparseDotted, axisLabelVisible: true, title: 'SL' }));
      if (p.tp !== null) posLines.current.push(s.createPriceLine({ price: p.tp, color: C.up, lineWidth: 1, lineStyle: LineStyle.SparseDotted, axisLabelVisible: true, title: 'TP' }));
    }
  }, [positions, sym]);

  return <div className="chart" ref={el} />;
}
