// Proxies chat/vision requests to the Anthropic API. The API key lives only
// in this server-side environment variable — it is never sent to the client.
// Requires a valid Supabase session token so only signed-in app users (not
// random internet traffic) can spend your Anthropic quota.
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://tptybhftjgvsgaclivdc.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'sb_publishable_QGOS4308ql5SV920w6lL3A_RIxvTldX';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Missing session token' });

  try {
    const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: SUPABASE_ANON_KEY,
      },
    });
    if (!userRes.ok) return res.status(401).json({ error: 'Invalid session' });
  } catch (err) {
    return res.status(401).json({ error: 'Could not verify session' });
  }

  const { messages } = req.body || {};
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'Missing messages' });
  }

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-5',
        max_tokens: 1024,
        messages,
      }),
    });
    if (!r.ok) {
      const errText = await r.text();
      console.error('Anthropic error', r.status, errText);
      return res.status(502).json({ error: 'AI request failed' });
    }
    const data = await r.json();
    const text = (data.content || []).map((b) => b.text || '').join('');
    res.status(200).json({ text });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
}
