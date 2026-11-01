import { useState } from 'react';
import { balanceCurve, MARGIN_CALL_LEVEL, START_BALANCE, type Metrics } from '../game/account.ts';
import { DIVISIONS, divisionFor, divisionProgress, nextDivision } from '../game/tiers.ts';
import { useGame } from '../game/store.ts';
import { net, useNet, type LeaderRow } from '../online/net.ts';
import { useComms } from '../online/comms.ts';
import { social, useSocial } from '../online/social.ts';
import { compactMoney, money, pnlClass } from '../format.ts';
import { useT } from '../i18n.ts';
import { sfx } from '../sfx.ts';
import { Avatar } from './Avatar.tsx';
import { Badge } from './Badge.tsx';

type Seg = 'rank' | 'board' | 'balance';
type Scope = 'world' | 'group' | 'friends';

export function WealthTab({ m, onProfile }: { m: Metrics; onProfile: (id: string) => void }) {
  const t = useT();
  const [seg, setSeg] = useState<Seg>('rank');
  return (
    <div className="list">
      <div className="seg3 sticky">
        {(['rank', 'board', 'balance'] as Seg[]).map((s) => (
          <button key={s} className={seg === s ? 'on' : ''} onClick={() => { setSeg(s); sfx.tap(); }}>{t(`w.${s}`)}</button>
        ))}
      </div>
      {seg === 'rank' && <RankView m={m} />}
      {seg === 'board' && <Board onProfile={onProfile} />}
      {seg === 'balance' && <BalanceView m={m} />}
    </div>
  );
}

function RankView({ m }: { m: Metrics }) {
  const g = useGame();
  const bal = g.account.balance;
  const d = divisionFor(bal);
  const nx = nextDivision(bal);
  const pct = divisionProgress(bal) * 100;
  return (
    <>
      <div className="tiercard card">
        <Badge d={d} size={84} />
        <div>
          <div className="eyebrow">You are here · {d.tier.name}</div>
          <h2>{d.label}</h2>
          <div className="muted" style={{ fontSize: 12.5 }}>Unlocked: {d.symbol}</div>
          <div className="bar"><div style={{ width: `${pct}%` }} /></div>
          <div className="sub">
            {nx ? <>{money(nx.min - bal)} to {nx.label}</> : 'Highest division reached'} · equity {money(m.equity)}
          </div>
        </div>
      </div>
      {nx && (
        <div className="nextcard card">
          <Badge d={nx} size={40} />
          <div><span className="eyebrow">Next</span><b>{nx.label}</b><small className="muted">at {compactMoney(nx.min)} · {nx.symbol}</small></div>
        </div>
      )}
      <div className="section"><span className="eyebrow">All divisions</span><span className="eyebrow">{d.idx + 1} / {DIVISIONS.length}</span></div>
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
    </>
  );
}

