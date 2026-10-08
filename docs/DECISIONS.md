# Architecture Decisions (Scaffold)

- Monorepo with npm workspaces (`apps/*`, `packages/*`).
- Frontend deploy target: Vercel (`apps/web`).
- API deploy target: Pxxl long-running Node server (`apps/api`).
- Shared schemas/types live in `packages/shared`.
- Feature-level and infrastructure decisions will be added as their assigned milestones proceed.

## M0: API routing and hosting verification

- **API path mapping:** Express routes are rooted at `/`. The Vercel web project rewrites `/api/:path*` to the Pxxl origin at `/:path*`, stripping the public `/api` prefix. The health handler also accepts both `/healthz` and `/api/healthz` so direct API checks remain compatible.
- **Pxxl origin:** Not yet supplied or verified. `apps/web/vercel.json` intentionally retains `PXXL_API_URL_PLACEHOLDER`; do not substitute a guessed hostname.
- **Pxxl sleep/cold start, request timeout, memory limit, ability to set env vars, root directory, and start-command behavior:** Not verified in this workspace. Confirm these in the Pxxl service/dashboard when deployment is configured; record measured or explicitly reported values here.
- **Vercel preview integration:** Explicitly deferred by the owner until environment variables and deployment are set up. No preview has been deployed or verified; this check remains pending, not passed. Verify `<preview-origin>/api/healthz` returns `200 { "ok": true }` through the rewrite once a preview is available.
- **M0 status:** Local API routing, tests, and web-shell work are reviewable and locally verifiable. Hosting checks are deferred and remain a later validation gate; do not report them as passed. Proceeding to M1 does not change this pending status.

## M1: API auth, users, and data

- **Persistence:** Use the configured libSQL/Turso client through a Drizzle-backed repository interface. Apply numbered SQL migrations transactionally at API startup and record applied files in `schema_migrations`; keep connection/configuration outside route modules.
- **M1 schema:** Store timestamps as ISO-8601 UTC text. Enforce roles, voice parts, active/forced-change flags, username uniqueness, non-negative AI limits and foreign-key/index constraints in the initial migration. The PRD's score/AI data tables are schema foundations only; M1 does not add score, MusicXML, or AI routes.
- **Password hashing:** Add `bcryptjs` because the scaffold had no password-hashing library and a pure-JavaScript bcrypt implementation is deployable without native build tooling. Hash at cost 12; generated account passwords use a readable unambiguous alphabet. Reject user-selected passwords over 72 UTF-8 bytes so bcrypt cannot silently treat distinct long inputs as the same password.
- **Session tokens:** Build HS256 JWT signing/verification with Node's `crypto` rather than adding a JWT dependency. Keep the token solely in a 7-day Secure, HttpOnly, SameSite=Lax cookie; reload the user from the repository on every valid authenticated request.
- **Throttle:** Keep a bounded 5-attempt/60-second per-IP-and-normalized-username counter and 15-minute lockout in the single long-running API process; prune expired entries and fail closed at capacity. The actual trusted-proxy hop count must be set/verified for deployment before treating source-IP attribution as deployed-verified.
- **CSRF/CORS/logging:** Require the exact `X-Requested-With: choirscore` header on every state-changing method; accept only exact configured origins; enable Helmet; log request id/method/path/status/duration without request bodies, headers, cookies, credentials or exception messages. Insert one redacted audit event in the same DB transaction as every successful admin action.
- **Test databases:** Use isolated file-backed libSQL databases for server integration tests so schema migration and transaction behavior is exercised across persistent connections.
- **Status:** M1 route tests are local only. The owner-deferred Vercel-to-Pxxl check remains pending, not passed.
