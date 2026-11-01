import type { Session } from '@supabase/supabase-js';
import { useSyncExternalStore } from 'react';
import { getItem, setItem } from '../storage.ts';
import { game } from '../game/store.ts';
import { cloud } from './cloud.ts';
import { getClient, hasServer } from './supabase.ts';
import { net } from './net.ts';
import { claudeCaps, isArtifactBuild } from './claudeCloud.ts';

// ---------------------------------------------------------------------------
// Login / sign-up.
//  online : Supabase Auth (Google, GitHub, X, e-mail). The session is
//           persisted, so the player is never asked to log in again on this
//           device. The game profile is linked to the auth user server-side,
//           so the same login restores it (and a cloud save) on any device.
//  offline: no server needed. Username + password live on this device
//           (PBKDF2 hash) and the whole game runs locally.
// Admin rights are never decided in the client: the server grants them to the
// verified e-mail listed in `admin_emails`.
// ---------------------------------------------------------------------------

export type Provider = 'google' | 'github' | 'twitter' | 'email' | 'offline' | 'claude';

export interface AuthState {
  mode: 'online' | 'offline';
  provider: Provider;
  userId?: string;
  email?: string;
  /** Username + password done. */
  setupDone: boolean;
  /** Step-by-step guide seen. */
  guideDone: boolean;
  passSalt?: string;
  passHash?: string;
  /** Last value the server reported (cached for offline sessions). */
  isAdmin: boolean;
}

const KEY = 'apex.auth.v1';
type Listener = () => void;

function load(): AuthState | null {
  try {
    const raw = getItem(KEY);
    if (raw) return JSON.parse(raw) as AuthState;
  } catch {
    /* fall through */
  }
  // players from before logins existed keep their account (no forced re-onboarding)
  return game.profile ? { mode: 'offline', provider: 'offline', setupDone: true, guideDone: false, isAdmin: false } : null;
}

const b64 = (b: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(b)));

export async function hashPassword(password: string, salt?: string): Promise<{ salt: string; hash: string }> {
  const s = salt ? Uint8Array.from(atob(salt), (c) => c.charCodeAt(0)) : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: s, iterations: 150_000, hash: 'SHA-256' }, key, 256);
  return { salt: b64(s), hash: b64(bits) };
}

export function passwordProblem(p: string): string | null {
  if (p.length < 8) return 'At least 8 characters.';
  if (!/[A-Za-z]/.test(p) || !/[0-9]/.test(p)) return 'Use letters and numbers.';
  return null;
}

class Auth {
  state: AuthState | null = load();
  /** False until the stored session has been checked. */
  ready = !hasServer;
  busy = false;
  error: string | null = null;
  notice: string | null = null;
  readonly online = hasServer;
  /** Artifact build: online login with the viewer's Claude account (null until known). */
  claudeAvailable: boolean | null = isArtifactBuild ? null : false;
  private listeners = new Set<Listener>();
  private version = 0;

  subscribe = (l: Listener) => {
    this.listeners.add(l);
    return () => {
      this.listeners.delete(l);
    };
  };
  getVersion = () => this.version;
  private bump() {
    this.version++;
    this.listeners.forEach((l) => l());
  }
  private save(next: AuthState | null) {
    this.state = next;
    setItem(KEY, next ? JSON.stringify(next) : '');
    this.bump();
  }
  private fail(msg: string) {
    this.error = msg;
    this.busy = false;
    this.bump();
  }

  /** Boot: pick up a persisted or just-redirected (OAuth / e-mail link) session. */
  async init() {
    if (isArtifactBuild) {
      void claudeCaps().then(async (cc) => {
        this.claudeAvailable = !!cc;
        if (cc && this.state?.provider === 'claude' && this.state.userId === cc.id) {
          if (this.state.setupDone) await cloud.attachClaude(cc, () => game.flush());
          if (cc.isOwner !== this.state.isAdmin) this.save({ ...this.state, isAdmin: cc.isOwner });
        }
        this.bump();
      });
    }
    const c = getClient();
    if (!c) {
      this.ready = true;
      return this.bump();
    }
    try {
      const sb = await c;
      const timeout = new Promise<null>((r) => setTimeout(() => r(null), 6000));
      const res = await Promise.race([sb.auth.getSession(), timeout]);
      const session = res && 'data' in res ? res.data.session : null;
      if (session) await this.onSession(session);
      sb.auth.onAuthStateChange((ev, s) => {
        if (ev === 'SIGNED_IN' && s && this.state?.userId !== s.user.id) void this.onSession(s);
      });
    } catch {
      /* offline: the persisted state below still lets the player in */
    }
    this.ready = true;
    this.bump();
  }

