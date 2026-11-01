import { useSyncExternalStore } from 'react';
import { getItem, setItem } from '../storage.ts';
import { CLASSES, SYMBOLS, SYMBOL_MAP, type AssetClass } from '../market/symbols.ts';

// Everything the trader configures (chart look, indicators, drawings,
// watchlist, interface). One persisted store, MT5-style defaults.

export type ChartType = 'bars' | 'candles' | 'line';
export type Lang = 'en' | 'es' | 'fr' | 'de' | 'pt' | 'id';
export type Theme = 'dark' | 'black' | 'light';

export interface ChartColors {
  background: string;
  foreground: string;
  grid: string;
  barUp: string;
  barDown: string;
  bullCandle: string;
  bearCandle: string;
  lineChart: string;
  volumes: string;
  bidLine: string;
  askLine: string;
  stopsLevel: string;
}

export interface ChartToggles {
  volume: boolean;
  tickVolumes: boolean;
  periodSeparators: boolean;
  askLine: boolean;
  countdown: boolean;
  freeMove: boolean;
  ohlc: boolean;
  dataWindow: boolean;
  tradeOrders: boolean;
  tradePositions: boolean;
  slTp: boolean;
  profitLoss: boolean;
  tradeHistory: boolean;
  oneClick: boolean;
  panelBottom: boolean;
  preload: boolean;
}

export type IndicatorType = 'ma' | 'ema' | 'bb' | 'env' | 'sar' | 'rsi' | 'macd' | 'stoch' | 'atr' | 'cci';
export interface Indicator {
  id: string;
  type: IndicatorType;
  period: number;
  color: string;
}

export type ObjType = 'hline' | 'vline' | 'trend' | 'rect' | 'fibo' | 'text';
export interface ChartObject {
  id: string;
  type: ObjType;
  t1: number;
  p1: number;
  t2?: number;
  p2?: number;
  color: string;
  label?: string;
}

export interface Settings {
  lang: Lang;
  theme: Theme;
  pushEnabled: boolean;
  notify: { tp: boolean; sl: boolean; stopout: boolean; fill: boolean; news: boolean };
  chartType: ChartType;
  tf: number;
  sym: string;
  toggles: ChartToggles;
  colors: ChartColors;
  indicators: Indicator[];
  objects: Record<string, ChartObject[]>;
  watch: Record<AssetClass, string[]>;
  quickLots: number;
  deviation: number;
}

export const COLOR_PRESETS: Record<string, { label: string; colors: ChartColors }> = {
  apex: {
    label: 'Graphite',
    colors: { background: '#121214', foreground: '#8e8e93', grid: '#1f1f23', barUp: '#4cc38a', barDown: '#e5484d', bullCandle: '#4cc38a', bearCandle: '#e5484d', lineChart: '#e5e5e7', volumes: '#3c5a4a', bidLine: '#8e8e93', askLine: '#ff7a7f', stopsLevel: '#e5484d' },
  },
  greenOnBlack: {
    label: 'Green on black',
    colors: { background: '#000000', foreground: '#ffffff', grid: '#262626', barUp: '#00ff00', barDown: '#00ff00', bullCandle: '#000000', bearCandle: '#ffffff', lineChart: '#00ff00', volumes: '#32cd32', bidLine: '#c0c0c0', askLine: '#ff0000', stopsLevel: '#ff0000' },
  },
  blackOnWhite: {
    label: 'Black on white',
    colors: { background: '#ffffff', foreground: '#000000', grid: '#e6e6e6', barUp: '#000000', barDown: '#000000', bullCandle: '#ffffff', bearCandle: '#000000', lineChart: '#000000', volumes: '#008000', bidLine: '#c0c0c0', askLine: '#ff0000', stopsLevel: '#ff0000' },
  },
  mobile: {
    label: 'MT5 mobile',
    colors: { background: '#0f1115', foreground: '#c9ccd3', grid: '#1c1f26', barUp: '#2f8cff', barDown: '#ff4d4f', bullCandle: '#2f8cff', bearCandle: '#ff4d4f', lineChart: '#2f8cff', volumes: '#2f8cff', bidLine: '#c9ccd3', askLine: '#ff4d4f', stopsLevel: '#ff4d4f' },
  },
};

const DEFAULT_TOGGLES: ChartToggles = {
  volume: true,
  tickVolumes: true,
  periodSeparators: false,
  askLine: true,
  countdown: true,
  freeMove: false,
  ohlc: true,
  dataWindow: false,
  tradeOrders: true,
  tradePositions: true,
  slTp: true,
  profitLoss: true,
  tradeHistory: true,
  oneClick: true,
  panelBottom: false,
  preload: false,
};

const defaultWatch = (): Record<AssetClass, string[]> =>
  Object.fromEntries(CLASSES.map((c) => [c, SYMBOLS.filter((s) => s.cls === c).map((s) => s.id)])) as Record<AssetClass, string[]>;

const DEFAULTS: Settings = {
  lang: 'en',
  theme: 'dark',
  pushEnabled: false,
  notify: { tp: true, sl: true, stopout: true, fill: true, news: true },
  chartType: 'candles',
  tf: 60,
  sym: 'XAUUSD',
  toggles: DEFAULT_TOGGLES,
  colors: COLOR_PRESETS.apex.colors,
  indicators: [{ id: 'i1', type: 'ema', period: 20, color: '#d6b26e' }],
  objects: {},
  watch: defaultWatch(),
  quickLots: 0.01,
  deviation: 20,
};

