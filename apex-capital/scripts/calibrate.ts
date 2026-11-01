// Measures realized volatility, € per minute per 0.01 lot, and news frequency.
// Usage: npm run calibrate [-- <unix seconds>]   (defaults to last Wednesday 12:00 UTC)
import { midPrice, recentNews } from '../src/market/engine.ts';
import { SYMBOLS, isOpen, pnlFor, notional } from '../src/market/symbols.ts';

const arg = Number(process.argv[2]);
const d = new Date();
d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 4) % 7 || 7));
d.setUTCHours(12, 0, 0, 0);
const at = Number.isFinite(arg) && arg > 0 ? arg : Math.floor(d.getTime() / 1000);
console.log('at', new Date(at * 1000).toISOString());
for (const s of SYMBOLS) {
  const rets: number[] = [];
  for (let i = 0; i < 2000; i++) {
    const t = at - i * 61;
    if (!isOpen(s, t) || !isOpen(s, t - 60)) continue;
    rets.push(Math.log(midPrice(s.id, t) / midPrice(s.id, t - 60)));
  }
  const med = [...rets].map(Math.abs).sort((x, y) => x - y)[rets.length >> 1] * 1.4826;
  const px = midPrice(s.id, at);
  const eurPerMin = Math.abs(pnlFor(s, med * px, 0.01, px));
  const margin = notional(s, 0.01, px) / s.leverage;
  console.log(`${s.id.padEnd(7)} px ${px.toFixed(s.digits).padStart(10)}  target ${(s.vol1m * 100).toFixed(3)}%  robust ${(med * 100).toFixed(3)}%  0.01 lot: €${eurPerMin.toFixed(2)}/min, margin €${margin.toFixed(2)}`);
}
console.log('news last hour:', recentNews(at, 3600).length);
recentNews(at, 3600).slice(0, 5).forEach((e) => console.log('  ', e.kind.padEnd(5), e.headline));
