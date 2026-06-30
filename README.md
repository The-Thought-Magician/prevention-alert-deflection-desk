# Prevention Alert Deflection Desk

Prevention Alert Deflection Desk is a workbench for payments risk and operations teams that catches incoming pre-dispute alerts from the card networks (Visa RDR, Verifi CDRN, Ethoca) and helps the merchant decide, within the short 24-72 hour action window, whether to refund-and-deflect or to let the transaction proceed to representment.

A deflected pre-dispute alert never becomes a chargeback, so it never counts against the merchant's chargeback ratio, which is the number the card networks use to levy fines, mandatory reserves, and ultimately termination of processing. The product unifies the three major pre-dispute alert feeds into a single triage queue, runs a deterministic refund-vs-represent decision engine over each alert, tracks the deflection deadline so nothing silently lapses into a chargeback, projects how each decision moves the live chargeback ratio against the network monitoring-program thresholds (Visa VDMP, Mastercard ECP), and prevents double refunds by linking every alert to its underlying order. An ROI dashboard quantifies chargebacks avoided, fines averted, and reserve exposure reduced.

See [`docs/idea.md`](docs/idea.md) for the full product specification, problem statement, target users, and feature breakdown.

## Stack

- **Backend:** Hono (Node, TypeScript, ESM) running via `tsx`, with Drizzle ORM over Neon Postgres (`@neondatabase/serverless`). API mounted under `/api/v1`, health at `/health`.
- **Frontend:** Next.js 16 (App Router), React 19, TypeScript (strict), Tailwind CSS 4.
- **Auth:** Neon Auth (`@neondatabase/auth`). The Next.js proxy route resolves the session server-side and forwards a trusted `X-User-Id` header to the backend.
- **Package manager:** pnpm (always; never npm/npx/yarn).

## Local Development

Prerequisites: Node 22+, pnpm, and a Postgres connection string (Neon recommended). Provision the database schema out-of-band (the app seeds sample data on first boot but does not create its own tables).

### Backend

```bash
cd backend
pnpm install
# create backend/.env (see below)
pnpm dev
```

The backend listens on `http://localhost:3001` by default and exposes the API under `/api/v1` with a health check at `/health`.

### Frontend

```bash
cd web
pnpm install
# create web/.env.local (see below)
pnpm dev
```

The frontend runs on `http://localhost:3000`. Browser calls go to same-origin `/api/proxy/...`, which injects the authenticated `X-User-Id` and forwards to the backend.

## Environment Variables

### `backend/.env`

```
PORT=3001
DATABASE_URL=postgres://user:password@host/db?sslmode=require
FRONTEND_URL=http://localhost:3000
ADMIN_USER_IDS=
# Optional Stripe (billing returns 503 when unset):
# STRIPE_SECRET_KEY=
# STRIPE_PRO_PRICE_ID=
# STRIPE_WEBHOOK_SECRET=
```

### `web/.env.local`

```
NEON_AUTH_BASE_URL=https://<endpoint>.neonauth.<region>.aws.neon.tech/<db>/auth
NEON_AUTH_COOKIE_SECRET=<random 32-byte hex>
NEXT_PUBLIC_API_URL=http://localhost:3001
```

`NEXT_PUBLIC_API_URL` is the only public (build-time) variable; the two `NEON_AUTH_*` values are server-only.

## Billing

All features are free for signed-in users. Stripe billing is wired but optional: billing endpoints return `503` when `STRIPE_SECRET_KEY` is unset, so a Pro tier can later be gated without a rebuild.

## Deployment

- **Backend:** Render web service (`render.yaml`, Variant A — `rootDir: ""`, `cd backend && pnpm install`). Set `DATABASE_URL` and `FRONTEND_URL` as Render env vars.
- **Frontend:** Vercel (framework `nextjs`, `rootDirectory: web`, Node `22.x`).
- **Local containers:** `docker-compose.yml` brings the backend and web up together.
