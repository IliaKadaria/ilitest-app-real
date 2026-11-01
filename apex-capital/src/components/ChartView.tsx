import { useState } from 'react';
import { TIMEFRAMES, quote } from '../market/engine.ts';
import { CLASSES, SYMBOLS, SYMBOL_MAP, fmtPrice, nextOpen, type AssetClass } from '../market/symbols.ts';
import type { Deal } from '../game/account.ts';
import { game, useGame } from '../game/store.ts';
import { INDICATOR_INFO, settings, useSettings, type ChartType, type IndicatorType, type ObjType } from '../game/settings.ts';
import { money } from '../format.ts';
import { useT } from '../i18n.ts';
import { sfx } from '../sfx.ts';
import { Chart, type HoverInfo } from './Chart.tsx';
import { Flash, useHold } from './Juice.tsx';
import { Icon } from './Icons.tsx';
import { stepLots } from './OrderTicket.tsx';

const TOOLS: { id: ObjType; label: string }[] = [
  { id: 'hline', label: 'Horizontal Line' },
  { id: 'vline', label: 'Vertical Line' },
  { id: 'trend', label: 'Trend Line' },
  { id: 'rect', label: 'Rectangle' },
  { id: 'fibo', label: 'Fibonacci Retracement' },
  { id: 'text', label: 'Text' },
];
const TYPE_LABEL: Record<ChartType, string> = { bars: 'Bar chart', candles: 'Candlesticks', line: 'Line chart' };
const tfLabel = (sec: number) => TIMEFRAMES.find((t) => t.sec === sec)?.id ?? 'M1';

type Sheet = 'tf' | 'ind' | 'obj' | 'sym' | 'type' | null;

