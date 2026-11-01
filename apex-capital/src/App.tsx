import { useEffect, useMemo, useRef, useState } from 'react';
import { Chart } from './components/Chart.tsx';
import { OrderPanel } from './components/OrderPanel.tsx';
import { History, Positions, Wealth } from './components/Panels.tsx';
import { Quotes } from './components/Quotes.tsx';
import { Communities } from './components/Chat.tsx';
import { Lockout } from './components/Lockout.tsx';
import { FlexCard } from './components/FlexCard.tsx';
import { Badge } from './components/Badge.tsx';
import { Icon } from './components/Icons.tsx';
import { Flash, FloatPnl, ScreenFx, type FxKind } from './components/Juice.tsx';
import { TIMEFRAMES, midPrice, recentNews, upcomingNews } from './market/engine.ts';
import { SYMBOL_MAP, effectiveTime, fmtPrice, nextOpen } from './market/symbols.ts';
import { MARGIN_CALL_LEVEL, START_BALANCE, metrics, quotesFor, type Deal, type Metrics } from './game/account.ts';
import { divisionFor } from './game/tiers.ts';
import { game, useGame } from './game/store.ts';
import { net, useNet, type Snapshot } from './online/net.ts';
import { comms, useComms } from './online/comms.ts';
import { isMuted, setMuted, sfx } from './sfx.ts';
import { hhmm, money, pnlClass } from './format.ts';

type Tab = 'quotes' | 'trade' | 'chat' | 'wealth' | 'history';
interface Toast {
  id: number;
  title: string;
  body: string;
  tone: 'good' | 'bad' | 'news' | 'info';
}

function useNow(ms: number) {
  const [now, setNow] = useState(() => Date.now() / 1000);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now() / 1000), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

function snapshotOf(m: Metrics): Snapshot | null {
  const p = game.profile;
  if (!p) return null;
  const a = game.account;
  return { id: p.id, secret: p.secret, name: p.name, equity: m.equity, balance: a.balance, rank: divisionFor(a.balance).label, blownCount: a.blownCount, totalProfit: a.totalProfit, bestTrade: a.bestTrade, wins: a.wins, losses: a.losses };
}
const currentMetrics = (): Metrics => metrics(game.account, quotesFor(game.account, Date.now() / 1000));
const withTimeout = <T,>(p: Promise<T>, ms: number, fallback: T) => Promise.race([p, new Promise<T>((r) => setTimeout(() => r(fallback), ms))]);

