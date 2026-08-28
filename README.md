# Nam Anh Studio Worker

## What changed

- Customer order creation remains unauthenticated.
- D1 is the source of truth for prices and order persistence.
- Order creation errors are logged server-side and return a safe production error; there is no fake success path.
- Tracking uses a 128-bit+ random token (`crypto.randomUUID()` with hyphens removed).
- Admin API requires a valid Cloudflare Access JWT and then an exact email allowlist check for `vunamanhnguyen@proton.me`.
- The Worker does not trust `localStorage`, request-body roles, or an arbitrary email header.
- Existing order price snapshots remain stored on each order.

## Required Cloudflare Access configuration

The static Vercel site cannot enforce server-side authentication on `/admin/index.html` by itself. Put the production hostname behind Cloudflare (proxied DNS) and create a Cloudflare Access application covering:

- `/admin`
- `/admin/`
- `/admin/*`
- `/api/admin/*`

Use Google as the identity provider and create an allow policy for exactly:

`vunamanhnguyen@proton.me`

All other identities must be denied. The Access application must inject `CF-Access-Jwt-Assertion` and the Worker must receive that request after Access has authenticated it.

Set these Worker variables:

- `CF_ACCESS_TEAM_DOMAIN` — your Access team domain, e.g. `https://example.cloudflareaccess.com`
- `CF_ACCESS_AUD` — the Access application's Audience (AUD) tag
- `DB` — the real D1 binding/database ID
- `APP_ORIGIN` only if the API is intentionally hosted on a different origin

Do not expose any Access secret/private key in frontend code.

## D1

Apply existing migrations to the intended production database. Do not reset production data:

`wrangler d1 migrations apply nam-anh-studio --remote`

Then deploy:

`wrangler deploy`

## Important deployment note

Protecting only `/api/admin/*` is not sufficient. The Access application must also cover `/admin/*`; otherwise a Vercel-hosted static `admin/index.html` can still be downloaded directly even though its API calls are protected.

## Testing

1. Allowed Google account -> `/admin` -> dashboard.
2. Other Google account -> `/admin` -> Access denied before reaching the dashboard.
3. Logged-out direct `/admin/index.html` -> Access login.
4. Logged-out `/api/admin/orders` -> 401.
5. Authenticated non-allowlisted account -> `/api/admin/orders` -> 403.
6. Allowed admin -> `/api/admin/orders` -> data.
7. Customer -> `/api/orders` POST -> no account required; order is persisted before success is returned.
8. Customer -> `/api/admin/*` -> never receives admin data.
9. Admin logout -> Access session ends; subsequent `/admin` access requires authentication again.
