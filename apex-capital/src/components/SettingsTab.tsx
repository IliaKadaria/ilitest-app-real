import logoFull from '../assets/logo-full.png';
import { useRef, useState } from 'react';
import { CLASSES, SYMBOL_MAP, type AssetClass, type Ccy } from '../market/symbols.ts';
import { customMarkets, useCustomMarkets } from '../market/custom.ts';
import { auth, useAuth, type Provider } from '../online/auth.ts';
import { cloud } from '../online/cloud.ts';
import { NewsFeed } from './NewsFeed.tsx';
import { START_BALANCE } from '../game/account.ts';
import { divisionFor } from '../game/tiers.ts';
import { MAX_ACCOUNTS, game, useGame } from '../game/store.ts';
import { COLOR_PRESETS, settings, useSettings, type ChartColors, type ChartToggles, type Theme } from '../game/settings.ts';
import { mail, useMail } from '../game/mail.ts';
import { push, type PushState } from '../online/push.ts';
import { social } from '../online/social.ts';
import { net } from '../online/net.ts';
import { compactMoney, hhmm, money } from '../format.ts';
import { LANGS, useT } from '../i18n.ts';
import { isMuted, setMuted, sfx } from '../sfx.ts';
import { Avatar, PRESETS, fileToAvatar } from './Avatar.tsx';
import { Badge } from './Badge.tsx';
import { Icon } from './Icons.tsx';

type Page = null | 'accounts' | 'mail' | 'news' | 'interface' | 'charts' | 'notifications' | 'about' | 'profile' | 'login' | 'admin';
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

export function SettingsTab({ now, notify, pushState, setPushState, onSymbol }: { now: number; notify: Notify; pushState: PushState; setPushState: (s: PushState) => void; onSymbol: (s: string) => void }) {
  const au = useAuth();
  const [confirmOut, setConfirmOut] = useState(false);
  const g = useGame();
  const t = useT();
  const mb = useMail();
  const [page, setPage] = useState<Page>(null);
  const p = g.profile!;
  const d = divisionFor(g.account.balance);
  const back = () => setPage(null);

  if (page === 'accounts') return <Sub title={t('s.newAccount')} onBack={back}><Accounts notify={notify} /></Sub>;
  if (page === 'mail') return <Sub title={t('s.mailbox')} onBack={back}><Mailbox /></Sub>;
  if (page === 'news') return <Sub title={t('s.news')} onBack={back}><NewsFeed now={now} onSymbol={onSymbol} /></Sub>;
  if (page === 'login') return <Sub title="Login & cloud save" onBack={back}><LoginInfo notify={notify} /></Sub>;
  if (page === 'admin') return <Sub title="Admin · Markets" onBack={back}><AdminMarkets notify={notify} /></Sub>;
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
          <small>{d.label} · #{g.account.login} · Liquidated-Demo</small>
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
      <div className="menu card">
        {item('login', <Icon.user />, 'Login & cloud save', <small className="muted">{au.state?.mode === 'online' ? providerLabel(au.state.provider) : 'Offline'}</small>)}
        {au.state?.isAdmin && item('admin', <Icon.lock />, 'Admin · Markets', <small className="muted">{customMarkets.list.length}</small>)}
        {item('about', <Icon.info />, t('s.about'))}
      </div>
      <button className="logout" onClick={() => setConfirmOut(true)}>Log Out</button>
      {confirmOut && (
        <div className="modal" onClick={() => setConfirmOut(false)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <div className="grab" />
            <h3>Log out of {p.name}?</h3>
            <p className="muted" style={{ margin: 0, fontSize: 13 }}>
              {au.state?.mode === 'online' ? 'Your progress is saved to the cloud first. Sign back in with the same account to continue.' : 'Your account stays on this device. You’ll need your password to get back in.'}
            </p>
            <button className="logout" style={{ margin: 0, width: '100%' }} onClick={() => { setConfirmOut(false); void auth.logOut(); }}>Log Out</button>
            <button className="ghost" onClick={() => setConfirmOut(false)}>{t('x.cancel')}</button>
          </div>
        </div>
      )}
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
              <b>#{a.login} · Liquidated-Demo</b>
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
    ['news', 'Breaking news', 'Real-world headlines as they land, like posts on X'],
  ];
  const label: Record<PushState, string> = {
    unsupported: 'This browser can’t show notifications. On iPhone: Share → Add to Home Screen, then open Liquidated from the home screen.',
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
        {kinds.map(([k, l, s]) => <Toggle key={k} on={st.notify[k]} label={l} sub={s || undefined} onClick={() => { settings.set({ notify: { ...st.notify, [k]: !st.notify[k] } }); if (k === 'news') void push.setNewsAlerts(!st.notify[k]); else push.schedule(game.account, true); }} />)}
      </div>
      {push.lastSchedule.length > 0 && (
        <div className="card pad">
          <div className="eyebrow">Scheduled from current positions</div>
          {push.lastSchedule.slice(0, 5).map((x) => <div key={x.tag} className="sub">{new Date(x.at * 1000).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })} · {x.title}</div>)}
        </div>
      )}
      <p className="fine">The market is simulated deterministically, so the game can calculate exactly when your take profit will be hit and schedule the alert in advance. Changing a position re-schedules it.</p>
    </div>
  );
}

