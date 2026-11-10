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
import { bucketStart, buildCandle, candles, quote, recentNews, type Candle } from '../market/engine.ts';
import { adx, atr, awesome, bollinger, cci, cvd, donchian, ema, envelopes, ichimoku, keltner, macd, mfi, momentum, obv, parabolicSar, rsi, sma, stdevOf, stochastic, supertrend, volumeDelta, volumeProfile, vwap, williamsR, wma } from '../market/indicators.ts';
import { gexProfile } from '../market/gex.ts';
import { runScript } from '../market/script.ts';
import { SYMBOL_MAP, displayDigits, fmtPrice } from '../market/symbols.ts';
import { PENDING_LABEL, positionProfit, type Deal, type PendingOrder, type Position } from '../game/account.ts';
import { INDICATOR_INFO, OBJ_POINTS, type ChartColors, type ChartObject, type ChartToggles, type ChartType, type Indicator, type ObjType } from '../game/settings.ts';
import { money } from '../format.ts';

const ts = (t: number) => t as UTCTimestamp;
const BUY = '#5b8cff';
const SELL = '#ff6b70';
const FIB = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
const FIB_EXT = [0, 0.618, 1, 1.272, 1.618, 2, 2.618];
const OBJ_COLOR: Partial<Record<ObjType, string>> = { fibo: '#d6b26e', fibext: '#d6b26e', rect: '#7aa7ff', ellipse: '#b48cff', triangle: '#5ad1d1', channel: '#7aa7ff', pitchfork: '#ff9f5a', range: '#9fa8ff', arrowup: '#4cc38a', arrowdown: '#e5484d', long: '#4cc38a', short: '#e5484d' };
/** Indicators drawn by the SVG overlay instead of chart series. */
const OVERLAY_ONLY = new Set(['vprofile', 'gex']);
const HIST_TYPES = new Set(['macd', 'delta', 'ao']);
export const paneOf = (ind: Indicator) => (ind.type === 'custom' ? !!ind.pane : INDICATOR_INFO[ind.type].pane);

export interface LongPress {
  x: number;
  y: number;
  price: number | null;
  time: number | null;
}
export interface Level {
  price: number;
  color: string;
  label: string;
}

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
  /** Hold the chart ~1 s (or right-click): open the chart menu. */
  onLongPress?: (p: LongPress) => void;
  /** Extra dashed levels (e.g. SL / TP being set in the trade panel). */
  levels?: Level[];
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
    case 'wma':
      return [wma(close, ind.period)];
    case 'vwap':
      return [vwap(d)];
    case 'ichimoku': {
      const k = ichimoku(d, ind.period, Math.round(ind.period * 2.9), Math.round(ind.period * 5.8));
      return [k.tenkan, k.kijun, k.spanA, k.spanB];
    }
    case 'donchian': {
      const k = donchian(d, ind.period);
      return [k.upper, k.mid, k.lower];
    }
    case 'keltner': {
      const k = keltner(d, ind.period);
      return [k.mid, k.upper, k.lower];
    }
    case 'supertrend':
      return [supertrend(d, ind.period)];
    case 'wpr':
      return [williamsR(d, ind.period)];
    case 'mom':
      return [momentum(d, ind.period)];
    case 'adx': {
      const k = adx(d, ind.period);
      return [k.adx, k.plus, k.minus];
    }
    case 'ao':
      return [awesome(d)];
    case 'stddev':
      return [stdevOf(close, ind.period)];
    case 'obv':
      return [obv(d)];
    case 'mfi':
      return [mfi(d, ind.period)];
    case 'delta':
      return [volumeDelta(d)];
    case 'cvd':
      return [cvd(d)];
    case 'custom':
      return runScript(ind.expr ?? '', d);
    case 'vprofile':
    case 'gex':
      return [];
  }
}

