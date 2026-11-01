import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}

if (import.meta.env.DEV) {
  // Dev-only test hook (stripped from production builds).
  void Promise.all([import('./game/store.ts'), import('./online/net.ts'), import('./sfx.ts'), import('./market/engine.ts'), import('./components/OrderPanel.tsx'), import('./online/comms.ts'), import('./market/symbols.ts'), import('./game/tiers.ts')]).then(
    ([s, n, f, e, o, c, sy, ti]) => Object.assign(window, { __apex: { game: s.game, net: n.net, sfx: f.sfx, engine: e, stepLots: o.stepLots, comms: c.comms, symbols: sy, tiers: ti } }),
  );
}
