import { useEffect, useMemo, useRef, useState } from 'react';
import { TradeTab, type TradeSub } from './components/TradeTab.tsx';
import { ChatTab, ProfileSheet } from './components/Social.tsx';
import { WealthTab } from './components/Wealth.tsx';
import { SettingsTab } from './components/SettingsTab.tsx';
import { Lockout } from './components/Lockout.tsx';
import { FlexCard } from './components/FlexCard.tsx';
import { Badge } from './components/Badge.tsx';
import { Avatar } from './components/Avatar.tsx';
import { Icon } from './components/Icons.tsx';
import { FloatPnl, ScreenFx, type FxKind } from './components/Juice.tsx';
import { recentNews, upcomingNews } from './market/engine.ts';
import { SYMBOL_MAP, fmtPrice } from './market/symbols.ts';
import { MARGIN_CALL_LEVEL, PENDING_LABEL, START_BALANCE, metrics, quotesFor, type Deal, type Metrics } from './game/account.ts';
import { divisionFor } from './game/tiers.ts';
import { game, useGame } from './game/store.ts';
import { settings, useSettings } from './game/settings.ts';
import { mail, useMail } from './game/mail.ts';
import { net, useNet, type Snapshot } from './online/net.ts';
import { comms, useComms } from './online/comms.ts';
import { social, useSocial } from './online/social.ts';
import { push, type PushState } from './online/push.ts';
import { sfx } from './sfx.ts';
import { money, pnlClass } from './format.ts';
import { useT } from './i18n.ts';
import { AuthScreen, SetupScreen, Splash } from './components/Gate.tsx';
import { Guide } from './components/Guide.tsx';
import { NewsPost } from './components/NewsFeed.tsx';
import { auth, useAuth } from './online/auth.ts';
import { cloud } from './online/cloud.ts';
import { liveNews, type LiveNews } from './online/livenews.ts';
import { customMarkets } from './market/custom.ts';

type Tab = 'trade' | 'chat' | 'wealth' | 'settings';
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
const sideTxt = (s: 1 | -1) => (s === 1 ? 'BUY' : 'SELL');

