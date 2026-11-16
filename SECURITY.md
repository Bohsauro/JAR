# Security policy

## Supported versions

Only the latest version on `main` receives security fixes.

## Reporting a vulnerability

Please **don't open a public issue**. Report it privately on GitHub: open the repository's **Security** tab and choose **Report a vulnerability**.

Say what is affected, how to reproduce it and what impact you expect. You'll get an answer within 7 days. Once a fix ships you'll be credited in the release notes, unless you'd rather not be.

## What JAR protects, and what it doesn't

- `/v1/*` needs an API key (`pnk-…`). Keys are stored only as SHA-256 hashes in `data/keys.json`.
- The dashboard and `/api/*` need `PENNY_ADMIN_TOKEN`. Without it they only answer requests from localhost.
- `/v1/*` is rate limited per client IP (`PENNY_RATE_LIMIT`, default 120 requests per minute).
- JAR does **not** handle TLS. Anything beyond your LAN or VPN must go through a reverse proxy with HTTPS, because keys and the admin token travel in request headers.
- Your OpenRouter key stays in `.env` on the host and is only ever sent to OpenRouter.
