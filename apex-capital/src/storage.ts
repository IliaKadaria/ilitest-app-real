// localStorage can be missing or throw (sandboxed iframes, Safari private mode,
// storage full). The game must keep running either way, so never touch it directly.
const mem = new Map<string, string>();

export function getItem(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return mem.get(key) ?? null;
  }
}

export function setItem(key: string, value: string): void {
  mem.set(key, value);
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* in-memory only for this session */
  }
}
