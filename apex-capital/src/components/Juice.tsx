import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { money } from '../format.ts';

/**
 * Re-triggers a green/red flash every time `value` moves.
 * Remounting via `key` restarts the CSS animation even on rapid ticks.
 */
export function Flash({ value, children, className = '', arrow = false }: { value: number; children: ReactNode; className?: string; arrow?: boolean }) {
  const prev = useRef(value);
  const dir = useRef<0 | 1 | -1>(0);
  const n = useRef(0);
  if (value !== prev.current) {
    dir.current = value > prev.current ? 1 : -1;
    n.current++;
    prev.current = value;
  }
  const cls = dir.current > 0 ? 'tick-up' : dir.current < 0 ? 'tick-down' : '';
  return (
    <span key={n.current} className={`${className} ${cls}`}>
      {children}
      {arrow && dir.current !== 0 && <i className="arr">{dir.current > 0 ? '▲' : '▼'}</i>}
    </span>
  );
}

interface Floater {
  id: number;
  d: number;
  x: number;
}

/** Spawns floating "+$12.40" / "-$8.10" text as a value ticks up or down. */
export function FloatPnl({ value, threshold, every = 650 }: { value: number; threshold: number; every?: number }) {
  const base = useRef(value);
  const last = useRef(0);
  const [fl, setFl] = useState<Floater[]>([]);
  useEffect(() => {
    const now = performance.now();
    const d = value - base.current;
    if (now - last.current < every || Math.abs(d) < threshold) return;
    last.current = now;
    base.current = value;
    const id = now + Math.random();
    setFl((f) => [...f.slice(-3), { id, d, x: Math.round(Math.random() * 36 - 18) }]);
    window.setTimeout(() => setFl((f) => f.filter((x) => x.id !== id)), 1300);
  }, [value, threshold, every]);
  return (
    <span className="floats" aria-hidden>
      {fl.map((f) => (
        <span key={f.id} className={`float ${f.d > 0 ? 'up' : 'down'}`} style={{ '--x': `${f.x}px` } as CSSProperties}>
          {money(f.d, true)}
        </span>
      ))}
    </span>
  );
}

export type FxKind = 'win' | 'loss' | 'news';

/** Restrained full-screen edge glow (luxury: no confetti). */
export function ScreenFx({ fx }: { fx: { kind: FxKind; n: number } | null }) {
  const [shown, setShown] = useState(fx);
  useEffect(() => {
    if (!fx) return;
    setShown(fx);
    const t = window.setTimeout(() => setShown(null), 950);
    return () => window.clearTimeout(t);
  }, [fx]);
  if (!shown) return null;
  return <div key={shown.n} className={`screenfx ${shown.kind}`} aria-hidden />;
}

/** Press-and-hold auto-repeat for steppers (thumb-friendly lot sizing). */
export function useHold(fn: () => void) {
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const timer = useRef<number | null>(null);
  const stop = () => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  };
  useEffect(() => stop, []);
  const start = () => {
    fnRef.current();
    let delay = 380;
    const loop = () => {
      fnRef.current();
      delay = Math.max(50, delay * 0.75);
      timer.current = window.setTimeout(loop, delay);
    };
    timer.current = window.setTimeout(loop, delay);
  };
  return {
    onPointerDown: (e: React.PointerEvent) => {
      e.preventDefault();
      start();
    },
    onPointerUp: stop,
    onPointerLeave: stop,
    onPointerCancel: stop,
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
  };
}
