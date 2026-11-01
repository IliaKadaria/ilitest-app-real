import { useState } from 'react';
import { quote } from '../market/engine.ts';
import { SYMBOL_MAP, fmtPrice } from '../market/symbols.ts';
import { positionProfit, type Deal, type Metrics } from '../game/account.ts';
import { DIVISIONS, divisionFor, divisionProgress, nextDivision } from '../game/tiers.ts';
import { game, useGame } from '../game/store.ts';
import { net, useNet, type FeedItem } from '../online/net.ts';
import { ago, clock, compactMoney, money, pnlClass } from '../format.ts';
import { sfx } from '../sfx.ts';
import { Badge } from './Badge.tsx';
import { FloatPnl } from './Juice.tsx';

// ------------------------------------------------------------------ Positions
export function Positions({ now, onPick }: { now: number; onPick: (sym: string) => void }) {
  const g = useGame();
  const [open, setOpen] = useState<string | null>(null);
  const ps = g.account.positions;
  if (!ps.length)
    return (
      <div className="empty">
        <b>No open positions</b>
        Select a side above to open a position at market.
      </div>
    );
  return (
    <div className="list">
      <div className="bulk">
        <button onClick={() => game.closeWhere((_, pnl) => pnl > 0)}>Close profitable</button>
        <button onClick={() => game.closeWhere((_, pnl) => pnl < 0)}>Close losing</button>
        <button onClick={() => game.closeWhere(() => true)}>Close all</button>
      </div>
      {ps.map((p) => {
        const def = SYMBOL_MAP[p.sym];
        const q = quote(p.sym, now);
        const pnl = positionProfit(p, q);
        const cur = p.side === 1 ? q.bid : q.ask;
        const step = def.base * def.vol1m * 2;
        const expanded = open === p.id;
        return (
          <div key={p.id} className="row">
            <div className="rowmain" onClick={() => { setOpen(expanded ? null : p.id); sfx.tap(); }}>
              <div>
                <div className="sym">
                  {def.name}
                  <span className={`side-tag ${p.side === 1 ? 'buyc' : 'sellc'}`}>{p.side === 1 ? 'BUY' : 'SELL'} {p.lots.toFixed(2)}</span>
                  {!q.open && <span className="tag">CLOSED</span>}
                </div>
                <div className="sub">
                  {fmtPrice(def, p.open)} → {fmtPrice(def, cur)}
                  {p.sl !== null && <span className="tag sl">SL {fmtPrice(def, p.sl)}</span>}
                  {p.tp !== null && <span className="tag tp">TP {fmtPrice(def, p.tp)}</span>}
                </div>
              </div>
              <div className={`pnl ${pnlClass(pnl)}`}>
                {money(pnl, true)}
                <FloatPnl value={pnl} threshold={Math.max(0.05, Math.abs(pnl) * 0.02 + 0.02)} />
              </div>
            </div>
            {expanded && (
              <div className="rowx">
                <div className="modrow">
                  <span>SL</span>
                  <button onClick={() => game.modify(p.id, (p.sl ?? cur - p.side * step * 2) - p.side * step, p.tp)}>−</button>
                  <button onClick={() => game.modify(p.id, (p.sl ?? cur - p.side * step * 2) + p.side * step, p.tp)}>+</button>
                  <button onClick={() => game.modify(p.id, p.open, p.tp)}>BE</button>
                  <button onClick={() => game.modify(p.id, null, p.tp)}>✕</button>
                </div>
                <div className="modrow">
                  <span>TP</span>
                  <button onClick={() => game.modify(p.id, p.sl, (p.tp ?? cur + p.side * step * 3) - p.side * step)}>−</button>
                  <button onClick={() => game.modify(p.id, p.sl, (p.tp ?? cur + p.side * step * 3) + p.side * step)}>+</button>
                  <button onClick={() => game.modify(p.id, p.sl, null)}>✕</button>
                </div>
                <div className="modrow">
                  <button onClick={() => onPick(p.sym)}>Chart</button>
                  <button className={`closebtn ${pnl >= 0 ? 'win' : 'loss'}`} onClick={() => game.close(p.id)}>
                    Close at {fmtPrice(def, cur)} · {money(pnl, true)}
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ------------------------------------------------------------------ History
export function History({ onStatement }: { onStatement: (d: Deal) => void }) {
  const { account: a } = useGame();
  const total = a.wins + a.losses;
  return (
    <div className="list">
      <div className="stats card">
        <div><b className={pnlClass(a.totalProfit)}>{compactMoney(a.totalProfit)}</b><span>Net P&amp;L</span></div>
        <div><b>{total ? Math.round((a.wins / total) * 100) : 0}%</b><span>Win rate</span></div>
        <div><b className="up">{compactMoney(a.bestTrade)}</b><span>Best</span></div>
        <div><b>{a.blownCount}</b><span>Reviews</span></div>
      </div>
      {!a.history.length && (
        <div className="empty">
          <b>No closed trades</b>
          Realized P&amp;L appears here once you close a position.
        </div>
      )}
      {a.history.map((d) => {
        const def = SYMBOL_MAP[d.sym];
        return (
          <div key={d.id + d.closeTime} className="row">
            <div className="rowmain" onClick={() => onStatement(d)}>
              <div>
                <div className="sym">
                  {def.name}
                  <span className={`side-tag ${d.side === 1 ? 'buyc' : 'sellc'}`}>{d.side === 1 ? 'BUY' : 'SELL'} {d.lots.toFixed(2)}</span>
                  {d.reason !== 'manual' && <span className={`tag ${d.reason}`}>{d.reason === 'stopout' ? 'STOP-OUT' : d.reason.toUpperCase()}</span>}
                </div>
                <div className="sub">{fmtPrice(def, d.open)} → {fmtPrice(def, d.close)} · {clock(d.closeTime)}</div>
              </div>
              <div className={`pnl ${pnlClass(d.profit)}`}>{money(d.profit, true)}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

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

// ------------------------------------------------------------------ Wealth
export function Wealth({ m }: { m: Metrics }) {
  const g = useGame();
  useNet();
  const bal = g.account.balance;
  const d = divisionFor(bal);
  const nx = nextDivision(bal);
  const pct = divisionProgress(bal) * 100;
  const me = { id: g.profile?.id ?? 'me', name: g.profile?.name ?? 'You', balance: bal, rank: d.label, npc: false };
  const board = net.leaderboard(me).slice(0, 50);
  return (
    <div className="list">
      <div className="tiercard card">
        <Badge d={d} size={76} />
        <div>
          <div className="eyebrow">{d.tier.name}</div>
          <h2>{d.label}</h2>
          <div className="muted" style={{ fontSize: 12.5 }}>Unlocked: {d.symbol}</div>
          <div className="bar"><div style={{ width: `${pct}%` }} /></div>
          <div className="sub">
            {nx ? <>{money(nx.min - bal)} to {nx.label}</> : 'Highest division reached'} · equity {money(m.equity)}
          </div>
        </div>
      </div>

      <div className="section"><span className="eyebrow">Divisions</span><span className="eyebrow">{d.idx + 1} / {DIVISIONS.length}</span></div>
      <div className="divgrid">
        {DIVISIONS.map((x) => (
          <div key={x.idx} className={`divcell ${x.idx === d.idx ? 'cur' : x.idx > d.idx ? 'locked' : ''}`} title={x.symbol}>
            <Badge d={x} size={38} />
            <b>{x.label}</b>
            <small>{compactMoney(x.min)}</small>
            <em>{x.symbol}</em>
          </div>
        ))}
      </div>

      <div className="section"><span className="eyebrow">Leaderboard</span><span className="eyebrow">by balance</span></div>
      {board.map((row, i) => {
        const rd = divisionFor(row.balance);
        return (
          <div key={row.id} className={`lb ${row.me ? 'me' : ''}`}>
            <span className="pos">{String(i + 1).padStart(2, '0')}</span>
            <Badge d={rd} size={26} />
            <span className="who">
              {row.me ? 'You' : row.name}
              <small>{rd.label}{row.npc ? ' · desk' : ''}</small>
            </span>
            <span className="bal">{compactMoney(row.balance)}</span>
          </div>
        );
      })}
    </div>
  );
}
