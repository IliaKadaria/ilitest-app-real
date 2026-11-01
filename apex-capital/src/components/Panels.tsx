import { SYMBOL_MAP } from '../market/symbols.ts';
import { useNet, type FeedItem } from '../online/net.ts';
import { ago, money, pnlClass } from '../format.ts';

// ------------------------------------------------------------------ Tape (live trades, Bloomberg-style)
export function Tape({ now }: { now: number }) {
  const n = useNet();
  const line = (f: FeedItem) => {
    switch (f.kind) {
      case 'open':
        return <>opened <b className={f.side === 1 ? 'buyc' : 'sellc'}>{f.side === 1 ? 'BUY' : 'SELL'} {f.lots.toFixed(2)}</b> {SYMBOL_MAP[f.sym]?.name ?? f.sym}</>;
      case 'close':
        return <>closed {SYMBOL_MAP[f.sym]?.name ?? f.sym} <b className={pnlClass(f.profit)}>{money(f.profit, true)}</b></>;
      case 'blown':
        return <>re-entered after review #{f.blownCount}</>;
      case 'frozen':
        return <>account frozen for review</>;
      case 'chat':
        return <>{f.text}</>;
    }
  };
  return (
    <div className="list">
      <div className="modebanner glass">
        <span>
          <b>Live tape</b> · {n.mode === 'online' && n.status === 'live' ? `${n.onlineCount()} online` : 'desk activity'} · desk traders are simulated
        </span>
      </div>
      {n.feed.filter((f) => f.kind !== 'chat').slice(0, 80).map((f) => (
        <div key={f.key} className="lb" style={{ gridTemplateColumns: 'minmax(0,1fr) auto' }}>
          <span className="who">
            <b style={{ fontWeight: 600 }}>{f.me ? 'You' : f.name}</b> <span className="muted">{line(f)}</span>
          </span>
          <span className="pos">{ago(now - f.at)}</span>
        </div>
      ))}
    </div>
  );
}

