# TwentyThirdCentury — full-stack starter

A responsive technology/community/wellbeing platform with an Express API and SQLite persistence.

## Included
- Responsive dark futuristic frontend
- Account registration and sign-in (bcrypt password hashes, 12-hour signed bearer tokens)
- Community feed: create posts, like/unlike, comment/reply
- Mood check-ins saved per account
- Three AI guide personas (Nova, Byte, Sol); safe guided responses work without a provider key
- Optional OpenAI-compatible chat-completions integration through server-side environment variables
- API rate limits, Helmet security headers, request-size limits, SQL parameterization, and basic validation
- Member account deletion with password confirmation
- Community post reporting and administrator moderation endpoints (configure `ADMIN_EMAIL`)
- Render deployment blueprint with a persistent disk mount

## Run locally
Requirements: Node.js 20+.

```bash
npm install
cp .env.example .env
# Edit .env and set JWT_SECRET to a long random value.
npm run dev
```
Open http://localhost:3000.

The database is created at `./data/twentythirdcentury.db` by default. On Render, the Blueprint mounts persistent storage at `/var/data`.

## Deploy to Render
1. Create a GitHub repository and upload this project's files, keeping `server.js`, `package.json`, `render.yaml`, and `public/` at the repository root.
2. In Render, create a new Blueprint deployment from that repository, or create a Web Service manually.
3. Ensure the service uses `npm install` as build command and `npm start` as start command.
4. Mount a persistent disk at `/var/data`; set `DATABASE_PATH=/var/data/twentythirdcentury.db`. The included `render.yaml` defines this setup (a paid persistent disk/service may be required).
5. Set `JWT_SECRET` to a unique random secret. Never commit `.env` or API keys.
6. Optional live AI: set `OPENAI_API_KEY`, `OPENAI_MODEL`, and `OPENAI_BASE_URL` in Render's Environment settings. Without a key, the three guides use built-in guided responses.
7. Set `ADMIN_EMAIL` to the email address used by your administrator account. Register that account before opening the community.
8. Deploy and test `https://YOUR-SERVICE.onrender.com/api/health`.

**Important:** GitHub Pages only hosts static files; it cannot run this Node backend. Deploy this full-stack project to a Node host such as Render. The same service serves the frontend and API, avoiding cross-origin setup.

## Production readiness notes
This release includes account deletion API, post reporting, and a basic administrator review page at `/admin.html`. Configure `ADMIN_EMAIL` in the hosting environment to the exact email used by the administrator account; create that account and sign in before reviewing reports. A report can be dismissed or the reported post can be hidden.

This is not yet a fully audited public platform. Email verification, password reset, a formal privacy policy and terms reviewed for your jurisdiction, database backup/restore procedures, stronger automated abuse detection, and an independent security/accessibility review are still outstanding. Add an email provider before enabling account recovery or verification. The wellbeing guide is not a therapist or emergency service. Never store API keys in frontend files.

## API quick reference
- `GET /api/health`
- `POST /api/auth/register` `{ "username", "email", "password" }`
- `POST /api/auth/login` `{ "email", "password" }`
- `GET /api/me` (Bearer token)
- `GET /api/posts`
- `POST /api/posts` `{ "body" }` (Bearer token)
- `POST /api/posts/:id/like` (Bearer token)
- `POST /api/posts/:id/comments` `{ "body" }` (Bearer token)
- `POST /api/posts/:id/report` `{ "reason", "details" }` (Bearer token)
- `GET /api/admin/reports` (Bearer token; administrator only)
- `POST /api/admin/reports/:id/resolve` `{ "action": "hide|dismiss" }` (administrator only)
- `DELETE /api/me` `{ "password" }` (Bearer token)
- `POST /api/checkins` `{ "mood", "note" }` (Bearer token)
- `GET /api/checkins` (Bearer token)
- `POST /api/chat` `{ "agent": "nova|byte|sol", "message" }`
