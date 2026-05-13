# B2B Cabinet MVP (Next.js + Supabase + Prisma)

## Stack
Next.js 15, TypeScript, Tailwind, Prisma, PostgreSQL, Supabase Auth/Storage.

## Quick start
1. Copy env:
```bash
cp .env.example .env
```
2. Start with Docker:
```bash
docker compose up --build
```
3. Run migrations:
```bash
docker compose exec app npx prisma migrate deploy
```

## Features
- Auth via JWT cookie + RBAC (organization/partner/student/manager/admin)
- Dashboard with orders/documents/comments summary
- Orders list/detail
- Documents metadata + upload endpoint
- Order comments API
- Dark mode support via Tailwind class
- Middleware route protection
- Basic audit log model

## Deployment
- Works on VPS by Docker
- Works on Vercel + managed Postgres/Supabase


## New cabinets (MVP)
- `/partner/dashboard` — dashboard партнера с агрегированными метриками.
- `/organization/dashboard` — dashboard организации.
- `/student` + `/student/redirect` — временный SSO-like переход во внешний LMS по signed JWT.
- Middleware ограничивает доступ по ролям и изолирует кабинеты.
