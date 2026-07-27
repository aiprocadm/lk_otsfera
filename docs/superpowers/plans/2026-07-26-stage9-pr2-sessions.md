# Этап 9 PR-2 — Сессии и «последний вход» (ФТ-11.2, ФТ-11.3)

Спека: [2026-07-26-stage9-support-sessions-exports-design.md](../specs/2026-07-26-stage9-support-sessions-exports-design.md) §4–5 (подтверждена 26.07.2026).
Ветка `claude/stage9-pr2-sessions` от `main` (правило §14 — не стек на ветку PR-1).
Экспорты (ФТ-12.2) — PR-3.

## A. Модель (аддитивная миграция)

- [x] `User.sessionVersion Int @default(0)` + `User.lastLoginAt DateTime?`;
      миграция `stage9_pr2_session_version_last_login` + prisma:generate.
      Индексы не нужны: по полям не фильтруем и не сортируем.

## B. Ядро сессии

- [x] `jwt.ts`: `SessionPayload.sessionVersion?: number` +
      `sessionPayloadSchema.sessionVersion: z.number().int().optional()`
      (zod strip'ает неизвестные клеймы — без схемы клейм молча теряется).
      **Опциональность намеренна**: токены, выданные до деплоя, клейма не несут
      и читаются как версия 0, иначе релиз разлогинил бы всех.
- [x] `buildSessionClaims.ts`: `sessionVersion: user.sessionVersion` — единая
      точка сборки клеймов (её используют и login, и 2FA-verify).
- [x] `session.ts` (`getSession`): расширить существующий `findUnique` до
      `select: { isActive: true, sessionVersion: true }`, отвергать сессию при
      `(payload.sessionVersion ?? 0) !== user.sessionVersion`. Лишнего запроса
      нет — тот же поход в БД, что уже читает `isActive`.
- [x] **Middleware не проверяет версию** (edge-runtime, Prisma недоступен):
      носитель отозванного токена дойдёт до страницы, но `requireSession`/
      `requireRole`/`getSession` его развернут. Принятое ограничение спеки §4.

## C. Автоинкремент версии (5 точек)

- [x] `auth/passwordReset.ts` → `verifyAndConsumeToken` — одна точка на сброс
      пароля И активацию по приглашению (обе идут через неё), в той же
      транзакции, что и запись хеша.
- [x] `admin/users/mutations.ts` → `deactivateUser` (в транзакции рядом с
      `isActive: false`).
- [x] `organization/team.ts` → `deactivateMember` — **названная ТЗ дыра**:
      гасится membership, а клеймы организации живут в 7-дневном токене.
- [x] `partner/team.ts` → `deactivateMember` — то же для `partnerRole`/
      `assignedOrgIds`.
- [x] `manager/invite.ts` → `deactivateAssignment` — снятие менеджера с
      организации: `managedOrgIds` денормализованы в токен.
- [x] Реактивация версию **не трогает** (нечего отзывать — токенов уже нет).

## D. `lastLoginAt`

- [x] `api/auth/login`: запись перед выдачей токена, **не** в 2FA-ветке (там
      сессии ещё нет — только pre-auth cookie).
- [x] `api/auth/2fa/verify`: запись перед `signToken`.
- [x] Обе — best-effort (`.catch`): сбой апдейта не должен ломать вход (§3).

## E. «Выйти на всех устройствах»

- [x] Server-action `src/server-actions/security.ts` → `revokeAllSessionsAction`:
      `getSession()` (доступно всем 5 ролям), инкремент версии, аудит
      `sessions_revoked`, удаление своей cookie `session`.
- [x] Клиентская карточка `src/components/settings/security-card.tsx`
      (роль-агностичная — домен один, §4 sibling-правило не применяется):
      кнопка `danger`, после успеха — `router.push('/login')` + `refresh()`
      (образец `LogoutButton`), при ошибке — toast.
- [x] Монтаж на 5 личных settings-страниц (admin/leader/manager/partner/
      organization). Вкладку `partner/portfolio/[orgId]/settings` не трогаем —
      это настройки организации, а не профиля.

## F. Колонка «Последний вход» (ФТ-11.3)

- [x] `lib/format.ts` → `fmtLastLogin(value: Date | string | null)`:
      `—` / `сегодня, HH:mm` / `12.07.2026`; «сегодня» считается в
      Europe/Moscow (как остальные форматтеры), иначе тесты плывут от TZ CI.
- [x] `/admin/users`: `UserRow.lastLoginAt` (запрос через `include` — поле
      придёт само) + колонка в `admin/users-table.tsx`.
- [x] Команда организации: **снять заглушку** `lastLoginAt: null` в
      `listMembers` (добавить поле во вложенный `select`) + колонка в
      `organization/team-table.tsx`.
- [x] Команда партнёра: `TeamRow.lastLoginAt` + вложенный `select` + колонка в
      `partner/team-table.tsx` **и строка в мобильном `team-card-list.tsx`**
      (зеркала одних данных на одной странице).
- [x] Реестр менеджеров руководителя: `CompanyManagerRow.lastLoginAt` +
      строгий `select` + строка в `manager-roster-panel.tsx` (это `ul/li`, а не
      таблица — переверстки на TableShell не делаем).

## G. Тесты (порог 100%)

- [x] Unit: схема токена (старый токен без клейма валиден; несовпадение →
      отказ), `getSession` (isActive + version), `buildSessionClaims`,
      5 точек инкремента, `revokeAllSessionsAction` (гость → forbidden, аудит,
      cookie), карточка «Безопасность», `fmtLastLogin` (граница суток в МСК),
      4 списка (сервисы + рендер), login/2fa-verify (запись + fail-open).
- [x] Integration (живой Postgres): после revoke прежний токен не проходит
      `getSession`, новый — проходит; деактивация участника организации
      обрывает его сессию; `lastLoginAt` записывается.
- [x] Актуализация: фикстуры `lastLoginAt` в тестах org-команды, моки карточки
      «Безопасность» на 5 страничных тестах settings.

## H. Финал

- [x] typecheck / lint / unit / integration зелёные; CHANGELOG; STATUS.md; PR
      (`base: main`).
