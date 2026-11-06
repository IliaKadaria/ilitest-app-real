import type { Division } from '../game/tiers.ts';

const GLYPH: Record<string, string> = { bronze: 'B', silver: 'S', gold: 'G', platinum: 'P', diamond: 'D', syndicate: 'Σ', quant: 'Q' };

/** Engraved medallion: tier metal, division numeral. Pure SVG, crisp at any size. */
export function Badge({ d, size = 40 }: { d: Division; size?: number }) {
  const p = d.tier.palette;
  const id = `b${d.idx}`;
  const facets = d.tier.key === 'diamond' || d.tier.key === 'quant';
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" role="img" aria-label={d.label} style={{ flexShrink: 0 }}>
      <defs>
        <linearGradient id={`${id}g`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={p.b} />
          <stop offset="0.55" stopColor={p.a} />
          <stop offset="1" stopColor={p.b} />
        </linearGradient>
        <linearGradient id={`${id}s`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.35" />
          <stop offset="0.5" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
      </defs>
      {facets ? (
        <polygon points="32,3 58,18 58,46 32,61 6,46 6,18" fill={`url(#${id}g)`} stroke={p.rim} strokeWidth="1.2" />
      ) : (
        <circle cx="32" cy="32" r="29" fill={`url(#${id}g)`} stroke={p.rim} strokeWidth="1.2" />
      )}
      <circle cx="32" cy="32" r="22" fill="none" stroke={p.rim} strokeOpacity="0.45" strokeWidth="0.8" />
      {facets ? <polygon points="32,3 58,18 58,46 32,61 6,46 6,18" fill={`url(#${id}s)`} /> : <circle cx="32" cy="32" r="29" fill={`url(#${id}s)`} />}
      <text x="32" y="33" textAnchor="middle" fontFamily="Geist Variable, system-ui" fontWeight="600" fontSize="19" fill={p.ink}>
        {GLYPH[d.tier.key]}
      </text>
      <text x="32" y="47" textAnchor="middle" fontFamily="Geist Mono Variable, monospace" fontWeight="600" fontSize="8.5" letterSpacing="1" fill={p.ink} fillOpacity="0.8">
        {d.roman}
      </text>
    </svg>
  );
}
