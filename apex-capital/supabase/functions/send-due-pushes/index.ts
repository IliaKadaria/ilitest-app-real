// Supabase Edge Function: delivers forecast TP/SL/stop-out pushes that are due.
// Invoked every minute by pg_cron (see migration 20261102000000).
//
// Secrets (supabase secrets set ...):
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto:you@example.com), CRON_SECRET
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by the platform.
import webpush from 'npm:web-push@3.6.7';
import { createClient } from 'npm:@supabase/supabase-js@2';

const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
webpush.setVapidDetails(Deno.env.get('VAPID_SUBJECT') ?? 'mailto:admin@example.com', Deno.env.get('VAPID_PUBLIC_KEY')!, Deno.env.get('VAPID_PRIVATE_KEY')!);

Deno.serve(async (req) => {
  if (req.headers.get('x-cron-secret') !== Deno.env.get('CRON_SECRET')) return new Response('unauthorized', { status: 401 });
  const { data, error } = await sb.rpc('claim_due_pushes', { p_limit: 500 });
  if (error) return new Response(error.message, { status: 500 });
  let sent = 0;
  let dropped = 0;
  await Promise.all(
    (data ?? []).map(async (r: { title: string; body: string; tag: string; endpoint: string; p256dh: string; auth: string }) => {
      try {
        await webpush.sendNotification({ endpoint: r.endpoint, keys: { p256dh: r.p256dh, auth: r.auth } }, JSON.stringify({ title: r.title, body: r.body, tag: r.tag }), { TTL: 3600, urgency: 'high' });
        sent++;
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) {
          dropped++;
          await sb.rpc('drop_push_endpoint', { p_endpoint: r.endpoint });
        }
      }
    }),
  );
  return Response.json({ sent, dropped });
});
