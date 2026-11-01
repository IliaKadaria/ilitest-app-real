import { useEffect, useRef, useState } from 'react';
import {
  BarSeries,
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  LineStyle,
  createChart,
  createSeriesMarkers,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type MouseEventParams,
  type SeriesMarker,
  type SeriesType,
  type Time,
  type UTCTimestamp,
} from 'lightweight-charts';
import { buildCandle, candles, quote, recentNews, type Candle } from '../market/engine.ts';
import { atr, bollinger, cci, ema, envelopes, macd, parabolicSar, rsi, sma, stochastic } from '../market/indicators.ts';
import { SYMBOL_MAP, fmtPrice } from '../market/symbols.ts';
import { PENDING_LABEL, positionProfit, type Deal, type PendingOrder, type Position } from '../game/account.ts';
import { INDICATOR_INFO, type ChartColors, type ChartObject, type ChartToggles, type ChartType, type Indicator, type ObjType } from '../game/settings.ts';
import { money } from '../format.ts';

const ts = (t: number) => t as UTCTimestamp;
const BUY = '#5b8cff';
const SELL = '#ff6b70';
const FIB = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
const TWO_POINT: ObjType[] = ['trend', 'rect', 'fibo'];

export interface HoverInfo {
  candle: Candle;
  values: { label: string; value: string; color: string }[];
}

interface Props {
  sym: string;
  tf: number;
  now: number;
  type: ChartType;
  toggles: ChartToggles;
  colors: ChartColors;
  indicators: Indicator[];
  objects: ChartObject[];
  tool: ObjType | null;
  onPlace: (o: Omit<ChartObject, 'id'>) => void;
  positions: Position[];
  orders: PendingOrder[];
  deals: Deal[];
  focus: Deal | null;
  onHover?: (h: HoverInfo | null) => void;
}

interface IndSeries {
  ind: Indicator;
  series: ISeriesApi<SeriesType>[];
}

