# Architecture Decisions (Scaffold)

- Monorepo with npm workspaces (`apps/*`, `packages/*`).
- Frontend deploy target: Vercel (`apps/web`).
- API deploy target: Pxxl long-running Node server (`apps/api`).
- Shared schemas/types live in `packages/shared`.
- Feature-level and infrastructure decisions will be added as their assigned milestones proceed.

## M0: API routing and hosting verification

- **API path mapping:** Express routes are rooted at `/`. The Vercel web project rewrites `/api/:path*` to the Pxxl origin at `/:path*`, stripping the public `/api` prefix. The health handler also accepts both `/healthz` and `/api/healthz` so direct API checks remain compatible.
- **Pxxl origin:** Not yet supplied or verified. `apps/web/vercel.json` intentionally retains `PXXL_API_URL_PLACEHOLDER`; do not substitute a guessed hostname.
- **Pxxl sleep/cold start, request timeout, memory limit, environment-variable support, root directory, and start-command behavior:** Not verified in this workspace. Confirm these in the Pxxl service/dashboard and record measured or explicitly reported values here before M0 acceptance.
- **Vercel preview integration:** Not deployed or verified. The acceptance check remains pending until a real preview is configured and `<preview-origin>/api/healthz` returns `200 { "ok": true }` through the rewrite.
- **M0 status:** Local scaffold checks can pass independently, but M0 is not accepted until Pxxl hosting behavior and the Vercel-to-Pxxl preview health check are verified.
