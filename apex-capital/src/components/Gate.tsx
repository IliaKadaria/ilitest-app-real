import logoFull from '../assets/logo-full.png';
import { useState } from 'react';
import { START_BALANCE } from '../game/account.ts';
import { useGame } from '../game/store.ts';
import { auth, passwordProblem, useAuth } from '../online/auth.ts';
import { money } from '../format.ts';
import { sfx } from '../sfx.ts';

// Login / sign-up gate shown before the terminal, then username + password.

const G = () => (
  <svg viewBox="0 0 24 24" className="brandico"><path fill="#EA4335" d="M12 10.2v3.9h5.5c-.2 1.3-1.6 3.9-5.5 3.9-3.3 0-6-2.7-6-6.1s2.7-6.1 6-6.1c1.9 0 3.1.8 3.8 1.5l2.6-2.5C16.8 3.3 14.6 2.3 12 2.3 6.6 2.3 2.3 6.6 2.3 12s4.3 9.7 9.7 9.7c5.6 0 9.3-3.9 9.3-9.5 0-.6-.1-1.1-.2-1.6H12z" /></svg>
);
const GH = () => (
  <svg viewBox="0 0 24 24" className="brandico"><path fill="currentColor" d="M12 .5a11.5 11.5 0 0 0-3.6 22.4c.6.1.8-.3.8-.6v-2c-3.2.7-3.9-1.5-3.9-1.5-.5-1.3-1.3-1.7-1.3-1.7-1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.7-1.6-2.6-.3-5.3-1.3-5.3-5.7 0-1.3.5-2.3 1.2-3.1-.1-.3-.5-1.5.1-3.1 0 0 1-.3 3.2 1.2a11 11 0 0 1 5.8 0c2.2-1.5 3.2-1.2 3.2-1.2.6 1.6.2 2.8.1 3.1.8.8 1.2 1.8 1.2 3.1 0 4.4-2.7 5.4-5.3 5.7.4.4.8 1.1.8 2.2v3.2c0 .3.2.7.8.6A11.5 11.5 0 0 0 12 .5Z" /></svg>
);
const X = () => (
  <svg viewBox="0 0 24 24" className="brandico"><path fill="currentColor" d="M17.8 2.5h3.1l-6.8 7.8 8 10.6h-6.3l-4.9-6.4-5.6 6.4H2.2l7.3-8.3L1.9 2.5h6.4l4.4 5.9 5.1-5.9Zm-1.1 16.5h1.7L7.4 4.3H5.6L16.7 19Z" /></svg>
);
const Mail = () => (
  <svg viewBox="0 0 24 24" className="brandico"><rect x="3.5" y="5.5" width="17" height="13" rx="2" fill="none" stroke="currentColor" strokeWidth="1.6" /><path d="M4 7l8 6 8-6" fill="none" stroke="currentColor" strokeWidth="1.6" /></svg>
);

const Claude = () => (
  <svg viewBox="0 0 24 24" className="brandico"><path fill="#D97757" d="M12 2l1.8 6.2L20 10l-6.2 1.8L12 18l-1.8-6.2L4 10l6.2-1.8L12 2Zm6.5 11l.9 2.6 2.6.9-2.6.9-.9 2.6-.9-2.6-2.6-.9 2.6-.9.9-2.6Z" /></svg>
);