function alpha(hex: string, a: number) {
  const h = hex.replace('#', '');
  if (h.length !== 6) return hex;
  const n = parseInt(h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

function computeIndicator(ind: Indicator, d: Candle[]): number[][] {
  const close = d.map((c) => c.close);
  switch (ind.type) {
    case 'ma':
      return [sma(close, ind.period)];
    case 'ema':
      return [ema(close, ind.period)];
    case 'bb': {
      const b = bollinger(d, ind.period);
      return [b.mid, b.upper, b.lower];
    }
    case 'env': {
      const e = envelopes(d, ind.period);
      return [e.upper, e.lower];
    }
    case 'sar':
      return [parabolicSar(d)];
    case 'rsi':
      return [rsi(d, ind.period)];
    case 'macd': {
      const m = macd(d, ind.period, Math.round(ind.period * 2.17), 9);
      return [m.hist, m.line, m.signal];
    }
    case 'stoch': {
      const s = stochastic(d, ind.period);
      return [s.main, s.signal];
    }
    case 'atr':
      return [atr(d, ind.period)];
    case 'cci':
      return [cci(d, ind.period)];
  }
}

const point = (time: number, v: number) => (Number.isFinite(v) ? { time: ts(time), value: v } : { time: ts(time) });

export function Chart(props: Props) {
  const { sym, tf, now, type, toggles, colors, indicators, objects, tool, positions, orders, deals, focus } = props;
  const el = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const main = useRef<ISeriesApi<'Candlestick' | 'Bar' | 'Line'> | null>(null);
  const vol = useRef<ISeriesApi<'Histogram'> | null>(null);
  const inds = useRef<IndSeries[]>([]);
  const markers = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const data = useRef<Candle[]>([]);
  const bidLine = useRef<IPriceLine | null>(null);
  const askLine = useRef<IPriceLine | null>(null);
  const tradeLines = useRef<{ line: IPriceLine; pos?: Position }[]>([]);
  const markerKey = useRef('');
  const pending = useRef<{ t: number; p: number } | null>(null);
  const [preview, setPreview] = useState<{ t: number; p: number } | null>(null);
  const [build, setBuild] = useState(0);
  const [frame, setFrame] = useState(0);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const propsRef = useRef(props);
  propsRef.current = props;

  // ------------------------------------------------------------ create once
  useEffect(() => {
    if (!el.current) return;
    const c = createChart(el.current, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: '#121214' }, textColor: '#8e8e93', fontSize: 10.5, fontFamily: "'Geist Mono Variable', ui-monospace, monospace", attributionLogo: true, panes: { separatorColor: 'rgba(229,229,231,0.12)' } },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { scaleMargins: { top: 0.1, bottom: 0.12 } },
      timeScale: { timeVisible: true, secondsVisible: false, rightOffset: 8, barSpacing: 7 },
      handleScale: { axisPressedMouseMove: true, pinch: true, mouseWheel: true },
    });
    chart.current = c;
    const redraw = () => setFrame((f) => f + 1);
    c.timeScale().subscribeVisibleLogicalRangeChange(redraw);
    const onClick = (p: MouseEventParams<Time>) => clickRef.current(p);
    const onMove = (p: MouseEventParams<Time>) => moveRef.current(p);
    c.subscribeClick(onClick);
    c.subscribeCrosshairMove(onMove);
    return () => {
      c.timeScale().unsubscribeVisibleLogicalRangeChange(redraw);
      c.unsubscribeClick(onClick);
      c.unsubscribeCrosshairMove(onMove);
      c.remove();
      chart.current = null;
      main.current = null;
      vol.current = null;
      inds.current = [];
      markers.current = null;
      tradeLines.current = [];
      bidLine.current = null;
      askLine.current = null;
    };
  }, []);

  // ------------------------------------------------------------ coordinates
  const xOf = (t: number): number | null => {
    const d = data.current;
    const c = chart.current;
    if (!d.length || !c) return null;
    let logical: number;
    if (t <= d[0].time) logical = (t - d[0].time) / tf;
    else {
      let lo = 0;
      let hi = d.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (d[mid].time <= t) lo = mid;
        else hi = mid - 1;
      }
      const span = lo < d.length - 1 ? d[lo + 1].time - d[lo].time : tf;
      logical = lo + Math.min(lo < d.length - 1 ? 1 : 1e6, (t - d[lo].time) / span);
    }
    return c.timeScale().logicalToCoordinate(logical as never);
  };
  const timeOf = (x: number): number | null => {
    const d = data.current;
    const l = chart.current?.timeScale().coordinateToLogical(x);
    if (l === null || l === undefined || !d.length) return null;
    const i = Math.floor(l);
    const f = l - i;
    if (i < 0) return d[0].time + l * tf;
    if (i >= d.length - 1) return d[d.length - 1].time + (l - (d.length - 1)) * tf;
    return d[i].time + f * (d[i + 1].time - d[i].time);
  };
  const yOf = (p: number) => main.current?.priceToCoordinate(p) ?? null;

  const clickRef = useRef((_: MouseEventParams<Time>) => {});
  clickRef.current = (p) => {
    const tl = propsRef.current.tool;
    if (!tl || !p.point || (p.paneIndex ?? 0) !== 0) return;
    const t = timeOf(p.point.x);
    const pr = main.current?.coordinateToPrice(p.point.y);
    if (t === null || pr === null || pr === undefined) return;
    const color = tl === 'fibo' ? '#d6b26e' : tl === 'rect' ? '#7aa7ff' : '#e5e5e7';
    if (!TWO_POINT.includes(tl)) {
      let label: string | undefined;
      if (tl === 'text') {
        try {
          label = (window.prompt('Text label', 'Note') ?? 'Note').slice(0, 40) || 'Note';
        } catch {
          label = 'Note'; // prompt() is blocked in sandboxed frames
        }
      }
      propsRef.current.onPlace({ type: tl, t1: t, p1: pr, color, label });
      return;
    }
    if (!pending.current) {
      pending.current = { t, p: pr };
      setPreview({ t, p: pr });
      return;
    }
    propsRef.current.onPlace({ type: tl, t1: pending.current.t, p1: pending.current.p, t2: t, p2: pr, color });
    pending.current = null;
    setPreview(null);
  };
  const moveRef = useRef((_: MouseEventParams<Time>) => {});
  moveRef.current = (p) => {
    if (pending.current && p.point) {
      const t = timeOf(p.point.x);
      const pr = main.current?.coordinateToPrice(p.point.y);
      if (t !== null && pr != null) setPreview({ t, p: pr });
    }
    if (p.logical === undefined || p.logical === null || !p.point) {
      setHoverIdx(null);
      return;
    }
    const i = Math.max(0, Math.min(data.current.length - 1, Math.round(p.logical)));
    setHoverIdx(i);
  };

  useEffect(() => {
    if (!tool) {
      pending.current = null;
      setPreview(null);
    }
  }, [tool]);

  // ------------------------------------------------------------ build series
  const indKey = JSON.stringify(indicators);
  useEffect(() => {
    const c = chart.current;
    if (!c) return;
    for (const s of [main.current, vol.current, ...inds.current.flatMap((x) => x.series)]) {
      if (!s) continue;
      try {
        c.removeSeries(s);
      } catch {
        /* series belonged to a disposed chart */
      }
    }
    while (c.panes().length > 1) c.removePane(c.panes().length - 1);
    main.current = null;
    vol.current = null;
    inds.current = [];
    tradeLines.current = [];
    bidLine.current = null;
    askLine.current = null;

    c.applyOptions({
      layout: { background: { type: ColorType.Solid, color: colors.background }, textColor: colors.foreground },
      grid: { vertLines: { color: colors.grid }, horzLines: { color: colors.grid } },
      rightPriceScale: { borderColor: colors.grid, autoScale: !toggles.freeMove },
      timeScale: { borderColor: colors.grid, secondsVisible: false, shiftVisibleRangeOnNewBar: !toggles.freeMove },
      handleScroll: { vertTouchDrag: toggles.freeMove, pressedMouseMove: true, horzTouchDrag: true },
    });

    const def = SYMBOL_MAP[sym];
    const fmt = { type: 'price' as const, precision: def.digits, minMove: Math.pow(10, -def.digits) };
    const common = { lastValueVisible: false, priceLineVisible: false, priceFormat: fmt };
    main.current =
      type === 'candles'
        ? c.addSeries(CandlestickSeries, { ...common, upColor: colors.bullCandle, downColor: colors.bearCandle, borderVisible: true, borderUpColor: colors.barUp, borderDownColor: colors.barDown, wickUpColor: colors.barUp, wickDownColor: colors.barDown })
        : type === 'bars'
          ? c.addSeries(BarSeries, { ...common, upColor: colors.barUp, downColor: colors.barDown, thinBars: false })
          : c.addSeries(LineSeries, { ...common, color: colors.lineChart, lineWidth: 2, crosshairMarkerVisible: true });
    markers.current = createSeriesMarkers(main.current as ISeriesApi<SeriesType>, []);
    markerKey.current = '';

    if (toggles.volume) {
      vol.current = c.addSeries(HistogramSeries, { priceScaleId: 'vol', lastValueVisible: false, priceLineVisible: false, color: alpha(colors.volumes, 0.55), priceFormat: { type: 'volume' } });
      c.priceScale('vol').applyOptions({ scaleMargins: { top: 0.84, bottom: 0 }, visible: false });
    }

    let pane = 0;
    for (const ind of indicators) {
      const info = INDICATOR_INFO[ind.type];
      const p = info.pane ? ++pane : 0;
      const line = (color: string, width: 1 | 2 = 1, extra: object = {}) =>
        c.addSeries(LineSeries, { color, lineWidth: width, lastValueVisible: info.pane, priceLineVisible: false, crosshairMarkerVisible: false, priceFormat: info.pane ? { type: 'price', precision: 2, minMove: 0.01 } : fmt, ...extra }, p);
      let series: ISeriesApi<SeriesType>[];
      switch (ind.type) {
        case 'bb':
          series = [line(ind.color), line(alpha(ind.color, 0.7), 1, { lineStyle: LineStyle.Dashed }), line(alpha(ind.color, 0.7), 1, { lineStyle: LineStyle.Dashed })];
          break;
        case 'env':
          series = [line(ind.color), line(ind.color)];
          break;
        case 'sar':
          series = [line(ind.color, 1, { lineVisible: false, pointMarkersVisible: true, pointMarkersRadius: 1.5 })];
          break;
        case 'macd':
          series = [c.addSeries(HistogramSeries, { color: alpha(ind.color, 0.6), lastValueVisible: false, priceLineVisible: false, priceFormat: { type: 'price', precision: def.digits + 1, minMove: Math.pow(10, -def.digits - 1) } }, p), line('#e5e5e7'), line('#ff7a7f', 1, { lineStyle: LineStyle.Dotted })];
          break;
        case 'stoch':
          series = [line(ind.color), line('#ff7a7f', 1, { lineStyle: LineStyle.Dashed })];
          break;
        default:
          series = [line(ind.color, ind.type === 'rsi' || ind.type === 'cci' || ind.type === 'atr' ? 1 : 2)];
      }
      if (ind.type === 'rsi' || ind.type === 'stoch') {
        series[0].createPriceLine({ price: 70, color: 'rgba(229,229,231,0.25)', lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: false, title: '' });
        series[0].createPriceLine({ price: 30, color: 'rgba(229,229,231,0.25)', lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: false, title: '' });
      }
      if (ind.type === 'cci') {
        series[0].createPriceLine({ price: 100, color: 'rgba(229,229,231,0.25)', lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: false, title: '' });
        series[0].createPriceLine({ price: -100, color: 'rgba(229,229,231,0.25)', lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: false, title: '' });
      }
      inds.current.push({ ind, series });
    }
    const panes = c.panes();
    panes[0]?.setStretchFactor(3);
    for (let i = 1; i < panes.length; i++) panes[i].setStretchFactor(1);

    // data
    const d = candles(sym, tf, toggles.preload ? 1500 : 320, Date.now() / 1000);
    data.current = d;
    pushAll(true);
    c.timeScale().applyOptions({ secondsVisible: false, timeVisible: tf < 86400 });
    if (!propsRef.current.focus) c.timeScale().scrollToRealTime();
    setBuild((b) => b + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sym, tf, type, indKey, toggles.volume, toggles.preload, toggles.freeMove, colors]);

  const volValue = (c: Candle) => (toggles.tickVolumes ? c.volume : Math.round(c.volume * SYMBOL_MAP[sym].contract * 0.013));

  /** Push full data (rebuild) or just the last bar (tick). */
  function pushAll(full: boolean) {
    const d = data.current;
    const m = main.current;
    if (!m || !d.length) return;
    const last = d[d.length - 1];
    const asMain = (c: Candle) => (type === 'line' ? { time: ts(c.time), value: c.close } : { ...c, time: ts(c.time) });
    const volBar = (c: Candle) => ({ time: ts(c.time), value: volValue(c) });
    if (full) {
      m.setData(d.map(asMain) as never);
      vol.current?.setData(d.map(volBar));
    } else {
      m.update(asMain(last) as never);
      vol.current?.update(volBar(last));
    }
    for (const { ind, series } of inds.current) {
      const out = computeIndicator(ind, d);
      series.forEach((s, k) => {
        const vals = out[k];
        if (!vals) return;
        if (full) {
          const pts = d.map((c, i) => (ind.type === 'macd' && k === 0 && Number.isFinite(vals[i]) ? { time: ts(c.time), value: vals[i], color: vals[i] >= 0 ? alpha(ind.color, 0.65) : 'rgba(255,122,127,0.6)' } : point(c.time, vals[i])));
          s.setData(pts as never);
        } else {
          const v = vals[vals.length - 1];
          if (Number.isFinite(v)) s.update((ind.type === 'macd' && k === 0 ? { time: ts(last.time), value: v, color: v >= 0 ? alpha(ind.color, 0.65) : 'rgba(255,122,127,0.6)' } : { time: ts(last.time), value: v }) as never);
        }
      });
    }
  }

  // ------------------------------------------------------------ price lines (bid/ask, positions, orders)
  const tradeKey = JSON.stringify([positions.filter((p) => p.sym === sym).map((p) => [p.id, p.sl, p.tp]), orders.filter((o) => o.sym === sym).map((o) => [o.id, o.price, o.sl, o.tp, o.type]), toggles.tradeOrders, toggles.tradePositions, toggles.slTp, toggles.profitLoss, toggles.askLine]);
  useEffect(() => {
    const s = main.current;
    if (!s) return;
    for (const l of [bidLine.current, askLine.current, ...tradeLines.current.map((x) => x.line)]) if (l) s.removePriceLine(l);
    tradeLines.current = [];
    const q = quote(sym, Date.now() / 1000);
    bidLine.current = s.createPriceLine({ price: q.bid, color: colors.bidLine, lineWidth: 1, lineStyle: LineStyle.Solid, axisLabelVisible: true, title: '' });
    askLine.current = toggles.askLine ? s.createPriceLine({ price: q.ask, color: colors.askLine, lineWidth: 1, lineStyle: LineStyle.Solid, axisLabelVisible: true, title: '' }) : null;
    const add = (price: number, color: string, style: LineStyle, title: string, pos?: Position) => tradeLines.current.push({ line: s.createPriceLine({ price, color, lineWidth: 1, lineStyle: style, axisLabelVisible: true, title }), pos });
    if (toggles.tradePositions)
      for (const p of positions.filter((x) => x.sym === sym)) {
        add(p.open, p.side === 1 ? BUY : SELL, LineStyle.Dashed, posTitle(p), p);
        if (toggles.slTp && p.sl !== null) add(p.sl, colors.stopsLevel, LineStyle.Dashed, 'SL');
        if (toggles.slTp && p.tp !== null) add(p.tp, colors.stopsLevel, LineStyle.Dashed, 'TP');
      }
    if (toggles.tradeOrders)
      for (const o of orders.filter((x) => x.sym === sym)) {
        add(o.price, o.type.startsWith('buy') ? BUY : SELL, LineStyle.LargeDashed, `${PENDING_LABEL[o.type].toUpperCase()} ${o.lots.toFixed(2)}`);
        if (o.stopLimit !== null) add(o.stopLimit, o.type.startsWith('buy') ? BUY : SELL, LineStyle.Dotted, 'LIMIT');
        if (toggles.slTp && o.sl !== null) add(o.sl, colors.stopsLevel, LineStyle.Dotted, 'SL');
        if (toggles.slTp && o.tp !== null) add(o.tp, colors.stopsLevel, LineStyle.Dotted, 'TP');
      }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tradeKey, build, colors.bidLine, colors.askLine, colors.stopsLevel]);

  function posTitle(p: Position) {
    const base = `${p.side === 1 ? 'BUY' : 'SELL'} ${p.lots.toFixed(2)}`;
    if (!propsRef.current.toggles.profitLoss) return base;
    return `${base}  ${money(positionProfit(p, quote(p.sym, Date.now() / 1000)), true)}`;
  }

  // ------------------------------------------------------------ markers (news + trade history)
  function refreshMarkers(force = false) {
    const d = data.current;
    if (!d.length || !markers.current) return;
    const from = d[0].time;
    const news = recentNews(now, Math.min(d.length * tf, 6 * 3600)).filter((e) => e.symbol === sym || e.symbol === null || e.symbol === SYMBOL_MAP[sym].derive?.a || e.symbol === SYMBOL_MAP[sym].derive?.b);
    const hist = toggles.tradeHistory || focus ? deals.filter((x) => x.sym === sym && x.closeTime >= from && (toggles.tradeHistory || x.id === focus?.id)).slice(0, 60) : [];
    const key = `${tf}:${build}:${news.map((n) => n.id).join(',')}:${hist.map((h) => h.id).join(',')}:${focus?.id ?? ''}`;
    if (!force && key === markerKey.current) return;
    markerKey.current = key;
    const bucket = (t: number) => ts(Math.floor(t / tf) * tf);
    const ms: SeriesMarker<Time>[] = news.map((e) => ({
      time: bucket(e.t0),
      position: e.dir > 0 ? ('belowBar' as const) : ('aboveBar' as const),
      shape: e.dir > 0 ? ('arrowUp' as const) : ('arrowDown' as const),
      color: e.kind === 'shock' ? '#e5484d' : e.kind === 'macro' ? '#d6b26e' : alpha(e.dir > 0 ? '#4cc38a' : '#e5484d', 0.7),
      text: e.kind === 'shock' ? 'HALT' : e.kind === 'macro' ? 'DATA' : 'NEWS',
    }));
    for (const h of hist) {
      const f = h.id === focus?.id;
      if (h.openTime >= from)
        ms.push({ time: bucket(h.openTime), position: h.side === 1 ? 'belowBar' : 'aboveBar', shape: h.side === 1 ? 'arrowUp' : 'arrowDown', color: h.side === 1 ? BUY : SELL, text: f ? `${h.side === 1 ? 'BUY' : 'SELL'} ${h.lots.toFixed(2)}` : '', size: f ? 2 : 1 });
      ms.push({ time: bucket(h.closeTime), position: h.side === 1 ? 'aboveBar' : 'belowBar', shape: 'circle', color: h.profit >= 0 ? '#4cc38a' : '#e5484d', text: f ? money(h.profit, true) : '', size: f ? 1.6 : 0.8 });
    }
    ms.sort((a, b) => (a.time as number) - (b.time as number));
    markers.current.setMarkers(ms);
  }

  // ------------------------------------------------------------ live tick
  useEffect(() => {
    const s = main.current;
    const d = data.current;
    if (!s || !d.length) return;
    const q = quote(sym, now);
    bidLine.current?.applyOptions({ price: q.bid });
    askLine.current?.applyOptions({ price: q.ask });
    for (const tl of tradeLines.current) if (tl.pos) tl.line.applyOptions({ title: posTitle(tl.pos) });
    if (q.open) {
      const start = Math.floor(now / tf) * tf;
      let lc = d[d.length - 1];
      if (start - lc.time > tf) {
        data.current = candles(sym, tf, d.length, now);
        pushAll(true);
      } else if (start >= lc.time) {
        if (start !== lc.time) {
          d[d.length - 1] = buildCandle(sym, tf, lc.time);
          main.current?.update((type === 'line' ? { time: ts(lc.time), value: d[d.length - 1].close } : { ...d[d.length - 1], time: ts(lc.time) }) as never);
          lc = { time: start, open: d[d.length - 1].close, high: q.mid, low: q.mid, close: q.mid, volume: 1 };
          lc.high = Math.max(lc.high, lc.open);
          lc.low = Math.min(lc.low, lc.open);
          d.push(lc);
          if (d.length > 2000) d.shift();
        } else {
          lc = { ...lc, high: Math.max(lc.high, q.mid), low: Math.min(lc.low, q.mid), close: q.mid, volume: buildCandle(sym, tf, start, now).volume };
          d[d.length - 1] = lc;
        }
        pushAll(false);
      }
    }
    refreshMarkers();
    setFrame((f) => f + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [now]);

  useEffect(() => refreshMarkers(true), [build, deals.length, toggles.tradeHistory, focus?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ------------------------------------------------------------ focus a historical trade
  useEffect(() => {
    if (!focus || focus.sym !== sym || !chart.current) return;
    const d = data.current;
    const idx = (t: number) => {
      let i = d.findIndex((c) => c.time > t);
      if (i === -1) i = d.length;
      return i - 1;
    };
    const a = idx(focus.openTime);
    const b = idx(focus.closeTime);
    const pad = Math.max(12, (b - a) * 0.8);
    chart.current.timeScale().setVisibleLogicalRange({ from: a - pad, to: b + pad });
  }, [focus, build, sym]);

  // ------------------------------------------------------------ hover info (OHLC / data window)
  const hovered = hoverIdx !== null ? data.current[hoverIdx] : data.current[data.current.length - 1];
  useEffect(() => {
    if (!props.onHover) return;
    if (!hovered) return props.onHover(null);
    const i = hoverIdx ?? data.current.length - 1;
    const values: HoverInfo['values'] = [];
    for (const { ind } of inds.current) {
      const out = computeIndicator(ind, data.current);
      const names = ind.type === 'bb' ? ['Mid', 'Up', 'Low'] : ind.type === 'macd' ? ['Hist', 'Main', 'Signal'] : ind.type === 'stoch' ? ['Main', 'Signal'] : ind.type === 'env' ? ['Up', 'Low'] : [''];
      out.forEach((arr, k) => {
        const v = arr[i];
        if (!Number.isFinite(v)) return;
        const digits = INDICATOR_INFO[ind.type].pane && ind.type !== 'atr' && ind.type !== 'macd' ? 2 : SYMBOL_MAP[sym].digits + (ind.type === 'macd' ? 1 : 0);
        values.push({ label: `${INDICATOR_INFO[ind.type].short}${INDICATOR_INFO[ind.type].period ? `(${ind.period})` : ''}${names[k] ? ` ${names[k]}` : ''}`, value: v.toFixed(digits), color: ind.color });
      });
    }
    props.onHover({ candle: { ...hovered, volume: volValue(hovered) }, values });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hoverIdx, frame]);

  // ------------------------------------------------------------ overlay (objects, separators, countdown, history links)
  const c = chart.current;
  const w = el.current?.clientWidth ?? 0;
  const paneH = c?.panes()[0]?.getHeight() ?? 0;
  const scaleW = c?.priceScale('right').width() ?? 0;
  const plotW = Math.max(0, w - scaleW);
  const def = SYMBOL_MAP[sym];
  const overlay: React.ReactNode[] = [];
  void frame;

  if (c && main.current && paneH > 0) {
    // period separators
    if (toggles.periodSeparators) {
      const range = c.timeScale().getVisibleLogicalRange();
      const d = data.current;
      const period = tf <= 3600 ? 86400 : tf <= 14400 ? 7 * 86400 : 0;
      if (range) {
        for (let i = Math.max(1, Math.floor(range.from)); i < Math.min(d.length, Math.ceil(range.to)); i++) {
          const a = d[i - 1].time;
          const b = d[i].time;
          const cross = period ? Math.floor((a + 4 * 86400) / period) !== Math.floor((b + 4 * 86400) / period) : new Date(a * 1000).getUTCMonth() !== new Date(b * 1000).getUTCMonth();
          if (!cross) continue;
          const x = c.timeScale().logicalToCoordinate((i - 0.5) as never);
          if (x !== null) overlay.push(<line key={`sep${i}`} x1={x} x2={x} y1={0} y2={paneH} stroke={colors.foreground} strokeOpacity={0.35} strokeDasharray="2 4" />);
        }
      }
    }
    // historical trade links (MT5 draws entry → exit)
    const hist = deals.filter((x) => x.sym === sym && (toggles.tradeHistory || x.id === focus?.id)).slice(0, 60);
    for (const h of hist) {
      const x1 = xOf(h.openTime);
      const x2 = xOf(h.closeTime);
      const y1 = yOf(h.open);
      const y2 = yOf(h.close);
      if (x1 === null || x2 === null || y1 === null || y2 === null) continue;
      const f = h.id === focus?.id;
      const col = h.side === 1 ? BUY : SELL;
      overlay.push(<line key={`h${h.id}${h.closeTime}`} x1={x1} y1={y1} x2={x2} y2={y2} stroke={col} strokeWidth={f ? 2 : 1} strokeDasharray="4 3" />);
      if (f) {
        overlay.push(
          <g key="focus">
            <rect x={Math.min(x1, x2) - 6} y={0} width={Math.abs(x2 - x1) + 12} height={paneH} fill={alpha(col, 0.07)} />
            <circle cx={x1} cy={y1} r={4.5} fill={col} />
            <circle cx={x2} cy={y2} r={4.5} fill={h.profit >= 0 ? '#4cc38a' : '#e5484d'} />
            <text x={x1 + 7} y={y1 - 8} className="ovl-label" fill={col}>ENTRY {fmtPrice(def, h.open)}</text>
            <text x={x2 + 7} y={y2 + 16} className="ovl-label" fill={h.profit >= 0 ? '#4cc38a' : '#e5484d'}>EXIT {fmtPrice(def, h.close)} · {money(h.profit, true)}</text>
          </g>,
        );
      }
    }
    // user objects
    const drawObj = (o: Omit<ChartObject, 'id'> & { id: string }, ghost = false) => {
      const x1 = xOf(o.t1);
      const y1 = yOf(o.p1);
      const x2 = o.t2 !== undefined ? xOf(o.t2) : null;
      const y2 = o.p2 !== undefined ? yOf(o.p2) : null;
      const op = ghost ? 0.55 : 1;
      switch (o.type) {
        case 'hline':
          return y1 === null ? null : (
            <g key={o.id} opacity={op}>
              <line x1={0} x2={plotW} y1={y1} y2={y1} stroke={o.color} strokeWidth={1} />
              <text x={plotW - 4} y={y1 - 4} textAnchor="end" className="ovl-label" fill={o.color}>{fmtPrice(def, o.p1)}</text>
            </g>
          );
        case 'vline':
          return x1 === null ? null : (
            <g key={o.id} opacity={op}>
              <line x1={x1} x2={x1} y1={0} y2={paneH} stroke={o.color} strokeWidth={1} />
              <text x={x1 + 4} y={paneH - 6} className="ovl-label" fill={o.color}>{new Date(o.t1 * 1000).toLocaleString([], { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</text>
            </g>
          );
        case 'text':
          return x1 === null || y1 === null ? null : <text key={o.id} x={x1} y={y1} className="ovl-text" fill={o.color} opacity={op}>{o.label}</text>;
        case 'trend':
          return x1 === null || y1 === null || x2 === null || y2 === null ? null : (
            <g key={o.id} opacity={op}>
              <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={o.color} strokeWidth={1.5} />
              <circle cx={x1} cy={y1} r={2.5} fill={o.color} />
              <circle cx={x2} cy={y2} r={2.5} fill={o.color} />
            </g>
          );
        case 'rect':
          return x1 === null || y1 === null || x2 === null || y2 === null ? null : (
            <rect key={o.id} opacity={op} x={Math.min(x1, x2)} y={Math.min(y1, y2)} width={Math.abs(x2 - x1)} height={Math.abs(y2 - y1)} fill={alpha(o.color, 0.12)} stroke={o.color} strokeWidth={1} />
          );
        case 'fibo': {
          if (x1 === null || y1 === null || x2 === null || y2 === null || o.p2 === undefined) return null;
          const p1 = o.p1;
          const p2 = o.p2;
          return (
            <g key={o.id} opacity={op}>
              <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={o.color} strokeDasharray="3 3" />
              {FIB.map((lv) => {
                const price = p2 + (p1 - p2) * lv;
                const y = yOf(price);
                if (y === null) return null;
                return (
                  <g key={lv}>
                    <line x1={Math.min(x1, x2)} x2={plotW} y1={y} y2={y} stroke={o.color} strokeOpacity={lv === 0 || lv === 1 ? 0.9 : 0.55} />
                    <text x={Math.min(x1, x2) + 3} y={y - 3} className="ovl-label" fill={o.color}>{(lv * 100).toFixed(1)}  {fmtPrice(def, price)}</text>
                  </g>
                );
              })}
            </g>
          );
        }
      }
    };
    for (const o of objects) overlay.push(drawObj(o));
    if (tool && pending.current && preview) overlay.push(drawObj({ id: 'ghost', type: tool, t1: pending.current.t, p1: pending.current.p, t2: preview.t, p2: preview.p, color: '#e5e5e7' }, true));
  }

  // countdown to bar close
  const q = quote(sym, now);
  const left = Math.max(0, Math.floor(now / tf) * tf + tf - now);
  const yBid = paneH > 0 ? yOf(q.bid) : null;
  const cd = left >= 3600 ? `${Math.floor(left / 3600)}:${String(Math.floor((left % 3600) / 60)).padStart(2, '0')}:${String(Math.floor(left % 60)).padStart(2, '0')}` : `${String(Math.floor(left / 60)).padStart(2, '0')}:${String(Math.floor(left % 60)).padStart(2, '0')}`;

  return (
    <div className="chart" ref={el}>
      <svg className="overlay" width={plotW} height={paneH} style={{ width: plotW, height: paneH }}>
        {overlay}
      </svg>
      {toggles.countdown && q.open && yBid !== null && yBid > 8 && yBid < paneH - 8 && (
        <span className="countdown" style={{ top: yBid + 9, right: scaleW + 4 }}>{cd}</span>
      )}
      {tool && <span className="toolhint">{TWO_POINT.includes(tool) ? (pending.current ? 'Tap the second point' : 'Tap the first point') : 'Tap the chart to place'}</span>}
    </div>
  );
}
