import { divisionFor } from '../game/tiers.ts';
import { game } from '../game/store.ts';
import { customMarkets } from '../market/custom.ts';
import { auth } from './auth.ts';
import { claudeCaps, isArtifactBuild, watchBoard, watchMarkets, writeBoardRow } from './claudeCloud.ts';
import { net } from './net.ts';

// claude.ai artifact build: live leaderboard of everyone playing this artifact,
// plus the owner's (admin's) shared markets. Started once at boot.

let started = false;
export async function startArtifactOnline() {
  if (!isArtifactBuild || started) return;
  started = true;
  const cc = await claudeCaps();
  if (!cc) return;
  watchMarkets(cc, (rows) => customMarkets.setFromRows(rows));
  watchBoard(cc, (rows) =>
    net.setExternalBoard(rows.map((r) => ({ id: r.pid, name: r.name, balance: Number(r.balance) || 0, rank: divisionFor(Number(r.balance) || 0).label, npc: false, blownCount: r.blownCount }))),
  );
  net.onSnapshot = (s) => {
    if (auth.state?.provider !== 'claude' || auth.state.userId !== cc.id) return;
    const avatar = game.profile?.avatar;
    void writeBoardRow(cc, {
      pid: s.id,
      name: s.name,
      balance: Math.round(s.balance * 100) / 100,
      equity: Math.round(s.equity * 100) / 100,
      blownCount: s.blownCount,
      totalProfit: Math.round(s.totalProfit * 100) / 100,
      bestTrade: Math.round(s.bestTrade * 100) / 100,
      wins: s.wins,
      losses: s.losses,
      ...(avatar && avatar.length < 20000 ? { avatar } : {}),
      updatedAt: Date.now(),
    });
  };
}
