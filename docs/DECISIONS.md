# Architecture Decisions (Scaffold)

- Monorepo with npm workspaces (`apps/*`, `packages/*`).
- Frontend deploy target: Vercel (`apps/web`).
- API deploy target: Pxxl long-running Node server (`apps/api`).
- Shared schemas/types live in `packages/shared`.
- Feature-level and infrastructure decisions will be added as their assigned milestones proceed.

## M0: API routing and hosting verification

- **API path mapping:** Express routes are rooted at `/`. The Vercel web project rewrites `/api/:path*` to the Pxxl origin at `/:path*`, stripping the public `/api` prefix. The health handler also accepts both `/healthz` and `/api/healthz` so direct API checks remain compatible.
- **Pxxl origin:** Not yet supplied or verified. `apps/web/vercel.json` intentionally retains `PXXL_API_URL_PLACEHOLDER`; do not substitute a guessed hostname.
- **Pxxl sleep/cold start, request timeout, memory limit, environment-variable support, root directory, and start-command behavior:** Not verified in this workspace. Confirm these in the Pxxl service/dashboard when deployment is configured; record measured or explicitly reported values here.
- **Vercel preview integration:** Explicitly deferred by the owner until environment variables and deployment are set up. No preview has been deployed or verified; this check remains pending, not passed. Verify `<preview-origin>/api/healthz` returns `200 { "ok": true }` through the rewrite once a preview is available.
- **M0 status:** Local API routing, tests, and web-shell work are reviewable and locally verifiable. Hosting checks are deferred and remain a later validation gate; do not report them as passed. Proceeding to M1 does not change this pending status.
