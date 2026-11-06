import { useState } from 'react';
import { quote } from '../market/engine.ts';
import { SYMBOL_MAP, fmtPrice, pointOf } from '../market/symbols.ts';
import { MARGIN_CALL_LEVEL, PENDING_LABEL, positionProfit, ticketNo, type Metrics, type PendingOrder, type Position } from '../game/account.ts';
import { game, useGame } from '../game/store.ts';
import { clock, money, pnlClass } from '../format.ts';
import { useT } from '../i18n.ts';
import { sfx } from '../sfx.ts';
import { FloatPnl } from './Juice.tsx';
import { Stepper } from './OrderTicket.tsx';

export function AccountBlock({ m }: { m: Metrics }) {
  const t = useT();
  const mc = m.level !== null && m.level < MARGIN_CALL_LEVEL;
  return (
    <div className="acctblock">
      <div><span>{t('t.balance')}</span><b className="num">{money(m.balance)}</b></div>
      <div><span>{t('t.equity')}</span><b className={`num ${pnlClass(m.floating)}`}>{money(m.equity)}</b></div>
      <div><span>{t('t.margin')}</span><b className="num">{money(m.margin)}</b></div>
      <div><span>{t('t.free')}</span><b className="num">{money(m.free)}</b></div>
      <div><span>{t('t.level')}</span><b className={`num ${mc ? 'down' : ''}`}>{m.level === null ? '—' : m.level > 99999 ? '∞' : `${m.level.toFixed(2)}%`}</b></div>
    </div>
  );
}

