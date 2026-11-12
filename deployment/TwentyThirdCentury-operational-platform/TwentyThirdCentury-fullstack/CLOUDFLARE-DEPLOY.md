# TwentyThirdCentury — Cloudflare free deployment

This is isolated from the existing Render website and GitHub main branch.

## Free-tier architecture
- Cloudflare Workers serves the API and static assets from public/.
- Cloudflare D1 stores accounts, posts, comments, likes, mood check-ins and reports.
- AI specialists use built-in guided responses. No paid AI API is configured.
- No custom domain is required; use the free workers.dev hostname.

## One-time Cloudflare account setup
1. Create or sign in to Cloudflare and stay on the Free plan. Do not add a paid plan or payment method.
2. In Workers & Pages, enable the free workers.dev subdomain.
3. Create a D1 database named twentythirdcentury-db on the free plan.
4. Copy its database ID into wrangler.toml in place of REPLACE_WITH_CLOUDFLARE_D1_DATABASE_ID.
5. Create a Worker secret named JWT_SECRET with a random value of at least 32 characters. Keep it private.
6. Apply migrations/0001_initial.sql to D1 using the dashboard SQL console or Wrangler.
7. Deploy with Wrangler. Stop if Cloudflare asks you to enable Workers Paid or enter payment details.

## CLI deployment
Install Node.js 20+ and Wrangler, then from this folder:
```sh
npm install
npx wrangler d1 execute twentythirdcentury-db --remote --file=migrations/0001_initial.sql
npx wrangler deploy
```
Wrangler may ask you to authenticate to Cloudflare. Confirm the Free plan and correct account before proceeding.

## Verify
- Open https://<your-worker>.<your-subdomain>.workers.dev/
- Check /api/health returns ok: true and database: connected.
- Test registration, sign-in, post creation, comments, likes, check-ins and report moderation.
- Keep the existing Render site separate until all tests pass.

## Security and limits
- Passwords are PBKDF2-HMAC-SHA-256 hashed; raw passwords are never stored.
- JWT signing key is a Worker secret, not committed to Git.
- Basic per-isolate request throttles are not globally coordinated.
- Free Workers have daily request and CPU limits. D1 has free daily read/write and storage quotas. Requests may fail if limits are reached.
- Admin is determined by ADMIN_EMAIL; register using that address.
- Built-in guided AI replies are enabled; no paid AI API key is required.
