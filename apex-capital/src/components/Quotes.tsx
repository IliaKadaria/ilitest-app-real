import { midPrice, quote } from '../market/engine.ts';
import { CLASS_LABEL, SYMBOLS, effectiveTime, fmtPrice, isOpen, nextOpen, type AssetClass } from '../market/symbols.ts';
import { hhmm, pnlClass } from '../format.ts';
import { Flash } from './Juice.tsx';

const ORDER: AssetClass[] = ['fx', 'metal', 'tech'];

function opensLabel(t: number): string {
  return new Date(t * 1000).toLocaleString([], { weekday: 'short' }) + ' ' + hhmm(t);
}

export function Quotes({ now, current, onPick }: { now: number; current: string; onPick: (sym: string) => void }) {
  return (
    <div className="list" style={{ paddingTop: 8 }}>
      {ORDER.map((cls) => {
        const syms = SYMBOLS.filter((s) => s.cls === cls);
        const open = isOpen(syms[0], now);
        return (
          <div key={cls} className="qgroup card">
            <div className="qhead">
              <span className="eyebrow">{CLASS_LABEL[cls]}</span>
              <span className={`sess ${open ? '' : 'closed'}`}>
                <i />
                {open ? 'Open' : `Closed · opens ${opensLabel(nextOpen(syms[0], now))}`}
              </span>
            </div>
            {syms.map((s) => {
              const q = quote(s.id, now);
              const ref = midPrice(s.id, effectiveTime(s, now) - 86400);
              const c = ((q.mid - ref) / ref) * 100;
              return (
                <button key={s.id} className={`qrow ${s.id === current ? 'on' : ''}`} onClick={() => onPick(s.id)}>
                  <span className="mono-badge">{s.mono}</span>
                  <span className="qname">
                    <b>{s.name}</b>
                    <small>{s.desc}</small>
                  </span>
                  <span className="qpx num">
                    <Flash value={q.bid}>{fmtPrice(s, q.bid)}</Flash>
                    <small>{fmtPrice(s, q.ask)}</small>
                  </span>
                  <span className={`chg ${pnlClass(c)}`}>{c >= 0 ? '+' : '−'}{Math.abs(c).toFixed(2)}%</span>
                </button>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
