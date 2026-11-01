import { useEffect, useMemo, useRef, useState } from 'react';
import { pnlFor, quote } from '../market/engine.ts';
import { SYMBOLS, SYMBOL_MAP, fmtPrice, pointOf } from '../market/symbols.ts';
import { PENDING_LABEL, metrics, quotesFor, requiredMargin, validatePending, type PendingType, type Side } from '../game/account.ts';
import { game, useGame } from '../game/store.ts';
import { settings, useSettings } from '../game/settings.ts';
import { money } from '../format.ts';
import { useT } from '../i18n.ts';
import { sfx } from '../sfx.ts';
import { Flash, useHold } from './Juice.tsx';

type TicketType = 'market' | PendingType;
const TYPES: TicketType[] = ['market', 'buy_limit', 'sell_limit', 'buy_stop', 'sell_stop', 'buy_stop_limit', 'sell_stop_limit'];

/** 0.01 steps below 0.1, 0.1 below 1, 1 below 10, then 5. */
export function stepLots(l: number, dir: 1 | -1): number {
  const probe = dir > 0 ? l : l - 1e-9;
  const step = probe < 0.1 ? 0.01 : probe < 1 ? 0.1 : probe < 10 ? 1 : 5;
  const next = Math.round((l + dir * step) / step) * step;
  return Math.min(100, Math.max(0.01, Math.round(next * 100) / 100));
}
const clampLots = (v: number) => Math.min(100, Math.max(0.01, Math.round(v * 100) / 100));

/** MT5 stepper: − value + with press-and-hold. Empty value = not set. */
export function Stepper({ label, value, onChange, step, digits, placeholder, onActivate }: { label: string; value: string; onChange: (v: string) => void; step: number; digits: number; placeholder?: string; onActivate?: () => string }) {
  const nudge = (dir: 1 | -1) => {
    const cur = Number(value);
    if (!value || !Number.isFinite(cur)) {
      if (onActivate) onChange(onActivate());
      return;
    }
    onChange((cur + dir * step).toFixed(digits));
  };
  const down = useHold(() => nudge(-1));
  const up = useHold(() => nudge(1));
  return (
    <div className="stepper">
      <span className="lbl">{label}</span>
      <button className="nudge" aria-label={`Decrease ${label}`} {...down}>−</button>
      <input className="num" inputMode="decimal" value={value} placeholder={placeholder ?? 'not set'} onChange={(e) => onChange(e.target.value.replace(',', '.'))} />
      <button className="nudge" aria-label={`Increase ${label}`} {...up}>+</button>
      {value && onActivate && <button className="clear" aria-label={`Clear ${label}`} onClick={() => onChange('')}>✕</button>}
    </div>
  );
}

function TickChart({ sym, now }: { sym: string; now: number }) {
  const ticks = useRef<{ b: number; a: number }[]>([]);
  const lastSym = useRef(sym);
  if (lastSym.current !== sym) {
    ticks.current = [];
    lastSym.current = sym;
  }
  if (!ticks.current.length) for (let i = 80; i > 0; i--) { const q = quote(sym, now - i); ticks.current.push({ b: q.bid, a: q.ask }); }
  const q = quote(sym, now);
  const last = ticks.current[ticks.current.length - 1];
  if (!last || last.b !== q.bid) ticks.current = [...ticks.current.slice(-120), { b: q.bid, a: q.ask }];
  const pts = ticks.current;
  const lo = Math.min(...pts.map((p) => p.b));
  const hi = Math.max(...pts.map((p) => p.a));
  const W = 300;
  const H = 74;
  const x = (i: number) => (i / Math.max(1, pts.length - 1)) * W;
  const y = (v: number) => H - 4 - ((v - lo) / (hi - lo || 1)) * (H - 8);
  return (
    <svg className="tickchart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
      <polyline fill="none" stroke="var(--sell)" strokeWidth="1.2" points={pts.map((p, i) => `${x(i)},${y(p.b)}`).join(' ')} />
      <polyline fill="none" stroke="var(--buy)" strokeWidth="1.2" points={pts.map((p, i) => `${x(i)},${y(p.a)}`).join(' ')} />
    </svg>
  );
}

