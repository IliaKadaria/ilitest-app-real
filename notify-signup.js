// Called by a Supabase Database Webhook whenever a row is inserted into
// public.users (i.e. whenever someone signs up). Sends you an email via
// Resend. Protected by a shared secret so randoms can't trigger emails.
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const secret = req.headers['x-webhook-secret'];
  if (!secret || secret !== process.env.SUPABASE_WEBHOOK_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const payload = req.body || {};
  const email = payload.record && payload.record.email ? payload.record.email : 'unknown';

  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: 'Ilitest <onboarding@resend.dev>',
        to: [process.env.RESEND_TO_EMAIL],
        subject: 'New Ilitest signup',
        text: `A new user just signed up: ${email}`,
      }),
    });
    if (!r.ok) {
      console.error('Resend error', r.status, await r.text());
      return res.status(502).json({ error: 'Email send failed' });
    }
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
}
