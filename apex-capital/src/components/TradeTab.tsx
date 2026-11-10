import { useState } from 'react';
import { TIMEFRAMES } from '../market/engine.ts';
import type { Deal, Metrics } from '../game/account.ts';
import { settings, useSettings } from '../game/settings.ts';
import { useT } from '../i18n.ts';
import { sfx } from '../sfx.ts';
import { ChartView, type TicketPrefill } from './ChartView.tsx';
import { HistoryView } from './HistoryView.tsx';
import { OrderTicket } from './OrderTicket.tsx';
import { Quotes } from './Quotes.tsx';
import { TradeScreen } from './TradeScreen.tsx';

export type TradeSub = 'quotes' | 'chart' | 'trade' | 'history';
const SUBS: TradeSub[] = ['quotes', 'chart', 'trade', 'history'];

/** Smallest timeframe that frames the whole trade and still fits in loaded history. */
export function tfForDeal(d: Deal, now: number, preload: boolean): number {
  const bars = preload ? 1400 : 300;
  const duration = Math.max(1, d.closeTime - d.openTime);
  for (const tf of TIMEFRAMES) if (duration / tf.sec <= 90 && (now - d.openTime) / tf.sec < bars - 30) return tf.sec;
  return 86400;
}

export function TradeTab({ now, m, sub, onSub, onShare }: { now: number; m: Metrics; sub: TradeSub; onSub: (s: TradeSub) => void; onShare: (d: Deal) => void }) {
  const st = useSettings();
  const t = useT();
  const [focus, setFocus] = useState<Deal | null>(null);
  const [ticket, setTicket] = useState<string | null>(null);
  const [prefill, setPrefill] = useState<TicketPrefill | undefined>(undefined);
  const sym = st.sym;

  const openChart = (s: string) => {
    if (s !== sym) setFocus(null);
    settings.set({ sym: s });
    onSub('chart');
  };
  const showDeal = (d: Deal) => {
    setFocus(d);
    settings.set({ sym: d.sym, tf: tfForDeal(d, now, st.toggles.preload) });
    onSub('chart');
    sfx.tap();
  };

  return (
    <div className="tradetab">
      <div className="subnav">
        {SUBS.map((s) => (
          <button key={s} className={sub === s ? 'on' : ''} onClick={() => { onSub(s); sfx.tap(); }}>{t(`sub.${s}`)}</button>
        ))}
      </div>
      <div className="subbody">
        {sub === 'quotes' && <Quotes now={now} current={sym} onChart={openChart} onOrder={(s) => { settings.set({ sym: s }); setTicket(s); }} />}
        {sub === 'chart' && (
          <ChartView
            sym={sym}
            now={now}
            tf={st.tf}
            focus={focus && focus.sym === sym ? focus : null}
            onSym={(s) => { setFocus(null); settings.set({ sym: s }); }}
            onTf={(tf) => settings.set({ tf })}
            onClearFocus={() => setFocus(null)}
            onNewOrder={(p) => { setPrefill(p); setTicket(sym); }}
          />
        )}
        {sub === 'trade' && <TradeScreen now={now} m={m} onNewOrder={() => setTicket(sym)} onChart={openChart} />}
        {sub === 'history' && <HistoryView onShowOnChart={showDeal} onShare={onShare} />}
      </div>
      {ticket && <OrderTicket sym={ticket} now={now} prefill={prefill} onClose={() => { setTicket(null); setPrefill(undefined); }} />}
    </div>
  );
}
