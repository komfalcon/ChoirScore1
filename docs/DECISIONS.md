# Architecture Decisions (Scaffold)

- Monorepo with npm workspaces (`apps/*`, `packages/*`).
- Frontend deploy target: Vercel (`apps/web`).
- API deploy target: Pxxl long-running Node server (`apps/api`).
- Shared schemas/types live in `packages/shared`.
- TODO: capture feature-level and infra decisions as they are made.
