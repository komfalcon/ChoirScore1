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
- Build command: `npm run build`
- Output directory: `dist`
- Set `PXXL_API_URL` in the Vercel project environment to the Pxxl API origin (scheme and host, without a trailing slash). The Vercel route uses this value at request time; do not put the API origin in `VITE_*` variables or hardcode it in the repository. Keep `VITE_API_BASE=/api` so browser requests and session cookies stay same-origin.

### Pxxl (api)

- Root directory: `apps/api`
- Build command: `npm run build`
- Start command: `npm run start`
- Set environment values from `apps/api/.env.example`.
- API server listens on `process.env.PORT`.
