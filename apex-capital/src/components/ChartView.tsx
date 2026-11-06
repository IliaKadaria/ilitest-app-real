import { useState } from 'react';
import { TIMEFRAMES, pnlFor, quote, trendOf } from '../market/engine.ts';
import { CLASSES, SYMBOLS, SYMBOL_MAP, fmtPrice, nextOpen, pointOf, type AssetClass } from '../market/symbols.ts';
import type { Deal } from '../game/account.ts';
import { game, useGame } from '../game/store.ts';
import { INDICATOR_INFO, settings, useSettings, type ChartToggles, type ChartType, type IndicatorGroup, type IndicatorType, type ObjType } from '../game/settings.ts';
import { SCRIPT_FUNCS, SCRIPT_VARS, checkScript } from '../market/script.ts';
import { money } from '../format.ts';
import { useT } from '../i18n.ts';
import { sfx } from '../sfx.ts';
import { Chart, type HoverInfo, type Level, type LongPress } from './Chart.tsx';
import { Flash, useHold } from './Juice.tsx';
import { Icon } from './Icons.tsx';
import { stepLots } from './OrderTicket.tsx';

const TOOL_GROUPS: { name: string; tools: { id: ObjType; label: string }[] }[] = [
  {
    name: 'Lines',
    tools: [
      { id: 'trend', label: 'Trend line' },
      { id: 'ray', label: 'Ray' },
      { id: 'extline', label: 'Extended line' },
      { id: 'arrow', label: 'Arrow' },
      { id: 'hline', label: 'Horizontal line' },
      { id: 'hray', label: 'Horizontal ray' },
      { id: 'vline', label: 'Vertical line' },
      { id: 'cross', label: 'Cross line' },
    ],
  },
  { name: 'Channels & pitchforks', tools: [{ id: 'channel', label: 'Parallel channel' }, { id: 'pitchfork', label: 'Andrews pitchfork' }] },
  { name: 'Fibonacci', tools: [{ id: 'fibo', label: 'Fib retracement' }, { id: 'fibext', label: 'Fib extension' }] },
  { name: 'Shapes', tools: [{ id: 'rect', label: 'Rectangle' }, { id: 'ellipse', label: 'Ellipse' }, { id: 'triangle', label: 'Triangle' }] },
  { name: 'Measure & positions', tools: [{ id: 'range', label: 'Price range' }, { id: 'long', label: 'Long position' }, { id: 'short', label: 'Short position' }] },
  { name: 'Annotations', tools: [{ id: 'text', label: 'Text' }, { id: 'pricelabel', label: 'Price label' }, { id: 'arrowup', label: 'Arrow up' }, { id: 'arrowdown', label: 'Arrow down' }] },
];
const TOOLS = TOOL_GROUPS.flatMap((g) => g.tools);
const TYPE_LABEL: Record<ChartType, string> = { bars: 'Bar chart', candles: 'Candlesticks', line: 'Line chart' };
const tfLabel = (sec: number) => TIMEFRAMES.find((t) => t.sec === sec)?.id ?? '1m';
const QUICK_TF = ['1s', '15s', '1m', '5m', '15m', '1h', '4h', '1D', '1W'];

type Sheet = 'tf' | 'ind' | 'obj' | 'sym' | 'type' | 'menu' | 'settings' | null;

export interface TicketPrefill {
  sl?: string;
  tp?: string;
  lots?: number;
}


