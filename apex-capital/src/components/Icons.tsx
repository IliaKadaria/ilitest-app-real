// Hairline icon set (1.5px strokes, inherit color via stroke=currentColor in CSS).
const P = (d: string) => <path d={d} strokeLinecap="round" strokeLinejoin="round" />;

export const Icon = {
  quotes: () => <svg viewBox="0 0 24 24">{P('M4 6h16M4 12h16M4 18h10')}</svg>,
  trade: () => (
    <svg viewBox="0 0 24 24">
      {P('M7 3v4M7 15v6M17 3v8M17 17v4')}
      <rect x="5" y="7" width="4" height="8" rx="1" />
      <rect x="15" y="11" width="4" height="6" rx="1" />
    </svg>
  ),
  chat: () => <svg viewBox="0 0 24 24">{P('M20 12a8 8 0 0 1-11.6 7.1L4 20l1-4.2A8 8 0 1 1 20 12Z')}</svg>,
  wealth: () => <svg viewBox="0 0 24 24">{P('M6 3h12l3 5-9 13L3 8l3-5ZM3 8h18M9 3l3 18M15 3l-3 18')}</svg>,
  history: () => <svg viewBox="0 0 24 24">{P('M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l3 2')}</svg>,
  lock: () => (
    <svg viewBox="0 0 24 24">
      <rect x="4.5" y="10.5" width="15" height="10" rx="2.5" />
      {P('M8 10.5V7.5a4 4 0 0 1 8 0v3M12 14.5v2.5')}
    </svg>
  ),
  broadcast: () => <svg viewBox="0 0 24 24">{P('M4 10v4l11 5V5L4 10ZM15 9a3 3 0 0 1 0 6M18.5 7a6 6 0 0 1 0 10')}</svg>,
  send: () => <svg viewBox="0 0 24 24">{P('M5 12h13M13 6l6 6-6 6')}</svg>,
  plus: () => <svg viewBox="0 0 24 24">{P('M12 5v14M5 12h14')}</svg>,
  back: () => <svg viewBox="0 0 24 24">{P('M15 5l-7 7 7 7')}</svg>,
  sound: () => <svg viewBox="0 0 24 24">{P('M4 10v4h4l5 4V6L8 10H4ZM16.5 9a4 4 0 0 1 0 6')}</svg>,
  mute: () => <svg viewBox="0 0 24 24">{P('M4 10v4h4l5 4V6L8 10H4ZM17 10l4 4M21 10l-4 4')}</svg>,
};
