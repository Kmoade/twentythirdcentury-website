# TwentyThirdCentury — Cloudflare Free deployment

This directory is a self-contained deployment copy. It does not replace the existing Render website or the GitHub main branch.

## No-payment guardrails

- Create/use a Cloudflare account on the Free plan only.
- Do not add a payment method, enable Workers Paid, purchase a domain, or configure paid add-ons.
- Use the free workers.dev hostname.
- Stop if any step requests payment or an upgrade.

## Cloudflare setup

1. Sign in to Cloudflare and confirm the account is on the Free plan.
2. Open Workers & Pages and enable the free workers.dev subdomain.
3. Create one D1 database named twentythirdcentury-db. Free accounts allow up to 10 D1 databases; each database is limited to 500 MB and the account has 5 GB total storage.
4. Copy the D1 database ID into wrangler.toml, replacing REPLACE_WITH_CLOUDFLARE_D1_DATABASE_ID.
5. Create a Worker secret named JWT_SECRET with a random value of at least 32 characters. Keep it private; do not commit it.
6. Install Node.js 20+ and run these commands from this directory:

```sh
npm install
npx wrangler login
npx wrangler d1 execute twentythirdcentury-db --remote --file=migrations/0001_initial.sql
npx wrangler secret put JWT_SECRET
npx wrangler deploy
```

Wrangler login and deployment should use the Cloudflare Free account. If Cloudflare prompts for Workers Paid or billing details, cancel and stop.

## Test before switching traffic

Open the workers.dev URL returned by Wrangler and verify:
- Homepage, styling, game and all navigation render.
- GET /api/health returns ok:true and database:connected.
- Create an account, sign in, publish a post, comment, like, report a post and save a mood check-in.
- Sign in using the configured ADMIN_EMAIL to review moderation at /admin.html.
- Verify the site still works after a reload and a new session.

Do not remove or change the existing Render deployment. It stays live until you explicitly approve switching over after tests pass.

## Included functionality

- Worker API for registration/login, community feed, likes, comments, reports, admin moderation, mood check-ins and account deletion.
- D1 schema and indexes.
- Built-in guided Nova, Byte and Sol replies; no external paid AI API.
- PBKDF2-HMAC-SHA-256 password hashes and signed 12-hour JWT sessions.

## Free-plan ceilings

Workers Free currently allows 100,000 requests/day and 10 ms CPU time per request. D1 Free allows 5 million rows read/day, 100,000 rows written/day, 500 MB per database, and 5 GB total account storage. If a daily limit is reached, database queries stop until reset; no automatic paid upgrade is configured. See official limits and pricing:
- https://developers.cloudflare.com/workers/platform/limits/
- https://developers.cloudflare.com/d1/platform/limits/
- https://developers.cloudflare.com/d1/platform/pricing/

Basic request throttling in this Worker is isolate-local, not a globally coordinated rate limiter. Test authentication CPU usage on the free plan before launch.