function About() {
  return (
    <div className="pad stack">
      <button onClick={() => auth.replayGuide()}>Replay the step-by-step guide</button>
      <img className="gatelogo" src={logoFull} alt="Liquidated" />
      <div className="eyebrow">Day Trading Game</div>
      <p className="muted">MetaTrader 5-style day-trading game. 52 instruments across Forex, Metals and Nasdaq, simulated deterministically so every player trades the same market.</p>
      <p className="fine">Simulated markets and funds. Not investment advice. Stock tickers are used for realism only; their prices and headlines are generated by the game.</p>
      <p className="fine">Charts by TradingView Lightweight Charts™.</p>
    </div>
  );
}

// -------------------------------------------------------------------- login & cloud
const providerLabel = (p: Provider) => ({ google: 'Google', github: 'GitHub', twitter: 'X', email: 'E-mail', offline: 'Offline' })[p] ?? p;

function LoginInfo({ notify }: { notify: Notify }) {
  const a = useAuth();
  const s = a.state!;
  const [, force] = useState(0);
  cloud.listen(() => force((x) => x + 1));
  return (
    <div className="pad stack">
      <div className="card pad">
        <div className="eyebrow">Signed in with</div>
        <b style={{ fontSize: 16 }}>{providerLabel(s.provider)}</b>
        {s.email && <div className="muted" style={{ fontSize: 13 }}>{s.email}</div>}
        {s.isAdmin && <div className="tag tp" style={{ display: 'inline-block', margin: '8px 0 0' }}>ADMIN</div>}
      </div>
      <div className="card pad">
        <div className="eyebrow">Cloud save</div>
        {s.mode === 'online' ? (
          <>
            <p className="muted" style={{ fontSize: 13, margin: '6px 0 10px' }}>
              Your accounts, history and settings sync automatically. {cloud.lastSaved ? `Last saved ${new Date(cloud.lastSaved).toLocaleTimeString()}.` : ''} {cloud.status === 'error' ? 'Last sync failed; it will retry.' : ''}
            </p>
            <button onClick={() => void cloud.saveNow().then(() => notify('Saved to cloud', 'Your progress is backed up.', 'good'))}>Save now</button>
          </>
        ) : (
          <p className="muted" style={{ fontSize: 13, margin: '6px 0 0' }}>Offline account: everything is saved on this device. Sign in online to back it up and play on other devices.</p>
        )}
      </div>
      {s.mode === 'online' ? (
        <button className="ghost" onClick={() => void a.signOut()}>Sign out</button>
      ) : (
        a.online && <button className="primary" onClick={() => a.signedOutView()}>Sign in to back up this account</button>
      )}
      <p className="fine">You stay logged in on this device. Trading keeps working offline; changes sync when you’re back online.</p>
    </div>
  );
}

