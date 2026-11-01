import { midPrice } from '../market/engine.ts';
import { noise1, rand, strSeed } from '../market/rng.ts';
import { SYMBOLS, SYMBOL_MAP, isOpen, pnlFor } from '../market/symbols.ts';

// Deterministic NPC traders: every device sees the same desk activity at the
// same second, with P&L computed from the shared market.

export const NPC_NAMES = [
  'M.Laurent', 'K.Tanaka', 'A.Okafor', 'S.Lindqvist', 'R.Castellano', 'J.Whitmore', 'E.Moreau', 'D.Nakamura',
  'L.Bianchi', 'H.AlSayed', 'C.VanDijk', 'T.Beaumont', 'N.Petrov', 'F.Ortega', 'I.Kowalski', 'P.Ashford',
  'V.Rousseau', 'G.Haddad', 'Y.Sato', 'B.Fairfax',
];

const NPC_SEED = strSeed('apex-npc-v1');
export const NPC_SLOT = 9;

export interface NpcTrade {
  key: string;
  name: string;
  sym: string;
  side: 1 | -1;
  lots: number;
  tOpen: number;
  tClose: number;
  openPx: number;
}

export function npcTradeForSlot(slot: number): NpcTrade | null {
  if (rand(NPC_SEED, slot, 0) > 0.5) return null;
  const tOpen = slot * NPC_SLOT + Math.floor(rand(NPC_SEED, slot, 5) * NPC_SLOT);
  const open = SYMBOLS.filter((s) => isOpen(s, tOpen));
  if (!open.length) return null;
  const name = NPC_NAMES[Math.floor(rand(NPC_SEED, slot, 1) * NPC_NAMES.length)];
  const sym = open[Math.floor(rand(NPC_SEED, slot, 2) * open.length)].id;
  const side: 1 | -1 = rand(NPC_SEED, slot, 3) < 0.55 ? 1 : -1;
  // heavy-tailed: mostly 0.01–0.5 lots, occasionally a whale ticket
  const lots = Math.max(0.01, Math.round(0.01 * Math.pow(300, rand(NPC_SEED, slot, 4) ** 1.8) * 100) / 100);
  const tClose = tOpen + 25 + Math.floor(Math.pow(rand(NPC_SEED, slot, 6), 2) * 900);
  return { key: `npc-${slot}`, name, sym, side, lots, tOpen, tClose, openPx: midPrice(sym, tOpen) };
}

export function npcProfit(tr: NpcTrade): number {
  const def = SYMBOL_MAP[tr.sym];
  const close = midPrice(tr.sym, tr.tClose);
  return pnlFor(def, (close - tr.openPx) * tr.side - def.spread, tr.lots, close);
}

/** Slowly drifting NPC balances spanning every tier (€120 → ~€12M). */
export function npcBalance(name: string, t: number): number {
  const s = strSeed(name);
  const lvl = Math.log(120) + rand(s, 1) * (Math.log(12_000_000) - Math.log(120)) + 0.9 * noise1(s, t / 86400) + 0.25 * noise1(s ^ 7, t / 3600);
  return Math.max(60, Math.exp(lvl));
}
