// Public (non-secret) config for the client. The Supabase anon/publishable
// key is safe to expose — Row Level Security on the database is what
// actually protects data, not hiding this key. These are hardcoded because
// they are public values; an env var would override them if ever set.
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://tptybhftjgvsgaclivdc.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'sb_publishable_QGOS4308ql5SV920w6lL3A_RIxvTldX';

export default function handler(req, res) {
  res.status(200).json({ url: SUPABASE_URL, anonKey: SUPABASE_ANON_KEY });
}
