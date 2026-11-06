// Online mode inside a claude.ai artifact. The sandbox blocks Google/GitHub/X
// redirects and every outside server, but the page can identify the viewer by
// their Claude account (`user`) and keep data in the artifact's database
// (`db`): a private per-player save, a shared leaderboard and the admin's
// markets. The artifact's owner is the verified admin.
//
// Declared capabilities (see README): db rules
//   players         read view, write owner
//   players/{self}  write interact      (each player writes only their row)
//   markets         read view, write owner (admin only)
//   data/users/{self} private save (platform default)

/* eslint-disable @typescript-eslint/no-explicit-any */
type Db = any;
type User = any;

export interface ClaudeCaps {
  db: Db;
  user: User;
  id: string;
  isOwner: boolean;
}

let caps: Promise<ClaudeCaps | null> | null = null;

/** Resolves the viewer's Claude identity + database, or null outside an artifact / when signed out. */
export function claudeCaps(): Promise<ClaudeCaps | null> {
  caps ??= (async () => {
    // window.claude can appear shortly after the page's first script run
    for (let i = 0; i < 30 && !(window as any).claude?.use; i++) await new Promise((r) => setTimeout(r, 100));
    const c = (window as any).claude;
    if (!c?.use) return null;
    try {
      const [db, user] = await Promise.all([c.use('db'), c.use('user')]);
      if (!db || !user) return null;
      const id = await user.id();
      if (!id) return null;
      let isOwner = false;
      try {
        isOwner = !!(await user.isOwner());
      } catch {
        /* not told */
      }
      return { db, user, id: String(id), isOwner };
    } catch {
      return null;
    }
  })();
  return caps;
}

/** True when the page runs as a claude.ai artifact build. */
export const isArtifactBuild = import.meta.env.MODE === 'artifact';

// ---------------------------------------------------------------- private save (one doc per storage key, ≤256 KiB each)
const saveCol = (c: ClaudeCaps) => c.db.collection(`data/users/${c.id}/save`);
const docId = (k: string) => k.replace(/[^A-Za-z0-9_.\-~:@+]/g, '_');

export async function readSave(c: ClaudeCaps): Promise<Record<string, string> | null> {
  const snap = await saveCol(c).get();
  if (snap.empty) return null;
  const out: Record<string, string> = {};
  for (const d of snap.docs) {
    const v = d.data();
    if (v && typeof v.key === 'string' && typeof v.value === 'string') out[v.key] = v.value;
  }
  return Object.keys(out).length ? out : null;
}

const written = new Map<string, string>();
/** Write only the keys that changed since the last save, one at a time. */
export async function writeSave(c: ClaudeCaps, data: Record<string, string>): Promise<void> {
  for (const [key, value] of Object.entries(data)) {
    if (written.get(key) === value) continue;
    if (value.length > 240_000) continue; // a single key over the per-document limit stays local
    await saveCol(c).doc(docId(key)).set({ key, value, at: Date.now() });
    written.set(key, value);
  }
}

// ---------------------------------------------------------------- shared leaderboard
export interface BoardRow {
  pid: string;
  name: string;
  balance: number;
  equity: number;
  blownCount: number;
  totalProfit: number;
  bestTrade: number;
  wins: number;
  losses: number;
  avatar?: string;
  updatedAt: number;
}

let lastRow = '';
let lastWrite = 0;
export async function writeBoardRow(c: ClaudeCaps, row: BoardRow, force = false) {
  const key = JSON.stringify({ ...row, equity: Math.round(row.equity), updatedAt: 0 });
  if (key === lastRow || (!force && Date.now() - lastWrite < 15_000)) return;
  lastRow = key;
  lastWrite = Date.now();
  try {
    await c.db.doc(`players/${c.id}`).set({ ...row, updatedAt: Date.now() });
  } catch {
    /* a viewer without write access still plays; their row just isn't shared */
  }
}

export function watchBoard(c: ClaudeCaps, onRows: (rows: BoardRow[]) => void): () => void {
  return c.db
    .collection('players')
    .orderBy('balance', 'desc')
    .limit(200)
    .onSnapshot(
      (snap: any) => onRows(snap.docs.map((d: any) => d.data()).filter((r: any) => r && typeof r.pid === 'string')),
      () => {},
    );
}

// ---------------------------------------------------------------- admin markets
export function watchMarkets(c: ClaudeCaps, onRows: (rows: Record<string, unknown>[]) => void): () => void {
  return c.db.collection('markets').onSnapshot(
    (snap: any) => onRows(snap.docs.map((d: any) => d.data()).filter(Boolean)),
    () => {},
  );
}
export async function putMarket(c: ClaudeCaps, row: Record<string, unknown>) {
  await c.db.doc(`markets/${String(row.id)}`).set(row);
}
export async function deleteMarket(c: ClaudeCaps, id: string) {
  await c.db.doc(`markets/${id}`).delete();
}
