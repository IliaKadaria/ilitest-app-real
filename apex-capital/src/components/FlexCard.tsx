import { useEffect, useRef, useState } from 'react';
import { midPrice } from '../market/engine.ts';
import { SYMBOL_MAP, fmtPrice } from '../market/symbols.ts';
import { requiredMargin, type Deal } from '../game/account.ts';
import { divisionFor } from '../game/tiers.ts';
import { money } from '../format.ts';
import { sfx } from '../sfx.ts';

const W = 1080;
const H = 1350;
const MONO = "'Geist Mono Variable', ui-monospace, monospace";
const SANS = "'Geist Variable', system-ui, sans-serif";

/** Private-bank trade confirmation, rendered to a 4:5 PNG. */
function draw(cv: HTMLCanvasElement, d: Deal, name: string, balance: number) {
  const ctx = cv.getContext('2d')!;
  const def = SYMBOL_MAP[d.sym];
  const win = d.profit >= 0;
  const accent = win ? '#4cc38a' : '#e5484d';
  const hair = 'rgba(229,229,231,0.14)';

  const g = ctx.createRadialGradient(W / 2, -200, 50, W / 2, -200, 1500);
  g.addColorStop(0, '#1d1e22');
  g.addColorStop(1, '#0b0b0c');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = hair;
  ctx.lineWidth = 2;
  ctx.strokeRect(48, 48, W - 96, H - 96);

  const line = (y: number) => {
    ctx.strokeStyle = hair;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(96, y);
    ctx.lineTo(W - 96, y);
    ctx.stroke();
  };

  ctx.fillStyle = '#e5e5e7';
  ctx.textAlign = 'left';
  ctx.font = `600 34px ${SANS}`;
  ctx.letterSpacing = '14px';
  ctx.fillText('APEX CAPITAL', 96, 150);
  ctx.letterSpacing = '6px';
  ctx.fillStyle = '#8e8e93';
  ctx.font = `500 22px ${MONO}`;
  ctx.fillText('TRADE CONFIRMATION', 96, 196);
  ctx.textAlign = 'right';
  ctx.fillText('SIMULATED', W - 96, 196);
  ctx.letterSpacing = '0px';
  line(236);

  const div = divisionFor(balance);
  ctx.textAlign = 'left';
  ctx.fillStyle = '#8e8e93';
  ctx.font = `400 28px ${SANS}`;
  ctx.fillText(`${name}  ·  ${div.label}`, 96, 300);

  ctx.fillStyle = accent;
  ctx.font = `400 138px ${MONO}`;
  ctx.fillText(money(d.profit, true), 88, 450);
  ctx.fillStyle = '#8e8e93';
  ctx.font = `400 26px ${SANS}`;
  const roi = (d.profit / requiredMargin(d.sym, d.lots, d.open, d.openTime)) * 100;
  ctx.fillText(`Realized ${win ? 'profit' : 'loss'}  ·  ${roi >= 0 ? '+' : '−'}${Math.abs(roi).toFixed(1)}% on margin`, 96, 500);

  // price path during the trade
  const n = 140;
  const pts: number[] = [];
  for (let i = 0; i <= n; i++) pts.push(midPrice(d.sym, d.openTime + ((d.closeTime - d.openTime) * i) / n));
  const lo = Math.min(...pts);
  const hi = Math.max(...pts);
  const top = 580;
  const bot = 820;
  const x = (i: number) => 96 + (i / n) * (W - 192);
  const y = (p: number) => bot - ((p - lo) / (hi - lo || 1)) * (bot - top);
  const fill = ctx.createLinearGradient(0, top, 0, bot);
  fill.addColorStop(0, win ? 'rgba(76,195,138,0.18)' : 'rgba(229,72,77,0.18)');
  fill.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.beginPath();
  pts.forEach((p, i) => (i ? ctx.lineTo(x(i), y(p)) : ctx.moveTo(x(i), y(p))));
  ctx.lineTo(x(n), bot);
  ctx.lineTo(x(0), bot);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.beginPath();
  pts.forEach((p, i) => (i ? ctx.lineTo(x(i), y(p)) : ctx.moveTo(x(i), y(p))));
  ctx.strokeStyle = accent;
  ctx.lineWidth = 4;
  ctx.lineJoin = 'round';
  ctx.stroke();
  line(870);

  const rows: [string, string][] = [
    ['Instrument', `${def.name}  ·  ${def.desc}`],
    ['Side / Volume', `${d.side === 1 ? 'BUY' : 'SELL'}  ${d.lots.toFixed(2)} lots`],
    ['Open → Close', `${fmtPrice(def, d.open)}  →  ${fmtPrice(def, d.close)}`],
    ['Executed', new Date(d.closeTime * 1000).toLocaleString([], { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })],
  ];
  rows.forEach(([k, v], i) => {
    const yy = 935 + i * 66;
    ctx.textAlign = 'left';
    ctx.fillStyle = '#8e8e93';
    ctx.font = `400 26px ${SANS}`;
    ctx.fillText(k, 96, yy);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#e5e5e7';
    ctx.font = `400 26px ${MONO}`;
    ctx.fillText(v, W - 96, yy);
  });
  line(1190);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#5c5c62';
  ctx.font = `400 22px ${SANS}`;
  ctx.fillText(`Simulated trading game. No real funds.  ${location.host || 'apex.capital'}`, W / 2, 1250);
}

