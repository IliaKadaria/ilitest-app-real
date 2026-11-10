import { useSyncExternalStore } from 'react';
import { getClient } from './supabase.ts';

// ---------------------------------------------------------------------------
// Real-world market headlines. The `fetch-news` edge function pulls them every
// couple of minutes from a licensed news API (Finnhub) into `news_items`:
// headline, the provider's short summary, publisher name and a link to the
// original article. We never copy article bodies; tapping opens the source.
// New rows stream in over realtime and pop up like posts on X.
// Real headlines are context only: game prices are simulated and do not
// react to them (the in-game "Market wire" is what moves simulated prices).
// ---------------------------------------------------------------------------

export interface LiveNews {
  id: string;
  headline: string;
  summary: string;
  source: string;
  url: string;
  image: string | null;
  category: string;
  at: number;
  symbols: string[];
}

/** Map a headline to in-game symbols it is about (for highlighting & alerts). */
const KEYWORDS: [RegExp, string[]][] = [
  [/\b(fed|fomc|powell|treasur|yields?|cpi|inflation|payrolls?|jobs report)\b/i, ['EURUSD', 'USDJPY', 'XAUUSD', 'NAS100']],
  [/\b(ecb|lagarde|euro ?zone|euro)\b/i, ['EURUSD', 'EURGBP', 'EURJPY']],
  [/\b(boe|bank of england|sterling|pound|uk economy)\b/i, ['GBPUSD', 'EURGBP']],
  [/\b(boj|bank of japan|yen|japan)\b/i, ['USDJPY', 'EURJPY']],
  [/\b(snb|swiss franc)\b/i, ['USDCHF']],
  [/\b(rba|australia|aussie)\b/i, ['AUDUSD']],
  [/\b(bank of canada|loonie|canada)\b/i, ['USDCAD']],
  [/\b(gold|bullion)\b/i, ['XAUUSD']],
  [/\bsilver\b/i, ['XAGUSD']],
  [/\b(oil|crude|opec|brent|wti)\b/i, ['USOIL', 'UKOIL']],
  [/\bnatural gas|lng\b/i, ['NGAS']],
  [/\b(wheat|corn|soybeans?|grain)\b/i, ['WHEAT', 'CORN', 'SOYBEAN']],
  [/\b(coffee|cocoa|sugar)\b/i, ['COFFEE', 'COCOA', 'SUGAR']],
  [/\bcopper\b/i, ['XCUUSD']],
  [/\b(nasdaq|tech stocks|s&p|wall street|stocks)\b/i, ['NAS100']],
  [/\b(apple|iphone)\b/i, ['AAPL']],
  [/\bmicrosoft\b/i, ['MSFT']],
  [/\bnvidia\b/i, ['NVDA']],
  [/\bamazon\b/i, ['AMZN']],
  [/\b(alphabet|google)\b/i, ['GOOGL']],
  [/\b(meta|facebook|instagram)\b/i, ['META']],
  [/\btesla\b/i, ['TSLA']],
  [/\bbroadcom\b/i, ['AVGO']],
  [/\bnetflix\b/i, ['NFLX']],
  [/\b(amd|advanced micro)\b/i, ['AMD']],
  [/\bintel\b/i, ['INTC']],
];

export function symbolsFor(text: string, related: string[] = []): string[] {
  const out = new Set(related);
  for (const [re, syms] of KEYWORDS) if (re.test(text)) syms.forEach((s) => out.add(s));
  return [...out];
}

type Listener = () => void;
type NewListener = (n: LiveNews) => void;

class LiveNewsStore {
  items: LiveNews[] = [];
  /** live = server reachable and the feed table exists. */
  status: 'off' | 'loading' | 'live' | 'unavailable' = 'off';
  private listeners = new Set<Listener>();
  private fresh = new Set<NewListener>();
  private version = 0;

  subscribe = (l: Listener) => {
    this.listeners.add(l);
    return () => {
      this.listeners.delete(l);
    };
  };
  getVersion = () => this.version;
  onNew(l: NewListener) {
    this.fresh.add(l);
    return () => {
      this.fresh.delete(l);
    };
  }
  private bump() {
    this.version++;
    this.listeners.forEach((l) => l());
  }

  async start() {
    if (this.status !== 'off') return;
    const c = getClient();
    if (!c) {
      this.status = 'unavailable';
      return this.bump();
    }
    this.status = 'loading';
    this.bump();
    const sb = await c;
    const { data, error } = await sb.from('news_items').select('*').order('published_at', { ascending: false }).limit(80);
    if (error) {
      this.status = 'unavailable';
      return this.bump();
    }
    this.items = (data ?? []).map(fromRow);
    this.status = 'live';
    this.bump();
    if (this.subscribed) return;
    this.subscribed = true;
    sb.channel('apex-news')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'news_items' }, ({ new: row }) => {
        const n = fromRow(row as Record<string, unknown>);
        if (this.items.some((x) => x.id === n.id)) return;
        this.items = [n, ...this.items].sort((a, b) => b.at - a.at).slice(0, 150);
        this.bump();
        // only announce genuinely recent items (backfills arrive in batches)
        if (Date.now() / 1000 - n.at < 1800) this.fresh.forEach((l) => l(n));
      })
      .subscribe();
  }
  private subscribed = false;
}

function fromRow(r: Record<string, unknown>): LiveNews {
  const headline = String(r.headline ?? '');
  const summary = String(r.summary ?? '');
  return {
    id: String(r.id),
    headline,
    summary,
    source: String(r.source ?? 'News'),
    url: String(r.url ?? ''),
    image: (r.image as string) || null,
    category: String(r.category ?? 'general'),
    at: new Date(String(r.published_at)).getTime() / 1000,
    symbols: symbolsFor(`${headline} ${summary}`, (r.symbols as string[]) ?? []),
  };
}

export const liveNews = new LiveNewsStore();

export function useLiveNews() {
  useSyncExternalStore(liveNews.subscribe, liveNews.getVersion);
  return liveNews;
}
