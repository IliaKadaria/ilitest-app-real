import { LOCKOUT_SECONDS, START_BALANCE } from '../game/account.ts';
import { useGame } from '../game/store.ts';
import { strSeed } from '../market/rng.ts';
import { countdown, money } from '../format.ts';
import { Icon } from './Icons.tsx';

/**
 * Full-screen "Private Banking · Credit Review" lockout. Covers the entire
 * app: no terminal, no trading, nothing behind it is reachable until the
 * review period has elapsed.
 */
export function Lockout({ now, busy, onReenter }: { now: number; busy: boolean; onReenter: () => void }) {
  const { account: a, profile } = useGame();
  const until = a.lockedUntil ?? now;
  const left = Math.max(0, until - now);
  const done = left <= 0;
  const elapsed = 1 - left / LOCKOUT_SECONDS;
  const liquidated = a.history.filter((d) => d.reason === 'stopout' && d.closeTime >= until - LOCKOUT_SECONDS - 1);
  const loss = liquidated.reduce((s, d) => s + d.profit, 0);
  const caseNo = `APX-${(strSeed(`${profile?.id}:${until}`) % 900000 + 100000).toString()}`;
  const local = (t: number) => new Date(t * 1000).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' });

  return (
    <div className="frozen" role="dialog" aria-modal="true" aria-labelledby="frozen-title">
      <div className="seal"><Icon.lock /></div>
      <div>
        <div className="eyebrow">Private Banking · Credit Review</div>
        <h1 id="frozen-title">{done ? 'Review complete' : 'Account frozen'}</h1>
      </div>
      <p>
        {done
          ? `Your file has been reviewed. A new credit line of ${money(START_BALANCE)} has been approved.`
          : 'Your trading account breached its risk limits and has been suspended pending a mandatory credit review. All positions were liquidated at market.'}
      </p>

      <div className="card timer">
        <span className="eyebrow">{done ? 'Ready' : 'Terminal access restored in'}</span>
        <b className="num">{countdown(left)}</b>
        <div className="ring"><div style={{ width: `${Math.min(100, elapsed * 100)}%` }} /></div>
      </div>

      <div className="card kv">
        <span>Case reference</span><b>{caseNo}</b>
        <span>Reason</span><b style={{ fontFamily: 'var(--sans)' }}>{a.lockReason ?? 'Risk limit breach'}</b>
        <span>Positions liquidated</span><b>{liquidated.length}</b>
        <span>Realized on liquidation</span><b className={loss < 0 ? 'down' : ''}>{money(loss, true)}</b>
        <span>Residual balance</span><b>{money(a.balance)}</b>
        <span>Review ends</span><b>{local(until)}</b>
      </div>

      <div className="card steps">
        <div className="step done"><i />Positions liquidated at market</div>
        <div className={`step ${elapsed > 0.02 ? 'done' : ''}`}><i />Risk file opened with Private Banking</div>
        <div className={`step ${elapsed > 0.5 ? 'done' : ''}`}><i />Credit committee review</div>
        <div className={`step ${done ? 'done' : ''}`}><i />New credit line of {money(START_BALANCE)} approved</div>
      </div>

      <button className="primary" disabled={!done || busy} onClick={onReenter}>
        {done ? (busy ? 'Opening account…' : 'Accept credit line and re-enter') : 'Terminal locked'}
      </button>
      <p className="fine" style={{ fontSize: 11, color: 'var(--dim)', textAlign: 'center' }}>Simulated account. No real funds are involved.</p>
    </div>
  );
}