export default function App() {
  const g = useGame();
  useNet();
  const c = useComms();
  const now = useNow(250);
  const [sym, setSym] = useState('ATX100');
  const [tf, setTf] = useState(60);
  const [tab, setTab] = useState<Tab>('trade');
  const [statement, setStatement] = useState<Deal | null>(null);
  const [reentering, setReentering] = useState(false);
  const [muted, setMutedState] = useState(isMuted());
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [fx, setFx] = useState<{ kind: FxKind; n: number } | null>(null);
  const [alias, setAlias] = useState('');
  const seenNews = useRef<Set<number>>(new Set(recentNews(Date.now() / 1000, 3600).map((e) => e.id)));
  const lastCountdown = useRef(0);
  const wasMarginCall = useRef(false);

  const notify = (title: string, body: string, tone: Toast['tone'] = 'info') => {
    const id = Math.random();
    setToasts((t) => [{ id, title, body, tone }, ...t].slice(0, 2));
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === 'news' ? 5500 : tone === 'good' ? 2600 : 3800);
  };
  const glow = (kind: FxKind) => setFx((f) => ({ kind, n: (f?.n ?? 0) + 1 }));
  const pushSnapshot = (force: boolean) => {
    const s = snapshotOf(currentMetrics());
    if (s) net.update(s, force);
  };

  // game events → sound, glow, toasts, tape, server
  useEffect(
    () =>
      game.onEvent((e) => {
        if (e.type === 'error' && !game.underReview()) notify('Order rejected', e.msg, 'bad');
        if (e.type === 'open') net.publish({ kind: 'open', sym: e.pos.sym, side: e.pos.side, lots: e.pos.lots });
        if (e.type === 'close' || e.type === 'stopout') {
          const d = e.deal;
          net.publish({ kind: 'close', sym: d.sym, side: d.side, lots: d.lots, profit: d.profit });
          pushSnapshot(true);
          if (e.type === 'close') {
            const title = d.reason === 'tp' ? 'Take profit filled' : d.reason === 'sl' ? 'Stop loss filled' : 'Position closed';
            notify(title, `${SYMBOL_MAP[d.sym].name} ${d.side === 1 ? 'BUY' : 'SELL'} ${d.lots.toFixed(2)} · ${money(d.profit, true)}`, d.profit >= 0 ? 'good' : 'bad');
            if (d.profit >= 25) {
              sfx.jackpot();
              glow('win');
              setTimeout(() => setStatement(d), 700);
            } else if (d.profit > 0) {
              sfx.cash();
              glow('win');
            } else {
              sfx.bonk();
              if (d.profit < -10) glow('loss');
            }
          }
        }
        if (e.type === 'frozen') {
          setToasts([]);
          sfx.vault();
          void net.lockAccount();
          pushSnapshot(true);
        }
      }),
    [], // eslint-disable-line react-hooks/exhaustive-deps
  );

  // online layers once the profile exists
  useEffect(() => {
    const s = snapshotOf(currentMetrics());
    if (!s || !g.profile) return;
    net.start(s);
    void comms.start({ id: g.profile.id, secret: g.profile.secret, name: g.profile.name });
  }, [g.profile]);

  // persist immediately when backgrounded
  useEffect(() => {
    const save = () => game.flush();
    const vis = () => document.visibilityState === 'hidden' && game.flush();
    window.addEventListener('pagehide', save);
    document.addEventListener('visibilitychange', vis);
    return () => {
      window.removeEventListener('pagehide', save);
      document.removeEventListener('visibilitychange', vis);
    };
  }, []);

  const quotes = useMemo(() => quotesFor(g.account, now, [sym]), [g.account, now, sym]);
  const m = metrics(g.account, quotes);
  const upcoming = upcomingNews(now);
  const marginCall = m.level !== null && m.level < MARGIN_CALL_LEVEL;
  const frozen = g.underReview();

  // 4 Hz loop
  useEffect(() => {
    game.tick();
    net.tickNpc(now);
    for (const ev of recentNews(now, 10)) {
      if (seenNews.current.has(ev.id)) continue;
      seenNews.current.add(ev.id);
      if (frozen) continue;
      const title = ev.kind === 'macro' ? 'Economic release' : ev.kind === 'shock' ? 'Market alert' : `Wire · ${SYMBOL_MAP[ev.symbol ?? '']?.name ?? ''}`;
      notify(title, ev.headline, 'news');
      if (ev.kind === 'macro' || ev.kind === 'shock') {
        sfx.alarm();
        glow('news');
      } else sfx.newsPing();
    }
    const macro = upcoming.find((e) => e.kind === 'macro');
    if (macro && !frozen) {
      const left = Math.ceil(macro.t0 - now);
      if (left <= 10 && left > 0 && left !== lastCountdown.current) {
        lastCountdown.current = left;
        sfx.tick(left <= 3);
      }
    }
    if (marginCall && !wasMarginCall.current) {
      sfx.marginCall();
      notify('Margin call', `Margin level ${m.level?.toFixed(0)}%. Positions are liquidated at 50%.`, 'bad');
    }
    wasMarginCall.current = marginCall;
    if (Math.floor(now * 4) % 4 === 0) pushSnapshot(false);
  }, [now]); // eslint-disable-line react-hooks/exhaustive-deps

  const reenter = async () => {
    setReentering(true);
    const serverCount = await withTimeout(net.resetAccount(), 4000, null);
    if (game.completeReview(serverCount)) {
      net.publishBlown(game.account.blownCount);
      pushSnapshot(true);
      sfx.cash();
      notify('Credit line approved', `${money(START_BALANCE)} is available to trade.`, 'good');
      setTab('trade');
    }
    setReentering(false);
  };

  const pick = (s: string) => {
    setSym(s);
    setTab('trade');
    sfx.tap();
  };
  const go = (t: Tab) => {
    setTab(t);
    sfx.tap();
  };

  // ---------------------------------------------------------------- onboarding
  if (!g.profile) {
    const ok = /^[A-Za-z0-9_.-]{2,18}$/.test(alias);
    return (
      <div className="app">
        <div className="onboard">
          <div className="wordmark">APEX CAPITAL</div>
          <h1>Your private trading account is ready.</h1>
          <p>Opening balance {money(START_BALANCE)}. Grow it through seven tiers, from Bronze to Quant. Breach your risk limits and the account is frozen for a five-hour credit review.</p>
          <label className="eyebrow" htmlFor="alias">Account alias</label>
          <input id="alias" value={alias} maxLength={18} autoComplete="off" placeholder="e.g. JLaurent" onChange={(e) => setAlias(e.target.value.replace(/[^\w.-]/g, ''))} />
          <button className="primary" disabled={!ok} onClick={() => { game.setProfile(alias); sfx.cash(); }}>Open account</button>
          <p className="fine">Simulated markets and funds. Not investment advice.</p>
        </div>
      </div>
    );
  }

  const def = SYMBOL_MAP[sym];
  const q = quotes[sym];
  const ref = midPrice(sym, effectiveTime(def, now) - 86400);
  const chg = ((q.mid - ref) / ref) * 100;
  const news = recentNews(now, 1800);
  const div = divisionFor(g.account.balance);
  const macro = upcoming.find((e) => e.kind === 'macro');
  const chatUnread = c.communities.reduce((s, x) => s + (c.membership(x.id) ? c.unread(x.id) : 0), 0);

  return (
    <div className="app">
      <header className="hdr">
        <Badge d={div} size={34} />
        <div className="brand">
          <span className="wordmark">APEX</span>
          <span className="divline">{div.label} · {g.profile.name}</span>
        </div>
        <div className="eq">
          <b className="num">
            {money(m.equity)}
            {g.account.positions.length > 0 && <FloatPnl value={m.equity} threshold={Math.max(0.05, Math.abs(m.equity) * 0.0008)} />}
          </b>
          <span className="num">{g.account.positions.length ? <span className={pnlClass(m.floating)}>{money(m.floating, true)} open</span> : `Balance ${money(m.balance)}`}</span>
        </div>
        <button className="iconbtn" aria-label={muted ? 'Unmute' : 'Mute'} onClick={() => { setMuted(!muted); setMutedState(!muted); }}>
          {muted ? <Icon.mute /> : <Icon.sound />}
        </button>
      </header>

      <div className="tabbody">
        {tab === 'quotes' && <Quotes now={now} current={sym} onPick={pick} />}

        {/* trade tab: chart stays mounted to keep its state */}
        <div style={tab === 'trade' ? undefined : { display: 'none' }}>
          <div className="symhdr">
            <span className="mono-badge">{def.mono}</span>
            <span className="qname">
              <b>{def.name}</b>
              <small>{def.desc}</small>
            </span>
            <span className="px">
              <Flash value={q.bid} className="num" arrow>
                <b>{fmtPrice(def, q.bid)}</b>
              </Flash>
              <small className={`num ${pnlClass(chg)}`}>{chg >= 0 ? '+' : '−'}{Math.abs(chg).toFixed(2)}%</small>
            </span>
          </div>
          <div className="ticker">
            {macro ? (
              <>
                <span className="tag sched">SCHEDULED</span>
                <span className="txt">{macro.teaser}</span>
                <span className="cd">{Math.ceil(macro.t0 - now)}s</span>
              </>
            ) : upcoming[0] ? (
              <>
                <span className="tag">DESK</span>
                <span className="txt">{upcoming[0].teaser}</span>
              </>
            ) : news[0] ? (
              <>
                <span className={`tag ${now - news[0].t0 < 90 ? 'live' : ''}`}>{now - news[0].t0 < 90 ? 'LIVE' : hhmm(news[0].t0)}</span>
                <span className="txt">{news[0].headline}</span>
              </>
            ) : (
              <>
                <span className="tag">WIRE</span>
                <span className="txt">No market-moving headlines.</span>
              </>
            )}
          </div>
          <div className="chartwrap">
            <div className="tfbar">
              {TIMEFRAMES.map((t) => (
                <button key={t.id} className={tf === t.sec ? 'on' : ''} onClick={() => { setTf(t.sec); sfx.tap(); }}>{t.id}</button>
              ))}
              {!q.open && <span className="closed">Closed · opens {new Date(nextOpen(def, now) * 1000).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })}</span>}
            </div>
            <Chart sym={sym} tfSec={tf} now={now} positions={g.account.positions} showEma />
          </div>
          <div className="acct">
            <div><span>Balance</span><b>{money(m.balance)}</b></div>
            <div><span>Equity</span><b className={pnlClass(m.floating)}>{money(m.equity)}</b></div>
            <div><span>Free</span><b>{money(m.free)}</b></div>
            <div><span>Level</span><b className={marginCall ? 'down' : ''}>{m.level === null ? '—' : m.level > 99999 ? '∞' : `${m.level.toFixed(0)}%`}</b></div>
          </div>
          {marginCall && <div className="mcbar">Margin call. Liquidation at 50% margin level triggers a five-hour account review.</div>}
          <OrderPanel sym={sym} now={now} />
          <Positions now={now} onPick={pick} />
        </div>

        {tab === 'chat' && <Communities now={now} notify={notify} onOpenSymbol={pick} />}
        {tab === 'wealth' && <Wealth m={m} />}
        {tab === 'history' && <History onStatement={setStatement} />}
      </div>

      <nav className="tabs">
        {([
          ['quotes', 'Quotes', Icon.quotes],
          ['trade', 'Trade', Icon.trade],
          ['chat', 'Chat', Icon.chat],
          ['wealth', 'Wealth', Icon.wealth],
          ['history', 'History', Icon.history],
        ] as const).map(([id, label, I]) => (
          <button key={id} className={tab === id ? 'on' : ''} onClick={() => go(id)}>
            <I />
            {label}
            {id === 'chat' && chatUnread > 0 && <span className="dot">{chatUnread > 99 ? '99+' : chatUnread}</span>}
          </button>
        ))}
      </nav>

      <ScreenFx fx={fx} />
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.tone}`}>
            <i />
            <div>
              <b>{t.title}</b>
              <span>{t.body}</span>
            </div>
          </div>
        ))}
      </div>

      {statement && <FlexCard deal={statement} name={g.profile.name} balance={g.account.balance} onClose={() => setStatement(null)} />}
      {frozen && <Lockout now={now} busy={reentering} onReenter={reenter} />}
    </div>
  );
}
