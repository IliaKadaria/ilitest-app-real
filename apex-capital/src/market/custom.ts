import { useSyncExternalStore } from 'react';
import { getItem, setItem } from '../storage.ts';
import { registerCustom, unregisterCustom, type CustomMarket } from './symbols.ts';
import { getClient } from '../online/supabase.ts';

// Admin-created markets. Cached locally and registered synchronously at boot
// (main.tsx imports this first) so saved positions on them survive reloads.
// Online, the list comes from the public `custom_markets` table and only
// server-verified admins can change it; offline, changes stay on this device.

const KEY = 'apex.markets.v1';

function readCache(): CustomMarket[] {
  try {
    return (JSON.parse(getItem(KEY) ?? '[]') as CustomMarket[]) ?? [];
  } catch {
    return [];
  }
}

type Listener = () => void;

class CustomMarkets {
  list: CustomMarket[] = readCache();
  private listeners = new Set<Listener>();
  private version = 0;

  constructor() {
    for (const m of this.list) registerCustom(m);
  }
  subscribe = (l: Listener) => {
    this.listeners.add(l);
    return () => {
      this.listeners.delete(l);
    };
  };
  getVersion = () => this.version;
  private apply(next: CustomMarket[]) {
    const gone = this.list.filter((m) => !next.some((n) => n.id === m.id));
    gone.forEach((m) => unregisterCustom(m.id));
    const added = next.filter((m) => !this.list.some((o) => o.id === m.id));
    next.forEach((m) => registerCustom(m));
    this.list = next;
    setItem(KEY, JSON.stringify(next));
    this.version++;
    this.listeners.forEach((l) => l());
    if (added.length || gone.length)
      void import('../game/settings.ts').then(({ settings }) => {
        added.forEach((m) => settings.watchSym(m.id));
        gone.forEach((m) => settings.set({ watch: { ...settings.s.watch, [m.cls]: settings.s.watch[m.cls].filter((x) => x !== m.id) } }));
      });
  }

  /** Pull the shared list (and keep it live). */
  async sync() {
    const c = getClient();
    if (!c) return;
    const sb = await c;
    const { data, error } = await sb.from('custom_markets').select('*').order('created_at');
    if (error) return;
    this.apply((data ?? []).map(fromRow));
    sb.channel('apex-markets')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'custom_markets' }, () => void this.sync())
      .subscribe();
  }

  async add(m: CustomMarket, me: { id: string; secret: string } | null, online: boolean): Promise<string | null> {
    const err = validate(m);
    if (err) return err;
    if (online && me) {
      const sb = await getClient();
      if (!sb) return 'Server unavailable.';
      const { error } = await sb.rpc('add_market', { p_id: me.id, p_secret: me.secret, p_market: toRow(m) });
      if (error) return /admins only/i.test(error.message) ? 'Only admins can add markets.' : error.message;
      await this.sync();
      return null;
    }
    this.apply([...this.list.filter((x) => x.id !== m.id), m]);
    return null;
  }

  async remove(id: string, me: { id: string; secret: string } | null, online: boolean): Promise<string | null> {
    if (online && me) {
      const sb = await getClient();
      if (!sb) return 'Server unavailable.';
      const { error } = await sb.rpc('remove_market', { p_id: me.id, p_secret: me.secret, p_symbol: id });
      if (error) return error.message;
      await this.sync();
      return null;
    }
    this.apply(this.list.filter((x) => x.id !== id));
    return null;
  }
}

function validate(m: CustomMarket): string | null {
  if (!/^[A-Z0-9]{2,10}$/.test(m.id)) return 'Symbol: 2–10 capital letters or digits.';
  if (!(m.base > 0)) return 'Price must be positive.';
  if (!(m.vol1m >= 0.00001 && m.vol1m <= 0.05)) return 'Volatility out of range.';
  if (!(m.contract > 0) || !(m.leverage >= 1 && m.leverage <= 1000)) return 'Check contract size and leverage.';
  if (!(m.spread > 0)) return 'Spread must be positive.';
  return null;
}

const toRow = (m: CustomMarket) => ({ id: m.id, name: m.name, description: m.desc, cls: m.cls, base: m.base, vol1m: m.vol1m, digits: m.digits, contract: m.contract, leverage: m.leverage, spread: m.spread, quote_ccy: m.quoteCcy });
const fromRow = (r: Record<string, unknown>): CustomMarket => ({
  id: String(r.id),
  name: String(r.name ?? r.id),
  desc: String(r.description ?? ''),
  cls: r.cls as CustomMarket['cls'],
  base: Number(r.base),
  vol1m: Number(r.vol1m),
  digits: Number(r.digits),
  contract: Number(r.contract),
  leverage: Number(r.leverage),
  spread: Number(r.spread),
  quoteCcy: (r.quote_ccy as CustomMarket['quoteCcy']) ?? 'USD',
});

export const customMarkets = new CustomMarkets();

export function useCustomMarkets() {
  useSyncExternalStore(customMarkets.subscribe, customMarkets.getVersion);
  return customMarkets;
}
