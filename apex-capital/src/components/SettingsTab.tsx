import { useRef, useState } from 'react';
import { recentNews, upcomingNews } from '../market/engine.ts';
import { SYMBOL_MAP } from '../market/symbols.ts';
import { START_BALANCE } from '../game/account.ts';
import { divisionFor } from '../game/tiers.ts';
import { MAX_ACCOUNTS, game, useGame } from '../game/store.ts';
import { COLOR_PRESETS, settings, useSettings, type ChartColors, type ChartToggles, type Theme } from '../game/settings.ts';
import { mail, useMail } from '../game/mail.ts';
import { push, type PushState } from '../online/push.ts';
import { social } from '../online/social.ts';
import { net } from '../online/net.ts';
import { clock, compactMoney, countdown, hhmm, money } from '../format.ts';
import { LANGS, useT } from '../i18n.ts';
import { isMuted, setMuted, sfx } from '../sfx.ts';
import { Avatar, PRESETS, fileToAvatar } from './Avatar.tsx';
import { Badge } from './Badge.tsx';
import { Icon } from './Icons.tsx';

type Page = null | 'accounts' | 'mail' | 'news' | 'interface' | 'charts' | 'notifications' | 'about' | 'profile';
type Notify = (title: string, body: string, tone?: 'good' | 'bad' | 'info') => void;

const TOGGLES: [keyof ChartToggles, string, string?][] = [
  ['volume', 'Volume', 'Volume histogram under the price'],
  ['tickVolumes', 'Tick volumes', 'Use tick volume instead of real volume'],
  ['periodSeparators', 'Period separators', 'Day / week / month dividers'],
  ['askLine', 'Ask price line'],
  ['countdown', 'Countdown to bar close'],
  ['freeMove', 'Free chart movement', 'Drag vertically, no auto-scroll'],
  ['ohlc', 'OHLC', 'Open/High/Low/Close in the corner'],
  ['dataWindow', 'Data window', 'Values under the crosshair'],
  ['tradeOrders', 'Trade orders', 'Pending order levels'],
  ['tradePositions', 'Trade positions', 'Entry lines of open positions'],
  ['slTp', 'SL/TP levels'],
  ['profitLoss', 'Profit/Loss', 'Live P/L on position lines'],
  ['tradeHistory', 'Trade history', 'Entry/exit markers of closed trades'],
  ['oneClick', 'One Click Trading', 'SELL / BUY panel on the chart'],
  ['panelBottom', 'Trading Panel at the bottom'],
  ['preload', 'Preload charts data', 'Load ~1,500 bars instead of ~300'],
];
const COLORS: [keyof ChartColors, string][] = [
  ['background', 'Background'],
  ['foreground', 'Foreground'],
  ['grid', 'Grid'],
  ['barUp', 'Bar Up'],
  ['barDown', 'Bar Down'],
  ['bullCandle', 'Bull Candle'],
  ['bearCandle', 'Bear Candle'],
  ['lineChart', 'Line Chart'],
  ['volumes', 'Volumes'],
  ['bidLine', 'Bid Price Line'],
  ['askLine', 'Ask Price Line'],
  ['stopsLevel', 'Stops Level'],
];