export function ChartView({ sym, now, tf, focus, onSym, onTf, onClearFocus, onNewOrder }: { sym: string; now: number; tf: number; focus: Deal | null; onSym: (s: string) => void; onTf: (tf: number) => void; onClearFocus: () => void; onNewOrder: () => void }) {
  const st = useSettings();
  const g = useGame();
  const t = useT();
  const [sheet, setSheet] = useState<Sheet>(null);
  const [tool, setTool] = useState<ObjType | null>(null);
  const [hover, setHover] = useState<HoverInfo | null>(null);
  const def = SYMBOL_MAP[sym];
  const q = quote(sym, now);
  const objects = st.objects[sym] ?? [];

  const lotsDown = useHold(() => settings.set({ quickLots: stepLots(settings.s.quickLots, -1) }));
  const lotsUp = useHold(() => settings.set({ quickLots: stepLots(settings.s.quickLots, 1) }));
  const fire = (side: 1 | -1) => {
    if (game.open(sym, side, st.quickLots, null, null)) sfx.fill(side);
    else sfx.bonk();
  };

  const oneClick = st.toggles.oneClick && (
    <div className="oneclick-bar">
      <button className="side sell" disabled={!q.open} onClick={() => fire(-1)}>
        <span className="lbl">SELL</span>
        <Flash value={q.bid} className="px">{fmtPrice(def, q.bid)}</Flash>
      </button>
      <div className="lots">
        <button className="nudge sm" aria-label="Decrease volume" {...lotsDown}>−</button>
        <b className="num">{st.quickLots.toFixed(2)}</b>
        <button className="nudge sm" aria-label="Increase volume" {...lotsUp}>+</button>
      </div>
      <button className="side buy" disabled={!q.open} onClick={() => fire(1)}>
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
        <button className="tbtn" onClick={onNewOrder} aria-label="New order"><Icon.plus /></button>
      </div>
      <div className="tfquick">
        {TIMEFRAMES.map((x) => (
          <button key={x.id} className={tf === x.sec ? 'on' : ''} onClick={() => { onTf(x.sec); sfx.tap(); }}>{x.id}</button>
        ))}
      </div>

      {focus && (
        <div className="focusbar">
          <span><b className={focus.side === 1 ? 'buyc' : 'sellc'}>{focus.side === 1 ? 'BUY' : 'SELL'} {focus.lots.toFixed(2)}</b> {SYMBOL_MAP[focus.sym].name} · {new Date(focus.openTime * 1000).toLocaleString([], { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' })} · <b className={focus.profit >= 0 ? 'up' : 'down'}>{money(focus.profit, true)}</b></span>
          <button className="iconbtn sm" aria-label="Clear" onClick={onClearFocus}>✕</button>
        </div>
      )}

      {!st.toggles.panelBottom && oneClick}

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
        />
      </div>

      {st.toggles.panelBottom && oneClick}

      {sheet === 'tf' && (
        <Sheet title="Timeframe" onClose={() => setSheet(null)}>
          <div className="tfgrid">
            {TIMEFRAMES.map((x) => (
              <button key={x.id} className={tf === x.sec ? 'on' : ''} onClick={() => { onTf(x.sec); setSheet(null); }}>
                <b>{x.id}</b>
                <small>{x.sec < 3600 ? `${x.sec / 60} min` : x.sec < 86400 ? `${x.sec / 3600} hour${x.sec > 3600 ? 's' : ''}` : '1 day'}</small>
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
          <div className="eyebrow">Draw on {def.name}</div>
          <div className="toolgrid">
            {TOOLS.map((x) => (
              <button key={x.id} onClick={() => { setTool(x.id); setSheet(null); sfx.tap(); }}>
                <ObjIcon type={x.id} />
                {x.label}
              </button>
            ))}
          </div>
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
    vline: 'M12 3v18',
    trend: 'M4 19L20 5M4 19h0M20 5h0',
    rect: 'M5 7h14v10H5z',
    fibo: 'M4 5h16M4 9h16M4 12h16M4 15h16M4 19h16',
    text: 'M5 6h14M12 6v13',
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

function IndicatorSheet({ onClose }: { onClose: () => void }) {
  const st = useSettings();
  const [adding, setAdding] = useState(false);
  return (
    <Sheet title="Indicators" onClose={onClose}>
      {!adding ? (
        <>
          <div className="eyebrow">Main window & sub-windows</div>
          {!st.indicators.length && <div className="empty" style={{ padding: 12 }}>No indicators on the chart</div>}
          {st.indicators.map((i) => {
            const info = INDICATOR_INFO[i.type];
            return (
              <div key={i.id} className="indrow">
                <input type="color" value={i.color} onChange={(e) => settings.updateIndicator(i.id, { color: e.target.value })} aria-label="Color" />
                <span><b>{info.name}</b><small>{info.pane ? 'Indicator window' : 'Main window'}</small></span>
                {info.period > 0 && (
                  <input className="num period" inputMode="numeric" value={i.period} onChange={(e) => settings.updateIndicator(i.id, { period: Math.max(2, Math.min(200, Number(e.target.value.replace(/\D/g, '')) || 2)) })} aria-label="Period" />
                )}
                <button className="ghost sm" onClick={() => settings.removeIndicator(i.id)}>✕</button>
              </div>
            );
          })}
          <button className="primary" onClick={() => setAdding(true)}>+ Add indicator</button>
        </>
      ) : (
        <>
          {(['trend', 'osc'] as const).map((grp) => (
            <div key={grp} style={{ display: 'grid', gap: 6 }}>
              <div className="eyebrow">{grp === 'trend' ? 'Trend' : 'Oscillators'}</div>
              {(Object.keys(INDICATOR_INFO) as IndicatorType[])
                .filter((k) => INDICATOR_INFO[k].pane === (grp === 'osc'))
                .map((k) => (
                  <button key={k} className="listbtn" onClick={() => { settings.addIndicator(k, INDICATOR_INFO[k].period, INDICATOR_INFO[k].color); setAdding(false); sfx.tap(); }}>
                    <span className="fx">f</span> {INDICATOR_INFO[k].name}
                  </button>
                ))}
            </div>
          ))}
          <button className="ghost" onClick={() => setAdding(false)}>Back</button>
        </>
      )}
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
