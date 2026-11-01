# Apex Capital

A private-banking style day-trading game for mobile (PWA). MetaTrader 5 mechanics, a
Bloomberg-grade terminal and WhatsApp-style communities, all on a simulated market.

Simulated markets and funds. Not investment advice.

## Product rules

| Area | Rule |
| --- | --- |
| Opening balance | **€100.00** |
| Progression | **7 tiers / 30 divisions** (Bronze III → Quant I) on account balance, each with its own badge and status symbol (`src/game/tiers.ts`) |
| Blown account | Stop-out (50% margin level), equity ≤ 0, or balance < €1 → all positions liquidated, **5-hour lockout** on a full-screen *Private Banking · Credit Review* screen. Terminal unreachable until it ends, then a new €100 credit line. Negative balance protection applies. |
| Forex (18: 7 majors + 11 crosses) | 24/5: Sun 22:00 → Fri 22:00 UTC, 1:500. Crosses are derived from their simulated legs (EUR/JPY = EUR/USD × USD/JPY) so prices stay triangularly consistent |
| Futures (25: metals, gold/silver crosses, WTI & Brent crude, natural gas, corn, wheat, soybeans, coffee, sugar, cocoa) | 24/5 with daily 22:00–23:00 UTC break, 1:50–1:200 |
| Nasdaq (18: NAS100 + 17 large caps) | **Open 24/7** on a simulated venue, index 1:200, stocks 1:20. Real tickers, simulated prices; stock headlines only describe order flow, never company fundamentals |
| Account currency | EUR. P&L and margin are converted from the quote currency at the live simulated rate |
| Communities | Created **only by admins**. Admins toggle **Broadcast mode** (read-only for members), post announcements, polls and trade signals, delete messages, remove members. |

Prices are a deterministic function of time, so every player sees the same market and
headlines with no game server. Closed markets freeze at the close and gap on reopen.
SL/TP and stop-outs that happened while the app was closed are replayed and filled at the moment they hit.

## App layout (bottom bar)

| Tab | Contents |
| --- | --- |
| **Trade** | MT5 sub-tabs: **Quotes** (Forex / Metals / Nasdaq, swipe a row left → New order · Open chart · Delete, “Add symbol”), **Chart** (M1–D1, bars/candles/line, 10 indicators incl. RSI/MACD/Stochastic/ATR/CCI sub-windows, drawing objects: horizontal/vertical/trend line, rectangle, Fibonacci, text; one-click trading panel, OHLC + data window), **Trade** (balance/equity/margin/free/level, positions, pending orders, modify/close), **History** (Positions / Orders / Deals, period + symbol filters, **Show on chart** jumps to the exact entry → exit on the right timeframe) |
| **Chat** | Admin-run communities (WhatsApp-style, broadcast mode, polls, signals), username search, friend requests, profiles (picture, rank, balance, money made, win rate, group chats), private DMs |
| **Wealth** | Rank (division + all 30 tiers), Leaderboard (Worldwide / Your group / Friends), Your balance (balance, equity, margin, free margin, level, balance curve, stats) |
| **Settings** | Profile picture + username, New account (up to 5 demo accounts), Mailbox, News, Interface (6 languages, dark / OLED / light), Charts (all MT5 toggles + 12 colours + presets), Notifications |

Order ticket = MT5: Market Execution with deviation (requotes), Buy/Sell Limit, Buy/Sell Stop, Buy/Sell Stop Limit, SL/TP steppers, expiration (GTC / Today / Specified), live tick chart.

## Login, cloud save, admins

- First launch shows **Continue with Google / GitHub / X / e-mail** or **Play offline**, then username + password, then an 8-step guide.
  The session is persisted: players are never asked to log in again on that device. Offline accounts keep a PBKDF2 password hash locally.
- Online logins are linked to the game profile (`auth_links`) and the whole local save is mirrored to `cloud_saves` (RLS: own row only),
  so the same login restores everything on another device.