export function TradeScreen({ now, m, onNewOrder, onChart }: { now: number; m: Metrics; onNewOrder: () => void; onChart: (sym: string) => void }) {
  const g = useGame();
  const t = useT();
  const [open, setOpen] = useState<string | null>(null);
  const [modPos, setModPos] = useState<Position | null>(null);
  const [modOrd, setModOrd] = useState<PendingOrder | null>(null);
  const ps = g.account.positions;
  const os = g.account.orders;
  const mc = m.level !== null && m.level < MARGIN_CALL_LEVEL;

  return (
    <div className="list">
      <div className={`pnlhero ${pnlClass(m.floating)}`}>
        <b className="num">{money(m.floating, true)}</b>
        <span>{ps.length ? `${ps.length} open position${ps.length === 1 ? '' : 's'}` : 'Flat'}</span>
      </div>
      <AccountBlock m={m} />
      {mc && <div className="mcbar">Margin call. Liquidation at 50% margin level triggers a five-hour account review.</div>}
      <div className="pad"><button className="primary" style={{ width: '100%' }} onClick={onNewOrder}>+ {t('t.new')}</button></div>

      <div className="section"><span className="eyebrow">{t('t.positions')}</span><span className="eyebrow">{ps.length}</span></div>
      {!ps.length && <div className="empty"><b>{t('t.noPos')}</b>{t('t.noPosSub')}</div>}
      {ps.length > 1 && (
        <div className="bulk">
          <button onClick={() => game.closeWhere((_, pnl) => pnl > 0)}>{t('t.closeWin')}</button>
          <button onClick={() => game.closeWhere((_, pnl) => pnl < 0)}>{t('t.closeLoss')}</button>
          <button onClick={() => game.closeWhere(() => true)}>{t('t.closeAll')}</button>
        </div>
      )}
      {ps.map((p) => {
        const def = SYMBOL_MAP[p.sym];
        const q = quote(p.sym, now);
        const pnl = positionProfit(p, q);
        const cur = p.side === 1 ? q.bid : q.ask;
        const expanded = open === p.id;
        return (
          <div key={p.id} className="row">
            <div className="rowmain" onClick={() => { setOpen(expanded ? null : p.id); sfx.tap(); }}>
              <div>
                <div className="sym">
                  {def.name}, <span className={p.side === 1 ? 'buyc' : 'sellc'}>{p.side === 1 ? 'buy' : 'sell'} {p.lots.toFixed(2)}</span>
                  {!q.open && <span className="tag">CLOSED</span>}
                </div>
                <div className="sub">{fmtPrice(def, p.open)} → {fmtPrice(def, cur)}</div>
              </div>
              <div className={`pnl ${pnlClass(pnl)}`}>
                {money(pnl, true)}
                <FloatPnl value={pnl} threshold={Math.max(0.05, Math.abs(pnl) * 0.02 + 0.02)} />
              </div>
            </div>
            {expanded && (
              <div className="rowx">
                <div className="kv2">
                  <span>Ticket</span><b>#{ticketNo(p.id)}</b>
                  <span>Opened</span><b>{new Date(p.openTime * 1000).toLocaleString([], { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })}</b>
                  <span>S/L</span><b className="down">{p.sl === null ? '—' : fmtPrice(def, p.sl)}</b>
                  <span>T/P</span><b className="up">{p.tp === null ? '—' : fmtPrice(def, p.tp)}</b>
                  <span>Swap</span><b>{money(0)}</b>
                </div>
                <div className="modrow">
                  <button onClick={() => setModPos(p)}>{t('t.modify')}</button>
                  <button onClick={() => onChart(p.sym)}>Chart</button>
                  <button className={`closebtn ${pnl >= 0 ? 'win' : 'loss'}`} onClick={() => game.close(p.id)}>{t('t.close')} · {money(pnl, true)}</button>
                </div>
              </div>
            )}
          </div>
        );
      })}

      <div className="section"><span className="eyebrow">{t('t.orders')}</span><span className="eyebrow">{os.length}</span></div>
      {!os.length && <div className="empty" style={{ paddingTop: 10 }}>No pending orders</div>}
      {os.map((o) => {
        const def = SYMBOL_MAP[o.sym];
        const q = quote(o.sym, now);
        const ref = o.type.startsWith('buy') ? q.ask : q.bid;
        const away = Math.round(Math.abs(ref - o.price) / pointOf(def));
        const expanded = open === o.id;
        return (
          <div key={o.id} className="row">
            <div className="rowmain" onClick={() => { setOpen(expanded ? null : o.id); sfx.tap(); }}>
              <div>
                <div className="sym">{def.name}, <span className={o.type.startsWith('buy') ? 'buyc' : 'sellc'}>{PENDING_LABEL[o.type].toLowerCase()} {o.lots.toFixed(2)}</span></div>
                <div className="sub">at {fmtPrice(def, o.price)}{o.stopLimit !== null ? ` → ${fmtPrice(def, o.stopLimit)}` : ''} · {away} pts away</div>
              </div>
              <div className="pnl muted" style={{ fontSize: 13 }}>{fmtPrice(def, ref)}</div>
            </div>
            {expanded && (
              <div className="rowx">
                <div className="kv2">
                  <span>Ticket</span><b>#{ticketNo(o.id)}</b>
                  <span>Placed</span><b>{clock(o.placedAt)}</b>
                  <span>S/L</span><b className="down">{o.sl === null ? '—' : fmtPrice(def, o.sl)}</b>
                  <span>T/P</span><b className="up">{o.tp === null ? '—' : fmtPrice(def, o.tp)}</b>
                  <span>Expiration</span><b>{o.expiresAt === null ? 'GTC' : new Date(o.expiresAt * 1000).toLocaleString([], { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</b>
                </div>
                <div className="modrow">
                  <button onClick={() => setModOrd(o)}>{t('t.modify')}</button>
                  <button onClick={() => onChart(o.sym)}>Chart</button>
                  <button className="closebtn loss" onClick={() => game.cancelOrder(o.id)}>{t('t.cancel')}</button>
                </div>
              </div>
            )}
          </div>
        );
      })}

      {modPos && <ModifyPosition p={modPos} now={now} onClose={() => setModPos(null)} />}
      {modOrd && <ModifyOrder o={modOrd} onClose={() => setModOrd(null)} />}
    </div>
  );
}

function ModifyPosition({ p, now, onClose }: { p: Position; now: number; onClose: () => void }) {
  const t = useT();
  const def = SYMBOL_MAP[p.sym];
  const live = game.account.positions.find((x) => x.id === p.id) ?? p;
  const [sl, setSl] = useState(live.sl === null ? '' : fmtPrice(def, live.sl));
  const [tp, setTp] = useState(live.tp === null ? '' : fmtPrice(def, live.tp));
  const q = quote(p.sym, now);
  const cur = p.side === 1 ? q.bid : q.ask;
  const pip = pointOf(def) * (def.digits === 3 || def.digits === 5 ? 10 : 1);
  const dist = def.base * def.vol1m * 6;
  const save = () => {
    if (game.modify(p.id, sl ? Number(sl) : null, tp ? Number(tp) : null)) {
      sfx.tap();
      onClose();
    } else sfx.bonk();
  };
  return (
    <div className="modal" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="grab" />
        <h3>Modify #{ticketNo(p.id)} · {def.name} {p.side === 1 ? 'buy' : 'sell'} {p.lots.toFixed(2)}</h3>
        <div className="ticketpx"><span className="num big">{fmtPrice(def, cur)}</span></div>
        <Stepper label={t('o.sl')} value={sl} onChange={setSl} step={pip} digits={def.digits} onActivate={() => fmtPrice(def, cur - p.side * dist)} />
        <Stepper label={t('o.tp')} value={tp} onChange={setTp} step={pip} digits={def.digits} onActivate={() => fmtPrice(def, cur + p.side * dist * 1.6)} />
        <div className="row2">
          <button onClick={() => setSl(fmtPrice(def, p.open))}>SL to breakeven</button>
          <button onClick={() => { setSl(''); setTp(''); }}>Clear both</button>
        </div>
        <button className="primary" onClick={save}>{t('t.modify')}</button>
      </div>
    </div>
  );
}

function ModifyOrder({ o, onClose }: { o: PendingOrder; onClose: () => void }) {
  const t = useT();
  const def = SYMBOL_MAP[o.sym];
  const [price, setPrice] = useState(fmtPrice(def, o.price));
  const [lim, setLim] = useState(o.stopLimit === null ? '' : fmtPrice(def, o.stopLimit));
  const [sl, setSl] = useState(o.sl === null ? '' : fmtPrice(def, o.sl));
  const [tp, setTp] = useState(o.tp === null ? '' : fmtPrice(def, o.tp));
  const pip = pointOf(def) * (def.digits === 3 || def.digits === 5 ? 10 : 1);
  const s = o.type.startsWith('buy') ? 1 : -1;
  const dist = def.base * def.vol1m * 6;
  const save = () => {
    if (game.modifyOrder(o.id, Number(price), lim ? Number(lim) : null, sl ? Number(sl) : null, tp ? Number(tp) : null)) {
      sfx.tap();
      onClose();
    } else sfx.bonk();
  };
  return (
    <div className="modal" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="grab" />
        <h3>Modify {PENDING_LABEL[o.type]} #{ticketNo(o.id)}</h3>
        <Stepper label={t('o.price')} value={price} onChange={setPrice} step={pip} digits={def.digits} />
        {o.stopLimit !== null && <Stepper label={t('o.stopLimit')} value={lim} onChange={setLim} step={pip} digits={def.digits} />}
        <Stepper label={t('o.sl')} value={sl} onChange={setSl} step={pip} digits={def.digits} onActivate={() => fmtPrice(def, Number(lim || price) - s * dist)} />
        <Stepper label={t('o.tp')} value={tp} onChange={setTp} step={pip} digits={def.digits} onActivate={() => fmtPrice(def, Number(lim || price) + s * dist * 1.6)} />
        <button className="primary" onClick={save}>{t('t.modify')}</button>
      </div>
    </div>
  );
}
