# План — Этап 4: онбординг по приглашению (один PR)

Спека: [2026-07-24-stage4-invite-onboarding-design.md](../specs/2026-07-24-stage4-invite-onboarding-design.md) — ✅ подтверждена («всё да, PR один»).
Ветка: `claude/stage4-invite-onboarding`.

REQUIRED SUB-SKILL: superpowers:subagent-driven-development (по желанию).

## A. ФТ-10.1 — письма всюду + фолбэк

- [x] A1. `email/templates/partner-invite.tsx`: `PartnerInviteTemplate` +
  subject/text (по образцу `OrgInviteTemplate`: кто пригласил, партнёр, роль,
  кнопка «Установить пароль», срок 7 дней); реэкспорт в `templates/index.ts`;
  `sendPartnerInviteEmail` в `email/send.tsx`.
- [x] A2. `partner/team.ts::inviteMember`: `passwordHash: null` +
  `createInviteToken` → `{ user, partnerUser, inviteUrl }`; временный пароль
  удаляется. `POST /api/partner/team`: отправка письма (best-effort),
  в ответ `inviteUrl` + `emailStatus`.
- [x] A3. `invite-member-form.tsx` (partner): после успеха — ссылка +
  «Скопировать» (паттерн org-формы), формулировка про письмо/фолбэк.
- [x] A4. Leader-путь: `server-actions/manager/team.ts::leaderAssignManagerAction`
  шлёт `sendManagerInviteEmail` (как admin-путь), best-effort.

## B. ФТ-10.2 — повторная отправка и копия ссылки

- [x] B1. Сервис `src/lib/services/team/resend.ts`: `resendInvite(prisma,
  session, { userId })` — скоупы (org-admin: активный участник своей org;
  partner-admin: своей команды; admin: любой без пароля; leader/manager —
  менеджеры своей компании), гейты: user активен, `passwordHash === null`;
  старые невыгоревшие invite-токены гасятся (`usedAt = now`), новый токен
  7 дней; rate-limit 5/час на приглашающего; аудит `invite_resent`;
  результат `{ inviteUrl, emailStatus }` (письмо по роли приглашённого).
- [x] B2. Server-actions обёртки: organization/partner/admin (+ leader) →
  `resendInviteAction`.
- [x] B3. UI: org `team-table`, partner `partner-team-table`, `/admin/users` —
  у участников без пароля кнопки «Отправить письмо повторно» и
  «Скопировать ссылку» (клиентский компонент, тосты об исходе).
- [x] B4. Как узнать «без пароля» в таблицах: сервисы списков команд отдают
  `hasPassword`/`invitePending` (не сам hash).

## C. ФТ-10.3 — «Добро пожаловать» для приглашённых

- [x] C1. `passwordReset.ts`: `peekTokenPurpose(prisma, rawToken)` — по sha256
  находит токен, возвращает `{ purpose, valid }` без погашения.
- [x] C2. `/reset-password/page.tsx`: при валидном invite-токене — заголовок
  «Добро пожаловать! Придумайте пароль» + подпись; reset — как сейчас;
  невалидный — как сейчас (форма сама покажет ошибку при сабмите).

## D. ФТ-10.4 — welcome-блок

- [x] D1. Миграция: `User.welcomeSeenAt DateTime?` (additive); prisma generate.
- [x] D2. Server-action `dismissWelcomeAction` (org/partner общий, ставит
  `welcomeSeenAt=now` себе).
- [x] D3. Sibling-карточки `org-welcome-card.tsx` / `partner-welcome-card.tsx`:
  приветствие по имени, 3 карточки-ссылки (enrollments / certificates /
  documents; выключенные флагами → «Заказы»/«Финансы»), кнопка «Скрыть».
- [x] D4. Дашборды org/partner: рендер блока при `welcomeSeenAt == null`
  (welcomeSeenAt читается по session.sub).

## E. Тесты (порог 100%) и ворота

- [x] E1. partner/team: invite-токен вместо temp-пароля (unit + integration),
  письмо/фолбэк, роут.
- [x] E2. resendInvite: скоупы всех ролей, гашение старых токенов, rate-limit,
  «уже с паролем» → validation, аудит; server-actions; UI-кнопки.
- [x] E3. `peekTokenPurpose` + страница (renderServerComponent): invite/reset/
  невалидный; показ не гасит токен (integration).
- [x] E4. welcome: рендер при null, скрытие, автозамена карточек по флагам;
  dismiss-action; миграция (integration: колонка есть, дефолт null).
- [x] E5. Обновить существующие invite/team-тесты под новую модель партнёра.
- [x] E6. `typecheck` / `lint` / `test:unit` зелёные; integration по затронутым
  местам на живом Postgres; CHANGELOG; STATUS; PR.
