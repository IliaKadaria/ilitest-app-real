/// <reference lib="webworker" />
import { advance, type SimEvent } from './sim.ts';
import type { AccountState } from './account.ts';
import { SYMBOL_MAP, fmtPrice } from '../market/symbols.ts';

// Runs the deterministic market forward to find when open positions and
// pending orders will fill, so the server can push "Take profit filled" while
// the app is closed. Same code + same grid as the replay on reopen.

export interface ForecastItem {
  at: number;
  kind: 'tp' | 'sl' | 'stopout' | 'fill';
  title: string;
  body: string;
  tag: string;
}

export interface ForecastRequest {
  acc: AccountState;
  from: number;
  horizon: number;
}

const eur = (v: number) => `${v >= 0 ? '+' : '−'}€${Math.abs(v).toFixed(2)}`;

self.onmessage = (e: MessageEvent<ForecastRequest>) => {
  const { acc, from, horizon } = e.data;
  const items: ForecastItem[] = [];
  const label = (sym: string) => SYMBOL_MAP[sym]?.name ?? sym;
  const px = (sym: string, p: number) => (SYMBOL_MAP[sym] ? fmtPrice(SYMBOL_MAP[sym], p) : String(p));
  advance(acc, from, from + horizon, (ev: SimEvent, t: number) => {
    if (ev.type === 'close' && (ev.deal.reason === 'tp' || ev.deal.reason === 'sl')) {
      const d = ev.deal;
      const tp = d.reason === 'tp';
      items.push({
        at: t,
        kind: d.reason as 'tp' | 'sl',
        title: tp ? `Take profit filled · ${eur(d.profit)}` : `Stop loss filled · ${eur(d.profit)}`,
        body: `${label(d.sym)} ${d.side === 1 ? 'BUY' : 'SELL'} ${d.lots.toFixed(2)} closed at ${px(d.sym, d.close)}`,
        tag: `close-${d.id}`,
      });
    } else if (ev.type === 'fill') {
      items.push({ at: t, kind: 'fill', title: 'Pending order filled', body: `${label(ev.pos.sym)} ${ev.pos.side === 1 ? 'BUY' : 'SELL'} ${ev.pos.lots.toFixed(2)} at ${px(ev.pos.sym, ev.pos.open)}`, tag: `fill-${ev.pos.id}` });
    } else if (ev.type === 'frozen') {
      items.push({ at: t, kind: 'stopout', title: 'Account frozen · stop-out', body: 'Your positions were liquidated. Credit review: 5 hours.', tag: 'stopout' });
      return false;
    }
    return items.length < 40;
  });
  (self as unknown as Worker).postMessage(items);
};
