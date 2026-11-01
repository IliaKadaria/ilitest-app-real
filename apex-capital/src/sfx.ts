import { getItem, setItem } from './storage.ts';
// Synthesized SFX (Web Audio API) + haptics. Zero audio files, ~0 KB of assets.
// Browsers only allow audio after a user gesture, so we unlock on first tap.

const MUTE_KEY = 'apex.muted';

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let muted = getItem(MUTE_KEY) === '1';

function ac(): AudioContext | null {
  if (muted) return null;
  if (!ctx) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
    master = ctx.createGain();
    master.gain.value = 0.55;
    // gentle limiter so stacked sounds never clip
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -10;
    comp.ratio.value = 6;
    master.connect(comp).connect(ctx.destination);
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

/** Call from any user gesture (we also auto-bind the first pointerdown). */
export function unlockAudio() {
  const c = ac();
  if (!c) return;
  // iOS needs an actual (silent) sound started inside the gesture
  const b = c.createBuffer(1, 1, 22050);
  const s = c.createBufferSource();
  s.buffer = b;
  s.connect(master!);
  s.start(0);
}
window.addEventListener('pointerdown', unlockAudio, { once: true, capture: true });

export function isMuted() {
  return muted;
}
export function setMuted(m: boolean) {
  muted = m;
  setItem(MUTE_KEY, m ? '1' : '0');
  if (m) void ctx?.suspend();
  else unlockAudio();
}

export function buzz(pattern: number | number[]) {
  // Android Chrome supports this; iOS Safari ignores it (no web vibration API there).
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* blocked before first tap */
  }
}

// ---------------------------------------------------------------- primitives

function tone(freq: number, start: number, dur: number, opts: { type?: OscillatorType; gain?: number; slideTo?: number; attack?: number } = {}) {
  const c = ac();
  if (!c || !master) return;
  const t0 = c.currentTime + start;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = opts.type ?? 'sine';
  o.frequency.setValueAtTime(freq, t0);
  if (opts.slideTo) o.frequency.exponentialRampToValueAtTime(opts.slideTo, t0 + dur);
  const peak = opts.gain ?? 0.3;
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(peak, t0 + (opts.attack ?? 0.005));
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(master);
  o.start(t0);
  o.stop(t0 + dur + 0.05);
}

function noise(start: number, dur: number, opts: { gain?: number; hp?: number; lp?: number } = {}) {
  const c = ac();
  if (!c || !master) return;
  const t0 = c.currentTime + start;
  const len = Math.max(1, Math.floor(c.sampleRate * dur));
  const buf = c.createBuffer(1, len, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = c.createBufferSource();
  src.buffer = buf;
  let node: AudioNode = src;
  if (opts.hp) {
    const f = c.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = opts.hp;
    node = node.connect(f);
  }
  if (opts.lp) {
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = opts.lp;
    node = node.connect(f);
  }
  const g = c.createGain();
  g.gain.setValueAtTime(opts.gain ?? 0.3, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  node.connect(g).connect(master);
  src.start(t0);
}

/** Metallic bell: a few inharmonic partials. */
function bell(freq: number, start: number, dur = 0.9, gain = 0.22) {
  [1, 2.76, 5.4].forEach((m, i) => tone(freq * m, start, dur / (i + 1), { gain: gain / (i + 1.5), type: 'sine' }));
}

// ---------------------------------------------------------------- game sounds
// Understated palette: soft clicks, glass chimes, low muted tones.

export const sfx = {
  /** UI tap: soft tick. */
  tap() {
    tone(2400, 0, 0.018, { type: 'sine', gain: 0.035 });
  },

  /** Order filled: muted "tock", slightly higher for buys. */
  fill(side: 1 | -1) {
    tone(side === 1 ? 880 : 660, 0, 0.07, { type: 'sine', gain: 0.16, slideTo: side === 1 ? 990 : 590 });
    noise(0, 0.02, { gain: 0.04, hp: 4000 });
    buzz(12);
  },

  /** Profit taken: two soft glass chimes. */
  cash() {
    bell(1318.5, 0, 1.1, 0.14);
    bell(1975.5, 0.11, 1.4, 0.12);
    buzz([10, 40, 14]);
  },

  /** Large win: an ascending three-chime figure. */
  jackpot() {
    bell(1046.5, 0, 1.2, 0.13);
    bell(1318.5, 0.12, 1.3, 0.13);
    bell(1975.5, 0.24, 1.8, 0.14);
    buzz([12, 50, 12, 50, 20]);
  },

  /** Small loss: low muted thud. */
  bonk() {
    tone(150, 0, 0.22, { type: 'sine', gain: 0.22, slideTo: 95 });
    buzz(30);
  },

  /** Account frozen: vault door: deep thunk + latch + low drone. */
  vault() {
    tone(70, 0, 0.6, { type: 'sine', gain: 0.4, slideTo: 42 });
    noise(0, 0.12, { gain: 0.25, lp: 500 });
    noise(0.32, 0.05, { gain: 0.16, hp: 2500 });
    tone(55, 0.35, 2.2, { type: 'triangle', gain: 0.08, attack: 0.4 });
    buzz([120, 80, 220]);
  },

  /** Kept for API compatibility (stop-out): same as vault. */
  shatter() {
    this.vault();
  },
  sadTrombone() {
    this.vault();
  },

  /** Countdown click for scheduled releases. */
  tick(urgent = false) {
    tone(urgent ? 1900 : 1600, 0, 0.02, { type: 'sine', gain: urgent ? 0.07 : 0.045 });
  },

  /** Headline: discreet two-note terminal ping. */
  newsPing() {
    tone(1046.5, 0, 0.14, { gain: 0.08 });
    tone(1568, 0.09, 0.2, { gain: 0.07 });
  },

  /** High-impact release (CPI / FOMC / halt): three measured pulses. */
  alarm() {
    for (let i = 0; i < 3; i++) tone(1174.7, i * 0.16, 0.1, { type: 'sine', gain: 0.11 });
    buzz([40, 40, 40, 40, 40]);
  },

  /** Margin call: low two-tone. */
  marginCall() {
    tone(392, 0, 0.18, { type: 'sine', gain: 0.12 });
    tone(294, 0.2, 0.3, { type: 'sine', gain: 0.12 });
    buzz([80, 60, 80]);
  },
};