export function SettingsTab({ now, notify, pushState, setPushState }: { now: number; notify: Notify; pushState: PushState; setPushState: (s: PushState) => void }) {
  const g = useGame();
  const t = useT();
  const mb = useMail();
  const [page, setPage] = useState<Page>(null);
  const p = g.profile!;
  const d = divisionFor(g.account.balance);
  const back = () => setPage(null);

  if (page === 'accounts') return <Sub title={t('s.newAccount')} onBack={back}><Accounts notify={notify} /></Sub>;
  if (page === 'mail') return <Sub title={t('s.mailbox')} onBack={back}><Mailbox /></Sub>;
  if (page === 'news') return <Sub title={t('s.news')} onBack={back}><News now={now} /></Sub>;
  if (page === 'interface') return <Sub title={t('s.interface')} onBack={back}><Interface /></Sub>;
  if (page === 'charts') return <Sub title={t('s.charts')} onBack={back}><Charts /></Sub>;
  if (page === 'notifications') return <Sub title={t('s.notifications')} onBack={back}><Notifications state={pushState} setState={setPushState} /></Sub>;
  if (page === 'about') return <Sub title={t('s.about')} onBack={back}><About /></Sub>;
  if (page === 'profile') return <Sub title="Profile" onBack={back}><ProfileEdit notify={notify} /></Sub>;

  const item = (id: Page, icon: React.ReactNode, label: string, extra?: React.ReactNode) => (
    <button className="menuitem" onClick={() => { setPage(id); sfx.tap(); }}>
      <span className="mi">{icon}</span>
      <span className="ml">{label}</span>
      {extra}
      <Icon.chevron />
    </button>
  );

  return (
    <div className="list">
      <button className="profilecard card" onClick={() => setPage('profile')}>
        <Avatar name={p.name} src={p.avatar} size={64} />
        <span className="qname">
          <b style={{ fontSize: 18 }}>{p.name}</b>
          <small>{d.label} · #{g.account.login} · Apex-Demo</small>
          <small>{money(g.account.balance)} · {net.mode === 'online' && net.status === 'live' ? 'Live server' : 'Offline mode'}</small>
        </span>
        <Badge d={d} size={34} />
      </button>
      <div className="menu card">
        {item('accounts', <Icon.account />, t('s.newAccount'), <small className="muted">{g.accounts.length}</small>)}
        {item('mail', <Icon.mail />, t('s.mailbox'), mb.unread() > 0 ? <span className="unread">{mb.unread()}</span> : null)}
        {item('news', <Icon.news />, t('s.news'))}
      </div>
      <div className="menu card">
        {item('interface', <Icon.globe />, t('s.interface'), <small className="muted">{LANGS.find((l) => l.id === settings.s.lang)?.label}</small>)}
        {item('charts', <Icon.chart />, t('s.charts'))}
        {item('notifications', <Icon.bell />, t('s.notifications'), <small className="muted">{pushState === 'server' ? 'On' : pushState === 'local' ? 'In-app' : 'Off'}</small>)}
      </div>
      <div className="menu card">{item('about', <Icon.info />, t('s.about'))}</div>
    </div>
  );
}

function Sub({ title, onBack, children }: { title: string; onBack: () => void; children: React.ReactNode }) {
  return (
    <div className="list">
      <div className="subhdr">
        <button className="iconbtn" aria-label="Back" onClick={onBack}><Icon.back /></button>
        <b>{title}</b>
      </div>
      {children}
    </div>
  );
}

function Toggle({ on, onClick, label, sub }: { on: boolean; onClick: () => void; label: string; sub?: string }) {
  return (
    <div className="togrow" onClick={onClick}>
      <span><b>{label}</b>{sub && <small>{sub}</small>}</span>
      <button className={`switch ${on ? 'on' : ''}`} aria-label={label} aria-pressed={on} />
    </div>
  );
}

// -------------------------------------------------------------------- profile
function ProfileEdit({ notify }: { notify: Notify }) {
  const g = useGame();
  const p = g.profile!;
  const [name, setName] = useState(p.name);
  const fileRef = useRef<HTMLInputElement>(null);
  const ok = /^[A-Za-z0-9_.-]{2,18}$/.test(name);
  const setAv = (a: string | undefined) => {
    game.setAvatar(a);
    void social.setAvatar(a);
    sfx.tap();
  };
  return (
    <div className="pad stack">
      <div className="avedit">
        <Avatar name={p.name} src={p.avatar} size={104} />
        <div className="stack" style={{ gap: 8 }}>
          <button onClick={() => fileRef.current?.click()}><Icon.camera /> Upload photo</button>
          {p.avatar && <button className="ghost" onClick={() => setAv(undefined)}>Remove picture</button>}
        </div>
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={async (e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          try { setAv(await fileToAvatar(f)); } catch (err) { notify('Upload failed', String(err), 'bad'); }
          e.target.value = '';
        }} />
      </div>
      <div className="eyebrow">Or pick a style</div>
      <div className="presetgrid">
        {PRESETS.map((_, i) => (
          <button key={i} className={p.avatar === `p:${i}` ? 'on' : ''} onClick={() => setAv(`p:${i}`)}><Avatar name={p.name} src={`p:${i}`} size={44} /></button>
        ))}
      </div>
      <label className="field"><span>Username</span><input value={name} maxLength={18} onChange={(e) => setName(e.target.value.replace(/[^\w.-]/g, ''))} /></label>
      <button className="primary" disabled={!ok || name === p.name} onClick={() => { game.setProfile(name); notify('Username updated', name, 'good'); }}>Save username</button>
      <p className="fine">Your username, picture, rank and balance are visible to other traders.</p>
    </div>
  );
}