  private async onSession(s: Session) {
    this.signedOut = false;
    const prov = (s.user.app_metadata?.provider as Provider) ?? 'email';
    const prev = this.state;
    const same = prev?.userId === s.user.id;
    this.save({
      mode: 'online',
      provider: prov === ('x' as Provider) ? 'twitter' : prov,
      userId: s.user.id,
      email: s.user.email ?? undefined,
      setupDone: same ? prev!.setupDone : false,
      guideDone: same ? prev!.guideDone : false,
      passSalt: prev?.passSalt,
      passHash: prev?.passHash,
      isAdmin: same ? prev!.isAdmin : false,
    });
    // same login, new device → adopt the linked profile and its cloud save
    const sb = await getClient()!;
    const { data } = await sb.rpc('get_link');
    const link = data as { player_id: string; secret: string; name: string; avatar: string | null; is_admin: boolean } | null;
    if (link?.player_id) {
      const local = game.profile;
      if (!local || local.id !== link.player_id) game.adoptProfile({ id: link.player_id, secret: link.secret, name: link.name, avatar: link.avatar ?? undefined });
      this.save({ ...this.state!, setupDone: true, guideDone: same ? this.state!.guideDone : true, isAdmin: link.is_admin });
      if (await cloud.attach(s.user.id, () => game.flush())) location.reload();
    }
  }

  // ---------------------------------------------------------------- sign in
  async oauth(provider: 'google' | 'github' | 'twitter') {
    const c = getClient();
    if (!c) return this.fail('Online sign-in is not configured. Use “Play offline”.');
    this.busy = true;
    this.error = null;
    this.bump();
    const sb = await c;
    const { error } = await sb.auth.signInWithOAuth({ provider, options: { redirectTo: location.href.split('#')[0].split('?')[0] } });
    if (error) this.fail(/not enabled|unsupported provider/i.test(error.message) ? `${provider === 'twitter' ? 'X' : provider[0].toUpperCase() + provider.slice(1)} sign-in isn’t enabled on the server yet.` : error.message);
  }

  async emailLink(email: string) {
    const c = getClient();
    if (!c) return this.fail('Online sign-in is not configured. Use “Play offline”.');
    this.busy = true;
    this.error = null;
    this.bump();
    const { error } = await (await c).auth.signInWithOtp({ email: email.trim(), options: { emailRedirectTo: location.href.split('#')[0].split('?')[0] } });
    this.busy = false;
    if (error) return this.fail(error.message);
    this.notice = `Check ${email.trim()} — tap the link to sign in.`;
    this.bump();
  }

  async emailPassword(email: string, password: string, create: boolean) {
    const c = getClient();
    if (!c) return this.fail('Online sign-in is not configured. Use “Play offline”.');
    this.busy = true;
    this.error = null;
    this.bump();
    const sb = await c;
    const res = create
      ? await sb.auth.signUp({ email: email.trim(), password, options: { emailRedirectTo: location.href.split('#')[0].split('?')[0] } })
      : await sb.auth.signInWithPassword({ email: email.trim(), password });
    this.busy = false;
    if (res.error) return this.fail(/invalid login/i.test(res.error.message) ? 'Wrong e-mail or password.' : res.error.message);
    if (create && !res.data.session) {
      this.notice = `Confirm your e-mail: we sent a link to ${email.trim()}.`;
      return this.bump();
    }
    if (res.data.session) await this.onSession(res.data.session);
    this.bump();
  }

  /** Artifact build: sign in as the Claude user viewing the page. */
  async claudeSignIn() {
    this.busy = true;
    this.error = null;
    this.bump();
    const cc = await claudeCaps();
    if (!cc) return this.fail('Sign in to claude.ai to play online here, or play offline.');
    const prev = this.state;
    const same = prev?.userId === cc.id;
    this.save({ mode: 'online', provider: 'claude', userId: cc.id, setupDone: same ? prev!.setupDone : false, guideDone: same ? prev!.guideDone : false, passSalt: prev?.passSalt, passHash: prev?.passHash, isAdmin: cc.isOwner });
    this.signedOut = false;
    // returning player on a new device: restore their cloud save
    if (await cloud.attachClaude(cc, () => game.flush())) {
      const restored = (() => {
        try {
          return !!window.localStorage.getItem('apex.profile.v1');
        } catch {
          return false;
        }
      })();
      if (restored) this.save({ ...this.state!, setupDone: true, guideDone: true });
      location.reload();
      return;
    }
    if (same && prev?.setupDone) this.save({ ...this.state!, setupDone: true });
    else if (game.profile && prev?.setupDone) this.save({ ...this.state!, setupDone: true }); // offline account upgraded in place
    this.busy = false;
    this.bump();
  }