const KEY = 'apex.settings.v2';

function loadSettings(): Settings {
  try {
    const raw = getItem(KEY);
    if (!raw) return DEFAULTS;
    const s = JSON.parse(raw) as Partial<Settings>;
    const saved = (s.watch ?? {}) as Record<string, string[]>;
    if (saved.metal && !saved.futures) {
      // v2 called this category "metal": keep the user's list and add the new futures
      saved.futures = [...saved.metal, ...defaultWatch().futures.filter((id) => !saved.metal.includes(id))];
      delete saved.metal;
    }
    const watch = { ...defaultWatch(), ...saved } as Record<AssetClass, string[]>;
    for (const c of CLASSES) watch[c] = watch[c].filter((id) => SYMBOL_MAP[id]?.cls === c);
    return {
      ...DEFAULTS,
      ...s,
      sym: s.sym && SYMBOL_MAP[s.sym] ? s.sym : DEFAULTS.sym,
      toggles: { ...DEFAULT_TOGGLES, ...(s.toggles ?? {}) },
      colors: { ...DEFAULTS.colors, ...(s.colors ?? {}) },
      notify: { ...DEFAULTS.notify, ...(s.notify ?? {}) },
      watch,
    };
  } catch {
    return DEFAULTS;
  }
}

type Listener = () => void;

class SettingsStore {
  s: Settings = loadSettings();
  private listeners = new Set<Listener>();
  private version = 0;
  subscribe = (l: Listener) => {
    this.listeners.add(l);
    return () => {
      this.listeners.delete(l);
    };
  };
  getVersion = () => this.version;

  set(patch: Partial<Settings>) {
    this.s = { ...this.s, ...patch };
    setItem(KEY, JSON.stringify(this.s));
    this.version++;
    this.listeners.forEach((l) => l());
  }
  toggle(k: keyof ChartToggles, v?: boolean) {
    this.set({ toggles: { ...this.s.toggles, [k]: v ?? !this.s.toggles[k] } });
  }
  color(k: keyof ChartColors, v: string) {
    this.set({ colors: { ...this.s.colors, [k]: v } });
  }

  // watchlist
  unwatch(sym: string) {
    const c = SYMBOL_MAP[sym].cls;
    this.set({ watch: { ...this.s.watch, [c]: this.s.watch[c].filter((x) => x !== sym) } });
  }
  watchSym(sym: string) {
    const c = SYMBOL_MAP[sym].cls;
    if (this.s.watch[c].includes(sym)) return;
    const order = SYMBOLS.filter((x) => x.cls === c).map((x) => x.id);
    const next = [...this.s.watch[c], sym].sort((a, b) => order.indexOf(a) - order.indexOf(b));
    this.set({ watch: { ...this.s.watch, [c]: next } });
  }

  // indicators
  addIndicator(type: IndicatorType, period: number, color: string) {
    this.set({ indicators: [...this.s.indicators, { id: `i${Date.now().toString(36)}`, type, period, color }] });
  }
  updateIndicator(id: string, patch: Partial<Indicator>) {
    this.set({ indicators: this.s.indicators.map((i) => (i.id === id ? { ...i, ...patch } : i)) });
  }
  removeIndicator(id: string) {
    this.set({ indicators: this.s.indicators.filter((i) => i.id !== id) });
  }

  // drawings
  objectsFor(sym: string): ChartObject[] {
    return this.s.objects[sym] ?? [];
  }
  addObject(sym: string, o: Omit<ChartObject, 'id'>) {
    const obj = { ...o, id: `o${Date.now().toString(36)}${Math.floor(Math.random() * 999)}` };
    this.set({ objects: { ...this.s.objects, [sym]: [...this.objectsFor(sym), obj] } });
  }
  removeObject(sym: string, id: string) {
    this.set({ objects: { ...this.s.objects, [sym]: this.objectsFor(sym).filter((o) => o.id !== id) } });
  }
  clearObjects(sym: string) {
    this.set({ objects: { ...this.s.objects, [sym]: [] } });
  }
}

export const settings = new SettingsStore();

export function useSettings(): Settings {
  useSyncExternalStore(settings.subscribe, settings.getVersion);
  return settings.s;
}

export const INDICATOR_INFO: Record<IndicatorType, { name: string; short: string; pane: boolean; period: number; color: string }> = {
  ma: { name: 'Moving Average (SMA)', short: 'MA', pane: false, period: 20, color: '#7aa7ff' },
  ema: { name: 'Exponential Moving Average', short: 'EMA', pane: false, period: 50, color: '#d6b26e' },
  bb: { name: 'Bollinger Bands', short: 'BB', pane: false, period: 20, color: '#9fa8ff' },
  env: { name: 'Envelopes', short: 'ENV', pane: false, period: 14, color: '#b48cff' },
  sar: { name: 'Parabolic SAR', short: 'SAR', pane: false, period: 0, color: '#e5e5e7' },
  rsi: { name: 'Relative Strength Index', short: 'RSI', pane: true, period: 14, color: '#d6b26e' },
  macd: { name: 'MACD', short: 'MACD', pane: true, period: 12, color: '#7aa7ff' },
  stoch: { name: 'Stochastic Oscillator', short: 'Stoch', pane: true, period: 14, color: '#4cc38a' },
  atr: { name: 'Average True Range', short: 'ATR', pane: true, period: 14, color: '#ff7a7f' },
  cci: { name: 'Commodity Channel Index', short: 'CCI', pane: true, period: 14, color: '#5ad1d1' },
};
