import type { SupabaseClient } from '@supabase/supabase-js';

// One Supabase client for the whole app. The auth session is persisted, so a
// player who logged in once is never asked again on this device.

const URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const hasServer = !!(URL && KEY);

let client: Promise<SupabaseClient> | null = null;

export function getClient(): Promise<SupabaseClient> | null {
  if (!hasServer) return null;
  client ??= import('@supabase/supabase-js').then(({ createClient }) =>
    createClient(URL!, KEY!, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce', storageKey: 'apex.sb.auth' },
      realtime: { params: { eventsPerSecond: 10 } },
    }),
  );
  return client;
}