const LINE_NAMES: Partial<Record<Indicator['type'], string[]>> = {
  bb: ['Mid', 'Up', 'Low'],
  macd: ['Hist', 'Main', 'Signal'],
  stoch: ['Main', 'Signal'],
  env: ['Up', 'Low'],
  ichimoku: ['Tenkan', 'Kijun', 'Span A', 'Span B'],
  donchian: ['Up', 'Mid', 'Low'],
  keltner: ['Mid', 'Up', 'Low'],
  adx: ['ADX', '+DI', '−DI'],
};
const CUSTOM_COLORS = ['#e5e5e7', '#d6b26e', '#7aa7ff', '#ff7a7f'];

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
  const pending = useRef<{ t: number; p: number }[]>([]);
  const [preview, setPreview] = useState<{ t: number; p: number } | null>(null);
  const [build, setBuild] = useState(0);
  const [frame, setFrame] = useState(0);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const propsRef = useRef(props);
  propsRef.current = props;
  const press = useRef<{ x: number; y: number; timer: number } | null>(null);

  // ------------------------------------------------------------ create once
  useEffect(() => {
    if (!el.current) return;
    const c = createChart(el.current, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: '#121214' }, textColor: '#8e8e93', fontSize: 10.5, fontFamily: "'Geist Mono Variable', ui-monospace, monospace", attributionLogo: false, panes: { separatorColor: 'rgba(229,229,231,0.12)' } },
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
    const color = OBJ_COLOR[tl] ?? '#e5e5e7';
    const need = OBJ_POINTS[tl];
    const pts = [...pending.current, { t, p: pr }];
    if (pts.length < need) {
      pending.current = pts;
      setPreview({ t, p: pr });
      return;
    }
    let label: string | undefined;
    if (tl === 'text') {
      try {
        label = (window.prompt('Text label', 'Note') ?? 'Note').slice(0, 40) || 'Note';
      } catch {
        label = 'Note'; // prompt() is blocked in sandboxed frames
      }
    }
    const [a, b, c3] = pts;
    propsRef.current.onPlace({ type: tl, t1: a.t, p1: a.p, t2: b?.t, p2: b?.p, t3: c3?.t, p3: c3?.p, color, label });
    pending.current = [];
    setPreview(null);
  };
  const moveRef = useRef((_: MouseEventParams<Time>) => {});
  moveRef.current = (p) => {
    if (pending.current.length && p.point) {
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
    pending.current = [];
    setPreview(null);
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
      timeScale: { borderColor: colors.grid, secondsVisible: tf < 60, shiftVisibleRangeOnNewBar: !toggles.freeMove },
      handleScroll: { vertTouchDrag: toggles.freeMove, pressedMouseMove: true, horzTouchDrag: true },
    });

    const def = SYMBOL_MAP[sym];
    const digits = displayDigits(def);
    const fmt = { type: 'price' as const, precision: digits, minMove: Math.pow(10, -digits) };
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

    const d = candles(sym, tf, toggles.preload ? 1500 : 320, Date.now() / 1000);
    data.current = d;
    let pane = 0;
    for (const ind of indicators) {
      if (OVERLAY_ONLY.has(ind.type)) {
        inds.current.push({ ind, series: [] });
        continue;
      }
      const inPane = paneOf(ind);
      const p = inPane ? ++pane : 0;
      const paneFmt = ind.type === 'obv' || ind.type === 'cvd' || ind.type === 'delta' ? { type: 'volume' as const } : ind.type === 'stddev' || ind.type === 'ao' || ind.type === 'atr' || ind.type === 'custom' ? { type: 'price' as const, precision: Math.min(8, def.digits + 1), minMove: Math.pow(10, -Math.min(8, def.digits + 1)) } : { type: 'price' as const, precision: 2, minMove: 0.01 };
      const line = (color: string, width: 1 | 2 = 1, extra: object = {}) =>
        c.addSeries(LineSeries, { color, lineWidth: width, lastValueVisible: inPane, priceLineVisible: false, crosshairMarkerVisible: false, priceFormat: inPane ? paneFmt : fmt, ...extra }, p);
      const hist = () => c.addSeries(HistogramSeries, { color: alpha(ind.color, 0.6), lastValueVisible: false, priceLineVisible: false, priceFormat: paneFmt }, p);
      let series: ISeriesApi<SeriesType>[];
      switch (ind.type) {
        case 'ichimoku':
          series = [line('#5ad1d1'), line('#ff7a7f'), line(alpha('#4cc38a', 0.8), 1, { lineStyle: LineStyle.Dotted }), line(alpha('#e5484d', 0.8), 1, { lineStyle: LineStyle.Dotted })];
          break;
        case 'donchian':
        case 'keltner':
          series = ind.type === 'donchian' ? [line(ind.color), line(alpha(ind.color, 0.6), 1, { lineStyle: LineStyle.Dotted }), line(ind.color)] : [line(ind.color), line(alpha(ind.color, 0.7), 1, { lineStyle: LineStyle.Dashed }), line(alpha(ind.color, 0.7), 1, { lineStyle: LineStyle.Dashed })];
          break;
        case 'supertrend':
          series = [line(ind.color, 2, { lineType: 1 })];
          break;
        case 'adx':
          series = [line(ind.color, 2), line('#4cc38a'), line('#e5484d')];
          break;
        case 'delta':
        case 'ao':
          series = [hist()];
          break;
        case 'custom': {
          const n = Math.max(1, runScript(ind.expr ?? '', d).length);
          series = Array.from({ length: n }, (_, k) => line(k === 0 ? ind.color : CUSTOM_COLORS[k % CUSTOM_COLORS.length], k === 0 ? 2 : 1));
          break;
        }
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
          series = [c.addSeries(HistogramSeries, { color: alpha(ind.color, 0.6), lastValueVisible: false, priceLineVisible: false, priceFormat: { type: 'price', precision: Math.min(10, def.digits + 1), minMove: Math.pow(10, -Math.min(10, def.digits + 1)) } }, p), line('#e5e5e7'), line('#ff7a7f', 1, { lineStyle: LineStyle.Dotted })];
          break;
        case 'stoch':
          series = [line(ind.color), line('#ff7a7f', 1, { lineStyle: LineStyle.Dashed })];
          break;
        default:
          series = [line(ind.color, ind.type === 'rsi' || ind.type === 'cci' || ind.type === 'atr' ? 1 : 2)];
      }
      if (ind.type === 'wpr' || ind.type === 'mfi') {
        series[0].createPriceLine({ price: ind.type === 'wpr' ? -20 : 80, color: 'rgba(229,229,231,0.25)', lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: false, title: '' });
        series[0].createPriceLine({ price: ind.type === 'wpr' ? -80 : 20, color: 'rgba(229,229,231,0.25)', lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: false, title: '' });
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
    pushAll(true);
    c.timeScale().applyOptions({ secondsVisible: tf < 60, timeVisible: tf < 86400 });
    if (!propsRef.current.focus) c.timeScale().scrollToRealTime();
    setBuild((b) => b + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sym, tf, type, indKey, toggles.volume, toggles.preload, toggles.freeMove, colors, displayDigits(SYMBOL_MAP[sym])]);

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
          const pts = d.map((c, i) => (HIST_TYPES.has(ind.type) && k === 0 && Number.isFinite(vals[i]) ? { time: ts(c.time), value: vals[i], color: vals[i] >= 0 ? alpha(ind.color, 0.65) : 'rgba(255,122,127,0.6)' } : point(c.time, vals[i])));
          s.setData(pts as never);
        } else {
          const v = vals[vals.length - 1];
          if (Number.isFinite(v)) s.update((HIST_TYPES.has(ind.type) && k === 0 ? { time: ts(last.time), value: v, color: v >= 0 ? alpha(ind.color, 0.65) : 'rgba(255,122,127,0.6)' } : { time: ts(last.time), value: v }) as never);
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
    const bucket = (t: number) => ts(bucketStart(t, tf));
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
      const start = bucketStart(now, tf);
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
      const names = LINE_NAMES[ind.type] ?? (ind.type === 'custom' ? ['', 'L2', 'L3', 'L4'] : ['']);
      out.forEach((arr, k) => {
        const v = arr[i];
        if (!Number.isFinite(v)) return;
        const dg = ind.type === 'obv' || ind.type === 'cvd' || ind.type === 'delta' ? 0 : paneOf(ind) && !['atr', 'macd', 'stddev', 'ao', 'custom'].includes(ind.type) ? 2 : Math.min(10, displayDigits(SYMBOL_MAP[sym]) + (ind.type === 'macd' ? 1 : 0));
        const short = ind.type === 'custom' ? ind.name || 'Custom' : INDICATOR_INFO[ind.type].short;
        values.push({ label: `${short}${INDICATOR_INFO[ind.type].period ? `(${ind.period})` : ''}${names[k] ? ` ${names[k]}` : ''}`, value: v.toFixed(dg), color: ind.color });
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
    // volume profile + GEX (overlay indicators)
    for (const { ind } of inds.current) {
      if (ind.type === 'vprofile') {
        const range = c.timeScale().getVisibleLogicalRange();
        const d = data.current;
        const from = Math.max(0, Math.floor(range?.from ?? 0));
        const to = Math.min(d.length, Math.ceil(range?.to ?? d.length) + 1);
        const vp = volumeProfile(d.slice(from, to), Math.max(8, Math.min(60, ind.period || 28)));
        if (vp) {
          const maxV = Math.max(...vp.bins.map((x) => x.buy + x.sell)) || 1;
          const width = plotW * 0.28;
          vp.bins.forEach((bin, i) => {
            const y1 = yOf(bin.hi);
            const y2 = yOf(bin.lo);
            if (y1 === null || y2 === null) return;
            const h = Math.max(1, y2 - y1 - 1);
            const inVa = bin.lo >= vp.val - 1e-12 && bin.hi <= vp.vah + 1e-12;
            const wb = (bin.buy / maxV) * width;
            const ws = (bin.sell / maxV) * width;
            overlay.push(
              <g key={`vp${i}`} opacity={inVa ? 0.75 : 0.4}>
                <rect x={plotW - wb - ws} y={y1} width={ws} height={h} fill={alpha('#e5484d', 0.8)} />
                <rect x={plotW - wb} y={y1} width={wb} height={h} fill={alpha(ind.color, 0.85)} />
              </g>,
            );
          });
          const yp = yOf(vp.poc);
          if (yp !== null) overlay.push(<g key="vppoc"><line x1={0} x2={plotW} y1={yp} y2={yp} stroke="#f2c94c" strokeDasharray="6 3" strokeOpacity={0.8} /><text x={4} y={yp - 3} className="ovl-label" fill="#f2c94c">POC {fmtPrice(def, vp.poc)}</text></g>);
          for (const [lv, nm] of [[vp.vah, 'VAH'], [vp.val, 'VAL']] as const) {
            const y = yOf(lv);
            if (y !== null) overlay.push(<g key={`vp${nm}`}><line x1={0} x2={plotW} y1={y} y2={y} stroke={ind.color} strokeOpacity={0.45} strokeDasharray="2 4" /><text x={4} y={y - 3} className="ovl-label" fill={ind.color}>{nm}</text></g>);
          }
        }
      }
      if (ind.type === 'gex') {
        const q0 = quote(sym, now);
        const g = gexProfile(sym, q0.mid, now, Math.max(5, Math.min(30, ind.period || 15)));
        if (g) {
          const maxG = Math.max(...g.strikes.map((x) => Math.max(x.call, -x.put))) || 1;
          const width = plotW * 0.3;
          for (const k of g.strikes) {
            const y = yOf(k.strike);
            if (y === null || y < 0 || y > paneH) continue;
            const wc = (k.call / maxG) * width;
            const wp = (-k.put / maxG) * width;
            overlay.push(
              <g key={`gx${k.strike}`}>
                <rect x={0} y={y - 2} width={wc} height={3} fill={alpha('#4cc38a', 0.7)} />
                <rect x={0} y={y + 1} width={wp} height={3} fill={alpha('#e5484d', 0.7)} />
              </g>,
            );
          }
          const tag = (price: number | null, label: string, col: string, key: string) => {
            if (price === null) return;
            const y = yOf(price);
            if (y === null) return;
            overlay.push(<g key={key}><line x1={0} x2={plotW} y1={y} y2={y} stroke={col} strokeOpacity={0.75} strokeDasharray="8 4" /><text x={6} y={y - 4} className="ovl-label" fill={col}>{label} {fmtPrice(def, price)}</text></g>);
          };
          tag(g.callWall, 'CALL WALL', '#4cc38a', 'gxc');
          tag(g.putWall, 'PUT WALL', '#e5484d', 'gxp');
          tag(g.zeroGamma, 'ZERO γ', '#f2c94c', 'gxz');
        }
      }
    }
    // user objects
    const BIG = 4000;
    const ext = (x1: number, y1: number, x2: number, y2: number, back: boolean) => {
      const dx = x2 - x1 || 1e-6;
      const dy = y2 - y1;
      return { ax: back ? x1 - dx * BIG : x1, ay: back ? y1 - dy * BIG : y1, bx: x2 + dx * BIG, by: y2 + dy * BIG };
    };
    const drawObj = (o: Omit<ChartObject, 'id'> & { id: string }, ghost = false) => {
      const x1 = xOf(o.t1);
      const y1 = yOf(o.p1);
      const x2 = o.t2 !== undefined ? xOf(o.t2) : null;
      const y2 = o.p2 !== undefined ? yOf(o.p2) : null;
      const x3 = o.t3 !== undefined ? xOf(o.t3) : null;
      const y3 = o.p3 !== undefined ? yOf(o.p3) : null;
      const op = ghost ? 0.55 : 1;
      const two = x1 !== null && y1 !== null && x2 !== null && y2 !== null;
      const pct = (a: number, b: number) => `${(((b - a) / a) * 100).toFixed(2)}%`;
      switch (o.type) {
        case 'hline':
          return y1 === null ? null : (
            <g key={o.id} opacity={op}>
              <line x1={0} x2={plotW} y1={y1} y2={y1} stroke={o.color} strokeWidth={1} />
              <text x={plotW - 4} y={y1 - 4} textAnchor="end" className="ovl-label" fill={o.color}>{fmtPrice(def, o.p1)}</text>
            </g>
          );
        case 'hray':
          return x1 === null || y1 === null ? null : (
            <g key={o.id} opacity={op}>
              <line x1={x1} x2={plotW} y1={y1} y2={y1} stroke={o.color} strokeWidth={1} />
              <circle cx={x1} cy={y1} r={2.5} fill={o.color} />
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
        case 'cross':
          return x1 === null || y1 === null ? null : (
            <g key={o.id} opacity={op}>
              <line x1={x1} x2={x1} y1={0} y2={paneH} stroke={o.color} strokeWidth={1} strokeDasharray="4 3" />
              <line x1={0} x2={plotW} y1={y1} y2={y1} stroke={o.color} strokeWidth={1} strokeDasharray="4 3" />
              <text x={x1 + 4} y={y1 - 4} className="ovl-label" fill={o.color}>{fmtPrice(def, o.p1)}</text>
            </g>
          );
        case 'text':
          return x1 === null || y1 === null ? null : <text key={o.id} x={x1} y={y1} className="ovl-text" fill={o.color} opacity={op}>{o.label}</text>;
        case 'pricelabel':
          return x1 === null || y1 === null ? null : (
            <g key={o.id} opacity={op}>
              <path d={`M${x1},${y1} l8,-10 h${fmtPrice(def, o.p1).length * 6.4 + 10} v20 h-${fmtPrice(def, o.p1).length * 6.4 + 10} z`} fill={alpha(o.color, 0.18)} stroke={o.color} />
              <text x={x1 + 13} y={y1 + 4} className="ovl-label" fill={o.color}>{fmtPrice(def, o.p1)}</text>
            </g>
          );
        case 'arrowup':
        case 'arrowdown': {
          if (x1 === null || y1 === null) return null;
          const up = o.type === 'arrowup';
          return <path key={o.id} opacity={op} d={up ? `M${x1},${y1} l-8,12 h5 v10 h6 v-10 h5 z` : `M${x1},${y1} l-8,-12 h5 v-10 h6 v10 h5 z`} fill={o.color} />;
        }
        case 'trend':
        case 'ray':
        case 'extline':
        case 'arrow': {
          if (!two) return null;
          const e = o.type === 'trend' || o.type === 'arrow' ? { ax: x1, ay: y1, bx: x2, by: y2 } : ext(x1, y1, x2, y2, o.type === 'extline');
          const ang = Math.atan2(y2 - y1, x2 - x1);
          return (
            <g key={o.id} opacity={op}>
              <line x1={e.ax} y1={e.ay} x2={e.bx} y2={e.by} stroke={o.color} strokeWidth={1.5} />
              <circle cx={x1} cy={y1} r={2.5} fill={o.color} />
              {o.type === 'arrow' ? <path d={`M${x2},${y2} L${x2 - 11 * Math.cos(ang - 0.4)},${y2 - 11 * Math.sin(ang - 0.4)} L${x2 - 11 * Math.cos(ang + 0.4)},${y2 - 11 * Math.sin(ang + 0.4)} z`} fill={o.color} /> : <circle cx={x2} cy={y2} r={2.5} fill={o.color} />}
            </g>
          );
        }
        case 'rect':
          return !two ? null : (
            <rect key={o.id} opacity={op} x={Math.min(x1, x2)} y={Math.min(y1, y2)} width={Math.abs(x2 - x1)} height={Math.abs(y2 - y1)} fill={alpha(o.color, 0.12)} stroke={o.color} strokeWidth={1} />
          );
        case 'ellipse':
          return !two ? null : <ellipse key={o.id} opacity={op} cx={(x1 + x2) / 2} cy={(y1 + y2) / 2} rx={Math.abs(x2 - x1) / 2} ry={Math.abs(y2 - y1) / 2} fill={alpha(o.color, 0.12)} stroke={o.color} />;
        case 'triangle':
          return !two ? null : <path key={o.id} opacity={op} d={`M${x1},${y1} L${x2},${y2} L${x3 ?? x2},${y3 ?? y2} Z`} fill={alpha(o.color, 0.12)} stroke={o.color} />;
        case 'channel': {
          if (!two) return null;
          const dy = y3 !== null && x3 !== null ? y3 - (y1 + ((y2 - y1) * (x3 - x1)) / (x2 - x1 || 1)) : 0;
          return (
            <g key={o.id} opacity={op}>
              <path d={`M${x1},${y1} L${x2},${y2} L${x2},${y2 + dy} L${x1},${y1 + dy} Z`} fill={alpha(o.color, 0.08)} />
              <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={o.color} strokeWidth={1.5} />
              <line x1={x1} y1={y1 + dy} x2={x2} y2={y2 + dy} stroke={o.color} strokeWidth={1.5} />
              <line x1={x1} y1={y1 + dy / 2} x2={x2} y2={y2 + dy / 2} stroke={o.color} strokeOpacity={0.5} strokeDasharray="4 4" />
            </g>
          );
        }
        case 'pitchfork': {
          if (!two) return null;
          const mx = x3 !== null ? (x2 + x3) / 2 : x2;
          const my = y3 !== null ? (y2 + y3) / 2 : y2;
          const e = ext(x1, y1, mx, my, false);
          const dx = e.bx - x1;
          const dyy = e.by - y1;
          return (
            <g key={o.id} opacity={op}>
              <line x1={x1} y1={y1} x2={e.bx} y2={e.by} stroke={o.color} strokeWidth={1.5} />
              <line x1={x2} y1={y2} x2={x2 + dx} y2={y2 + dyy} stroke={o.color} />
              {x3 !== null && y3 !== null && <line x1={x3} y1={y3} x2={x3 + dx} y2={y3 + dyy} stroke={o.color} />}
              {x3 !== null && y3 !== null && <line x1={x2} y1={y2} x2={x3} y2={y3} stroke={o.color} strokeOpacity={0.5} />}
            </g>
          );
        }
        case 'fibo': {
          if (!two || o.p2 === undefined) return null;
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
        case 'fibext': {
          if (!two || o.p2 === undefined) return null;
          const move = o.p2 - o.p1;
          const base = o.p3 ?? o.p2;
          const xs = x3 ?? x2;
          return (
            <g key={o.id} opacity={op}>
              <path d={`M${x1},${y1} L${x2},${y2} L${xs},${y3 ?? y2}`} fill="none" stroke={o.color} strokeDasharray="3 3" />
              {FIB_EXT.map((lv) => {
                const price = base + move * lv;
                const y = yOf(price);
                if (y === null) return null;
                return (
                  <g key={lv}>
                    <line x1={xs} x2={plotW} y1={y} y2={y} stroke={o.color} strokeOpacity={lv === 1 || lv === 1.618 ? 0.9 : 0.5} />
                    <text x={xs + 3} y={y - 3} className="ovl-label" fill={o.color}>{(lv * 100).toFixed(1)}  {fmtPrice(def, price)}</text>
                  </g>
                );
              })}
            </g>
          );
        }
        case 'range': {
          if (!two || o.p2 === undefined || o.t2 === undefined) return null;
          const bars = Math.round(Math.abs(o.t2 - o.t1) / tf);
          const col = o.p2 >= o.p1 ? '#4cc38a' : '#e5484d';
          return (
            <g key={o.id} opacity={op}>
              <rect x={Math.min(x1, x2)} y={Math.min(y1, y2)} width={Math.abs(x2 - x1)} height={Math.abs(y2 - y1)} fill={alpha(col, 0.14)} stroke={col} strokeDasharray="3 3" />
              <line x1={(x1 + x2) / 2} x2={(x1 + x2) / 2} y1={y1} y2={y2} stroke={col} />
              <text x={(x1 + x2) / 2} y={Math.min(y1, y2) - 6} textAnchor="middle" className="ovl-label" fill={col}>{fmtPrice(def, o.p2 - o.p1)} ({pct(o.p1, o.p2)}) · {bars} bars</text>
            </g>
          );
        }
        case 'long':
        case 'short': {
          if (!two || o.p2 === undefined) return null;
          const dir = o.type === 'long' ? 1 : -1;
          const reward = Math.abs(o.p2 - o.p1) || def.spread * 10;
          const target = o.p1 + dir * reward;
          const stop = o.p1 - (dir * reward) / 2;
          const yt = yOf(target);
          const ys = yOf(stop);
          if (yt === null || ys === null) return null;
          const xa = Math.min(x1, x2);
          const w = Math.max(60, Math.abs(x2 - x1));
          return (
            <g key={o.id} opacity={op}>
              <rect x={xa} y={Math.min(y1, yt)} width={w} height={Math.abs(yt - y1)} fill="rgba(76,195,138,0.18)" stroke="#4cc38a" strokeWidth={0.8} />
              <rect x={xa} y={Math.min(y1, ys)} width={w} height={Math.abs(ys - y1)} fill="rgba(229,72,77,0.18)" stroke="#e5484d" strokeWidth={0.8} />
              <line x1={xa} x2={xa + w} y1={y1} y2={y1} stroke="#e5e5e7" />
              <text x={xa + 4} y={yt + (dir === 1 ? 12 : -4)} className="ovl-label" fill="#4cc38a">Target {fmtPrice(def, target)} ({pct(o.p1, target)})</text>
              <text x={xa + 4} y={ys + (dir === 1 ? -4 : 12)} className="ovl-label" fill="#e5484d">Stop {fmtPrice(def, stop)}</text>
              <text x={xa + 4} y={y1 - 4} className="ovl-label" fill="#e5e5e7">{o.type === 'long' ? 'LONG' : 'SHORT'} {fmtPrice(def, o.p1)} · R:R 2.00</text>
            </g>
          );
        }
      }
    };
    for (const o of objects) overlay.push(drawObj(o));
    const pp = pending.current;
    if (tool && pp.length && preview) {
      const pts = [...pp, preview];
      overlay.push(drawObj({ id: 'ghost', type: tool, t1: pts[0].t, p1: pts[0].p, t2: pts[1]?.t, p2: pts[1]?.p, t3: pts[2]?.t, p3: pts[2]?.p, color: '#e5e5e7' }, true));
    }
    // extra levels (trade panel SL / TP preview)
    for (const lv of props.levels ?? []) {
      const y = yOf(lv.price);
      if (y === null) continue;
      overlay.push(
        <g key={`lv${lv.label}`}>
          <line x1={0} x2={plotW} y1={y} y2={y} stroke={lv.color} strokeDasharray="6 4" strokeWidth={1.2} />
          <rect x={plotW - 108} y={y - 9} width={104} height={17} rx={4} fill={alpha(lv.color, 0.9)} />
          <text x={plotW - 56} y={y + 4} textAnchor="middle" className="ovl-label" fill="#0b0b0d">{lv.label} {fmtPrice(def, lv.price)}</text>
        </g>,
      );
    }
  }

  // countdown to bar close
  const q = quote(sym, now);
  const left = Math.max(0, bucketStart(now, tf) + tf - now);
  const yBid = paneH > 0 ? yOf(q.bid) : null;
  const cd = left >= 3600 ? `${Math.floor(left / 3600)}:${String(Math.floor((left % 3600) / 60)).padStart(2, '0')}:${String(Math.floor(left % 60)).padStart(2, '0')}` : `${String(Math.floor(left / 60)).padStart(2, '0')}:${String(Math.floor(left % 60)).padStart(2, '0')}`;

  const cancelPress = () => {
    if (press.current) window.clearTimeout(press.current.timer);
    press.current = null;
  };
  const firePress = (x: number, y: number) => {
    cancelPress();
    const cb = propsRef.current.onLongPress;
    if (!cb || propsRef.current.tool) return;
    const r = el.current?.getBoundingClientRect();
    const lx = x - (r?.left ?? 0);
    const ly = y - (r?.top ?? 0);
    const pr = main.current?.coordinateToPrice(ly);
    navigator.vibrate?.(12);
    cb({ x: lx, y: ly, price: pr ?? null, time: timeOf(lx) });
  };
  const handlers = {
    onPointerDown: (e: React.PointerEvent) => {
      if (e.button !== 0 || propsRef.current.tool) return;
      cancelPress();
      const { clientX, clientY } = e;
      press.current = { x: clientX, y: clientY, timer: window.setTimeout(() => firePress(clientX, clientY), 1000) };
    },
    onPointerMove: (e: React.PointerEvent) => {
      const p0 = press.current;
      if (p0 && Math.hypot(e.clientX - p0.x, e.clientY - p0.y) > 9) cancelPress();
    },
    onPointerUp: cancelPress,
    onPointerCancel: cancelPress,
    onPointerLeave: cancelPress,
    onContextMenu: (e: React.MouseEvent) => {
      e.preventDefault();
      firePress(e.clientX, e.clientY);
    },
  };

  return (
    <div className="chart" ref={el} {...handlers}>
      <svg className="overlay" width={plotW} height={paneH} style={{ width: plotW, height: paneH }}>
        {overlay}
      </svg>
      {toggles.countdown && q.open && yBid !== null && yBid > 8 && yBid < paneH - 8 && (
        <span className="countdown" style={{ top: yBid + 9, right: scaleW + 4 }}>{cd}</span>
      )}
      {tool && <span className="toolhint">{OBJ_POINTS[tool] === 1 ? 'Tap the chart to place' : `Tap point ${pending.current.length + 1} of ${OBJ_POINTS[tool]}`}</span>}
    </div>
  );
}
