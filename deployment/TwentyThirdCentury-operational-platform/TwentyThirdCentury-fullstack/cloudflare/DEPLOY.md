# TwentyThirdCentury — Cloudflare Free deployment

This directory is a self-contained Cloudflare Pages project. Pages serves the website, Pages Functions execute the Worker API, and D1 stores application data. It is isolated from the existing Render website and GitHub main branch.

## No-payment guardrails

- Use a Cloudflare account on the Free plan only.
- Do not add a payment method, enable Workers Paid, purchase a domain, or configure paid add-ons.
- Use the free pages.dev hostname.
- Stop if any step requests payment or an upgrade.

## Create the D1 database

1. Sign in to Cloudflare and confirm the account is on the Free plan.
2. Open Workers & Pages → D1 SQL Database and create a database named twentythirdcentury-db.
3. Copy the database ID into wrangler.toml, replacing REPLACE_WITH_CLOUDFLARE_D1_DATABASE_ID. The ID is not a secret.
4. Apply migrations/0001_initial.sql using the D1 SQL console, or with Wrangler from this directory:
   `npm install`
   `npx wrangler login`
   `npx wrangler d1 execute twentythirdcentury-db --remote --file=migrations/0001_initial.sql`

## Create the Pages project

1. Open Workers & Pages → Create application → Pages → Connect to Git.
2. Select repository Kmoade/twentythirdcentury-website and branch operational-platform.
3. Set the project root directory to:
   deployment/TwentyThirdCentury-operational-platform/TwentyThirdCentury-fullstack/cloudflare
4. Set the build command to `npm install` and the build output directory to `public`.
5. Keep the Free plan and deploy. The `functions/api/[[path]].js` file routes /api requests to the Worker backend.
6. In Pages → Settings → Functions → D1 database bindings, bind variable name `DB` to `twentythirdcentury-db`.
7. In Pages → Settings → Variables and Secrets, add:
   - Secret `JWT_SECRET`: a random value of at least 32 characters. Keep it private; do not commit it.
   - Variable `ADMIN_EMAIL`: `sekatanekhanyi@gmail.com`.
8. Redeploy after adding bindings/secrets so the production deployment receives them.

Do not enable a paid plan or enter billing information. If Cloudflare prompts for Workers Paid or payment details, cancel and stop.

## Test before switching traffic

Open the new `pages.dev` URL and verify:
- Homepage, styling, game and navigation render.
- GET /api/health returns `ok: true` and `database: "connected"`.
- Create an account, sign in, publish a post, comment, like, report a post and save a mood check-in.
- Sign in using the configured ADMIN_EMAIL to review moderation at /admin.html.
- Verify the site still works after reload and a new session.

Do not remove or change the existing Render deployment. It stays live until all tests pass and you explicitly approve switching over.

## Included functionality

- Worker API for registration/login, community feed, likes, comments, reports, admin moderation, mood check-ins and account deletion.
- D1 schema and indexes.
- Built-in guided Nova, Byte and Sol replies; no paid AI API.
- PBKDF2-HMAC-SHA-256 password hashes and signed 12-hour JWT sessions.

## Free-plan ceilings

Workers Free currently allows 100,000 requests/day and 10 ms CPU time per request. D1 Free allows 5 million rows read/day, 100,000 rows written/day, 500 MB per database, and 5 GB total account storage. If a daily limit is reached, database queries stop until reset; no automatic paid upgrade is configured. Static asset requests on Workers are free and unlimited, and Pages has a free plan. See:
- https://developers.cloudflare.com/workers/platform/limits/
- https://developers.cloudflare.com/d1/platform/limits/
- https://developers.cloudflare.com/d1/platform/pricing/
- https://developers.cloudflare.com/pages/platform/limits/

Basic request throttling in this Worker is isolate-local, not a globally coordinated rate limiter. Authentication CPU usage must be checked against the free 10 ms CPU limit during testing.