  playOffline() {
    this.error = null;
    this.save({ mode: 'offline', provider: 'offline', setupDone: false, guideDone: false, isAdmin: false });
  }

  /** Offline unlock after signing out on this device. */
  async unlockOffline(password: string): Promise<boolean> {
    const s = this.state;
    if (!s?.passHash || !s.passSalt) return true;
    const { hash } = await hashPassword(password, s.passSalt);
    return hash === s.passHash;
  }

  // ---------------------------------------------------------------- setup
  async completeSetup(username: string, password: string): Promise<string | null> {
    const s = this.state;
    if (!s) return 'Sign in first.';
    if (!/^[A-Za-z0-9_.-]{2,18}$/.test(username)) return 'Username: 2–18 letters, numbers, _ . -';
    const pp = passwordProblem(password);
    if (pp) return pp;
    this.busy = true;
    this.bump();
    const { salt, hash } = await hashPassword(password);
    game.setProfile(username);
    let isAdmin = s.isAdmin;
    if (s.mode === 'online' && s.provider === 'claude') {
      const cc = await claudeCaps();
      if (cc) {
        isAdmin = cc.isOwner;
        void cloud.attachClaude(cc, () => game.flush());
      }
    } else if (s.mode === 'online') {
      const sb = await getClient()!;
      // lets Google / GitHub / X players also sign in with e-mail + this password
      await sb.auth.updateUser({ password }).catch(() => null);
      for (let i = 0; i < 20 && !(await net.ready()); i++) await new Promise((r) => setTimeout(r, 250));
      const p = game.profile!;
      const { data, error } = await sb.rpc('link_account', { p_id: p.id, p_secret: p.secret });
      // Server database not set up yet (migrations not run): stay signed in and keep playing;
      // the profile links automatically on the next sign-in once the server is ready.
      const notReady = !!error && (error.code === 'PGRST202' || /could not find the function|does not exist|schema cache/i.test(error.message));
      if (error && !notReady) {
        this.busy = false;
        this.bump();
        return /taken|unique/i.test(error.message) ? 'That username is taken.' : `Could not link your account: ${error.message}`;
      }
      isAdmin = !!(data as { is_admin?: boolean } | null)?.is_admin;
      if (!notReady) void cloud.attach(s.userId!, () => game.flush());
    }
    this.busy = false;
    this.save({ ...this.state!, setupDone: true, passSalt: salt, passHash: hash, isAdmin });
    return null;
  }

  finishGuide() {
    if (this.state) this.save({ ...this.state, guideDone: true });
  }
  replayGuide() {
    if (this.state) this.save({ ...this.state, guideDone: false });
  }

  /** Refresh the server-side admin flag (e.g. after the owner adds an admin e-mail). */
  async refreshAdmin() {
    if (this.state?.mode !== 'online') return;
    if (this.state.provider === 'claude') return;
    const c = getClient();
    if (!c) return;
    const { data } = await (await c).rpc('get_link');
    const link = data as { is_admin?: boolean } | null;
    if (link && link.is_admin !== this.state.isAdmin) this.save({ ...this.state, isAdmin: !!link.is_admin });
  }

  async signOut() {
    await cloud.saveNow();
    cloud.detach();
    const c = this.state?.provider === 'claude' ? null : getClient();
    if (c) await (await c).auth.signOut().catch(() => null);
    // keep the local game and its password so the player can continue offline
    this.save(this.state ? { ...this.state, mode: 'offline', provider: 'offline', userId: undefined, email: undefined, isAdmin: false, setupDone: !!this.state.passHash } : null);
    this.signedOut = true;
    this.bump();
  }
  /** Set after an explicit sign-out: the login screen shows again until the player picks a path. */
  signedOut = false;
  /** Settings → Log Out. Online: end the session. Offline: lock the device account behind its password. */
  async logOut() {
    if (this.state?.mode === 'online') return this.signOut();
    this.signedOut = true;
    this.error = null;
    this.notice = null;
    this.bump();
  }

  /** Offline player chooses to sign in (to back up / link this device's account). */
  signedOutView() {
    this.signedOut = true;
    this.error = null;
    this.notice = null;
    this.bump();
  }
  dismissSignedOut() {
    this.signedOut = false;
    this.bump();
  }
}

export const auth = new Auth();

export function useAuth() {
  useSyncExternalStore(auth.subscribe, auth.getVersion);
  return auth;
}