// -------------------------------------------------------------------- accounts
function Accounts({ notify }: { notify: Notify }) {
  const g = useGame();
  const can = game.canOpenNewAccount();
  return (
    <div className="pad stack">
      {g.accounts.map((a) => {
        const s = game.accountSummary(a.login);
        const active = a.login === g.account.login;
        return (
          <button key={a.login} className={`acctrow card ${active ? 'on' : ''}`} onClick={() => { if (!active && game.switchAccount(a.login)) notify('Account switched', `#${a.login}`, 'good'); }}>
            <span className="qname">
              <b>#{a.login} · Apex-Demo</b>
              <small>{g.profile?.name} · Hedge · 1:500 · opened {new Date(a.createdAt).toLocaleDateString()}</small>
            </span>
            <span style={{ textAlign: 'right' }}>
              <b className="num">{s ? compactMoney(s.balance) : '—'}</b>
              <small className="muted" style={{ display: 'block' }}>{active ? 'Active' : 'Tap to switch'}</small>
            </span>
          </button>
        );
      })}
      <div className="card pad">
        <b>Open a new demo account</b>
        <p className="muted" style={{ margin: '6px 0 10px', fontSize: 13 }}>Fresh {money(START_BALANCE)} balance, separate history. Up to {MAX_ACCOUNTS} accounts; switch any time from here.</p>
        {!can.ok && <div className="warnline">{can.why}</div>}
        <button className="primary" style={{ width: '100%' }} disabled={!can.ok} onClick={() => { if (game.openNewAccount()) notify('Account opened', `#${game.account.login} · ${money(START_BALANCE)}`, 'good'); }}>Open account</button>
      </div>
    </div>
  );
}

// -------------------------------------------------------------------- mailbox
function Mailbox() {
  const mb = useMail();
  const [open, setOpen] = useState<string | null>(null);
  return (
    <>
      {mb.items.length > 0 && <div className="pad" style={{ paddingBottom: 0 }}><button className="ghost sm" onClick={() => mb.markAll()}>Mark all as read</button></div>}
      {!mb.items.length && <div className="empty"><b>No messages</b>Broker notices about fills, reviews and promotions land here.</div>}
      {mb.items.map((m) => (
        <div key={m.id} className={`mailrow ${m.read ? '' : 'unreadmail'}`} onClick={() => { setOpen(open === m.id ? null : m.id); mail.markRead(m.id); }}>
          <i className={`dot ${m.tone}`} />
          <div>
            <div className="mailtop"><b>{m.subject}</b><small>{hhmm(m.at)}</small></div>
            <div className="muted mailfrom">{m.from} · {new Date(m.at * 1000).toLocaleDateString()}</div>
            {open === m.id ? <p className="mailbody">{m.body}</p> : <div className="muted mailprev">{m.body}</div>}
          </div>
          {open === m.id && <button className="ghost sm" onClick={(e) => { e.stopPropagation(); mail.remove(m.id); }}>Delete</button>}
        </div>
      ))}
    </>
  );
}

// -------------------------------------------------------------------- news
function News({ now }: { now: number }) {
  const up = upcomingNews(now);
  const past = recentNews(now, 6 * 3600);
  return (
    <>
      {up.length > 0 && <div className="section"><span className="eyebrow">Coming up</span></div>}
      {up.map((e) => (
        <div key={e.id} className="newsrow">
          <span className="tag sched">{e.kind === 'macro' ? 'CALENDAR' : 'DESK'}</span>
          <div><b>{e.teaser}</b><small className="muted">in {countdown(e.t0 - now)}</small></div>
        </div>
      ))}
      <div className="section"><span className="eyebrow">Wire · last 6 hours</span><span className="eyebrow">{past.length}</span></div>
      {past.map((e) => (
        <div key={e.id} className="newsrow">
          <span className={`tag ${e.kind === 'shock' ? 'sl' : e.kind === 'macro' ? 'sched' : e.dir > 0 ? 'tp' : 'sl'}`}>{e.kind === 'macro' ? 'MACRO' : e.kind === 'shock' ? 'ALERT' : SYMBOL_MAP[e.symbol ?? '']?.name ?? ''}</span>
          <div><b>{e.headline}</b><small className="muted">{clock(e.t0)}</small></div>
        </div>
      ))}
      <p className="fine pad">Headlines are generated by the simulation and move simulated prices only.</p>
    </>
  );
}

// -------------------------------------------------------------------- interface
function Interface() {
  const st = useSettings();
  const t = useT();
  const [muted, setM] = useState(isMuted());
  const themes: [Theme, string][] = [['dark', 'Graphite (dark)'], ['black', 'Midnight (OLED black)'], ['light', 'Light']];
  return (
    <>
      <div className="section"><span className="eyebrow">{t('s.language')}</span></div>
      <div className="menu card">
        {LANGS.map((l) => (
          <button key={l.id} className="menuitem" onClick={() => settings.set({ lang: l.id })}>
            <span className="ml">{l.label}</span>{st.lang === l.id && <Icon.check />}
          </button>
        ))}
      </div>
      <div className="section"><span className="eyebrow">{t('s.appearance')}</span></div>
      <div className="menu card">
        {themes.map(([id, label]) => (
          <button key={id} className="menuitem" onClick={() => settings.set({ theme: id })}>
            <span className={`swatch th-${id}`} /><span className="ml">{label}</span>{st.theme === id && <Icon.check />}
          </button>
        ))}
      </div>
      <div className="menu card" style={{ marginTop: 12 }}>
        <Toggle on={!muted} label="Sounds" sub="Fills, alerts and countdowns" onClick={() => { setMuted(!muted); setM(!muted); }} />
      </div>
    </>
  );
}

