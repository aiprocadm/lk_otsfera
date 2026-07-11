# Staff 2FA (email-код) — close-out

**Дата:** 2026-07-11
**Ветка:** `claude/staff-2fa` (stacked поверх `claude/release-hardening-r0`)
**Спека:** [2026-07-11-staff-2fa-design.md](../specs/2026-07-11-staff-2fa-design.md)
**План:** [2026-07-11-staff-2fa.md](2026-07-11-staff-2fa.md)

## Что отгружено

Обязательная 2FA по email-коду для staff-ролей (admin/manager/leader) за opt-in
флагом `FEATURE_STAFF_2FA`, с backup-кодами восстановления. Все 15 задач плана
выполнены по TDD, каждая — отдельный коммит.

- **Модель** (`TwoFactorChallenge` @unique userId, `TwoFactorBackupCode`
  @unique codeHash; миграция `20260710223120_staff_2fa`). Коды хранятся sha256.
- **Флаг** `staff_2fa` (opt-in, поведенческий — точки чтения в комментарии
  флага; матрица и §5 CLAUDE.md обновлены).
- **Сервис** `lib/services/auth/twoFactor.ts`: challenge create (upsert, TTL
  10 мин), verify (успех/просрочка/attempts=5/backup-fallback/invalid), backup
  codes (10×base32, транзакционная перегенерация). Unit + integration.
- **Pre-auth JWT** `signTwoFactorPendingToken` с `purpose:'2fa'` без `role` —
  `verifyToken`/`getSession` его отвергают (guard-тест).
- **buildSessionClaims** вынесен из login-роута — login и verify выдают
  идентичный session-JWT.
- **Роуты**: login-ветка (staff+флаг → email-challenge + `2fa_pending` cookie,
  502 при сбое письма), `2fa/verify` (обмен кода на сессию), `2fa/resend`
  (cooldown 30с + ≤3/окно). Все — тонкие, RU-коды в `errorMessageRu`.
- **UI**: двухшаговая `LoginForm` (код + resend-countdown + backup + «Назад»);
  секция «Коды восстановления» в settings admin/manager/leader (self-service);
  админ-перевыпуск кодов сотруднику из карточки `/admin/users/[id]`.
- **Email**: шаблон `two-factor-code.tsx` (код в теле, не в subject).

## Отличия от плана

- **Task 3 (RU-коды):** `invalid_code` уже был в `messages.ts` (telegram/max
  link делят строку «Код недействителен или истёк.») — не дублировали, 2FA
  переиспользует. Добавлено 4 новых кода + позже `not_staff` (Task 14).
- **Task 5 (сравнение):** оставлено `===` на sha256-хешах (не `secretEquals`) —
  сравниваются хеши, не секреты; тайминг префикс не раскрывает. Зафиксировано
  комментарием в сервисе.
- **Task 14 (админ-перевыпуск):** сигнатура подогнана под фактический стиль
  `admin/users/mutations.ts` (`actorUserId` + `AdminUserError`, не
  `SessionPayload`); UI — не Dialog-примитив, а инлайн-контрол в карточке
  (проще, показ кодов один раз тем же паттерном, что self-service секция).
- **Финальная верификация:** первый полный `test:coverage` вскрыл 5 файлов с
  недобитыми ветками (clientIp x-forwarded-for, default-message арки формы,
  pending-лейблы кнопок, copy-failure, rethrow) — закрыто отдельным
  test-коммитом; мёртвый null-guard в settings-секции удалён рефактором.

## Верификация

typecheck ✅ · lint (max-warnings=0) ✅ · полный `test:coverage`
(unit+integration) — 100% всех метрик после закрытия гэпов.

## Rollout

После мержа: убедиться, что доставка писем работает (`EMAIL_ENABLED=true` +
`RESEND_API_KEY`), затем `FEATURE_STAFF_2FA=1` в `.env.production` +
пересоздание web. При сбое отправки логин сотрудника вернёт 502 — поэтому
флаг включать только с рабочей почтой. Откат = `FEATURE_STAFF_2FA=0`.

## Follow-ups (вне scope)

- Миграция на TOTP поверх той же challenge-модели (добавить `method`-колонку).
- «Запомнить устройство» (trusted-device cookie).
- Добровольная 2FA для partner/organization.
