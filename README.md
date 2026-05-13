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
3. Run migrations (local development):
```bash
docker compose exec app npx prisma migrate dev
```

For production/deploy use:
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


## RBAC matrix (expected behavior)

| Route prefix | Allowed roles |
| --- | --- |
| `/admin/*` | `admin` |
| `/manager/*` | `manager` |
| `/partner/*` | `partner`, `admin` |
| `/organization/*` | `organization`, `admin` |
| `/student/*` | `student`, `organization`, `admin`, `manager` |

## Smoke-checklist: admin/manager навигация и редиректы

1. Неавторизованный пользователь:
   - открыть `/admin/dashboard` → редирект на `/login`.
   - открыть `/manager/dashboard` → редирект на `/login`.
2. Авторизованный `admin`:
   - открыть `/` или `/dashboard` → редирект на `/admin/dashboard`.
   - открыть `/admin/orders`, `/admin/documents`, `/admin/messages` → страницы доступны.
   - открыть любой `/manager/*` → редирект на `/forbidden`.
3. Авторизованный `manager`:
   - открыть `/` или `/dashboard` → редирект на `/manager/dashboard`.
   - открыть `/manager/orders`, `/manager/documents`, `/manager/messages` → страницы доступны.
   - открыть любой `/admin/*` → редирект на `/forbidden`.
4. Авторизованный пользователь другой роли (`partner`, `organization`, `student`):
   - открыть `/admin/*` и `/manager/*` → редирект на `/forbidden`.

## Student bridge JWT contract

Для перехода в внешний student-портал используется короткоживущий JWT (`signStudentBridgeToken`) со следующими правилами:

- **Claims**:
  - `sub`: идентификатор пользователя-студента.
  - `role`: всегда `student`.
  - `organizationId`, `email`, `name`, `externalStudentId`: контекст студента.
  - `jti`: уникальный идентификатор токена для одноразовой валидации.
  - `iat`, `exp`: время выпуска и окончания действия.
  - `aud`: `external-student-portal`.
  - `iss`: значение `STUDENT_BRIDGE_ISSUER` (fallback на `APP_URL`).
- **TTL**: берется из `STUDENT_BRIDGE_TTL` в секундах, ограничивается диапазоном **300..900** (по умолчанию `600`).
- **Подпись**: HS256, секрет `STUDENT_BRIDGE_JWT_SECRET` (fallback на `JWT_SECRET`).
- **Валидация** (`verifyStudentBridgeToken`):
  - обязательная проверка `aud=external-student-portal`;
  - обязательная проверка `iss=STUDENT_BRIDGE_ISSUER|APP_URL`;
  - обязательная проверка наличия `jti` и `exp`;
  - `jti` помечается как использованный в таблице `StudentBridgeTokenJti`; повторное использование блокируется как replay.

Рекомендация по эксплуатации: периодически очищать из `StudentBridgeTokenJti` записи с `expiresAt < now()` фоновым job/cron.

## API RBAC matrix

| Endpoint | Method | Allowed roles |
| --- | --- | --- |
| `/api/orders` | `GET` | `admin`, `organization`, `partner`, `manager` |
| `/api/orders/:id` | `PATCH` | `admin`, `organization`, `partner`, `manager` (with order access scope check) |
| `/api/documents` | `GET` | `admin`, `organization`, `partner`, `manager` |
| `/api/documents/upload` | `POST` | `admin`, `organization`, `partner`, `manager` (with order access scope check) |
| `/api/documents/:id/download` | `POST` | `admin`, `organization`, `partner`, `manager` (with document/order access scope check) |
| `/api/comments` | `POST` | `admin`, `organization`, `partner`, `manager` (with order access scope check) |
| `/api/notifications` | `GET`, `PATCH` | `admin`, `organization`, `partner`, `manager` |
| `/api/student/bridge/token` | `POST` | `student` |

Все указанные endpoint'ы возвращают `401`, если сессия отсутствует, и `403`, если роль пользователя не разрешена для конкретного ресурса.
