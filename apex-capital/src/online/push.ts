import type { AccountState } from '../game/account.ts';
import type { ForecastItem, ForecastRequest } from '../game/forecast.worker.ts';
import { settings } from '../game/settings.ts';
import { net } from './net.ts';

// ---------------------------------------------------------------------------
// Notifications.
//  1. App open but in the background → the service worker shows them directly.
//  2. App fully closed → the market is deterministic, so we forecast every
//     TP / SL / stop-out / pending fill for the next 72h in a worker and hand
//     the schedule to Supabase. pg_cron calls the `send-due-pushes` edge
//     function every minute, which delivers Web Push to this device.
//     Every account change re-forecasts and replaces the schedule.
// ---------------------------------------------------------------------------

const VAPID = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined;
const HORIZON = 72 * 3600;

export type PushState = 'unsupported' | 'denied' | 'off' | 'local' | 'server';

interface Identity {
  id: string;
  secret: string;
}

function b64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

class Push {
  state: PushState = 'off';
  serverReady = false;
  lastSchedule: ForecastItem[] = [];
  private me: Identity | null = null;
  private worker: Worker | null = null;
  private timer: number | null = null;
  private seq = 0;

  supported() {
    return typeof window !== 'undefined' && 'Notification' in window && 'serviceWorker' in navigator;
  }

  async init(me: Identity) {
    this.me = me;
    if (!this.supported()) return (this.state = 'unsupported');
    if (Notification.permission === 'denied') return (this.state = 'denied');
    if (Notification.permission === 'granted' && settings.s.pushEnabled) await this.subscribeServer();
    else this.state = 'off';
    return this.state;
  }

  /** Must be called from a user gesture (iOS). */
  async enable(): Promise<PushState> {
    if (!this.supported()) return (this.state = 'unsupported');
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') {
      settings.set({ pushEnabled: false });
      return (this.state = perm === 'denied' ? 'denied' : 'off');
    }
    settings.set({ pushEnabled: true });
    await this.subscribeServer();
    return this.state;
  }

  disable() {
    settings.set({ pushEnabled: false });
    this.state = 'off';
    void this.sendSchedule([]);
  }

  private async subscribeServer() {
    this.state = 'local';
    if (!VAPID || !this.me) return;
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(VAPID) }));
      const sb = await net.client();
      if (!sb) return;
      await net.ready();
      const { error } = await sb.rpc('save_push_subscription', { p_id: this.me.id, p_secret: this.me.secret, p_sub: sub.toJSON() });
      if (!error) {
        this.serverReady = true;
        this.state = 'server';
      }
    } catch {
      /* push service unavailable (e.g. desktop Safari without install): keep local */
    }
  }

  /** In-app event while the page is hidden (still alive in the background). */
  async local(title: string, body: string, tag: string) {
    if (!settings.s.pushEnabled || !this.supported() || Notification.permission !== 'granted') return;
    if (document.visibilityState === 'visible') return;
    if (this.serverReady && this.lastSchedule.some((x) => x.tag === tag)) return; // server already pushes this one
    try {
      const reg = await navigator.serviceWorker.ready;
      await reg.showNotification(title, { body, tag, icon: './icon-192.png', badge: './icon-192.png', data: { url: './' } });
    } catch {
      /* ignore */
    }
  }

  /** Debounced re-forecast after any change to positions/orders. */
  schedule(acc: AccountState, immediate = false) {
    if (!settings.s.pushEnabled || !this.serverReady) return;
    if (this.timer !== null) window.clearTimeout(this.timer);
    const run = () => {
      this.timer = null;
      void this.forecast(acc).then((items) => this.sendSchedule(items));
    };
    if (immediate) run();
    else this.timer = window.setTimeout(run, 1500);
  }

  private forecast(acc: AccountState): Promise<ForecastItem[]> {
    if (acc.lockedUntil || (!acc.positions.length && !acc.orders.length)) return Promise.resolve([]);
    const seq = ++this.seq;
    this.worker ??= new Worker(new URL('../game/forecast.worker.ts', import.meta.url), { type: 'module' });
    const w = this.worker;
    return new Promise((resolve) => {
      const done = (e: MessageEvent<ForecastItem[]>) => {
        w.removeEventListener('message', done);
        resolve(seq === this.seq ? e.data : []);
      };
      w.addEventListener('message', done);
      const req: ForecastRequest = { acc, from: Date.now() / 1000, horizon: HORIZON };
      w.postMessage(req);
    });
  }

  private async sendSchedule(items: ForecastItem[]) {
    const kinds = settings.s.notify;
    const filtered = items.filter((i) => kinds[i.kind]);
    this.lastSchedule = filtered;
    const sb = await net.client();
    if (!sb || !this.me) return;
    await sb.rpc('schedule_pushes', {
      p_id: this.me.id,
      p_secret: this.me.secret,
      p_items: filtered.map((i) => ({ at: new Date(i.at * 1000).toISOString(), title: i.title, body: i.body, tag: i.tag })),
    });
  }
}

export const push = new Push();
