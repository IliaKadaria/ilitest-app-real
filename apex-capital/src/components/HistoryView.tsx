import { useState } from 'react';
import { SYMBOL_MAP, fmtPrice } from '../market/symbols.ts';
import { PENDING_LABEL, START_BALANCE, ticketNo, type Deal } from '../game/account.ts';
import { useGame } from '../game/store.ts';
import { compactMoney, money, pnlClass } from '../format.ts';
import { useT } from '../i18n.ts';
import { sfx } from '../sfx.ts';
import { Icon } from './Icons.tsx';

type Seg = 'positions' | 'orders' | 'deals';
type Period = 'today' | 'week' | 'month' | 'all';

const dt = (t: number) => new Date(t * 1000).toLocaleString([], { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
const REASON: Record<Deal['reason'], string> = { manual: '', tp: '[tp]', sl: '[sl]', stopout: '[so]', frozen: '[so]' };

export function HistoryView({ onShowOnChart, onShare }: { onShowOnChart: (d: Deal) => void; onShare: (d: Deal) => void }) {
  const { account: a } = useGame();
  const t = useT();
  const [seg, setSeg] = useState<Seg>('positions');
  const [period, setPeriod] = useState<Period>('all');
  const [sym, setSym] = useState<string>('');
  const [open, setOpen] = useState<string | null>(null);
  const now = Date.now() / 1000;
  const since = period === 'today' ? Math.floor(now / 86400) * 86400 : period === 'week' ? now - 7 * 86400 : period === 'month' ? now - 30 * 86400 : 0;
  const deals = a.history.filter((d) => d.closeTime >= since && (!sym || d.sym === sym));
  const orders = a.orderHistory.filter((o) => o.doneAt >= since && (!sym || o.sym === sym));
  const profit = deals.reduce((s, d) => s + d.profit, 0);
  const wins = deals.filter((d) => d.profit > 0).length;
  const symbols = [...new Set(a.history.map((d) => d.sym))];

  // Deals = every in/out execution (MT5 "Deals" tab), newest first
  const flat = deals
    .flatMap((d) => [
      { key: `${d.id}-out`, time: d.closeTime, d, dir: 'out' as const },
      ...(d.openTime >= since ? [{ key: `${d.id}-in`, time: d.openTime, d, dir: 'in' as const }] : []),
    ])
    .sort((x, y) => y.time - x.time);

  return (
    <div className="list">
      <div className="seg3 sticky">
        {(['positions', 'orders', 'deals'] as Seg[]).map((s) => (
          <button key={s} className={seg === s ? 'on' : ''} onClick={() => { setSeg(s); sfx.tap(); }}>{t(`h.${s}`)}</button>
        ))}
      </div>
      <div className="filters">
        <select value={period} onChange={(e) => setPeriod(e.target.value as Period)}>
          {(['today', 'week', 'month', 'all'] as Period[]).map((p) => <option key={p} value={p}>{t(`h.${p}`)}</option>)}
        </select>
        <select value={sym} onChange={(e) => setSym(e.target.value)}>
          <option value="">All symbols</option>
          {symbols.map((s) => <option key={s} value={s}>{SYMBOL_MAP[s].name}</option>)}
        </select>
      </div>
      <div className="stats card">
        <div><b className={pnlClass(profit)}>{compactMoney(profit)}</b><span>{t('t.profit')}</span></div>
        <div><b>{deals.length ? Math.round((wins / deals.length) * 100) : 0}%</b><span>Win rate</span></div>
        <div><b>{compactMoney(START_BALANCE)}</b><span>Deposit</span></div>
        <div><b>{compactMoney(a.balance)}</b><span>{t('t.balance')}</span></div>
      </div>

      {seg === 'positions' && (
        <>
          {!deals.length && <div className="empty"><b>{t('h.empty')}</b>Closed positions appear here.</div>}
          {deals.map((d) => {
            const def = SYMBOL_MAP[d.sym];
            const key = d.id + d.closeTime;
            const expanded = open === key;
            return (
              <div key={key} className="row">
                <div className="rowmain" onClick={() => { setOpen(expanded ? null : key); sfx.tap(); }}>
                  <div>
                    <div className="sym">
                      {def.name}, <span className={d.side === 1 ? 'buyc' : 'sellc'}>{d.side === 1 ? 'buy' : 'sell'} {d.lots.toFixed(2)}</span>
                      {d.reason !== 'manual' && <span className={`tag ${d.reason}`}>{d.reason === 'stopout' || d.reason === 'frozen' ? 'STOP-OUT' : d.reason.toUpperCase()}</span>}
                    </div>
                    <div className="sub">{fmtPrice(def, d.open)} → {fmtPrice(def, d.close)}</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div className={`pnl ${pnlClass(d.profit)}`}>{money(d.profit, true)}</div>
                    <div className="sub">{dt(d.closeTime).slice(-8)}</div>
                  </div>
                </div>
                <button className="showchart" onClick={() => onShowOnChart(d)}><Icon.chart /> {t('h.show')}</button>
                {expanded && (
                  <div className="rowx">
                    <div className="kv2">
                      <span>Position</span><b>#{ticketNo(d.id)}</b>
                      <span>Bought / sold</span><b>{d.side === 1 ? 'BUY' : 'SELL'} {d.lots.toFixed(2)} lot{d.lots === 1 ? '' : 's'} ({(d.lots * def.contract).toLocaleString()} {def.cls === 'fx' ? def.id.slice(0, 3) : 'units'})</b>
                      <span>Open time</span><b>{dt(d.openTime)}</b>
                      <span>Close time</span><b>{dt(d.closeTime)}</b>
                      <span>Open price</span><b>{fmtPrice(def, d.open)}</b>
                      <span>Close price</span><b>{fmtPrice(def, d.close)}</b>
                      <span>S/L · T/P</span><b>{d.sl === null ? '—' : fmtPrice(def, d.sl)} · {d.tp === null ? '—' : fmtPrice(def, d.tp)}</b>
                      <span>Duration</span><b>{dur(d.closeTime - d.openTime)}</b>
                      <span>Closed by</span><b>{d.reason === 'manual' ? 'Trader' : d.reason === 'tp' ? 'Take profit' : d.reason === 'sl' ? 'Stop loss' : 'Stop-out'}</b>
                    </div>
                    <div className="modrow">
                      <button onClick={() => onShowOnChart(d)}>{t('h.show')}</button>
                      <button onClick={() => onShare(d)}>{t('h.share')}</button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </>
      )}

      {seg === 'orders' && (
        <>
          {!orders.length && <div className="empty"><b>{t('h.empty')}</b>Every market and pending order is logged here.</div>}
          {orders.map((o) => {
            const def = SYMBOL_MAP[o.sym];
            return (
              <div key={o.id + o.doneAt + o.state} className="row">
                <div className="rowmain">
                  <div>
                    <div className="sym">{def.name}, <span className={o.kind.startsWith('buy') ? 'buyc' : 'sellc'}>{PENDING_LABEL[o.kind].toLowerCase()}</span></div>
                    <div className="sub">{o.lots.toFixed(2)} / {o.state === 'filled' ? o.lots.toFixed(2) : '0.00'} at {o.fillPrice !== undefined ? fmtPrice(def, o.fillPrice) : fmtPrice(def, o.price)}</div>
                    {o.note && <div className="sub">{o.note}</div>}
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <span className={`state ${o.state}`}>{o.state}</span>
                    <div className="sub">{dt(o.doneAt).slice(-8)}</div>
                  </div>
                </div>
              </div>
            );
          })}
        </>
      )}

      {seg === 'deals' && (
        <>
          {!flat.length && <div className="empty"><b>{t('h.empty')}</b></div>}
          {flat.map(({ key, d, dir, time }) => {
            const def = SYMBOL_MAP[d.sym];
            const side = dir === 'in' ? d.side : -d.side;
            return (
              <div key={key} className="row">
                <div className="rowmain" onClick={() => onShowOnChart(d)}>
                  <div>
                    <div className="sym">{def.name}, <span className={side === 1 ? 'buyc' : 'sellc'}>{side === 1 ? 'buy' : 'sell'}</span> <span className="tag">{dir}</span> {dir === 'out' && REASON[d.reason] && <span className="muted">{REASON[d.reason]}</span>}</div>
                    <div className="sub">{d.lots.toFixed(2)} at {fmtPrice(def, dir === 'in' ? d.open : d.close)} · {dt(time)}</div>
                  </div>
                  <div className={`pnl ${dir === 'out' ? pnlClass(d.profit) : 'muted'}`}>{dir === 'out' ? money(d.profit, true) : '0.00'}</div>
                </div>
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}

function dur(s: number): string {
  if (s < 60) return `${Math.round(s)}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  return `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h`;
}
