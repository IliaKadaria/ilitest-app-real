import { getClient } from './supabase.ts';

// Cloud save: every apex.* key (accounts, history, settings, mailbox, friends,
// drawings…) is mirrored to the player's private row in `cloud_saves`
// (RLS: only their own auth user can read or write it). Logging in on a new
// device restores it; afterwards the device keeps it in sync automatically.

const SKIP = new Set(['apex.auth.v1', 'apex.comms.v1', 'apex.cloud.v1', 'apex.sb.auth']);
const META = 'apex.cloud.v1';

function keys(): string[] {
  try {
    const out: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (k && k.startsWith('apex.') && !SKIP.has(k) && !k.startsWith('apex.sb.')) out.push(k);
    }
    return out;
  } catch {
    return [];
  }
}

function snapshot(): Record<string, string> {
  const data: Record<string, string> = {};
  for (const k of keys()) {
    const v = window.localStorage.getItem(k);
    if (v !== null) data[k] = v;
  }
  return data;
}

function meta(): { user?: string; restored?: boolean; savedAt?: number } {
  try {
    return JSON.parse(window.localStorage.getItem(META) ?? '{}');
  } catch {
    return {};
  }
}
function setMeta(m: ReturnType<typeof meta>) {
  try {
    window.localStorage.setItem(META, JSON.stringify(m));
  } catch {
    /* ignore */
  }
}

class Cloud {
  status: 'off' | 'syncing' | 'saved' | 'error' = 'off';
  lastSaved = 0;
  private user: string | null = null;
  private timer: number | null = null;
  private onChange: (() => void) | null = null;

  listen(fn: () => void) {
    this.onChange = fn;
  }

  /**
   * First login on this device: if the account already has a cloud save, restore
   * it and return true (caller reloads). Otherwise upload this device's data.
   */
  async attach(userId: string, flush: () => void): Promise<boolean> {
    this.user = userId;
    const c = getClient();
    if (!c) return false;
    const sb = await c;
    const m = meta();
    if (m.user !== userId || !m.restored) {
      const { data } = await sb.from('cloud_saves').select('data, updated_at').eq('user_id', userId).maybeSingle();
      setMeta({ user: userId, restored: true, savedAt: Date.now() });
      if (data?.data && typeof data.data === 'object' && Object.keys(data.data).length) {
        try {
          for (const k of keys()) window.localStorage.removeItem(k);
          for (const [k, v] of Object.entries(data.data as Record<string, string>)) if (k.startsWith('apex.') && !SKIP.has(k)) window.localStorage.setItem(k, v);
        } catch {
          return false;
        }
        return true;
      }
    }
    flush();
    await this.saveNow();
    return false;
  }

  detach() {
    this.user = null;
    this.status = 'off';
    if (this.timer !== null) window.clearTimeout(this.timer);
  }

  /** Debounced autosave. */
  save(delay = 15000) {
    if (!this.user) return;
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => void this.saveNow(), delay);
  }

  async saveNow() {
    if (!this.user) return;
    if (this.timer !== null) {
      window.clearTimeout(this.timer);
      this.timer = null;
    }
    const c = getClient();
    if (!c) return;
    this.status = 'syncing';
    this.onChange?.();
    const sb = await c;
    const { error } = await sb.from('cloud_saves').upsert({ user_id: this.user, data: snapshot(), updated_at: new Date().toISOString() });
    this.status = error ? 'error' : 'saved';
    if (!error) {
      this.lastSaved = Date.now();
      setMeta({ ...meta(), savedAt: this.lastSaved });
    }
    this.onChange?.();
  }
}

export const cloud = new Cloud();
