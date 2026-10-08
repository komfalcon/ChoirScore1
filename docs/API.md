# ChoirScore API (M0 scaffold)

## Base and routing

- The Express API serves routes from `/`.
- The web client uses `/api` as its same-origin API base. Vercel rewrites `/api/:path*` to the Pxxl API origin at `/:path*`, stripping the public `/api` prefix before forwarding.
- The Pxxl API origin is intentionally unresolved in `apps/web/vercel.json`; replace its placeholder with the verified HTTPS service origin when configuring deployment. Do not commit credentials or secrets.

## Health

- `GET /healthz` - direct API health check; returns `200 { "ok": true }`.
- `GET <vercel-preview-origin>/api/healthz` - browser-visible M0 check; Vercel strips `/api` and forwards to the Pxxl `GET /healthz` route, which returns `200 { "ok": true }`.

## Other routes

- Auth, users, scores, AI, and admin routers are scaffold placeholders; document endpoints as their assigned milestones implement them.