export function FlexCard({ deal, name, balance, onClose }: { deal: Deal; name: string; balance: number; onClose: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const win = deal.profit >= 0;
  const caption = `${win ? 'Closed' : 'Took a loss on'} ${SYMBOL_MAP[deal.sym].name}: ${money(deal.profit, true)} · Apex Capital (simulated)`;

  // Render + encode up front so the Share tap stays inside the user gesture (iOS requirement).
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    let cancelled = false;
    void document.fonts.ready.then(() => {
      if (cancelled) return;
      draw(cv, deal, name, balance);
      cv.toBlob((b) => {
        if (!b || cancelled) return;
        setBlob(b);
        setUrl(URL.createObjectURL(b));
      }, 'image/png');
    });
    return () => {
      cancelled = true;
    };
  }, [deal, name, balance]);
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);

  const fileName = `apex-confirmation-${deal.sym}-${Math.round(deal.closeTime)}.png`;
  const file = blob ? new File([blob], fileName, { type: 'image/png' }) : null;
  const canShareFile = !!file && !!navigator.canShare?.({ files: [file] });
  const flash = (m: string) => {
    setMsg(m);
    window.setTimeout(() => setMsg(null), 2400);
  };

  const share = () => {
    sfx.tap();
    if (!file) return;
    if (canShareFile) navigator.share({ files: [file], text: caption }).catch(() => {});
    else if (navigator.share) navigator.share({ text: caption, url: location.href }).catch(() => {});
    else save();
  };
  const save = () => {
    sfx.tap();
    if (!url) return;
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    flash('Saved. On iPhone you can also long-press the image → Save to Photos.');
  };
  const copy = async () => {
    sfx.tap();
    try {
      if (blob && 'ClipboardItem' in window) {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        flash('Image copied to clipboard.');
      } else {
        await navigator.clipboard.writeText(caption);
        flash('Caption copied to clipboard.');
      }
    } catch {
      flash('Clipboard unavailable. Use Save instead.');
    }
  };

  return (
    <div className="modal" onClick={onClose}>
      <div className="sheet stmt" onClick={(e) => e.stopPropagation()}>
        <div className="grab" />
        <canvas ref={ref} width={W} height={H} style={{ display: 'none' }} />
        {url ? <img src={url} alt="Trade confirmation" /> : <div className="empty">Preparing confirmation…</div>}
        <div className="row2" style={{ gridTemplateColumns: '1.4fr 1fr 1fr' }}>
          <button className="primary" disabled={!blob} onClick={share}>{canShareFile ? 'Share' : 'Share link'}</button>
          <button disabled={!blob} onClick={save}>Save</button>
          <button disabled={!blob} onClick={copy}>Copy</button>
        </div>
        {msg && <div className="sheetmsg">{msg}</div>}
        <button className="ghost" onClick={onClose}>Close</button>
      </div>
    </div>
  );
}
