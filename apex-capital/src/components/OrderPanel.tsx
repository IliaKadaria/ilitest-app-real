import { useState } from 'react';
import { quote } from '../market/engine.ts';
import { SYMBOL_MAP, fmtPrice, pnlFor } from '../market/symbols.ts';
import { requiredMargin, type Side } from '../game/account.ts';
import { game } from '../game/store.ts';
import { money } from '../format.ts';
import { sfx } from '../sfx.ts';
import { Flash, useHold } from './Juice.tsx';

const LOT_PRESETS = [0.01, 0.02, 0.05, 0.1, 0.5, 1];

/** 0.01 steps below 0.1, 0.1 below 1, 1 below 10, then 5. */
export function stepLots(l: number, dir: 1 | -1): number {
  const probe = dir > 0 ? l : l - 1e-9;
  const step = probe < 0.1 ? 0.01 : probe < 1 ? 0.1 : probe < 10 ? 1 : 5;
  const next = Math.round((l + dir * step) / step) * step;
  return Math.min(100, Math.max(0.01, Math.round(next * 100) / 100));
}

export function OrderPanel({ sym, now }: { sym: string; now: number }) {
  const def = SYMBOL_MAP[sym];
  const q = quote(sym, now);
  const [lots, setLots] = useState(0.01);
  const [useSl, setUseSl] = useState(false);
  const [useTp, setUseTp] = useState(false);
  const [slMult, setSlMult] = useState(1);
  const [tpMult, setTpMult] = useState(1);
  const [flash, setFlash] = useState<Side | null>(null);
  const down = useHold(() => setLots((l) => stepLots(l, -1)));
  const up = useHold(() => setLots((l) => stepLots(l, 1)));

  const baseDist = def.base * def.vol1m;
  const slDist = baseDist * 5 * slMult;
  const tpDist = baseDist * 8 * tpMult;
  const margin = requiredMargin(sym, lots, q.ask);
  const eur = (dist: number) => Math.abs(pnlFor(def, dist, lots, q.mid));

  const fire = (side: Side) => {
    const entry = side === 1 ? q.ask : q.bid;
    const sl = useSl ? entry - side * slDist : null;
    const tp = useTp ? entry + side * tpDist : null;
    if (game.open(sym, side, lots, sl, tp)) {
      sfx.fill(side);
      setFlash(side);
      setTimeout(() => setFlash(null), 200);
    } else {
      sfx.bonk();
    }
  };

  const wide = q.spread > def.spread * 1.5;

  return (
    <div className="order glass">
      <div className="oneclick">
        <button className={`side sell ${flash === -1 ? 'flash' : ''}`} disabled={!q.open} onClick={() => fire(-1)}>
          <span className="lbl">SELL</span>
          <Flash value={q.bid} className="px">{fmtPrice(def, q.bid)}</Flash>
        </button>
        <div className="lots">
          <div className="lotrow">
            <button className="nudge" aria-label="Decrease volume" {...down}>−</button>
            <div className="lotval">{lots.toFixed(2)}</div>
            <button className="nudge" aria-label="Increase volume" {...up}>+</button>
          </div>
          <div className={`spread ${wide ? 'wide' : ''}`}>{q.open ? `spread ${fmtPrice(def, q.spread)}` : 'market closed'}</div>
        </div>
        <button className={`side buy ${flash === 1 ? 'flash' : ''}`} disabled={!q.open} onClick={() => fire(1)}>
          <span className="lbl">BUY</span>
          <Flash value={q.ask} className="px">{fmtPrice(def, q.ask)}</Flash>
        </button>
      </div>
      <div className="presets">
        {LOT_PRESETS.map((p) => (
          <button key={p} className={`chip ${lots === p ? 'on' : ''}`} onClick={() => { setLots(p); sfx.tap(); }}>{p.toFixed(2)}</button>
        ))}
      </div>
      <div className="risk">
        <div className={`riskbox ${useSl ? 'on' : ''}`}>
          <button className="toggle" onClick={() => { setUseSl(!useSl); sfx.tap(); }}>SL {useSl ? 'ON' : 'OFF'}</button>
          {useSl && (
            <>
              <button className="nudge sm" aria-label="Tighter stop" onClick={() => setSlMult(Math.max(0.2, slMult / 1.3))}>−</button>
              <span className="riskval down">−{money(eur(slDist))}</span>
              <button className="nudge sm" aria-label="Wider stop" onClick={() => setSlMult(Math.min(20, slMult * 1.3))}>+</button>
            </>
          )}
        </div>
        <div className={`riskbox ${useTp ? 'on' : ''}`}>
          <button className="toggle" onClick={() => { setUseTp(!useTp); sfx.tap(); }}>TP {useTp ? 'ON' : 'OFF'}</button>
          {useTp && (
            <>
              <button className="nudge sm" aria-label="Closer target" onClick={() => setTpMult(Math.max(0.2, tpMult / 1.3))}>−</button>
              <span className="riskval up">+{money(eur(tpDist))}</span>
              <button className="nudge sm" aria-label="Further target" onClick={() => setTpMult(Math.min(20, tpMult * 1.3))}>+</button>
            </>
          )}
        </div>
      </div>
      <div className="orderinfo">
        <span>margin {money(margin)}</span>
        <span>1:{def.leverage}</span>
        <span>≈{money(eur(baseDist))} / 1m</span>
      </div>
    </div>
  );
}
