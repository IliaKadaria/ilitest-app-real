import { useRef, useState, type ReactNode } from 'react';
import { midPrice, quote } from '../market/engine.ts';
import { CLASSES, SYMBOLS, SYMBOL_MAP, effectiveTime, fmtPrice, isOpen, nextOpen, pointOf, type AssetClass } from '../market/symbols.ts';
import { settings, useSettings } from '../game/settings.ts';
import { clock, hhmm, pnlClass } from '../format.ts';
import { useT } from '../i18n.ts';
import { sfx } from '../sfx.ts';
import { Flash } from './Juice.tsx';
import { Icon } from './Icons.tsx';

const ACTIONS_W = 222;

/** iOS-style swipe-to-reveal row. Tap = open chart, swipe left = actions. */
function SwipeRow({ open, onOpen, onTap, actions, children }: { open: boolean; onOpen: (o: boolean) => void; onTap: () => void; actions: ReactNode; children: ReactNode }) {
  const start = useRef<{ x: number; y: number; base: number; drag: boolean | null } | null>(null);
  const [dx, setDx] = useState<number | null>(null);
  const pos = dx ?? (open ? -ACTIONS_W : 0);
  return (
    <div className="swipe">
      <div className="swipe-actions">{actions}</div>
      <div
        className="swipe-front"
        style={{ transform: `translateX(${pos}px)`, transition: dx === null ? 'transform 0.22s cubic-bezier(.2,.8,.2,1)' : 'none' }}
        onPointerDown={(e) => {
          start.current = { x: e.clientX, y: e.clientY, base: open ? -ACTIONS_W : 0, drag: null };
        }}
        onPointerMove={(e) => {
          const s = start.current;
          if (!s) return;
          const mx = e.clientX - s.x;
          const my = e.clientY - s.y;
          if (s.drag === null && (Math.abs(mx) > 8 || Math.abs(my) > 8)) {
            s.drag = Math.abs(mx) > Math.abs(my);
            if (s.drag) (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          }
          if (s.drag) setDx(Math.max(-ACTIONS_W - 30, Math.min(0, s.base + mx)));
        }}
        onPointerUp={() => {
          const s = start.current;
          start.current = null;
          if (s?.drag) {
            const final = dx ?? s.base;
            onOpen(final < -ACTIONS_W / 3);
            setDx(null);
          } else if (s) {
            if (open) onOpen(false);
            else onTap();
          }
        }}
        onPointerCancel={() => {
          start.current = null;
          setDx(null);
        }}
      >
        {children}
      </div>
    </div>
  );
}

export function Quotes({ now, current, onChart, onOrder }: { now: number; current: string; onChart: (sym: string) => void; onOrder: (sym: string) => void }) {
  const st = useSettings();
  const t = useT();
  const [cls, setCls] = useState<AssetClass>(SYMBOL_MAP[current]?.cls ?? 'fx');
  const [openRow, setOpenRow] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const list = st.watch[cls];
  const probe = SYMBOLS.find((s) => s.cls === cls)!;
  const open = isOpen(probe, now);

  return (
    <div className="list quotes">
      <div className="seg3 sticky">
        {CLASSES.map((c) => (
          <button key={c} className={cls === c ? 'on' : ''} onClick={() => { setCls(c); setOpenRow(null); sfx.tap(); }}>
            {t(`cls.${c}`)}
            <small>{st.watch[c].length}</small>
          </button>
        ))}
      </div>
      <div className="qhead">
        <span className={`sess ${open ? '' : 'closed'}`}>
          <i />
          {open ? `${t('q.open')} · ${cls === 'nasdaq' ? '24/7 simulated venue' : cls === 'metal' ? 'daily break 22:00 UTC' : '24/5'}` : `${t('q.closed')} · ${new Date(nextOpen(probe, now) * 1000).toLocaleString([], { weekday: 'short' })} ${hhmm(nextOpen(probe, now))}`}
        </span>
        <span className="muted" style={{ fontSize: 11 }}>{clock(now)}</span>
      </div>
      <div className="qcols"><span>Symbol</span><span>Bid</span><span>Ask</span></div>
      {list.map((id) => {
        const s = SYMBOL_MAP[id];
        const q = quote(id, now);
        const ref = midPrice(id, effectiveTime(s, now) - 86400);
        const c = ((q.mid - ref) / ref) * 100;
        const spreadPts = Math.round(q.spread / pointOf(s));
        return (
          <SwipeRow
            key={id}
            open={openRow === id}
            onOpen={(o) => setOpenRow(o ? id : null)}
            onTap={() => { onChart(id); sfx.tap(); }}
            actions={
              <>
                <button className="sa sa-order" onClick={() => { setOpenRow(null); onOrder(id); }}><Icon.trade />{t('q.order')}</button>
                <button className="sa sa-chart" onClick={() => { setOpenRow(null); onChart(id); }}><Icon.chart />{t('q.chart')}</button>
                <button className="sa sa-del" onClick={() => { setOpenRow(null); settings.unwatch(id); sfx.tap(); }}><Icon.trash />{t('q.delete')}</button>
              </>
            }
          >
            <div className={`qrow ${id === current ? 'on' : ''}`}>
              <span className="qname">
                <b>{s.name}<span className={`chg ${pnlClass(c)}`}>{c >= 0 ? '+' : '−'}{Math.abs(c).toFixed(2)}%</span></b>
                <small>{q.open ? `${hhmm(now)} · spread ${spreadPts}` : t('q.closed')}</small>
              </span>
              <span className="qpx num sell"><Flash value={q.bid}>{fmtPrice(s, q.bid)}</Flash></span>
              <span className="qpx num buy"><Flash value={q.ask}>{fmtPrice(s, q.ask)}</Flash></span>
            </div>
          </SwipeRow>
        );
      })}
      {!list.length && <div className="empty"><b>No symbols</b>Add instruments to this list.</div>}
      <div className="pad" style={{ display: 'grid', gap: 8 }}>
        <button onClick={() => setAdding(true)}><Icon.plus /> {t('q.add')}</button>
        <div className="hint">{t('q.swipe')}</div>
      </div>
      {adding && <AddSymbols cls={cls} onClose={() => setAdding(false)} />}
    </div>
  );
}

function AddSymbols({ cls, onClose }: { cls: AssetClass; onClose: () => void }) {
  const st = useSettings();
  const t = useT();
  const [q, setQ] = useState('');
  const term = q.trim().toLowerCase();
  const rows = SYMBOLS.filter((s) => (term ? s.id.toLowerCase().includes(term) || s.desc.toLowerCase().includes(term) || s.name.toLowerCase().includes(term) : s.cls === cls));
  return (
    <div className="modal" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="grab" />
        <h3>{t('q.add')}</h3>
        <input autoFocus placeholder={t('q.search')} value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="addlist">
          {rows.map((s) => {
            const on = st.watch[s.cls].includes(s.id);
            return (
              <button key={s.id} className="addrow" onClick={() => (on ? settings.unwatch(s.id) : settings.watchSym(s.id))}>
                <span className="mono-badge">{s.mono}</span>
                <span className="qname"><b>{s.name}</b><small>{s.desc} · {t(`cls.${s.cls}`)}</small></span>
                <span className={`addtick ${on ? 'on' : ''}`}>{on ? '✓' : '+'}</span>
              </button>
            );
          })}
        </div>
        <button className="primary" onClick={onClose}>{t('x.done')}</button>
      </div>
    </div>
  );
}
