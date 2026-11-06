import type { SupabaseClient } from '@supabase/supabase-js';

// One Supabase client for the whole app. The auth session is persisted, so a
// player who logged in once is never asked again on this device.

// The project URL and publishable key are public by design (they ship in every
// bundle; RLS + secret-checked RPCs protect the data). They are built in as a
// fallback so a deploy that drops the .env files (e.g. an upload that skips
// dotfiles) still gets online login instead of silently going offline-only.
const FALLBACK_URL = 'https://rfohrnwzfaetfgtdcggg.supabase.co';
const FALLBACK_KEY = 'sb_publishable_9ZFFhe-n70xLxu8UF47ThA_Jg1q5TIU';
const URL = (import.meta.env.VITE_SUPABASE_URL as string | undefined) || (import.meta.env.MODE === 'artifact' ? undefined : FALLBACK_URL);
const KEY = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) || (import.meta.env.MODE === 'artifact' ? undefined : FALLBACK_KEY);

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
