// Supabase Edge Function: pulls real market headlines from Finnhub (licensed
// market-news API) into `news_items`, then pushes the newest ones to players
// who turned on breaking-news alerts. Called every 2 minutes by pg_cron.
//
// We store only what the API licenses for display: headline, the provider's
// short summary, publisher name, link and image. Article bodies are never
// copied; the app links out to the publisher.
//
// Secrets: FINNHUB_API_KEY (free key at finnhub.io), CRON_SECRET,
//          VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (for pushes)
import webpush from 'npm:web-push@3.6.7';
import { createClient } from 'npm:@supabase/supabase-js@2';

const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
const KEY = Deno.env.get('FINNHUB_API_KEY');
const CATEGORIES = ['general', 'forex', 'merger'];
const MAX_PUSH = 2;

interface FinnhubItem {
  id: number;
  category: string;
  datetime: number;
  headline: string;
  image: string;
  related: string;
  source: string;
  summary: string;
  url: string;
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

Deno.serve(async (req) => {
  if (req.headers.get('x-cron-secret') !== Deno.env.get('CRON_SECRET')) return new Response('unauthorized', { status: 401 });
  if (!KEY) return new Response('FINNHUB_API_KEY not set', { status: 500 });

  const batches = await Promise.all(
    CATEGORIES.map(async (c) => {
      const r = await fetch(`https://finnhub.io/api/v1/news?category=${c}&token=${KEY}`);
      return r.ok ? ((await r.json()) as FinnhubItem[]) : [];
    }),
  );
  const items = batches
    .flat()
    .filter((n) => n.headline && n.url && n.datetime)
    .map((n) => ({
      id: `fh-${n.id}`,
      headline: clip(n.headline.trim(), 300),
      summary: clip((n.summary ?? '').trim(), 280),
      source: clip(n.source || 'News', 60),
      url: n.url,
      image: n.image || null,
      category: n.category || 'general',
      symbols: (n.related || '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 8),
      published_at: new Date(n.datetime * 1000).toISOString(),
    }));
  if (!items.length) return Response.json({ inserted: 0 });

  const { data: existing } = await sb.from('news_items').select('id').in('id', items.map((i) => i.id));
  const known = new Set((existing ?? []).map((r: { id: string }) => r.id));
  const fresh = items.filter((i) => !known.has(i.id));
  if (fresh.length) await sb.from('news_items').upsert(fresh, { onConflict: 'id', ignoreDuplicates: true });
  await sb.from('news_items').delete().lt('published_at', new Date(Date.now() - 3 * 86400_000).toISOString());

  // breaking-news pushes: only genuinely new, recent items, newest first
  let pushed = 0;
  const recent = fresh.filter((i) => Date.now() - Date.parse(i.published_at) < 20 * 60_000).sort((a, b) => Date.parse(b.published_at) - Date.parse(a.published_at)).slice(0, MAX_PUSH);
  if (recent.length && Deno.env.get('VAPID_PRIVATE_KEY')) {
    webpush.setVapidDetails(Deno.env.get('VAPID_SUBJECT') ?? 'mailto:admin@example.com', Deno.env.get('VAPID_PUBLIC_KEY')!, Deno.env.get('VAPID_PRIVATE_KEY')!);
    const { data: subs } = await sb.from('push_subscriptions').select('endpoint, p256dh, auth').eq('news', true).limit(5000);
    for (const n of recent)
      await Promise.all(
        (subs ?? []).map(async (s: { endpoint: string; p256dh: string; auth: string }) => {
          try {
            await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify({ title: n.source, body: n.headline, tag: n.id }), { TTL: 1800 });
            pushed++;
          } catch (e) {
            const code = (e as { statusCode?: number }).statusCode;
            if (code === 404 || code === 410) await sb.from('push_subscriptions').delete().eq('endpoint', s.endpoint);
          }
        }),
      );
  }
  return Response.json({ fetched: items.length, inserted: fresh.length, pushed });
});
