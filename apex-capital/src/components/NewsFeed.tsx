import { useState } from 'react';
import { recentNews, upcomingNews } from '../market/engine.ts';
import { SYMBOL_MAP } from '../market/symbols.ts';
import { useLiveNews, type LiveNews } from '../online/livenews.ts';
import { ago, countdown } from '../format.ts';

// X/Twitter-style news timeline. "Live" = real headlines from licensed
// providers (headline + short summary + link to the publisher). "Market wire"
// = the in-game feed that actually moves the simulated prices.

const handle = (source: string) => '@' + source.toLowerCase().replace(/[^a-z0-9]+/g, '');
const hue = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);

export function SourceAvatar({ source, size = 40 }: { source: string; size?: number }) {
  const initials = source.replace(/[^A-Za-z0-9 ]/g, '').split(/\s+/).filter(Boolean).map((w) => w[0]).join('').slice(0, 2).toUpperCase() || 'N';
  return (
    <span className="srcav" style={{ width: size, height: size, fontSize: size * 0.36, background: `hsl(${hue(source)} 45% 32%)` }}>
      {initials}
    </span>
  );
}

export function NewsPost({ n, onSymbol, compact = false }: { n: LiveNews; onSymbol?: (s: string) => void; compact?: boolean }) {
  return (
    <article className={`post ${compact ? 'compact' : ''}`}>
      <SourceAvatar source={n.source} size={compact ? 34 : 42} />
      <div className="postbody">
        <div className="posthead">
          <b>{n.source}</b>
          <svg viewBox="0 0 24 24" className="verified" aria-label="Publisher"><path d="M12 2l2.4 2.1 3.2-.4.9 3.1 2.8 1.6-1 3 1 3-2.8 1.6-.9 3.1-3.2-.4L12 22l-2.4-2.1-3.2.4-.9-3.1L2.7 15.6l1-3-1-3 2.8-1.6.9-3.1 3.2.4L12 2Z" /><path d="M8 12.2l2.6 2.6L16.2 9" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
          <span className="muted">{handle(n.source)} · {ago(Date.now() / 1000 - n.at)}</span>
        </div>
        <p className="posttext">{n.headline}</p>
        {!compact && n.summary && <p className="postsum">{n.summary}</p>}
        {!compact && (
          <div className="postfoot">
            {n.symbols.filter((s) => SYMBOL_MAP[s]).slice(0, 4).map((s) => (
              <button key={s} className="cashtag" onClick={() => onSymbol?.(s)}>${SYMBOL_MAP[s].name.replace('/', '')}</button>
            ))}
            {n.url && <a className="readsrc" href={n.url} target="_blank" rel="noopener noreferrer">Read on {n.source} ↗</a>}
          </div>
        )}
      </div>
    </article>
  );
}

export function NewsFeed({ now, onSymbol }: { now: number; onSymbol: (s: string) => void }) {
  const ln = useLiveNews();
  const [seg, setSeg] = useState<'live' | 'wire'>(ln.status === 'live' ? 'live' : 'wire');
  const up = upcomingNews(now);
  const past = recentNews(now, 6 * 3600);
  return (
    <>
      <div className="seg3">
        <button className={seg === 'live' ? 'on' : ''} onClick={() => setSeg('live')}>Live headlines</button>
        <button className={seg === 'wire' ? 'on' : ''} onClick={() => setSeg('wire')}>Market wire</button>
      </div>
      {seg === 'live' ? (
        <>
          {ln.status === 'live' && !ln.items.length && <div className="empty"><b>No headlines yet</b>The feed refreshes every couple of minutes.</div>}
          {ln.status !== 'live' && (
            <div className="empty">
              <b>{ln.status === 'loading' ? 'Connecting to the news feed…' : 'Live headlines are offline'}</b>
              {ln.status === 'unavailable' && 'Real-world headlines need the online server. The Market wire tab keeps working offline.'}
            </div>
          )}
          {ln.items.map((n) => <NewsPost key={n.id} n={n} onSymbol={onSymbol} />)}
          <p className="fine pad">Real headlines from licensed providers. Tap “Read on …” for the full story at the publisher. Game prices are simulated and don’t follow real-world news.</p>
        </>
      ) : (
        <>
          {up.length > 0 && <div className="section"><span className="eyebrow">Coming up</span></div>}
          {up.map((e) => (
            <div key={e.id} className="newsrow">
              <span className="tag sched">{e.kind === 'macro' ? 'CALENDAR' : 'DESK'}</span>
              <div><b>{e.teaser}</b><small className="muted">in {countdown(e.t0 - now)}</small></div>
            </div>
          ))}
          <div className="section"><span className="eyebrow">Wire · last 6 hours</span><span className="eyebrow">{past.length}</span></div>
          {past.map((e) => (
            <div key={e.id} className="newsrow" onClick={() => e.symbol && onSymbol(e.symbol)}>
              <span className={`tag ${e.kind === 'shock' ? 'sl' : e.kind === 'macro' ? 'sched' : e.dir > 0 ? 'tp' : 'sl'}`}>{e.kind === 'macro' ? 'MACRO' : e.kind === 'shock' ? 'ALERT' : SYMBOL_MAP[e.symbol ?? '']?.name ?? ''}</span>
              <div><b>{e.headline}</b><small className="muted">{ago(now - e.t0)} ago</small></div>
            </div>
          ))}
          <p className="fine pad">The market wire is part of the game: these simulated headlines are what move in-game prices.</p>
        </>
      )}
    </>
  );
}
