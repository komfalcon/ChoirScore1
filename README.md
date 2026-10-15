# ChoirScore

Scaffold-only monorepo for a private choir score app.

## Project structure

- `apps/web` - React + Vite + TypeScript + Tailwind
- `apps/api` - Node.js + Express + TypeScript
- `packages/shared` - shared Zod schemas and TypeScript types
- `docs` - product/API/decision docs placeholders

## Local development

1. Install dependencies:
   ```bash
   npm install
   ```
2. Start API in one terminal:
   ```bash
   npm run dev --workspace @choirscore/api
   ```
3. Start web app in another terminal:
   ```bash
   npm run dev --workspace @choirscore/web
   ```

## Build and test

```bash
npm run build
npm run test
npm run lint
```

## Deploy

### Vercel (web)

- Root directory: `apps/web`
- Install command: `cd ../.. && npm ci` (the root install override in `apps/web/vercel.json`)
- Build command: `cd ../.. && npm run build --workspace @choirscore/shared && npm run build --workspace @choirscore/web` (builds shared before web)
- These commands require Vercel to expose repository files above `apps/web` while the Root Directory remains `apps/web`. Enable `Include source files outside of the Root Directory in the Build Step`; Vercel enables this by default for new projects, but verify this project's setting.
- Output directory: `dist`
- Set `PXXL_API_URL` in the Vercel project environment to the Pxxl API origin (scheme and host, without a trailing slash). The Vercel route uses this value at request time; do not put the API origin in `VITE_*` variables or hardcode it in the repository. Keep `VITE_API_BASE=/api` so browser requests and session cookies stay same-origin.

### Pxxl (api)

- Root directory: `apps/api`
- Build command: `npm run build`
- Start command: `npm run start`
- Set environment values from `apps/api/.env.example`.
- API server listens on `process.env.PORT`.
- Mistral uses the official `https://api.mistral.ai/v1/chat/completions` endpoint by default. `AI_BASE_URL` is privileged deployment configuration, not user input: leave it blank for the official default or set the full trusted HTTPS chat-completions endpoint. Startup validation checks only that a nonblank value is a parseable HTTPS URL without userinfo; it does not verify host trust or that the path targets chat completions. Configure a trusted host and the correct full endpoint path at deployment. The configured path is used as-is (not appended), provider fetch rejects redirects, and endpoint configuration and secrets are not logged.
- The timeout is 60 seconds per HTTP attempt. The initial provider call plus up to two repairs can make up to six HTTP attempts (one retry per call); retrying after a timeout may leave upstream work and cost ambiguous.