export function ChartView({ sym, now, tf, focus, onSym, onTf, onClearFocus, onNewOrder }: { sym: string; now: number; tf: number; focus: Deal | null; onSym: (s: string) => void; onTf: (tf: number) => void; onClearFocus: () => void; onNewOrder: (prefill?: TicketPrefill) => void }) {
  const st = useSettings();
  const g = useGame();
  const t = useT();
  const [sheet, setSheet] = useState<Sheet>(null);
  const [tool, setTool] = useState<ObjType | null>(null);
  const [hover, setHover] = useState<HoverInfo | null>(null);
  const [panel, setPanel] = useState(false);
  const [sl, setSl] = useState('');
  const [tp, setTp] = useState('');
  const def = SYMBOL_MAP[sym];
  const q = quote(sym, now);
  const objects = st.objects[sym] ?? [];
  const trend = trendOf(sym, tf, now);
  const nSl = sl.trim() === '' ? null : Number(sl);
  const nTp = tp.trim() === '' ? null : Number(tp);
  const levels: Level[] = panel ? [...(nSl !== null && Number.isFinite(nSl) ? [{ price: nSl, color: '#e5484d', label: 'SL' }] : []), ...(nTp !== null && Number.isFinite(nTp) ? [{ price: nTp, color: '#4cc38a', label: 'TP' }] : [])] : [];
  const step = (v: string, dir: 1 | -1, fallback: number) => {
    const base = v.trim() === '' || !Number.isFinite(Number(v)) ? fallback : Number(v);
    const pip = pointOf(def) * (def.digits === 3 || def.digits === 5 ? 10 : 1);
    return fmtPrice(def, base + dir * pip);
  };
  const dist = def.base * def.vol1m * 6;
  const panelFire = (side: 1 | -1) => {
    const s2 = nSl !== null && Number.isFinite(nSl) ? nSl : null;
    const t2 = nTp !== null && Number.isFinite(nTp) ? nTp : null;
    if (game.open(sym, side, st.quickLots, s2, t2)) {
      sfx.fill(side);
      setSl('');
      setTp('');
    } else sfx.bonk();
  };
  const onLongPress = (p: LongPress) => {
    void p;
    setSheet('menu');
    sfx.tap();
  };

  const lotsDown = useHold(() => settings.set({ quickLots: stepLots(settings.s.quickLots, -1) }));
  const lotsUp = useHold(() => settings.set({ quickLots: stepLots(settings.s.quickLots, 1) }));
  const fire = (side: 1 | -1) => {
    if (game.open(sym, side, st.quickLots, null, null)) sfx.fill(side);
    else sfx.bonk();
  };

  const oneClick = st.toggles.oneClick && (
    <div className="oneclick-bar">
      <button className={`side sell ${trend === -1 ? 'hot' : ''}`} disabled={!q.open} onClick={() => fire(-1)}>
        <span className="lbl">SELL</span>
        <Flash value={q.bid} className="px">{fmtPrice(def, q.bid)}</Flash>
      </button>
      <div className="lots">
        <button className="nudge sm" aria-label="Decrease volume" {...lotsDown}>−</button>
        <b className="num">{st.quickLots.toFixed(2)}</b>
        <button className="nudge sm" aria-label="Increase volume" {...lotsUp}>+</button>
      </div>
      <button className={`side buy ${trend === 1 ? 'hot' : ''}`} disabled={!q.open} onClick={() => fire(1)}>
        <span className="lbl">BUY</span>
        <Flash value={q.ask} className="px">{fmtPrice(def, q.ask)}</Flash>
      </button>
    </div>
  );

  const c = hover?.candle;
  return (
    <div className="chartview">
      <div className="charttools">
        <button className="symbtn" onClick={() => setSheet('sym')}><b>{def.name}</b><small>{tfLabel(tf)}</small></button>
        <button className="tbtn" onClick={() => setSheet('tf')} aria-label="Timeframe"><Icon.clock /><span>{tfLabel(tf)}</span></button>
        <button className="tbtn" onClick={() => setSheet('type')} aria-label="Chart type">{st.chartType === 'line' ? <Icon.line /> : st.chartType === 'bars' ? <Icon.bars /> : <Icon.trade />}</button>
        <button className="tbtn" onClick={() => setSheet('ind')} aria-label="Indicators"><span className="fx">f</span>{st.indicators.length > 0 && <i className="cnt">{st.indicators.length}</i>}</button>
        <button className={`tbtn ${tool ? 'on' : ''}`} onClick={() => (tool ? setTool(null) : setSheet('obj'))} aria-label="Objects"><Icon.pen />{objects.length > 0 && <i className="cnt">{objects.length}</i>}</button>
        <button className={`tbtn ${panel ? 'on' : ''}`} onClick={() => { setPanel((v) => !v); sfx.tap(); }} aria-label="Trade panel"><Icon.trade /></button>
        <button className="tbtn" onClick={() => onNewOrder()} aria-label="New order"><Icon.plus /></button>
      </div>
      <div className="tfquick">
        {TIMEFRAMES.filter((x) => QUICK_TF.includes(x.id) || x.sec === tf).map((x) => (
          <button key={x.id} className={tf === x.sec ? 'on' : ''} onClick={() => { onTf(x.sec); sfx.tap(); }}>{x.id}</button>
        ))}
        <button className="more" onClick={() => setSheet('tf')} aria-label="All timeframes">⋯</button>
      </div>

      {focus && (
        <div className="focusbar">
          <span><b className={focus.side === 1 ? 'buyc' : 'sellc'}>{focus.side === 1 ? 'BUY' : 'SELL'} {focus.lots.toFixed(2)}</b> {SYMBOL_MAP[focus.sym].name} · {new Date(focus.openTime * 1000).toLocaleString([], { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' })} · <b className={focus.profit >= 0 ? 'up' : 'down'}>{money(focus.profit, true)}</b></span>
          <button className="iconbtn sm" aria-label="Clear" onClick={onClearFocus}>✕</button>
        </div>
      )}

      {!st.toggles.panelBottom && !panel && oneClick}

      <div className="chartwrap big">
        {st.toggles.ohlc && c && (
          <div className="ohlc num" style={{ color: st.colors.foreground }}>
            <span className="sname" style={{ color: st.colors.foreground }}>{def.name}, {tfLabel(tf)}</span>
            <span>O {fmtPrice(def, c.open)}</span>
            <span>H {fmtPrice(def, c.high)}</span>
            <span>L {fmtPrice(def, c.low)}</span>
            <span>C {fmtPrice(def, c.close)}</span>
            {st.toggles.volume && <span>V {c.volume.toLocaleString()}</span>}
          </div>
        )}
        {st.toggles.dataWindow && c && (
          <div className="datawin num">
            <div><span>Date</span><b>{new Date(c.time * 1000).toLocaleDateString([], { month: 'short', day: '2-digit' })}</b></div>
            <div><span>Time</span><b>{new Date(c.time * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</b></div>
            <div><span>Open</span><b>{fmtPrice(def, c.open)}</b></div>
            <div><span>High</span><b>{fmtPrice(def, c.high)}</b></div>
            <div><span>Low</span><b>{fmtPrice(def, c.low)}</b></div>
            <div><span>Close</span><b>{fmtPrice(def, c.close)}</b></div>
            <div><span>{st.toggles.tickVolumes ? 'Tick vol' : 'Volume'}</span><b>{c.volume.toLocaleString()}</b></div>
            {hover?.values.map((v) => <div key={v.label}><span style={{ color: v.color }}>{v.label}</span><b>{v.value}</b></div>)}
          </div>
        )}
        {!q.open && <div className="closedbadge">Market closed · opens {new Date(nextOpen(def, now) * 1000).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })}</div>}
        <Chart
          sym={sym}
          tf={tf}
          now={now}
          type={st.chartType}
          toggles={st.toggles}
          colors={st.colors}
          indicators={st.indicators}
          objects={objects}
          tool={tool}
          onPlace={(o) => { settings.addObject(sym, o); setTool(null); sfx.tap(); }}
          positions={g.account.positions}
          orders={g.account.orders}
          deals={g.account.history}
          focus={focus}
          onHover={setHover}
          onLongPress={onLongPress}
          levels={levels}
        />
      </div>

      {panel ? (
        <div className="tradepanel">
          <div className="tp-row">
            <label className="tp-field sl">
              <span>SL</span>
              <button aria-label="SL down" onClick={() => setSl(step(sl, -1, trend === 1 ? q.bid - dist : q.ask + dist))}>−</button>
              <input className="num" inputMode="decimal" placeholder="none" value={sl} onChange={(e) => setSl(e.target.value.replace(/[^\d.]/g, ''))} />
              <button aria-label="SL up" onClick={() => setSl(step(sl, 1, trend === 1 ? q.bid - dist : q.ask + dist))}>+</button>
            </label>
            <label className="tp-field tp">
              <span>TP</span>
              <button aria-label="TP down" onClick={() => setTp(step(tp, -1, trend === 1 ? q.ask + dist * 1.6 : q.bid - dist * 1.6))}>−</button>
              <input className="num" inputMode="decimal" placeholder="none" value={tp} onChange={(e) => setTp(e.target.value.replace(/[^\d.]/g, ''))} />
              <button aria-label="TP up" onClick={() => setTp(step(tp, 1, trend === 1 ? q.ask + dist * 1.6 : q.bid - dist * 1.6))}>+</button>
            </label>
            <button className="tp-expand" aria-label="Full order ticket" onClick={() => { onNewOrder({ sl, tp, lots: st.quickLots }); setPanel(false); }}>
              <svg viewBox="0 0 24 24"><path d="M6 15l6-6 6 6" /></svg>
            </button>
          </div>
          {(nSl !== null || nTp !== null) && (
            <div className="tp-hint muted num">
              {nTp !== null && Number.isFinite(nTp) && <span className="up">TP {money(pnlFor(def, Math.abs(nTp - q.mid), st.quickLots, now), true)}</span>}
              {nSl !== null && Number.isFinite(nSl) && <span className="down">SL {money(-pnlFor(def, Math.abs(q.mid - nSl), st.quickLots, now), true)}</span>}
              <span>at {st.quickLots.toFixed(2)} lots</span>
            </div>
          )}
          <div className="oneclick-bar">
            <button className={`side sell ${trend === -1 ? 'hot' : ''}`} disabled={!q.open} onClick={() => panelFire(-1)}>
              <span className="lbl">SELL</span>
              <Flash value={q.bid} className="px">{fmtPrice(def, q.bid)}</Flash>
            </button>
            <div className="lots">
              <button className="nudge sm" aria-label="Decrease volume" {...lotsDown}>−</button>
              <b className="num">{st.quickLots.toFixed(2)}</b>
              <button className="nudge sm" aria-label="Increase volume" {...lotsUp}>+</button>
            </div>
            <button className={`side buy ${trend === 1 ? 'hot' : ''}`} disabled={!q.open} onClick={() => panelFire(1)}>
              <span className="lbl">BUY</span>
              <Flash value={q.ask} className="px">{fmtPrice(def, q.ask)}</Flash>
            </button>
          </div>
        </div>
      ) : (
        st.toggles.panelBottom && oneClick
      )}

      {sheet === 'menu' && (
        <div className="modal" onClick={() => setSheet(null)}>
          <div className="ctxmenu" onClick={(e) => e.stopPropagation()}>
            <div className="ctxhead"><b>{def.name}</b><small>{tfLabel(tf)} · {fmtPrice(def, q.bid)}</small></div>
            <button onClick={() => { setPanel(true); setSheet(null); sfx.tap(); }}><Icon.trade /> Trade</button>
            <button onClick={() => setSheet('ind')}><span className="fx">f</span> Indicators</button>
            <button onClick={() => setSheet('obj')}><Icon.pen /> Objects</button>
            <button onClick={() => setSheet('settings')}><Icon.settings /> Settings</button>
            <button className="cancel" onClick={() => setSheet(null)}>Cancel</button>
          </div>
        </div>
      )}

      {sheet === 'settings' && <ChartSettingsSheet onClose={() => setSheet(null)} />}

      {sheet === 'tf' && (
        <Sheet title="Timeframe" onClose={() => setSheet(null)}>
          <div className="tfgrid">
            {TIMEFRAMES.map((x) => (
              <button key={x.id} className={tf === x.sec ? 'on' : ''} onClick={() => { onTf(x.sec); setSheet(null); }}>
                <b>{x.id}</b>
                <small>{x.name}</small>
              </button>
            ))}
          </div>
        </Sheet>
      )}

      {sheet === 'type' && (
        <Sheet title="Chart type" onClose={() => setSheet(null)}>
          {(['bars', 'candles', 'line'] as ChartType[]).map((k) => (
            <button key={k} className={`listbtn ${st.chartType === k ? 'on' : ''}`} onClick={() => { settings.set({ chartType: k }); setSheet(null); }}>
              {k === 'line' ? <Icon.line /> : k === 'bars' ? <Icon.bars /> : <Icon.trade />} {TYPE_LABEL[k]} {st.chartType === k && <Icon.check />}
            </button>
          ))}
        </Sheet>
      )}

      {sheet === 'ind' && <IndicatorSheet onClose={() => setSheet(null)} />}

      {sheet === 'obj' && (
        <Sheet title="Objects" onClose={() => setSheet(null)}>
          {TOOL_GROUPS.map((grp) => (
            <div key={grp.name} style={{ display: 'grid', gap: 6 }}>
              <div className="eyebrow">{grp.name}</div>
              <div className="toolgrid">
                {grp.tools.map((x) => (
                  <button key={x.id} onClick={() => { setTool(x.id); setSheet(null); sfx.tap(); }}>
                    <ObjIcon type={x.id} />
                    {x.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
          <div className="eyebrow" style={{ marginTop: 6 }}>On this chart · {objects.length}</div>
          {objects.map((o) => (
            <div key={o.id} className="objrow">
              <ObjIcon type={o.type} />
              <span>{TOOLS.find((x) => x.id === o.type)?.label}{o.label ? ` · ${o.label}` : ''} <small className="muted num">{fmtPrice(def, o.p1)}</small></span>
              <button className="ghost sm" onClick={() => settings.removeObject(sym, o.id)}>{t('x.delete')}</button>
            </div>
          ))}
          {objects.length > 0 && <button className="ghost" onClick={() => settings.clearObjects(sym)}>Delete all objects</button>}
        </Sheet>
      )}

      {sheet === 'sym' && <SymbolSheet current={sym} onPick={(s) => { onSym(s); setSheet(null); }} onClose={() => setSheet(null)} />}
    </div>
  );
}

function ObjIcon({ type }: { type: ObjType }) {
  const d: Record<ObjType, string> = {
    hline: 'M3 12h18',
    hray: 'M7 12h14M7 12h0',
    vline: 'M12 3v18',
    cross: 'M12 3v18M3 12h18',
    trend: 'M4 19L20 5M4 19h0M20 5h0',
    ray: 'M4 19L13 11L22 3',
    extline: 'M1 22L23 2',
    arrow: 'M4 19L19 6M19 6h-6M19 6v6',
    channel: 'M3 15L15 5M9 21L21 11',
    pitchfork: 'M3 12L21 12M8 6L21 6M8 18L21 18M8 6L8 18',
    fibo: 'M4 5h16M4 9h16M4 12h16M4 15h16M4 19h16',
    fibext: 'M3 20L9 8L13 14M13 4h8M13 9h8M13 14h8',
    rect: 'M5 7h14v10H5z',
    ellipse: 'M3 12a9 6 0 1 0 18 0a9 6 0 1 0 -18 0',
    triangle: 'M4 19L12 5L20 19z',
    range: 'M12 4v16M8 4h8M8 20h8',
    long: 'M4 4h16v8H4zM4 12h16v6H4z',
    short: 'M4 6h16v6H4zM4 12h16v8H4z',
    text: 'M5 6h14M12 6v13',
    pricelabel: 'M3 12l5-6h13v12H8z',
    arrowup: 'M12 4l-6 8h4v8h4v-8h4z',
    arrowdown: 'M12 20l-6-8h4V4h4v8h4z',
  };
  return <svg viewBox="0 0 24 24" className="objicon"><path d={d[type]} strokeLinecap="round" /></svg>;
}

export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="modal" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="grab" />
        <h3>{title}</h3>
        {children}
      </div>
    </div>
  );
}

const GROUP_LABEL: Record<IndicatorGroup, string> = { trend: 'Trend & overlays', osc: 'Oscillators', volume: 'Volume', flow: 'Order flow & options' };
const EXAMPLES: { name: string; expr: string; pane: boolean }[] = [
  { name: 'EMA cross spread', expr: 'ema(close, 9) - ema(close, 21)', pane: true },
  { name: 'Bands ±2σ', expr: 'sma(close, 20) + 2 * stdev(close, 20); sma(close, 20); sma(close, 20) - 2 * stdev(close, 20)', pane: false },
  { name: 'Range position %', expr: '(close - lowest(low, 14)) / (highest(high, 14) - lowest(low, 14)) * 100', pane: true },
  { name: 'RSI of HL2, smoothed', expr: 'ema(rsi(hl2, 14), 5)', pane: true },
  { name: 'Momentum vs ATR', expr: 'change(close, 10) / atr(14)', pane: true },
];

function IndicatorSheet({ onClose }: { onClose: () => void }) {
  const st = useSettings();
  const [mode, setMode] = useState<'list' | 'add' | 'custom'>('list');
  const [name, setName] = useState('My indicator');
  const [expr, setExpr] = useState(EXAMPLES[0].expr);
  const [pane, setPane] = useState(true);
  const [editing, setEditing] = useState<string | null>(null);
  const err = expr.trim() ? checkScript(expr) : 'Write a formula';
  const save = () => {
    if (err) return;
    if (editing) settings.updateIndicator(editing, { expr, name: name.trim() || 'Custom', pane });
    else settings.addIndicator('custom', 0, '#e5e5e7', { expr, name: name.trim() || 'Custom', pane });
    setEditing(null);
    setMode('list');
    sfx.tap();
  };
  return (
    <Sheet title={mode === 'custom' ? (editing ? 'Edit custom indicator' : 'New custom indicator') : 'Indicators'} onClose={onClose}>
      {mode === 'list' && (
        <>
          <div className="eyebrow">Main window & sub-windows</div>
          {!st.indicators.length && <div className="empty" style={{ padding: 12 }}>No indicators on the chart</div>}
          {st.indicators.map((i) => {
            const info = INDICATOR_INFO[i.type];
            const custom = i.type === 'custom';
            return (
              <div key={i.id} className="indrow">
                <input type="color" value={i.color} onChange={(e) => settings.updateIndicator(i.id, { color: e.target.value })} aria-label="Color" />
                <span><b>{custom ? i.name || 'Custom' : info.name}</b><small>{custom ? <code>{i.expr}</code> : info.pane ? 'Indicator window' : 'Main window'}</small></span>
                {custom ? (
                  <button className="ghost sm" onClick={() => { setEditing(i.id); setName(i.name ?? ''); setExpr(i.expr ?? ''); setPane(!!i.pane); setMode('custom'); }}>Edit</button>
                ) : (
                  info.period > 0 && <input className="num period" inputMode="numeric" value={i.period} onChange={(e) => settings.updateIndicator(i.id, { period: Math.max(2, Math.min(200, Number(e.target.value.replace(/\D/g, '')) || 2)) })} aria-label="Period" />
                )}
                <button className="ghost sm" onClick={() => settings.removeIndicator(i.id)}>✕</button>
              </div>
            );
          })}
          <div className="row2">
            <button className="primary" onClick={() => setMode('add')}>+ Add indicator</button>
            <button className="ghost" onClick={() => { setEditing(null); setName('My indicator'); setExpr(EXAMPLES[0].expr); setPane(true); setMode('custom'); }}>+ Custom</button>
          </div>
        </>
      )}
      {mode === 'add' && (
        <>
          {(Object.keys(GROUP_LABEL) as IndicatorGroup[]).map((grp) => (
            <div key={grp} style={{ display: 'grid', gap: 6 }}>
              <div className="eyebrow">{GROUP_LABEL[grp]}</div>
              {(Object.keys(INDICATOR_INFO) as IndicatorType[])
                .filter((k) => k !== 'custom' && INDICATOR_INFO[k].group === grp)
                .map((k) => (
                  <button key={k} className="listbtn" onClick={() => { settings.addIndicator(k, INDICATOR_INFO[k].period, INDICATOR_INFO[k].color); setMode('list'); sfx.tap(); }}>
                    <span className="fx">f</span> {INDICATOR_INFO[k].name}
                  </button>
                ))}
            </div>
          ))}
          <p className="hint" style={{ textAlign: 'left' }}>GEX and order flow come from this game’s simulated options market and tape, not a real exchange feed.</p>
          <button className="ghost" onClick={() => setMode('list')}>Back</button>
        </>
      )}
      {mode === 'custom' && (
        <>
          <label className="field"><span>Name</span><input value={name} maxLength={28} onChange={(e) => setName(e.target.value)} /></label>
          <label className="field"><span>Formula</span><textarea className="num codebox" rows={3} spellCheck={false} value={expr} onChange={(e) => setExpr(e.target.value)} /></label>
          {err ? <div className="warnline">{err}</div> : <div className="done" style={{ margin: 0 }}>Formula OK</div>}
          <div className="seg3" style={{ margin: 0 }}>
            <button className={!pane ? 'on' : ''} onClick={() => setPane(false)}>On price chart</button>
            <button className={pane ? 'on' : ''} onClick={() => setPane(true)}>Own window</button>
          </div>
          <div className="eyebrow">Examples</div>
          <div className="chips">
            {EXAMPLES.map((x) => <button key={x.name} className="chip" onClick={() => { setExpr(x.expr); setName(x.name); setPane(x.pane); }}>{x.name}</button>)}
          </div>
          <div className="hint" style={{ textAlign: 'left' }}>
            Series: {SCRIPT_VARS.join(', ')} · <code>x[1]</code> = previous bar · operators + − × ÷ ^ · separate up to 4 lines with “;”.<br />
            Functions: {Object.values(SCRIPT_FUNCS).join(', ')}
          </div>
          <div className="row2">
            <button className="ghost" onClick={() => setMode('list')}>Cancel</button>
            <button className="primary" disabled={!!err} onClick={save}>{editing ? 'Save' : 'Add to chart'}</button>
          </div>
        </>
      )}
    </Sheet>
  );
}

const SETTING_TOGGLES: { k: keyof ChartToggles; label: string }[] = [
  { k: 'volume', label: 'Volume' },
  { k: 'ohlc', label: 'OHLC' },
  { k: 'dataWindow', label: 'Data window' },
  { k: 'askLine', label: 'Ask price line' },
  { k: 'countdown', label: 'Countdown to bar close' },
  { k: 'periodSeparators', label: 'Period separators' },
  { k: 'tradePositions', label: 'Trade positions' },
  { k: 'tradeOrders', label: 'Trade orders' },
  { k: 'slTp', label: 'SL / TP levels' },
  { k: 'tradeHistory', label: 'Trade history' },
  { k: 'oneClick', label: 'One-click trading' },
  { k: 'freeMove', label: 'Free chart movement' },
];

function ChartSettingsSheet({ onClose }: { onClose: () => void }) {
  const st = useSettings();
  return (
    <Sheet title="Chart settings" onClose={onClose}>
      <div className="seg3" style={{ margin: 0 }}>
        {(['bars', 'candles', 'line'] as ChartType[]).map((k) => <button key={k} className={st.chartType === k ? 'on' : ''} onClick={() => settings.set({ chartType: k })}>{TYPE_LABEL[k]}</button>)}
      </div>
      <div className="seg3" style={{ margin: 0 }}>
        <button className={st.precision !== 'extended' ? 'on' : ''} onClick={() => settings.set({ precision: 'standard' })}>Standard digits</button>
        <button className={st.precision === 'extended' ? 'on' : ''} onClick={() => settings.set({ precision: 'extended' })}>13 decimals</button>
      </div>
      <div className="togglelist">
        {SETTING_TOGGLES.map((x) => (
          <label key={x.k} className="togglerow">
            <span>{x.label}</span>
            <button className={`switch ${st.toggles[x.k] ? 'on' : ''}`} aria-label={x.label} onClick={() => settings.toggle(x.k)} />
          </label>
        ))}
      </div>
      <p className="hint" style={{ textAlign: 'left' }}>Colours and the rest live in Settings → Charts.</p>
    </Sheet>
  );
}

function SymbolSheet({ current, onPick, onClose }: { current: string; onPick: (s: string) => void; onClose: () => void }) {
  const t = useT();
  const [cls, setCls] = useState<AssetClass>(SYMBOL_MAP[current].cls);
  const [q, setQ] = useState('');
  const term = q.trim().toLowerCase();
  const rows = SYMBOLS.filter((s) => (term ? `${s.id} ${s.desc}`.toLowerCase().includes(term) : s.cls === cls));
  return (
    <Sheet title="Symbol" onClose={onClose}>
      <input placeholder={t('q.search')} value={q} onChange={(e) => setQ(e.target.value)} />
      {!term && (
        <div className="seg3">
          {CLASSES.map((c) => <button key={c} className={cls === c ? 'on' : ''} onClick={() => setCls(c)}>{t(`cls.${c}`)}</button>)}
        </div>
      )}
      <div className="addlist">
        {rows.map((s) => (
          <button key={s.id} className={`addrow ${s.id === current ? 'on' : ''}`} onClick={() => onPick(s.id)}>
            <span className="mono-badge">{s.mono}</span>
            <span className="qname"><b>{s.name}</b><small>{s.desc}</small></span>
          </button>
        ))}
      </div>
    </Sheet>
  );
}