export default function App() {
  const g = useGame();
  useNet();
  const c = useComms();
  const so = useSocial();
  const mb = useMail();
  const st = useSettings();
  const t = useT();
  const now = useNow(250);
  const [tab, setTab] = useState<Tab>('trade');
  const [sub, setSub] = useState<TradeSub>('quotes');
  const [statement, setStatement] = useState<Deal | null>(null);
  const [reentering, setReentering] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [fx, setFx] = useState<{ kind: FxKind; n: number } | null>(null);
  const au = useAuth();
  const [tweet, setTweet] = useState<LiveNews | null>(null);
  const [settingsKey, setSettingsKey] = useState(0);
  const [pushState, setPushState] = useState<PushState>('off');
  const [profile, setProfile] = useState<string | null>(null);
  const seenNews = useRef<Set<number>>(new Set(recentNews(Date.now() / 1000, 3600).map((e) => e.id)));
  const lastCountdown = useRef(0);
  const wasMarginCall = useRef(false);
  const lastDiv = useRef(divisionFor(game.account.balance).idx);

  const notify = (title: string, body: string, tone: Toast['tone'] = 'info') => {
    const id = Math.random();
    setToasts((x) => [{ id, title, body, tone }, ...x].slice(0, 2));
    setTimeout(() => setToasts((x) => x.filter((y) => y.id !== id)), tone === 'news' ? 5500 : tone === 'good' ? 2800 : 3800);
  };
  const glow = (kind: FxKind) => setFx((f) => ({ kind, n: (f?.n ?? 0) + 1 }));
  const pushSnapshot = (force: boolean) => {
    const s = snapshotOf(currentMetrics());
    if (s) net.update(s, force);
  };

  // theme on <html>
  useEffect(() => {
    document.documentElement.dataset.theme = st.theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', st.theme === 'light' ? '#f4f4f6' : st.theme === 'black' ? '#000000' : '#0b0b0c');
  }, [st.theme]);

  // game events → sound, glow, toasts, mailbox, notifications, tape, server
  useEffect(
    () =>
      game.onEvent((e) => {
        if (e.type === 'error' && !game.underReview()) notify('Trade request rejected', e.msg, 'bad');
        if (e.type === 'open') net.publish({ kind: 'open', sym: e.pos.sym, side: e.pos.side, lots: e.pos.lots });
        if (e.type === 'placed') notify('Order placed', `${PENDING_LABEL[e.order.type]} ${e.order.lots.toFixed(2)} ${SYMBOL_MAP[e.order.sym].name} at ${fmtPrice(SYMBOL_MAP[e.order.sym], e.order.price)}`, 'info');
        if (e.type === 'fill') {
          const p = e.pos;
          const body = `${PENDING_LABEL[e.record.kind]} ${p.lots.toFixed(2)} ${SYMBOL_MAP[p.sym].name} filled at ${fmtPrice(SYMBOL_MAP[p.sym], p.open)}`;
          notify('Pending order filled', body, 'good');
          mail.add('Pending order filled', body, 'good');
          if (settings.s.notify.fill) void push.local('Pending order filled', body, `fill-${p.id}`);
          net.publish({ kind: 'open', sym: p.sym, side: p.side, lots: p.lots });
          sfx.fill(p.side);
        }
        if (e.type === 'order_done' && e.record.state !== 'filled') {
          const r = e.record;
          const body = `${PENDING_LABEL[r.kind]} ${r.lots.toFixed(2)} ${SYMBOL_MAP[r.sym].name} ${r.state}${r.note ? `: ${r.note}` : ''}`;
          notify(`Order ${r.state}`, body, r.state === 'rejected' ? 'bad' : 'info');
          mail.add(`Order ${r.state}`, body, r.state === 'rejected' ? 'bad' : 'info');
        }
        if (e.type === 'close' || e.type === 'stopout') {
          const d = e.deal;
          net.publish({ kind: 'close', sym: d.sym, side: d.side, lots: d.lots, profit: d.profit });
          pushSnapshot(true);
          if (e.type === 'close') {
            const title = d.reason === 'tp' ? 'Take profit filled' : d.reason === 'sl' ? 'Stop loss filled' : 'Position closed';
            const body = `${SYMBOL_MAP[d.sym].name} ${sideTxt(d.side)} ${d.lots.toFixed(2)} at ${fmtPrice(SYMBOL_MAP[d.sym], d.close)} · ${money(d.profit, true)}`;
            notify(e.away ? `${title} while you were away` : title, body, d.profit >= 0 ? 'good' : 'bad');
            if (d.reason !== 'manual') {
              mail.add(e.away ? `${title} while you were away` : title, `${body}\nFilled ${new Date(d.closeTime * 1000).toLocaleString()}.`, d.profit >= 0 ? 'good' : 'bad');
              if (settings.s.notify[d.reason === 'tp' ? 'tp' : 'sl']) void push.local(`${title} · ${money(d.profit, true)}`, body, `close-${d.id}`);
            }
            if (d.profit >= 25) {
              sfx.jackpot();
              glow('win');
              if (!e.away) setTimeout(() => setStatement(d), 700);
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
          mail.add('Account frozen for credit review', `${e.reason}. All positions were liquidated and pending orders cancelled. Trading resumes after a 5-hour review.`, 'bad', 'Liquidated Risk Desk');
          if (settings.s.notify.stopout) void push.local('Account frozen · stop-out', e.reason, 'stopout');
        }
        if (e.type === 'account') {
          pushSnapshot(true);
          notify('Account', `Now trading #${e.login}`, 'info');
        }
      }),
    [], // eslint-disable-line react-hooks/exhaustive-deps
  );

  // boot: session check, shared markets, live headlines
  useEffect(() => {
    void auth.init();
    void customMarkets.sync();
    void liveNews.start();
    return liveNews.onNew((n) => {
      if (!settings.s.notify.news) return;
      setTweet(n);
      setTimeout(() => setTweet((x) => (x?.id === n.id ? null : x)), 7000);
      sfx.newsPing();
      void push.local(n.source, n.headline, n.id);
    });
  }, []);

  // cloud autosave after every account change
  useEffect(() => {
    if (au.state?.mode === 'online') cloud.save();
  }, [g.getVersion(), au.state?.mode]); // eslint-disable-line react-hooks/exhaustive-deps

  // online layers once the profile exists
  useEffect(() => {
    const s = snapshotOf(currentMetrics());
    if (!s || !g.profile) return;
    net.start(s);
    const me = { id: g.profile.id, secret: g.profile.secret, name: g.profile.name };
    void comms.start(me);
    void social.start(me);
    void push.init(me).then(setPushState);
    if (!mail.items.length) mail.add('Welcome to Liquidated', `Your demo account #${game.account.login} is open with ${money(START_BALANCE)}.\n\nTrade → Quotes lists 60+ instruments in Forex, Futures and Nasdaq. Swipe a symbol left for New order / Open chart / Delete. Turn on notifications in Settings to hear about take-profit fills even when the app is closed.`, 'info');
  }, [g.profile?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // profile changes → server
  useEffect(() => {
    if (g.profile) void social.setAvatar(g.profile.avatar);
  }, [g.profile?.avatar]); // eslint-disable-line react-hooks/exhaustive-deps

  // re-forecast push schedule whenever positions / orders change
  const tradeKey = JSON.stringify([g.account.login, g.account.positions.map((p) => [p.id, p.sl, p.tp]), g.account.orders.map((o) => [o.id, o.price, o.sl, o.tp, o.type]), g.account.lockedUntil]);
  useEffect(() => {
    if (pushState === 'server') push.schedule(game.account);
  }, [tradeKey, pushState]);

  // persist immediately when backgrounded, and lock in the final forecast
  useEffect(() => {
    const save = () => game.flush();
    const vis = () => {
      if (document.visibilityState !== 'hidden') return;
      game.flush();
      void cloud.saveNow();
      push.schedule(game.account, true);
    };
    window.addEventListener('pagehide', save);
    document.addEventListener('visibilitychange', vis);
    return () => {
      window.removeEventListener('pagehide', save);
      document.removeEventListener('visibilitychange', vis);
    };
  }, []);

  const quotes = useMemo(() => quotesFor(g.account, now), [g.account, now]);
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
      // only surface news that matters to this trader: macro, or an instrument they hold/watch
      const held = g.account.positions.some((p) => p.sym === ev.symbol || SYMBOL_MAP[p.sym].derive?.a === ev.symbol || SYMBOL_MAP[p.sym].derive?.b === ev.symbol);
      if (ev.kind !== 'macro' && ev.kind !== 'shock' && !held && ev.symbol !== st.sym) continue;
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
    const di = divisionFor(g.account.balance).idx;
    if (di > lastDiv.current && !frozen) {
      const d = divisionFor(g.account.balance);
      notify('Promotion', `You reached ${d.label}. Unlocked: ${d.symbol}`, 'good');
      mail.add(`Promoted to ${d.label}`, `Congratulations. Your balance crossed ${money(d.min)}. Status unlocked: ${d.symbol}.`, 'good', 'Liquidated Risk Desk');
    }
    lastDiv.current = di;
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

  const go = (x: Tab) => {
    setTab(x);
    sfx.tap();
  };
  const openSymbol = (s: string) => {
    settings.set({ sym: s });
    setSub('chart');
    setTab('trade');
  };

  // ---------------------------------------------------------------- login → username/password → guide
  if (!au.ready && !au.state) return <Splash />;
  if (!au.state || au.signedOut) return <AuthScreen />;
  if (!au.state.setupDone || !g.profile) return <SetupScreen />;

  const div = divisionFor(g.account.balance);
  const chatUnread = c.communities.reduce((s, x) => s + (c.membership(x.id) ? c.unread(x.id) : 0), 0) + so.totalUnread();

  return (
    <div className="app">
      <header className="hdr">
        <button className="avbtn" aria-label="Profile" onClick={() => go('settings')}>
          <Avatar name={g.profile.name} src={g.profile.avatar} size={36} />
        </button>
        <div className="brand">
          <span className="wordmark">LIQUIDATED</span>
          <span className="divline"><Badge d={div} size={14} /> {div.label} · {g.profile.name}</span>
        </div>
        <div className="eq">
          <b className="num">
            {money(m.equity)}
            {g.account.positions.length > 0 && <FloatPnl value={m.equity} threshold={Math.max(0.05, Math.abs(m.equity) * 0.0008)} />}
          </b>
          <span className="num">{g.account.positions.length ? <span className={pnlClass(m.floating)}>{money(m.floating, true)} open</span> : `Balance ${money(m.balance)}`}</span>
        </div>
      </header>
      {marginCall && tab !== 'trade' && <div className="mcbar">Margin call · level {m.level?.toFixed(0)}%</div>}

      <div className="tabbody">
        {tab === 'trade' && <TradeTab now={now} m={m} sub={sub} onSub={setSub} onShare={setStatement} />}
        {tab === 'chat' && <ChatTab now={now} notify={notify} onOpenSymbol={openSymbol} />}
        {tab === 'wealth' && <WealthTab m={m} onProfile={setProfile} />}
        {tab === 'settings' && <SettingsTab key={settingsKey} now={now} notify={notify} pushState={pushState} setPushState={setPushState} onSymbol={openSymbol} />}
      </div>

      <nav className="tabs">
        {([
          ['trade', t('nav.trade'), Icon.trade, g.account.positions.length],
          ['chat', t('nav.chat'), Icon.chat, chatUnread],
          ['wealth', t('nav.wealth'), Icon.wealth, 0],
          ['settings', t('nav.settings'), Icon.settings, mb.unread()],
        ] as const).map(([id, label, I, badge]) => (
          <button key={id} className={tab === id ? 'on' : ''} onClick={() => go(id)}>
            <I />
            {label}
            {badge > 0 && <span className={`dot ${id === 'trade' ? 'soft' : ''}`}>{badge > 99 ? '99+' : badge}</span>}
          </button>
        ))}
      </nav>

      <ScreenFx fx={fx} />
      <div className="toasts" aria-live="polite">
        {toasts.map((x) => (
          <div key={x.id} className={`toast ${x.tone}`}>
            <i />
            <div>
              <b>{x.title}</b>
              <span>{x.body}</span>
            </div>
          </div>
        ))}
      </div>

      {profile && <ProfileSheet id={profile} notify={notify} onClose={() => setProfile(null)} onMessage={() => { setProfile(null); setTab('chat'); }} onOpenGroup={() => { setProfile(null); setTab('chat'); }} />}
      {statement && <FlexCard deal={statement} name={g.profile.name} balance={g.account.balance} onClose={() => setStatement(null)} />}
      {tweet && (
        <div className="tweettoast" onClick={() => { setTweet(null); setSettingsKey((k) => k + 1); setTab('settings'); }}>
          <NewsPost n={tweet} compact />
        </div>
      )}
      {!au.state.guideDone && !frozen && <Guide onGo={(x, s2) => { setTab(x); if (s2) setSub(s2); }} onDone={() => { auth.finishGuide(); setTab('trade'); setSub('quotes'); }} />}
      {frozen && <Lockout now={now} busy={reentering} onReenter={reenter} />}
    </div>
  );
}
