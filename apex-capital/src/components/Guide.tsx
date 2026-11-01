import { useEffect, useState } from 'react';
import { START_BALANCE } from '../game/account.ts';
import { money } from '../format.ts';
import { sfx } from '../sfx.ts';
import type { TradeSub } from './TradeTab.tsx';

type Tab = 'trade' | 'chat' | 'wealth' | 'settings';

interface Step {
  title: string;
  body: string;
  tab: Tab;
  sub?: TradeSub;
  tips: string[];
}

const STEPS: Step[] = [
  {
    title: 'Welcome to your desk',
    body: `You start with ${money(START_BALANCE)}. Grow it through 30 ranks, from Bronze III to Quant I. Blow the account and it is frozen for a 5-hour credit review.`,
    tab: 'trade',
    sub: 'quotes',
    tips: ['Prices move in real time, 24/5 for Forex & Futures, 24/7 for Nasdaq', 'Every player trades the same market'],
  },
  {
    title: 'Quotes',
    body: 'Three lists: Forex, Futures and Nasdaq. Tap a market to open its chart.',
    tab: 'trade',
    sub: 'quotes',
    tips: ['Swipe a market left → New order · Open chart · Delete', '“Add symbol” brings deleted markets back'],
  },
  {
    title: 'Chart',
    body: 'A MetaTrader 5-style chart with timeframes from M1 to D1.',
    tab: 'trade',
    sub: 'chart',
    tips: ['f = indicators (RSI, MACD, Bollinger…)', 'Pencil = objects (lines, Fibonacci, text)', 'SELL / BUY panel trades in one tap'],
  },
  {
    title: 'Trade',
    body: 'Your balance, equity and margin, open positions and pending orders. “New order” opens the full MT5 ticket.',
    tab: 'trade',
    sub: 'trade',
    tips: ['Market, Limit, Stop and Stop Limit orders', 'Always set a Stop Loss', 'Margin level under 50% = stop-out'],
  },
  {
    title: 'History',
    body: 'Every trade you closed: market, buy or sell, volume, prices and profit.',
    tab: 'trade',
    sub: 'history',
    tips: ['“Show on chart” jumps to the exact entry and exit', 'Share big wins as a trade confirmation card'],
  },
  {
    title: 'Chat',
    body: 'Communities run by the admins, plus your own friends and private messages.',
    tab: 'chat',
    tips: ['Search a username to add a friend', 'Tap a name to see their rank, balance and groups'],
  },
  {
    title: 'Wealth',
    body: 'Your rank, the leaderboards (worldwide, your group, your friends) and your balance details.',
    tab: 'wealth',
    tips: ['Ranks are based on balance, not open profit'],
  },
  {
    title: 'Settings',
    body: 'Profile picture, accounts, mailbox, live news, language, chart colours and notifications.',
    tab: 'settings',
    tips: ['Turn on notifications to hear about take-profit fills even when the app is closed', 'You can replay this guide from Settings → About'],
  },
];

export function Guide({ onGo, onDone }: { onGo: (tab: Tab, sub?: TradeSub) => void; onDone: () => void }) {
  const [i, setI] = useState(0);
  const s = STEPS[i];
  const last = i === STEPS.length - 1;
  useEffect(() => {
    onGo(s.tab, s.sub);
  }, [i]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="guide" role="dialog" aria-modal="true" aria-labelledby="guide-title">
      <div className="guidecard">
        <div className="guidetop">
          <span className="eyebrow">Step {i + 1} of {STEPS.length}</span>
          <button className="ghost sm" onClick={() => { sfx.tap(); onDone(); }}>Skip</button>
        </div>
        <h2 id="guide-title">{s.title}</h2>
        <p>{s.body}</p>
        <ul>{s.tips.map((x) => <li key={x}>{x}</li>)}</ul>
        <div className="guidedots">{STEPS.map((_, k) => <i key={k} className={k === i ? 'on' : k < i ? 'past' : ''} />)}</div>
        <div className="row2">
          <button className="ghost" disabled={i === 0} onClick={() => setI(i - 1)}>Back</button>
          <button className="primary" onClick={() => { sfx.tap(); if (last) onDone(); else setI(i + 1); }}>{last ? 'Start trading' : 'Next'}</button>
        </div>
      </div>
    </div>
  );
}
