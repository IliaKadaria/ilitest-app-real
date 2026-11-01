// Hairline icon set (1.5px strokes, inherit color via stroke=currentColor in CSS).
const P = (d: string) => <path d={d} strokeLinecap="round" strokeLinejoin="round" />;
const S = (d: string) => () => <svg viewBox="0 0 24 24">{P(d)}</svg>;

export const Icon = {
  quotes: S('M4 6h16M4 12h16M4 18h10'),
  trade: () => (
    <svg viewBox="0 0 24 24">
      {P('M7 3v4M7 15v6M17 3v8M17 17v4')}
      <rect x="5" y="7" width="4" height="8" rx="1" />
      <rect x="15" y="11" width="4" height="6" rx="1" />
    </svg>
  ),
  bars: S('M7 4v16M4 8h3M7 16h3M17 6v13M14 10h3M17 15h3'),
  line: S('M3 17l5-6 4 3 4-7 5 5'),
  chart: S('M4 4v16h16M7 15l4-5 3 3 5-6'),
  chat: S('M20 12a8 8 0 0 1-11.6 7.1L4 20l1-4.2A8 8 0 1 1 20 12Z'),
  wealth: S('M6 3h12l3 5-9 13L3 8l3-5ZM3 8h18M9 3l3 18M15 3l-3 18'),
  history: S('M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l3 2'),
  settings: () => (
    <svg viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="3" />
      {P('M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z')}
    </svg>
  ),
  lock: () => (
    <svg viewBox="0 0 24 24">
      <rect x="4.5" y="10.5" width="15" height="10" rx="2.5" />
      {P('M8 10.5V7.5a4 4 0 0 1 8 0v3M12 14.5v2.5')}
    </svg>
  ),
  broadcast: S('M4 10v4l11 5V5L4 10ZM15 9a3 3 0 0 1 0 6M18.5 7a6 6 0 0 1 0 10'),
  send: S('M5 12h13M13 6l6 6-6 6'),
  plus: S('M12 5v14M5 12h14'),
  back: S('M15 5l-7 7 7 7'),
  chevron: S('M9 5l7 7-7 7'),
  check: S('M5 12.5l4.5 4.5L19 7.5'),
  sound: S('M4 10v4h4l5 4V6L8 10H4ZM16.5 9a4 4 0 0 1 0 6'),
  mute: S('M4 10v4h4l5 4V6L8 10H4ZM17 10l4 4M21 10l-4 4'),
  trash: S('M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3'),
  clock: () => (
    <svg viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="8.5" />
      {P('M12 7.5V12l3 2')}
    </svg>
  ),
  pen: S('M4 20l4-1 11-11-3-3L5 16l-1 4ZM14 7l3 3'),
  mail: () => (
    <svg viewBox="0 0 24 24">
      <rect x="3.5" y="5.5" width="17" height="13" rx="2" />
      {P('M4 7l8 6 8-6')}
    </svg>
  ),
  news: S('M5 5h11v14H6a1 1 0 0 1-1-1V5ZM16 9h3v9a1 1 0 0 1-2 0V9M8 9h5M8 12h5M8 15h3'),
  user: () => (
    <svg viewBox="0 0 24 24">
      <circle cx="12" cy="8.5" r="3.5" />
      {P('M5 20a7 7 0 0 1 14 0')}
    </svg>
  ),
  userPlus: () => (
    <svg viewBox="0 0 24 24">
      <circle cx="10" cy="8.5" r="3.5" />
      {P('M3 20a7 7 0 0 1 14 0M19 8v6M16 11h6')}
    </svg>
  ),
  users: () => (
    <svg viewBox="0 0 24 24">
      <circle cx="9" cy="8.5" r="3.2" />
      {P('M3 19.5a6 6 0 0 1 12 0M15.5 5.5a3.2 3.2 0 0 1 0 6.2M17.5 14a6 6 0 0 1 3.5 5.5')}
    </svg>
  ),
  search: () => (
    <svg viewBox="0 0 24 24">
      <circle cx="11" cy="11" r="6.5" />
      {P('M16 16l4 4')}
    </svg>
  ),
  globe: () => (
    <svg viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="8.5" />
      {P('M3.5 12h17M12 3.5c2.5 3 2.5 14 0 17M12 3.5c-2.5 3-2.5 14 0 17')}
    </svg>
  ),
  palette: S('M12 3a9 9 0 1 0 0 18c1 0 1.5-.7 1.5-1.5 0-1.2-1-1.5-1-2.5S13.3 15.5 14.5 15.5H17a4 4 0 0 0 4-4C21 6.8 17 3 12 3ZM7.5 11h0M10 7.5h0M14.5 7.5h0'),
  bell: S('M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15L6 16ZM10 20.5a2 2 0 0 0 4 0'),
  account: () => (
    <svg viewBox="0 0 24 24">
      <rect x="3.5" y="5.5" width="17" height="13" rx="2" />
      {P('M3.5 10h17M7 15h4')}
    </svg>
  ),
  trophy: S('M8 4h8v5a4 4 0 0 1-8 0V4ZM8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M8.5 20h7M10 17h4v3h-4z'),
  wallet: () => (
    <svg viewBox="0 0 24 24">
      <rect x="3.5" y="6.5" width="17" height="12" rx="2" />
      {P('M3.5 9.5h17M16 14h1.5')}
    </svg>
  ),
  camera: () => (
    <svg viewBox="0 0 24 24">
      <circle cx="12" cy="13" r="3.5" />
      {P('M4 8h3l1.5-2h7L17 8h3v11H4V8Z')}
    </svg>
  ),
  info: () => (
    <svg viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="8.5" />
      {P('M12 11v5M12 8h0')}
    </svg>
  ),
};
