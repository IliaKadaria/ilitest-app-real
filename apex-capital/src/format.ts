const eur = new Intl.NumberFormat('en-IE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function money(v: number, signed = false): string {
  const s = eur.format(Math.abs(v));
  if (!signed) return `${v < 0 ? '−' : ''}€${s}`;
  return `${v > 0 ? '+' : v < 0 ? '−' : ''}€${s}`;
}

export function compactMoney(v: number): string {
  const a = Math.abs(v);
  const sign = v < 0 ? '−' : '';
  if (a >= 1e9) return `${sign}€${(a / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${sign}€${(a / 1e6).toFixed(2)}M`;
  if (a >= 1e4) return `${sign}€${(a / 1e3).toFixed(1)}K`;
  return money(v);
}

export function ago(sec: number): string {
  const d = Math.max(0, Math.floor(sec));
  if (d < 60) return `${d}s`;
  if (d < 3600) return `${Math.floor(d / 60)}m`;
  if (d < 86400) return `${Math.floor(d / 3600)}h`;
  return `${Math.floor(d / 86400)}d`;
}

export function clock(t: number): string {
  return new Date(t * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function hhmm(t: number): string {
  return new Date(t * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function countdown(sec: number): string {
  const s = Math.max(0, Math.ceil(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
}

export function pnlClass(v: number): string {
  return v > 0 ? 'up' : v < 0 ? 'down' : '';
}
