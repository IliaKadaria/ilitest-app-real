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
| Forex (EUR/USD, GBP/USD, USD/JPY) | 24/5: Sun 22:00 → Fri 22:00 UTC, 1:500 |
| Metals (XAU/USD, XAG/USD) | 24/5 with daily 22:00–23:00 UTC break, 1:200 |
| US Tech (ATX100 index, NVRA, QBTX, HELX: fictional) | **Open 24/7**, index 1:200, stocks 1:20 |
| Communities | Created **only by admins**. Admins toggle **Broadcast mode** (read-only for members), post announcements, polls and trade signals, delete messages, remove members. |

Prices are a deterministic function of time, so every player sees the same market and
headlines with no game server. Closed markets freeze at the close and gap on reopen.
SL/TP and stop-outs that happened while the app was closed are replayed and filled at the moment they hit.

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