- Enable the providers in Supabase → Authentication → Providers (Google, GitHub, X/Twitter, Email) and add the app URL to the redirect allow-list.
- **Admins are decided server-side only.** Add the admin e-mail once in the SQL editor (keep it out of git):
  `insert into public.admin_emails (email) values ('you@example.com');` The account must sign in with that e-mail and have it verified.
  Admins can create communities and add markets (Settings → Admin · Markets) for every player.

## Live news

`supabase/functions/fetch-news` pulls real headlines from Finnhub (free key at finnhub.io) every 2 minutes into `news_items`:
headline, the provider's short summary, publisher and link. Article text is never copied; the app links to the publisher.
New items pop up X-style in the app and, for players who enable *Breaking news*, as a push notification.
Deploy: `supabase functions deploy fetch-news --no-verify-jwt`, `supabase secrets set FINNHUB_API_KEY=…`, then schedule it (SQL at the bottom
of `20261103000000_apex_auth_news_markets.sql`). Real headlines don't move game prices; the in-game Market wire does.

## Push notifications (TP filled while the app is closed)

The market is a pure function of time, so the client forecasts every TP/SL/stop-out/pending fill for the next
72 h (`src/game/forecast.worker.ts`, same code + same 5 s grid as the replay on reopen) and replaces its schedule
on the server whenever positions change. A cron job delivers them as Web Push.

1. Run `supabase/migrations/20261102000000_apex_social_push.sql`.
2. `npx web-push generate-vapid-keys` → put the public key in `.env.production` as `VITE_VAPID_PUBLIC_KEY`.
3. Deploy the function: `supabase functions deploy send-due-pushes --no-verify-jwt` and
   `supabase secrets set VAPID_PUBLIC_KEY=… VAPID_PRIVATE_KEY=… VAPID_SUBJECT=mailto:you@example.com CRON_SECRET=<random>`.
4. Enable `pg_cron` + `pg_net`, store the function URL and `CRON_SECRET` in Vault and schedule it every minute
   (exact SQL at the bottom of the migration).

Without steps 2–4 notifications still fire while the app is open in the background, and fills that happened while
it was closed are replayed on reopen (toast + Mailbox).
iPhone: web push only works once the app is added to the Home Screen (iOS 16.4+).

## Run

```bash
npm install
npm run dev -- --host     # open the Network URL on your phone
npm run build             # static output in dist/
npm run calibrate         # realized volatility & € per 0.01 lot per instrument
```

## Backend (Supabase project `larp-capital`, ref `rfohrnwzfaetfgtdcggg`)

Run both migrations in the SQL editor, in order:

1. `supabase/migrations/20261031000000_larp_core.sql`: players, live tape, secret-checked RPCs
2. `supabase/migrations/20261101000000_apex_communities.sql`: €100 accounts, server-side 5h lock,
   communities, members, messages, polls, moderation, house communities
3. `supabase/migrations/20261102000000_apex_social_push.sql`: new symbol universe, avatars, friends,
   private DMs (RPC-only reads), push subscriptions + forecast schedule
4. `supabase/migrations/20261103000000_apex_auth_news_markets.sql`: logins ↔ profiles, cloud saves, admin e-mails,
   admin-created markets, live news

Make yourself an admin after opening an account once in the app:

```sql
update public.players set is_admin = true where name = 'YourAlias';
```

All writes go through `security definer` RPCs that verify a per-device secret; clients only read.
If the server is unreachable or not migrated, Chat falls back to a clearly labelled **local demo**
(with a demo-admin switch) so the UX is always testable.

## Known limits

- Identity is per device (no login). A player can reinstall to dodge the lockout; real accounts
  (Supabase Auth) are needed to enforce it across devices.
- Balances are still client-reported to the leaderboard. Fine for a game; move trade validation
  server-side before any prizes.

Chart by [TradingView Lightweight Charts](https://www.tradingview.com/lightweight-charts/) (Apache-2.0, attribution kept on chart).