function Board({ onProfile }: { onProfile: (id: string) => void }) {
  const g = useGame();
  const t = useT();
  const n = useNet();
  const c = useComms();
  const s = useSocial();
  const [scope, setScope] = useState<Scope>('world');
  const myGroups = c.communities.filter((x) => c.membership(x.id) && !c.membership(x.id)?.banned);
  const [group, setGroup] = useState<string>(myGroups[0]?.id ?? '');
  const me: LeaderRow = { id: g.profile?.id ?? 'me', name: g.profile?.name ?? 'You', balance: g.account.balance, rank: '', npc: false };

  let rows: LeaderRow[];
  if (scope === 'world') rows = n.leaderboard(me);
  else {
    const ids = scope === 'friends' ? s.friends.filter((f) => f.status === 'friends').map((f) => f.id) : c.members.filter((x) => x.communityId === group && !x.banned && x.playerId !== 'house').map((x) => x.playerId);
    rows = [...new Set(ids)]
      .filter((id) => id !== me.id)
      .map((id) => social.card(id))
      .filter((x): x is NonNullable<typeof x> => !!x)
      .map((x) => ({ id: x.id, name: x.name, balance: x.balance, rank: '', npc: x.npc }));
    if (scope === 'friends' || ids.includes(me.id) || c.membership(group)) rows.push({ ...me, me: true });
    rows.sort((a, b) => b.balance - a.balance);
  }
  const myPos = rows.findIndex((r) => r.me);

  return (
    <>
      <div className="seg3">
        {(['world', 'group', 'friends'] as Scope[]).map((x) => (
          <button key={x} className={scope === x ? 'on' : ''} onClick={() => setScope(x)}>{t(`w.${x}`)}</button>
        ))}
      </div>
      {scope === 'group' && (
        myGroups.length ? (
          <div className="filters"><select value={group} onChange={(e) => setGroup(e.target.value)}>{myGroups.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></div>
        ) : (
          <div className="empty"><b>No group yet</b>Join a community in Chat to compete with its members.</div>
        )
      )}
      {scope === 'friends' && rows.length <= 1 && <div className="empty"><b>No friends yet</b>Add traders from Chat → search to race them here.</div>}
      {myPos >= 0 && (
        <div className="mypos card">
          <span className="eyebrow">Your position</span>
          <b className="num">#{myPos + 1}</b>
          <span className="muted">of {rows.length} · {compactMoney(me.balance)}</span>
        </div>
      )}
      {scope === 'world' && n.mode === 'online' && <div className="hint" style={{ padding: '0 16px 6px' }}>Real players active in the last 7 days.</div>}
      {rows.slice(0, 100).map((row, i) => {
        const rd = divisionFor(row.balance);
        const card = row.me ? null : social.card(row.id);
        return (
          <button key={row.id} className={`lb ${row.me ? 'me' : ''}`} onClick={() => !row.me && onProfile(row.id)}>
            <span className="pos">{i < 3 ? ['🥇', '🥈', '🥉'][i] : String(i + 1).padStart(2, '0')}</span>
            <Avatar name={row.me ? me.name : row.name} src={row.me ? g.profile?.avatar : card?.avatar} size={30} />
            <span className="who">
              {row.me ? 'You' : row.name}
              <small>{rd.label}{row.npc ? ' · desk' : ''}</small>
            </span>
            <span className="bal">{compactMoney(row.balance)}</span>
          </button>
        );
      })}
    </>
  );
}

function BalanceView({ m }: { m: Metrics }) {
  const g = useGame();
  const a = g.account;
  const total = a.wins + a.losses;
  const curve = balanceCurve(a);
  const mc = m.level !== null && m.level < MARGIN_CALL_LEVEL;
  const W = 340;
  const H = 120;
  const lo = Math.min(...curve.map((p) => p.balance), START_BALANCE);
  const hi = Math.max(...curve.map((p) => p.balance), START_BALANCE);
  const x = (i: number) => (i / Math.max(1, curve.length - 1)) * W;
  const y = (v: number) => H - 6 - ((v - lo) / (hi - lo || 1)) * (H - 12);
  const path = curve.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.balance).toFixed(1)}`).join(' ');
  const up = a.balance >= START_BALANCE;
  return (
    <>
      <div className="bighero">
        <span className="eyebrow">Equity</span>
        <b className="num">{money(m.equity)}</b>
        <span className={`num ${pnlClass(m.floating)}`}>{money(m.floating, true)} floating</span>
      </div>
      <div className="wgrid">
        <div className="card"><span>Balance</span><b className="num">{money(m.balance)}</b></div>
        <div className="card"><span>Equity</span><b className={`num ${pnlClass(m.floating)}`}>{money(m.equity)}</b></div>
        <div className="card"><span>Margin</span><b className="num">{money(m.margin)}</b></div>
        <div className="card"><span>Free margin</span><b className="num">{money(m.free)}</b></div>
        <div className="card"><span>Margin level</span><b className={`num ${mc ? 'down' : ''}`}>{m.level === null ? '—' : `${m.level.toFixed(0)}%`}</b></div>
        <div className="card"><span>Account</span><b className="num">#{a.login}</b></div>
      </div>
      <div className="section"><span className="eyebrow">Balance curve</span><span className="eyebrow">{curve.length - 1} deals</span></div>
      <div className="card curve">
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
          <line x1={0} x2={W} y1={y(START_BALANCE)} y2={y(START_BALANCE)} stroke="var(--hair-3)" strokeDasharray="3 4" />
          <path d={path} fill="none" stroke={up ? 'var(--up)' : 'var(--down)'} strokeWidth="2" vectorEffect="non-scaling-stroke" />
        </svg>
      </div>
      <div className="stats card">
        <div><b className={pnlClass(a.totalProfit)}>{compactMoney(a.totalProfit)}</b><span>Net P&amp;L</span></div>
        <div><b>{total ? Math.round((a.wins / total) * 100) : 0}%</b><span>Win rate</span></div>
        <div><b className="up">{compactMoney(a.bestTrade)}</b><span>Best</span></div>
        <div><b className="down">{compactMoney(a.worstTrade)}</b><span>Worst</span></div>
      </div>
      <div className="stats card">
        <div><b>{total}</b><span>Trades</span></div>
        <div><b>{compactMoney(a.peakBalance)}</b><span>Peak</span></div>
        <div><b>{a.peakBalance > 0 ? `${Math.max(0, ((a.peakBalance - a.balance) / a.peakBalance) * 100).toFixed(1)}%` : '0%'}</b><span>Drawdown</span></div>
        <div><b>{a.blownCount}</b><span>Reviews</span></div>
      </div>
      <div className="hint" style={{ padding: '4px 16px 16px' }}>{net.mode === 'online' ? 'Your balance syncs to the global leaderboard every few seconds.' : 'Offline mode: the leaderboard fills with real players once you play online.'}</div>
    </>
  );
}