export function OrderTicket({ sym: initialSym, now, onClose, initialType = 'market' }: { sym: string; now: number; onClose: () => void; initialType?: TicketType }) {
  const t = useT();
  const st = useSettings();
  const g = useGame();
  const [sym, setSym] = useState(initialSym);
  const [type, setType] = useState<TicketType>(initialType);
  const [lots, setLots] = useState(st.quickLots);
  const [price, setPrice] = useState('');
  const [stopLimit, setStopLimit] = useState('');
  const [sl, setSl] = useState('');
  const [tp, setTp] = useState('');
  const [deviation, setDeviation] = useState(st.deviation);
  const [expiry, setExpiry] = useState<'gtc' | 'today' | 'specified'>('gtc');
  const [expAt, setExpAt] = useState(() => new Date(Date.now() + 86400_000 - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 16));
  const [done, setDone] = useState<string | null>(null);
  const def = SYMBOL_MAP[sym];
  const q = quote(sym, now);
  const pip = pointOf(def) * (def.digits === 3 || def.digits === 5 ? 10 : 1);
  const dist = def.base * def.vol1m * 6;
  const pending = type !== 'market';
  const side: Side = type === 'market' ? 1 : type.startsWith('buy') ? 1 : -1;

  // sensible defaults whenever the type / symbol changes
  useEffect(() => {
    if (type === 'market') return;
    const s = type.startsWith('buy') ? 1 : -1;
    const ref = s === 1 ? q.ask : q.bid;
    const limitLike = type.endsWith('_limit') && !type.endsWith('stop_limit');
    const trig = limitLike ? ref - s * dist : ref + s * dist;
    setPrice(fmtPrice(def, trig));
    setStopLimit(type.endsWith('stop_limit') ? fmtPrice(def, trig - s * dist * 0.4) : '');
    setSl('');
    setTp('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, sym]);

  const num = (v: string) => (v.trim() === '' ? null : Number(v));
  const nPrice = num(price);
  const nStopLimit = num(stopLimit);
  const nSl = num(sl);
  const nTp = num(tp);
  const entry = pending ? (nStopLimit ?? nPrice ?? q.mid) : side === 1 ? q.ask : q.bid;
  const m = metrics(g.account, quotesFor(g.account, now));
  const margin = requiredMargin(sym, lots, entry, now);
  const eur = (from: number, to: number | null, s: Side) => (to === null || !Number.isFinite(to) ? null : pnlFor(def, (to - from) * s, lots, now));
  const pendingErr = pending && nPrice !== null ? validatePending(type as PendingType, nPrice, nStopLimit, nSl, nTp, q) : null;

  const suggestSl = (s: Side) => () => fmtPrice(def, entryFor(s) - s * dist);
  const suggestTp = (s: Side) => () => fmtPrice(def, entryFor(s) + s * dist * 1.6);
  const entryFor = (s: Side) => (pending ? entry : s === 1 ? q.ask : q.bid);

  const ok = (msg: string) => {
    setDone(msg);
    settings.set({ quickLots: lots, deviation });
    window.setTimeout(onClose, 900);
  };
  const market = (s: Side) => {
    const expected = s === 1 ? q.ask : q.bid;
    if (game.open(sym, s, lots, nSl, nTp, { expected, deviation })) {
      sfx.fill(s);
      ok(`${s === 1 ? 'Buy' : 'Sell'} ${lots.toFixed(2)} ${def.name} at ${fmtPrice(def, expected)} done`);
    } else sfx.bonk();
  };
  const place = () => {
    if (nPrice === null) return;
    const exp = expiry === 'gtc' ? { mode: 'gtc' as const } : expiry === 'today' ? { mode: 'today' as const } : { mode: 'specified' as const, at: new Date(expAt).getTime() / 1000 };
    if (game.placeOrder(sym, type as PendingType, lots, nPrice, nStopLimit, nSl, nTp, exp)) {
      sfx.tap();
      ok(`${PENDING_LABEL[type as PendingType]} ${lots.toFixed(2)} ${def.name} at ${price} placed`);
    } else sfx.bonk();
  };

  const lotDown = useHold(() => setLots((l) => stepLots(l, -1)));
  const lotUp = useHold(() => setLots((l) => stepLots(l, 1)));
  const sorted = useMemo(() => SYMBOLS.map((s) => s.id), []);

  const slSide: Side = pending ? side : 1;
  const lossAtSl = pending ? eur(entry, nSl, side) : null;
  const winAtTp = pending ? eur(entry, nTp, side) : null;

  return (
    <div className="modal full" onClick={onClose}>
      <div className="sheet ticket" onClick={(e) => e.stopPropagation()}>
        <div className="tickethdr">
          <button className="ghost sm" onClick={onClose}>{t('x.cancel')}</button>
          <select className="symselect" value={sym} onChange={(e) => setSym(e.target.value)}>
            {sorted.map((id) => <option key={id} value={id}>{SYMBOL_MAP[id].name}</option>)}
          </select>
          <span className="muted" style={{ fontSize: 11 }}>{def.desc}</span>
        </div>

        <label className="field">
          <span>{t('o.type')}</span>
          <select value={type} onChange={(e) => setType(e.target.value as TicketType)}>
            {TYPES.map((k) => <option key={k} value={k}>{k === 'market' ? t('o.market') : PENDING_LABEL[k]}</option>)}
          </select>
        </label>

        <div className="lotstep">
          <button onClick={() => setLots((l) => clampLots(l - 0.1))}>−0.1</button>
          <button onClick={() => setLots((l) => clampLots(l - 0.01))}>−0.01</button>
          <button className="nudge" aria-label="Decrease volume" {...lotDown}>−</button>
          <div className="lotval"><b className="num">{lots.toFixed(2)}</b><small>{t('o.volume')}</small></div>
          <button className="nudge" aria-label="Increase volume" {...lotUp}>+</button>
          <button onClick={() => setLots((l) => clampLots(l + 0.01))}>+0.01</button>
          <button onClick={() => setLots((l) => clampLots(l + 0.1))}>+0.1</button>
        </div>

        {pending && <Stepper label={type.endsWith('stop_limit') ? 'Stop price' : t('o.price')} value={price} onChange={setPrice} step={pip} digits={def.digits} />}
        {pending && type.endsWith('stop_limit') && <Stepper label={t('o.stopLimit')} value={stopLimit} onChange={setStopLimit} step={pip} digits={def.digits} />}
        <Stepper label={t('o.sl')} value={sl} onChange={setSl} step={pip} digits={def.digits} onActivate={suggestSl(slSide)} />
        <Stepper label={t('o.tp')} value={tp} onChange={setTp} step={pip} digits={def.digits} onActivate={suggestTp(slSide)} />

        {pending ? (
          <label className="field">
            <span>{t('o.expiration')}</span>
            <select value={expiry} onChange={(e) => setExpiry(e.target.value as typeof expiry)}>
              <option value="gtc">{t('o.gtc')}</option>
              <option value="today">{t('o.today')}</option>
              <option value="specified">{t('o.specified')}</option>
            </select>
          </label>
        ) : (
          <div className="row2">
            <label className="field">
              <span>{t('o.deviation')}</span>
              <input className="num" inputMode="numeric" value={deviation} onChange={(e) => setDeviation(Math.max(0, Math.min(10000, Number(e.target.value.replace(/\D/g, '')) || 0)))} />
            </label>
            <label className="field">
              <span>{t('o.fill')}</span>
              <select defaultValue="fok"><option value="fok">Fill or Kill</option><option value="ioc">Immediate or Cancel</option></select>
            </label>
          </div>
        )}
        {pending && expiry === 'specified' && <input type="datetime-local" value={expAt} onChange={(e) => setExpAt(e.target.value)} />}

        <div className="ticketpx">
          <Flash value={q.bid} className="num sellc big">{fmtPrice(def, q.bid)}</Flash>
          <Flash value={q.ask} className="num buyc big">{fmtPrice(def, q.ask)}</Flash>
        </div>
        <TickChart sym={sym} now={now} />

        <div className="ticketinfo num">
          <span>Margin {money(margin)}</span>
          <span>Free {money(m.free)}</span>
          <span>1:{def.leverage}</span>
        </div>
        {pending ? (
          (lossAtSl !== null || winAtTp !== null) && (
            <div className="ticketinfo num">
              {lossAtSl !== null && <span className="down">SL {money(lossAtSl, true)}</span>}
              {winAtTp !== null && <span className="up">TP {money(winAtTp, true)}</span>}
            </div>
          )
        ) : (
          (nSl !== null || nTp !== null) && (
            <div className="ticketinfo num">
              {nSl !== null && <span>SL: buy {money(eur(q.ask, nSl, 1) ?? 0, true)} · sell {money(eur(q.bid, nSl, -1) ?? 0, true)}</span>}
              {nTp !== null && <span>TP: buy {money(eur(q.ask, nTp, 1) ?? 0, true)} · sell {money(eur(q.bid, nTp, -1) ?? 0, true)}</span>}
            </div>
          )
        )}
        {pendingErr && <div className="warnline">{pendingErr}</div>}
        {!q.open && <div className="warnline">Market closed</div>}

        {done ? (
          <div className="done">{done}</div>
        ) : pending ? (
          <button className="primary" disabled={!q.open || !!pendingErr || nPrice === null} onClick={place}>{t('o.place')}</button>
        ) : (
          <div className="row2">
            <button className="bigside sell" disabled={!q.open} onClick={() => market(-1)}>{t('o.sell')}</button>
            <button className="bigside buy" disabled={!q.open} onClick={() => market(1)}>{t('o.buy')}</button>
          </div>
        )}
        <p className="fine">Attention! Simulated execution. Trades on market-execution use the current Bid/Ask; SL and TP must sit beyond the market.</p>
      </div>
    </div>
  );
}