// -------------------------------------------------------------------- admin: markets
function AdminMarkets({ notify }: { notify: Notify }) {
  const cm = useCustomMarkets();
  const g = useGame();
  const a = useAuth();
  const online = a.state?.mode === 'online' && net.status === 'live';
  const [f, setF] = useState({ id: '', name: '', desc: '', cls: 'futures' as AssetClass, base: '', vol: 'med', digits: '2', contract: '100', leverage: '100', spread: '', ccy: 'USD' as Ccy });
  const set = (k: keyof typeof f, v: string) => setF({ ...f, [k]: v });
  const VOL: Record<string, number> = { low: 0.0003, med: 0.0008, high: 0.0018, wild: 0.004 };
  const submit = async () => {
    const base = Number(f.base);
    const digits = Math.max(0, Math.min(6, Number(f.digits) || 0));
    const e = await customMarkets.add({
      id: f.id.toUpperCase(), name: f.name || f.id.toUpperCase(), desc: f.desc, cls: f.cls, base, vol1m: VOL[f.vol], digits,
      contract: Number(f.contract), leverage: Number(f.leverage), spread: Number(f.spread) || Math.max(Math.pow(10, -digits), base * 0.0002), quoteCcy: f.ccy,
    }, g.profile, online);
    if (e) notify('Market not added', e, 'bad');
    else {
      notify('Market added', `${f.id.toUpperCase()} is live in ${CLASSES.includes(f.cls) ? f.cls : ''}`, 'good');
      setF({ ...f, id: '', name: '', desc: '', base: '', spread: '' });
    }
  };
  return (
    <div className="pad stack">
      <div className="muted" style={{ fontSize: 13 }}>{online ? 'Markets you add appear for every player instantly.' : 'Offline: markets you add are only on this device until you are back online.'}</div>
      <div className="card pad stack" style={{ gap: 10 }}>
        <b>Add a market</b>
        <div className="row2">
          <label className="field"><span>Category</span><select value={f.cls} onChange={(e) => set('cls', e.target.value)}>{CLASSES.map((c) => <option key={c} value={c}>{c === 'fx' ? 'Forex' : c === 'futures' ? 'Futures' : 'Nasdaq'}</option>)}</select></label>
          <label className="field"><span>Symbol</span><input value={f.id} maxLength={10} placeholder="e.g. PLTR" onChange={(e) => set('id', e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))} /></label>
        </div>
        <div className="row2">
          <label className="field"><span>Display name</span><input value={f.name} maxLength={24} placeholder="Same as symbol" onChange={(e) => set('name', e.target.value)} /></label>
          <label className="field"><span>Start price</span><input className="num" inputMode="decimal" value={f.base} onChange={(e) => set('base', e.target.value.replace(',', '.'))} /></label>
        </div>
        <label className="field"><span>Description</span><input value={f.desc} maxLength={80} placeholder="e.g. Palantir Technologies" onChange={(e) => set('desc', e.target.value)} /></label>
        <div className="row2">
          <label className="field"><span>Volatility</span><select value={f.vol} onChange={(e) => set('vol', e.target.value)}><option value="low">Low (major FX)</option><option value="med">Medium (index / metal)</option><option value="high">High (single stock)</option><option value="wild">Wild (meme)</option></select></label>
          <label className="field"><span>Quote currency</span><select value={f.ccy} onChange={(e) => set('ccy', e.target.value)}>{['USD', 'EUR', 'GBP', 'JPY', 'CHF', 'AUD', 'CAD', 'NZD'].map((c) => <option key={c}>{c}</option>)}</select></label>
        </div>
        <div className="row2" style={{ gridTemplateColumns: '1fr 1fr 1fr' }}>
          <label className="field"><span>Digits</span><input className="num" inputMode="numeric" value={f.digits} onChange={(e) => set('digits', e.target.value.replace(/\D/g, ''))} /></label>
          <label className="field"><span>Contract</span><input className="num" inputMode="decimal" value={f.contract} onChange={(e) => set('contract', e.target.value)} /></label>
          <label className="field"><span>Leverage</span><input className="num" inputMode="numeric" value={f.leverage} onChange={(e) => set('leverage', e.target.value.replace(/\D/g, ''))} /></label>
        </div>
        <label className="field"><span>Spread (price units, optional)</span><input className="num" inputMode="decimal" value={f.spread} placeholder="auto" onChange={(e) => set('spread', e.target.value)} /></label>
        <button className="primary" disabled={!f.id || !(Number(f.base) > 0)} onClick={() => void submit()}>Add market</button>
      </div>
      <div className="eyebrow">Custom markets · {cm.list.length}</div>
      {!cm.list.length && <div className="muted" style={{ fontSize: 13 }}>None yet.</div>}
      {cm.list.map((m) => (
        <div key={m.id} className="objrow">
          <span><b>{m.name}</b> <small className="muted">{m.id} · {m.cls} · {SYMBOL_MAP[m.id] ? 'live' : '—'}</small></span>
          <button className="ghost sm" onClick={() => void customMarkets.remove(m.id, g.profile, online).then((e) => e && notify('Not removed', e, 'bad'))}>Remove</button>
        </div>
      ))}
      <p className="fine">Price and volatility are fixed once a market exists: changing them would rewrite every player’s chart history.</p>
    </div>
  );
}
