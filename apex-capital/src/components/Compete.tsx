import { useState } from 'react';
import { SYMBOL_MAP, fmtPrice } from '../market/symbols.ts';
import { DIVISIONS } from '../game/tiers.ts';
import { useGame } from '../game/store.ts';
import { useAuth } from '../online/auth.ts';
import { comps, useComps } from '../online/comps.ts';
import {
  COMP_DEFS,
  COMP_MODES,
  FUNDS,
  GRACE_SECONDS,
  LOAN_INTEREST,
  PUMP_SYMBOL,
  ROUND,
  STEAL_FINE,
  STEAL_ODDS,
  cluePrice,
  compQuote,
  eligible,
  fundScores,
  playState,
  prizePool,
  rouletteSwings,
  scoopEvents,
  standings,
  targetPlayers,
  whaleBacked,
  type CompMode,
  type Competition,
} from '../game/competitions.ts';
import { compactMoney, money, pnlClass } from '../format.ts';
import { sfx } from '../sfx.ts';
import { Badge } from './Badge.tsx';
import { CompChart } from './CompChart.tsx';

const ICON: Record<CompMode, string> = { whale: '🐋', roulette: '🎰', scoop: '🕵️', pump: '🚀' };
const clock = (sec: number) => {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export function CompeteView({ now, notify }: { now: number; notify: (title: string, body: string, tone: 'good' | 'bad' | 'info') => void }) {
  const cs = useComps();
  const [arena, setArena] = useState<string | null>(null);
  const active = arena ? cs.comp(arena) : null;
  if (active && cs.play(active.id)) return <Arena c={active} now={now} notify={notify} onBack={() => setArena(null)} />;
  return (
    <>
      <div className="comphero">
        <b>Competitions</b>
        <span>Pay a buy-in from your balance, then trade competition money. Your real positions are never at risk. Prizes land in your balance with a payout certificate in Mail.</span>
      </div>
      {cs.reason && <div className="hint" style={{ padding: '0 16px 8px', textAlign: 'left' }}>{cs.reason}</div>}
      {COMP_MODES.map((m) => <CompCard key={m} mode={m} now={now} notify={notify} onArena={setArena} />)}
    </>
  );
}

function CompCard({ mode, now, notify, onArena }: { mode: CompMode; now: number; notify: (t: string, b: string, tone: 'good' | 'bad' | 'info') => void; onArena: (id: string) => void }) {
  const cs = useComps();
  const g = useGame();
  const au = useAuth();
  const d = COMP_DEFS[mode];
  const [open, setOpen] = useState(false);
  const [team, setTeam] = useState(FUNDS[0].id);
  const [busy, setBusy] = useState(false);
  const cur = cs.current(mode);
  const joined = cur ? cs.play(cur.id) : null;
  const field = cur ? cs.field(cur) : [];
  const el = eligible(d, g.account.balance);
  const pool = prizePool(d, Math.max(field.length, 1));
  const isAdmin = !!au.state?.isAdmin;
  const lo = DIVISIONS[d.bracket[0]];
  const hi = DIVISIONS[d.bracket[1]];
  const practice = cs.list.find((c) => c.mode === mode && c.practice && cs.play(c.id) && !cs.play(c.id)!.paid);
  const run = async (fn: () => Promise<string | null>, ok: string) => {
    setBusy(true);
    const e = await fn();
    setBusy(false);
    if (e) {
      notify('Competition', e, 'bad');
      sfx.bonk();
    } else {
      notify('Competition', ok, 'good');
      sfx.cash();
    }
  };

  return (
    <div className={`compcard card ${mode}`}>
      <button className="comphead" onClick={() => setOpen(!open)}>
        <span className="compicon">{ICON[mode]}</span>
        <span className="qname">
          <b>{d.name}</b>
          <small>{d.tagline}</small>
        </span>
        <span className="chev">{open ? '−' : '+'}</span>
      </button>
      <div className="compmeta">
        <span className="bracket"><Badge d={lo} size={22} /> {lo.label} – {hi.label} <Badge d={hi} size={22} /></span>
        <span className="prizes">
          <b>🥇 {compactMoney(d.prizes[0])}</b>
          <b>🥈 {compactMoney(d.prizes[1])}</b>
          <b>🥉 {compactMoney(d.prizes[2])}</b>
        </span>
      </div>
      <div className="compstats">
        <div><span>Buy-in</span><b className="num">{compactMoney(d.buyIn)}</b></div>
        <div><span>Stack</span><b className="num">{compactMoney(d.stack)}</b></div>
        <div><span>Length</span><b className="num">{d.minutes} min</b></div>
        <div><span>Leverage</span><b className="num">{d.margin.maxLeverage}:1</b></div>
      </div>
      {open && (
        <ul className="comprules">
          {d.rules.map((r) => <li key={r}>{r}</li>)}
          <li>Needs at least {d.minPlayers} players to start. The pool is funded by buy-ins: it reaches the full prizes at {targetPlayers(d)} players and scales down below that, so a lone player can never take the whole pot.</li>
        </ul>
      )}
      <div className="compstatus">
        {!cur && <span className="muted">No event scheduled. An admin opens the next one.</span>}
        {cur?.status === 'open' && <span><i className="dotlive open" /> Registration open · {field.length} / {targetPlayers(d)} players · pool now 🥇 {compactMoney(pool[0])}</span>}
        {cur?.status === 'live' && cur.endsAt && <span><i className="dotlive" /> LIVE · {clock(cur.endsAt - now)} left · {field.length} players</span>}
      </div>
      {mode === 'whale' && cur?.status === 'open' && !joined && (
        <div className="fundpick">
          {FUNDS.map((f) => (
            <button key={f.id} className={team === f.id ? 'on' : ''} style={{ '--fund': f.color } as React.CSSProperties} onClick={() => setTeam(f.id)}>
              <i>{f.mono}</i>
              <span><b>{f.name}</b><small>{f.motto}</small></span>
            </button>
          ))}
        </div>
      )}
      <div className="compbtns">
        {cur && joined && <button className="primary" onClick={() => onArena(cur.id)}>{cur.status === 'live' ? 'Enter arena' : 'Joined · waiting for start'}</button>}
        {cur?.status === 'open' && !joined && (
          <button className="primary" disabled={busy || !el.ok} onClick={() => void run(() => comps.join(cur, mode === 'whale' ? team : undefined), `Joined ${d.name}. ${money(d.buyIn)} buy-in paid.`)}>
            Join · {money(d.buyIn)}
          </button>
        )}
        {practice ? (
          <button className="ghost" onClick={() => onArena(practice.id)}>Resume practice</button>
        ) : (
          <button className="ghost" onClick={() => { const c = comps.practice(mode, team); onArena(c.id); sfx.tap(); }}>Practice solo</button>
        )}
      </div>
      {cur?.status === 'open' && !joined && !el.ok && <div className="hint" style={{ textAlign: 'left' }}>{el.why}</div>}
      {isAdmin && (
        <div className="adminrow">
          <span className="eyebrow">Admin</span>
          {!cur && <button className="ghost sm" disabled={busy} onClick={() => void run(() => comps.create(mode), 'Registration opened.')}>Open registration</button>}
          {cur?.status === 'open' && (
            <button className="ghost sm" disabled={busy || field.length < d.minPlayers} title={field.length < d.minPlayers ? `Needs ${d.minPlayers} players` : ''} onClick={() => void run(() => comps.begin(cur.id), 'Competition started.')}>
              Start now {field.length < d.minPlayers ? `(${field.length}/${d.minPlayers})` : ''}
            </button>
          )}
          {cur && <button className="ghost sm danger" disabled={busy} onClick={() => void run(() => comps.cancel(cur.id), 'Cancelled. Buy-ins are refunded.')}>Cancel</button>}
        </div>
      )}
    </div>
  );
}

// ====================================================================== arena

function Arena({ c, now, notify, onBack }: { c: Competition; now: number; notify: (t: string, b: string, tone: 'good' | 'bad' | 'info') => void; onBack: () => void }) {
  const cs = useComps();
  const d = COMP_DEFS[c.mode];
  const play = cs.play(c.id)!;
  const [sym, setSym] = useState(d.basket[0]);
  const [lots, setLots] = useState(() => {
    // a sensible first ticket: about a quarter of the starting buying power
    const q0 = compQuote(c, d.basket[0], Date.now() / 1000);
    const per = SYMBOL_MAP[d.basket[0]].contract * q0.mid;
    const raw = (d.stack * d.margin.maxLeverage * 0.25) / (per || 1);
    return Math.max(0.01, raw >= 1 ? Math.floor(raw) : Math.floor(raw * 100) / 100);
  });
  const [lendTo, setLendTo] = useState<string | null>(null);
  const [lendAmt, setLendAmt] = useState('1000');
  const crowd = cs.crowd(c);
  const rules = cs.rules(c, play);
  const st = playState(c, play, now, rules, crowd);
  const s = st.snap;
  const def = SYMBOL_MAP[sym];
  const q = compQuote(c, sym, now, crowd);
  const g = useGame();
  const field = cs.field(c);
  const table = standings(c, field, field.length);
  const me = table.find((e) => e.playerId === g.profile?.id);
  const started = !!c.startsAt && now >= c.startsAt;
  const over = !!c.endsAt && now >= c.endsAt;
  const myNotes = cs.notes.filter((x) => x.compId === c.id).slice(0, 4);
  const step = c.mode === 'pump' ? 1 : def.contract >= 1000 ? 0.01 : 0.1;
  const fire = (side: 1 | -1) => {
    const e = comps.trade(c, sym, side, lots);
    if (e) {
      notify(d.name, e, 'bad');
      sfx.bonk();
    } else sfx.fill(side);
  };
  const pct = s.grossExposure > 0 ? Math.min(100, (s.totalEquity / s.grossExposure) * 100) : 100;

  return (
    <div className="arena">
      <div className="arenahead">
        <button className="iconbtn sm" onClick={onBack} aria-label="Back">‹</button>
        <span className="qname">
          <b>{ICON[c.mode]} {d.name}{c.practice ? ' · practice' : ''}</b>
          <small>{!started ? 'Waiting for the admin to start' : over ? 'Finished' : `${clock((c.endsAt ?? now) - now)} left`}</small>
        </span>
        <span className="arenascore">
          <b className={`num ${pnlClass(st.score - d.stack)}`}>{compactMoney(st.score)}</b>
          <small>#{me?.place ?? '—'} of {table.length}</small>
        </span>
      </div>

      {play.eliminatedAt && <div className="mcbar">Eliminated. Final equity {money(play.finalEquity ?? 0)}.</div>}
      {play.graceUntil && !play.eliminatedAt && <div className="mcbar pulse">MARGIN CALL · {clock(play.graceUntil - now)} to cover: close positions or borrow from a player.</div>}
      {over && <div className="done" style={{ margin: '8px 16px' }}>Finished. {play.paid ? (play.prize ? `You won ${money(play.prize)}. Certificate in Mail.` : 'No prize this time.') : 'Settling results…'}</div>}

      <div className="wgrid tight">
        <div className="card"><span>Cash</span><b className={`num ${s.cash < 0 ? 'down' : ''}`}>{compactMoney(s.cash)}</b></div>
        <div className="card"><span>Position value</span><b className="num">{compactMoney(s.positionValue)}</b></div>
        <div className="card"><span>Total equity</span><b className="num">{compactMoney(s.totalEquity)}</b></div>
        <div className="card"><span>Maint. {Math.round(rules.maintenancePct * 100)}%</span><b className="num">{compactMoney(s.maintenanceRequirement)}</b></div>
        <div className="card"><span>Used margin</span><b className="num">{compactMoney(s.usedMargin)}</b></div>
        <div className="card"><span>Buying power · {rules.maxLeverage}:1</span><b className="num">{compactMoney(s.buyingPower)}</b></div>
      </div>
      {s.grossExposure > 0 && (
        <div className="pad" style={{ paddingTop: 0 }}>
          <div className="mbar"><i style={{ width: `${pct}%` }} className={s.status} /><em style={{ left: `${rules.maintenancePct * 100}%` }} /></div>
        </div>
      )}

      <ModePanel c={c} now={now} notify={notify} onLend={setLendTo} />

      {d.basket.length > 1 && (
        <div className="chips pad" style={{ paddingBottom: 0 }}>
          {d.basket.map((x) => <button key={x} className={`chip ${x === sym ? 'on' : ''}`} onClick={() => setSym(x)}>{SYMBOL_MAP[x]?.name ?? x}</button>)}
        </div>
      )}
      <div className="card arenachart">
        <div className="arenapx"><b>{def.name}</b><span className="num">{fmtPrice(def, q.bid)}</span></div>
        <CompChart c={c} sym={sym} now={now} crowd={crowd} positions={play.positions} />
      </div>
      <div className="oneclick-bar" style={{ margin: '0 12px' }}>
        <button className="side sell" disabled={!started || over || !!play.eliminatedAt} onClick={() => fire(-1)}><span className="lbl">SELL</span><span className={`px num ${fmtPrice(def, q.bid).length > 10 ? 'long' : ''}`}>{fmtPrice(def, q.bid)}</span></button>
        <div className="lots">
          <button className="nudge sm" onClick={() => setLots((v) => Math.max(step, Math.round((v - step) * 100) / 100))}>−</button>
          <b className="num">{lots.toFixed(2)}</b>
          <button className="nudge sm" onClick={() => setLots((v) => Math.round((v + step) * 100) / 100)}>+</button>
        </div>
        <button className="side buy" disabled={!started || over || !!play.eliminatedAt} onClick={() => fire(1)}><span className="lbl">BUY</span><span className={`px num ${fmtPrice(def, q.ask).length > 10 ? 'long' : ''}`}>{fmtPrice(def, q.ask)}</span></button>
      </div>

      <div className="section"><span className="eyebrow">Positions · {play.positions.length}</span></div>
      {!play.positions.length && <div className="empty" style={{ padding: 12 }}>No open positions</div>}
      {play.positions.map((p) => {
        const h = s.holdings.find((x) => x.positionId === p.id);
        return (
          <div key={p.id} className="posrow">
            <span className="qname"><b className={p.side === 1 ? 'buyc' : 'sellc'}>{p.side === 1 ? 'BUY' : 'SELL'} {p.lots.toFixed(2)} {SYMBOL_MAP[p.sym]?.name}</b><small className="num">{fmtPrice(SYMBOL_MAP[p.sym], p.open)} → {fmtPrice(SYMBOL_MAP[p.sym], compQuote(c, p.sym, now, crowd)[p.side === 1 ? 'bid' : 'ask'])}</small></span>
            <b className={`num ${pnlClass(h?.unrealized ?? 0)}`}>{money(h?.unrealized ?? 0, true)}</b>
            <button className="ghost sm" disabled={over} onClick={() => { comps.close(c, p.id); sfx.tap(); }}>Close</button>
          </div>
        );
      })}

      {myNotes.length > 0 && (
        <div className="notes pad">
          {myNotes.map((n) => <div key={n.at + n.text} className="note">{n.text}</div>)}
        </div>
      )}

      <div className="section"><span className="eyebrow">Standings</span><span className="eyebrow">{c.practice ? 'practice · no prizes' : `pool 🥇 ${compactMoney(prizePool(d, table.length)[0])}`}</span></div>
      {table.map((e) => (
        <div key={e.playerId} className={`lb ${e.playerId === me?.playerId ? 'me' : ''}`}>
          <span className="pos">{e.place <= 3 ? ['🥇', '🥈', '🥉'][e.place - 1] : String(e.place).padStart(2, '0')}</span>
          <span className="who">{e.name}<small>{e.eliminated ? 'eliminated' : e.team ? FUNDS.find((f) => f.id === e.team)?.name : ''}</small></span>
          <span className="bal">{compactMoney(e.equity)}</span>
          {c.mode === 'roulette' && !c.practice && e.playerId !== me?.playerId && !e.eliminated && !over && <button className="ghost sm" onClick={() => setLendTo(e.playerId)}>Lend</button>}
        </div>
      ))}
      {c.practice && <div className="pad"><button className="ghost" style={{ width: '100%' }} onClick={() => { comps.abandonPractice(c.id); onBack(); }}>{over ? 'Close practice' : 'Quit practice'}</button></div>}

      {lendTo && (
        <div className="modal" onClick={() => setLendTo(null)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <div className="grab" />
            <h3>Lend to {field.find((f) => f.playerId === lendTo)?.name}</h3>
            <p className="muted" style={{ margin: 0 }}>They repay {Math.round(LOAN_INTEREST * 100)}% interest at the end, out of their final equity. You can lend up to half your equity.</p>
            <input className="num" inputMode="numeric" value={lendAmt} onChange={(e) => setLendAmt(e.target.value.replace(/\D/g, ''))} />
            <button className="primary" onClick={async () => { const e = await comps.lend(c, lendTo, Number(lendAmt)); notify(d.name, e ?? 'Loan sent.', e ? 'bad' : 'good'); if (!e) setLendTo(null); }}>Send loan</button>
          </div>
        </div>
      )}
    </div>
  );
}

function ModePanel({ c, now, notify, onLend }: { c: Competition; now: number; notify: (t: string, b: string, tone: 'good' | 'bad' | 'info') => void; onLend: (id: string) => void }) {
  const cs = useComps();
  const d = COMP_DEFS[c.mode];
  const play = cs.play(c.id)!;
  void onLend;
  if (!c.startsAt) return null;
  const el = now - c.startsAt;
  if (c.mode === 'whale') {
    const field = cs.field(c);
    const backed = whaleBacked(c, field, now, d.stack);
    const scores = fundScores(field, d.stack);
    const nextRound = c.startsAt + Math.ceil(Math.max(1, el) / ROUND) * ROUND;
    return (
      <div className="card modepanel">
        <div className="mp-head"><b>🐋 The Whale</b><small>next allocation in {clock(nextRound - now)}</small></div>
        <div className="funds">
          {FUNDS.map((f) => {
            const sc = scores.find((x) => x.fund === f.id)!;
            return (
              <div key={f.id} className={`fundrow ${backed === f.id ? 'backed' : ''} ${play.team === f.id ? 'mine' : ''}`} style={{ '--fund': f.color } as React.CSSProperties}>
                <i>{f.mono}</i>
                <span><b>{f.name}</b><small>{sc.members} trader{sc.members === 1 ? '' : 's'}{backed === f.id ? ' · 🐋 backed: 4:1' : ''}</small></span>
                <b className={`num ${pnlClass(sc.members ? sc.ret : 0)}`}>{sc.members ? `${(sc.ret * 100).toFixed(2)}%` : '—'}</b>
              </div>
            );
          })}
        </div>
      </div>
    );
  }
  if (c.mode === 'roulette') {
    const swings = rouletteSwings(c);
    const next = swings.find((x) => x.at > now);
    const past = swings.filter((x) => x.at <= now).slice(-3).reverse();
    return (
      <div className="card modepanel">
        <div className="mp-head"><b>🎰 The wheel</b><small>{next ? `next spin in ${clock(next.at - now)}` : 'no more spins'}</small></div>
        <div className="wheel">{d.basket.map((x) => <span key={x} className={next && next.at - now < 15 ? 'spin' : ''}>{SYMBOL_MAP[x]?.name}</span>)}</div>
        {past.map((x) => <div key={x.at} className="swing"><b>{SYMBOL_MAP[x.sym]?.name}</b><span className={x.move > 0 ? 'up' : 'down'}>{x.move > 0 ? '+' : ''}{(x.move * 100).toFixed(1)}%</span><small>{clock(now - x.at)} ago</small></div>)}
        <small className="muted">Margin call → {GRACE_SECONDS}s to cover. Borrowed {money(play.borrowed)} · lent {money(play.lent)}</small>
      </div>
    );
  }
  if (c.mode === 'scoop') {
    const events = scoopEvents(c);
    const next = events.find((e) => e.at > now);
    const past = events.filter((e) => e.at <= now).slice(-2).reverse();
    return (
      <div className="card modepanel">
        <div className="mp-head"><b>🕵️ The wire</b><small>{next ? `next event in ${clock(next.at - now)}` : 'all events public'}</small></div>
        {next?.clues.map((cl, j) => {
          const owned = play.clues.includes(cl.id);
          const unlocked = now >= cl.at;
          const tried = play.stealsTried.includes(cl.id);
          const price = cluePrice(cl, now);
          return (
            <div key={cl.id} className={`clue ${owned ? 'owned' : ''}`}>
              <span className="qname">
                <b>Clue {j + 1} · {['rumour', 'source', 'insider'][j]}</b>
                <small>{owned ? `“${cl.text}”` : unlocked ? `${['60%', '75%', '90%'][j]} reliable · ${money(price)}` : `leaks in ${clock(cl.at - now)}`}</small>
              </span>
              {owned ? (
                <button className="ghost sm" onClick={() => { const e = comps.sellClue(c, cl.id); notify(d.name, e ?? `Sold for ${money(Math.round(price * 0.5))}`, e ? 'bad' : 'good'); }}>Sell</button>
              ) : (
                unlocked && (
                  <span className="cluebtns">
                    <button className="ghost sm" onClick={() => { const e = comps.buyClue(c, cl.id); notify(d.name, e ?? 'Clue bought.', e ? 'bad' : 'good'); if (!e) sfx.cash(); }}>Buy</button>
                    <button className="ghost sm" disabled={tried} title={`${Math.round(STEAL_ODDS * 100)}% chance · fine ${money(d.stack * STEAL_FINE)}`} onClick={() => { const r = comps.stealClue(c, cl.id); notify(d.name, r.msg, r.ok ? 'good' : 'bad'); r.ok ? sfx.cash() : sfx.bonk(); }}>{tried ? 'Tried' : 'Steal'}</button>
                  </span>
                )
              )}
            </div>
          );
        })}
        {past.map((e) => <div key={e.id} className="swing"><b>{e.headline}</b><span className={e.move > 0 ? 'up' : 'down'}>{e.move > 0 ? '+' : ''}{(e.move * 100).toFixed(1)}%</span></div>)}
      </div>
    );
  }
  // pump
  const hypeLeft = c.startsAt + 15 * 60 - now;
  const q = compQuote(c, PUMP_SYMBOL, now, cs.crowd(c));
  return (
    <div className="card modepanel pumppanel">
      <div className="mp-head"><b>🚀 {PUMP_SYMBOL}</b><small>{hypeLeft > 0 ? `rug in ${clock(hypeLeft)}` : 'RUGGED'}</small></div>
      <div className="pumpbar"><i style={{ width: `${Math.max(0, Math.min(100, (el / (15 * 60)) * 100))}%` }} className={hypeLeft < 120 ? 'hot' : ''} /></div>
      <small className="muted num">€{q.mid.toFixed(13)} per token · crowd net {cs.crowd(c).toFixed(2)} lots · 1 lot = 1B tokens</small>
    </div>
  );
}