export function AuthScreen() {
  const a = useAuth();
  const g = useGame();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<'choose' | 'email'>('choose');
  const [emailMode, setEmailMode] = useState<'link' | 'password' | 'create'>('link');
  const [unlock, setUnlock] = useState('');
  const [unlockErr, setUnlockErr] = useState<string | null>(null);
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const canOffline = !!(a.state?.passHash && g.profile);

  return (
    <div className="app">
      <div className="gate">
        <div className="gatehero">
          <img className="gatelogo" src={logoFull} alt="Liquidated" />
          <div className="eyebrow" style={{ marginTop: 4 }}>Day Trading Game</div>
          <h1>Trade like a pro.<br />Without the risk.</h1>
          <p>52+ markets across Forex, Futures and Nasdaq on a MetaTrader 5-grade terminal. Start with {money(START_BALANCE)} and climb 30 ranks.</p>
        </div>

        {mode === 'choose' ? (
          <div className="gatebtns">
            <div className="gatesec"><b>Play online</b><span>Cloud save · live leaderboard · friends</span></div>
            {a.claudeAvailable !== false && !a.online && (
              <button className="authbtn primaryauth" disabled={a.busy || a.claudeAvailable === null} onClick={() => void a.claudeSignIn()}>
                <Claude /> {a.claudeAvailable === null ? 'Checking your account…' : 'Continue with Claude account'}
              </button>
            )}
            <button className="authbtn" disabled={a.busy || !a.online} onClick={() => void a.oauth('google')}><G /> Continue with Google</button>
            <button className="authbtn" disabled={a.busy || !a.online} onClick={() => void a.oauth('github')}><GH /> Continue with GitHub</button>
            <button className="authbtn" disabled={a.busy || !a.online} onClick={() => void a.oauth('twitter')}><X /> Continue with X</button>
            <button className="authbtn" disabled={a.busy || !a.online} onClick={() => setMode('email')}><Mail /> Continue with e-mail</button>
            {!a.online && <div className="gatenote">{a.claudeAvailable !== false ? 'In this preview, play online with your Claude account. Google, GitHub, X and e-mail sign-in work in the installed app.' : 'Google, GitHub, X and e-mail sign-in work in the installed app.'}</div>}
            <div className="ordiv"><span>or</span></div>
            <div className="gatesec"><b>Play offline</b><span>No account needed · progress stays on this device</span></div>
            {canOffline ? (
              <div className="stack" style={{ gap: 8 }}>
                <input type="password" placeholder={`Password for ${g.profile!.name}`} value={unlock} onChange={(e) => setUnlock(e.target.value)} />
                {unlockErr && <div className="warnline">{unlockErr}</div>}
                <button className="authbtn" onClick={async () => {
                  if (await a.unlockOffline(unlock)) { a.dismissSignedOut(); sfx.cash(); } else setUnlockErr('Wrong password.');
                }}>Continue offline as {g.profile!.name}</button>
              </div>
            ) : (
              <button className="authbtn" onClick={() => { a.playOffline(); a.dismissSignedOut(); sfx.tap(); }}>Play offline</button>
            )}
          </div>
        ) : (
          <div className="gatebtns">
            <div className="seg3" style={{ margin: 0 }}>
              <button className={emailMode === 'link' ? 'on' : ''} onClick={() => setEmailMode('link')}>Magic link</button>
              <button className={emailMode === 'password' ? 'on' : ''} onClick={() => setEmailMode('password')}>Sign in</button>
              <button className={emailMode === 'create' ? 'on' : ''} onClick={() => setEmailMode('create')}>Sign up</button>
            </div>
            <input type="email" autoComplete="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
            {emailMode !== 'link' && <input type="password" autoComplete={emailMode === 'create' ? 'new-password' : 'current-password'} placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} />}
            {emailMode === 'create' && password && passwordProblem(password) && <div className="hint" style={{ textAlign: 'left' }}>{passwordProblem(password)}</div>}
            <button
              className="primary"
              disabled={a.busy || !emailOk || (emailMode !== 'link' && (emailMode === 'create' ? !!passwordProblem(password) : !password))}
              onClick={() => (emailMode === 'link' ? void a.emailLink(email) : void a.emailPassword(email, password, emailMode === 'create'))}
            >
              {a.busy ? 'Please wait…' : emailMode === 'link' ? 'Send sign-in link' : emailMode === 'create' ? 'Create account' : 'Sign in'}
            </button>
            <button className="ghost" onClick={() => setMode('choose')}>Back</button>
          </div>
        )}
        {a.error && <div className="warnline">{a.error}</div>}
        {a.notice && <div className="done">{a.notice}</div>}
        <p className="fine">Simulated markets and funds. Not investment advice. By continuing you agree to play fair: one account per person.</p>
      </div>
    </div>
  );
}

export function SetupScreen() {
  const a = useAuth();
  const g = useGame();
  const [name, setName] = useState(g.profile?.name ?? '');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const nameOk = /^[A-Za-z0-9_.-]{2,18}$/.test(name);
  const pwErr = pw ? passwordProblem(pw) : null;
  const match = pw && pw === pw2;
  const s = a.state!;
  const submit = async () => {
    setErr(null);
    const e = await auth.completeSetup(name, pw);
    if (e) {
      setErr(e);
      sfx.bonk();
    } else sfx.cash();
  };
  return (
    <div className="app">
      <div className="gate">
        <div className="steps3"><i className="past" /><i className="on" /><i /></div>
        <div className="gatehero">
          <div className="eyebrow">{s.mode === 'online' ? `Signed in${s.email ? ` as ${s.email}` : ''}` : 'Offline account'}</div>
          <h1>Create your trader</h1>
          <p>{s.mode === 'online' ? 'Pick the username other traders will see, and a password. You can use it to sign in with your e-mail on any device.' : 'Your account lives on this device. The password locks it if you ever sign out.'}</p>
        </div>
        <div className="gatebtns">
          <label className="field"><span>Username</span><input value={name} maxLength={18} autoComplete="username" placeholder="e.g. JLaurent" onChange={(e) => setName(e.target.value.replace(/[^\w.-]/g, ''))} /></label>
          <label className="field"><span>Password</span><input type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} /></label>
          {pwErr && <div className="hint" style={{ textAlign: 'left' }}>{pwErr}</div>}
          <label className="field"><span>Confirm password</span><input type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} /></label>
          {pw2 && !match && <div className="hint" style={{ textAlign: 'left' }}>Passwords don’t match.</div>}
          {err && <div className="warnline">{err}</div>}
          <button className="primary" disabled={a.busy || !nameOk || !!pwErr || !match} onClick={submit}>{a.busy ? 'Opening account…' : `Open account · ${money(START_BALANCE)}`}</button>
        </div>
      </div>
    </div>
  );
}

export function Splash() {
  return (
    <div className="app">
      <div className="gate" style={{ alignContent: 'center', justifyItems: 'center' }}>
        <img className="gatelogo" src={logoFull} alt="Liquidated" />
        <div className="muted" style={{ fontSize: 12 }}>Connecting…</div>
      </div>
    </div>
  );
}
