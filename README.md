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
- Ensure `apps/web/vercel.json` points `/api/*` rewrites to your Pxxl API URL.

### Pxxl (api)

- Root directory: `apps/api`
- Build command: `npm run build`
- Start command: `npm run start`
- Set environment values from `apps/api/.env.example`.
- API server listens on `process.env.PORT`.