// -------------------------------------------------------------------- charts
function Charts() {
  const st = useSettings();
  return (
    <>
      <div className="menu card">
        {TOGGLES.map(([k, label, sub]) => <Toggle key={k} on={st.toggles[k]} label={label} sub={sub} onClick={() => settings.toggle(k)} />)}
      </div>
      <div className="section"><span className="eyebrow">Colors</span></div>
      <div className="presetrow">
        {Object.entries(COLOR_PRESETS).map(([k, v]) => (
          <button key={k} onClick={() => settings.set({ colors: v.colors })}>
            <span className="mini" style={{ background: v.colors.background }}>
              <i style={{ background: v.colors.bullCandle, borderColor: v.colors.barUp }} />
              <i style={{ background: v.colors.bearCandle, borderColor: v.colors.barDown }} />
            </span>
            {v.label}
          </button>
        ))}
      </div>
      <div className="menu card">
        {COLORS.map(([k, label]) => (
          <label key={k} className="togrow">
            <span><b>{label}</b><small className="num">{st.colors[k]}</small></span>
            <input type="color" value={st.colors[k]} onChange={(e) => settings.color(k, e.target.value)} />
          </label>
        ))}
      </div>
    </>
  );
}

// -------------------------------------------------------------------- notifications
function Notifications({ state, setState }: { state: PushState; setState: (s: PushState) => void }) {
  const st = useSettings();
  const kinds: [keyof typeof st.notify, string, string][] = [
    ['tp', 'Take profit filled', 'Including while the app is closed'],
    ['sl', 'Stop loss filled', ''],
    ['stopout', 'Stop-out / account frozen', ''],
    ['fill', 'Pending order filled', ''],
  ];
  const label: Record<PushState, string> = {
    unsupported: 'This browser can’t show notifications. On iPhone: Share → Add to Home Screen, then open Apex from the home screen.',
    denied: 'Notifications are blocked. Allow them for this site in your browser / system settings.',
    off: 'Off',
    local: 'On while the app is running in the background. The push server isn’t configured yet, so nothing arrives once the app is fully closed.',
    server: 'On. You’ll be notified even when the app is closed.',
  };
  return (
    <div className="pad stack">
      <div className="card pad">
        <b>Push notifications</b>
        <p className="muted" style={{ margin: '6px 0 10px', fontSize: 13 }}>{label[state]}</p>
        {state === 'server' || state === 'local' ? (
          <button className="ghost" style={{ width: '100%' }} onClick={() => { push.disable(); setState('off'); }}>Turn off</button>
        ) : (
          <button className="primary" style={{ width: '100%' }} disabled={state === 'unsupported'} onClick={async () => setState(await push.enable())}>Enable notifications</button>
        )}
      </div>
      <div className="menu card">
        {kinds.map(([k, l, s]) => <Toggle key={k} on={st.notify[k]} label={l} sub={s || undefined} onClick={() => { settings.set({ notify: { ...st.notify, [k]: !st.notify[k] } }); push.schedule(game.account, true); }} />)}
      </div>
      {push.lastSchedule.length > 0 && (
        <div className="card pad">
          <div className="eyebrow">Scheduled from current positions</div>
          {push.lastSchedule.slice(0, 5).map((x) => <div key={x.tag} className="sub">{new Date(x.at * 1000).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })} · {x.title}</div>)}
        </div>
      )}
      <p className="fine">The market is simulated deterministically, so Apex can calculate exactly when your take profit will be hit and schedule the alert in advance. Changing a position re-schedules it.</p>
    </div>
  );
}

function About() {
  return (
    <div className="pad stack">
      <div className="wordmark">APEX CAPITAL</div>
      <p className="muted">MetaTrader 5-style day-trading game. 52 instruments across Forex, Metals and Nasdaq, simulated deterministically so every player trades the same market.</p>
      <p className="fine">Simulated markets and funds. Not investment advice. Stock tickers are used for realism only; their prices and headlines are generated by the game.</p>
      <p className="fine">Charts by TradingView Lightweight Charts™.</p>
    </div>
  );
}
