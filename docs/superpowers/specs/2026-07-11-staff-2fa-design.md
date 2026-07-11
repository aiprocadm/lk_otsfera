# 2FA сотрудников (email-код) — design

**Дата:** 2026-07-11
**Автор:** Claude (session-driven, brainstorming)
**Статус:** Approved (design step), pending implementation
**Related:** Серия укрепления (ТЗ v0.5 §16/§25.7), пункт «2FA сотрудников» — отдельный PR после `claude/release-hardening-r0` (PR #194). Журнал доступа к ПДн — следующая отдельная спека.

## Проблема

Вход в кабинет — один фактор (email+пароль, bcrypt) с 7-дневным JWT. Сотрудники
(admin / manager / leader) видят ПДн слушателей, финансы и админ-инструменты;
украденный или подобранный пароль сотрудника отдаёт всё это одним шагом.
Rate-limit логина (R0.6) усложняет перебор, но не защищает от фишинга и утечки
пароля.

## Цель

Второй фактор для staff-ролей при логине: после верного пароля — одноразовый
6-значный код на email сотрудника. Обязателен для admin/manager/leader при
включённом флаге; внешних клиентов (partner/organization) не затрагивает.

**Выбор фактора (решение пользователя, 2026-07-11):** email-код, НЕ TOTP.
Осознанное ограничение: почта — общий фактор с reset-пароля, её компрометация
бьёт по обоим механизмам. Зафиксировано как known limitation; миграция на TOTP
возможна позже поверх той же challenge-модели (добавится `method`-колонка).

## Не-цели / Out of scope (явно)

- **TOTP/WebAuthn** — не в этом PR (см. выше).
- **2FA для partner/organization** — только staff; добровольная 2FA клиентов —
  возможный follow-up.
- **«Запомнить это устройство»** (trusted-device cookie) — YAGNI для v1;
  сотрудники логинятся раз в 7 дней (срок JWT).
- **Выключение 2FA per-user админом** — обязательность задаёт env-флаг, а не
  пер-пользовательский признак; админ управляет только backup-кодами.
- **Изменение student-bridge / API-токенов** — 2FA касается только формы `/login`.

## Дизайн

### Флаг

`staff_2fa` — **opt-in** (`FEATURE_STAFF_2FA=1`), семейство staged-rollout
(`organization_cabinet`, `chat`). Это **поведенческий** флаг (гейтит шаг
аутентификации), а не route-флаг: трёхточечное правило §5 (middleware→404 /
nav / route-handler) не применяется буквально. Точки чтения:

1. `POST /api/auth/login` — решает, выдавать сессию или challenge;
2. `POST /api/auth/2fa/{verify,resend}` — при выключенном флаге отвечают 404
   (`notFoundIfDisabled`-семантика, не раскрываем механизм);
3. страницы настроек staff-кабинетов — секция «Коды восстановления» рендерится
   только при флаге.

Откат инцидента = `FEATURE_STAFF_2FA=0` (рестарт web) — весь новый путь
исчезает, логин прежний. Матрица `docs/feature-flags-matrix.md` пополняется.

### Модель данных (prisma)

```prisma
model TwoFactorChallenge {
  id        String   @id @default(cuid())
  createdAt DateTime @default(now())
  userId    String   @unique            // одна активная challenge на пользователя
  user      User     @relation(fields: [userId], references: [id])
  codeHash  String                       // sha256(code) — плейнтекст не хранится
  expiresAt DateTime                     // now + 10 мин
  attempts  Int      @default(0)         // max 5, дальше challenge мертва

  @@index([expiresAt])                   // фоновая чистка/аналитика
}

model TwoFactorBackupCode {
  id        String    @id @default(cuid())
  createdAt DateTime  @default(now())
  userId    String
  user      User      @relation(fields: [userId], references: [id])
  codeHash  String    @unique            // sha256(code)
  usedAt    DateTime?                    // одноразовость

  @@index([userId])
}
```

Принцип hash-at-rest — тот же, что у reset-токенов (c3ab030): дамп таблицы не
даёт кодов. `userId @unique` у challenge делает повторный логин перезаписью
(upsert), а не накоплением строк.

### Флоу логина

`isStaff(user)` ⟺ `role === 'admin' || role === 'manager'` (leader — это
manager с `managerRole='leader'`, отдельной ветки не нужно).

1. **`POST /api/auth/login`** — существующие проверки (rate-limit, bcrypt,
   membership) не меняются. Дальше развилка: если `staff_2fa` включён и
   `isStaff(user)` — **сессия НЕ выдаётся**. Вместо неё:
   - код: `crypto.randomInt(0, 1_000_000)` → 6 цифр с ведущими нулями;
   - `twoFactorChallenge.upsert` по `userId` (codeHash, expiresAt=+10мин, attempts=0);
   - письмо с кодом — **блокирующе** (без кода войти нельзя; сбой отправки →
     `502 { code: 'EMAIL_SEND_FAILED' }`, challenge удаляется);
   - httpOnly cookie `2fa_pending`: короткий JWT `{ sub, purpose: '2fa' }`,
     TTL 10 мин (тот же `JWT_SECRET`, отдельный claim `purpose` — session-guard
     его не принимает, см. «Безопасность»);
   - ответ `200 { ok: true, twoFactorRequired: true }`.
   Не-staff или флаг выключен → прежний путь (полный JWT сразу).

2. **`POST /api/auth/2fa/verify { code }`** — per-IP rate-limit (10/60с, общий
   Redis-лимитер). Читает `2fa_pending` (нет/просрочен/чужой purpose → 401
   `SESSION_EXPIRED` — «начните вход заново»). Загружает challenge по `sub`:
   - нет challenge или `expiresAt <= now` → 401 `CODE_EXPIRED`;
   - `attempts >= 5` → challenge удаляется, 401 `TOO_MANY_ATTEMPTS`;
   - сверка `secretEquals(sha256(code), codeHash)`; при промахе — **fallback**:
     поиск непогашенного `twoFactorBackupCode` этого пользователя по
     `sha256(code)` (найден → сжигаем `usedAt` и это успех);
   - оба мимо → `attempts++`, 401 `INVALID_CODE`.
   Успех (email-код или backup): собрать **те же клеймы, что login**, выдать
   session-JWT + cookie (7д), удалить challenge, погасить `2fa_pending`
   (maxAge 0), audit `2fa_verified` / `2fa_backup_used`.

3. **`POST /api/auth/2fa/resend`** — по `2fa_pending`; лимиты: ≥30с между
   отправками и ≤3 переотправки на challenge (Redis-лимитер, ключ
   `2fa-resend:<userId>`); генерирует НОВЫЙ код (upsert перезаписывает хеш,
   attempts сбрасывается, expiresAt продлевается), шлёт письмо.

### Сборка клеймов — общий хелпер

Блок login-роута, собирающий partnerRole/assignedOrgIds/organizationMemberships/
managedOrgIds/managerRole/accessProfile (~80 строк), выносится в
`src/lib/auth/buildSessionClaims.ts` (`buildSessionClaims(prisma, user)`).
Его используют и login (одношаговый путь), и verify (после 2FA). Это
единственный рефакторинг существующего кода в PR; поведение клеймов
закрепляется существующими тестами login-роута (обновляются на хелпер).

### Email

Шаблон `src/lib/email/templates/two-factor-code.tsx` (React Email, RU, по
образцу password-reset). Код — только в теле письма, НЕ в теме (лок-скрин
уведомления); тема: «Код подтверждения входа». Отправка — существующий
`send()` (Resend), инлайн из роута.

### Backup-коды

- Генерация: 10 кодов по 10 символов (base32 без похожих глифов, из
  `randomBytes`), показываются один раз; в БД — только sha256. Повторная
  генерация транзакционно удаляет старые строки пользователя.
- **Self-service**: секция «Коды восстановления» в `/admin/settings`,
  `/manager/settings` и `/leader/settings`. Один клиентский компонент
  `StaffBackupCodesSection` на все три — sibling-паттерн §4 не нарушается:
  домен один (staff-2FA), роли не расходятся по смыслу.
  Server-action `regenerateBackupCodesAction` (staff-гейт: admin | manager,
  включая leader).
- **Админ для чужого аккаунта**: в `/admin/users/[id]` кнопка «Перевыпустить
  коды восстановления» — инвалидирует все коды пользователя и показывает новые
  (сценарий «сотрудник потерял доступ к почте и коды»). Audit
  `2fa_backup_regenerated` с `entityId = targetUserId`.

### Безопасность

- 6 цифр ≈ 10⁶ вариантов; компенсация: ≤5 попыток на код, TTL 10 мин,
  per-IP rate-limit на verify, resend ограничен. Ожидаемая вероятность угона
  ≤ 5/10⁶ на challenge.
- Хеши кодов в БД (sha256; коды высокоэнтропийные короткоживущие — KDF не
  нужен); сравнение через `secretEquals` (constant-time).
- Коды **не логируются** ни в каком виде (§12); audit-события без payload-кода:
  `2fa_code_sent`, `2fa_verified`, `2fa_failed`, `2fa_backup_used`,
  `2fa_backup_regenerated`.
- `2fa_pending`-JWT содержит `purpose: '2fa'`; `getSession`/`requireRole`
  проверяют отсутствие `purpose` (или `purpose === undefined`) — pre-auth
  токен не даёт доступа ни к одному маршруту, даже если подложить его в
  cookie `session`. Middleware не меняется (другое имя cookie).
- Enumeration не добавляется: 2FA-ветка наступает только после верного пароля.
- Демо-сиды/встроенный `SHOW_DEMO_LOGINS` не трогаем: флаг выключен в dev.

### Ошибки (RU-коды)

Новые стабильные коды: `email_send_failed`, `code_expired`, `invalid_code`,
`too_many_attempts`, `session_expired` (+ уже есть `too_many_requests`).
Все — в `errorMessageRu`.

### UI

`LoginForm` становится двухшаговой: шаг 1 — email/пароль (без изменений);
`twoFactorRequired: true` в ответе → шаг 2 — поле кода (6 цифр, автофокус,
`inputMode=numeric`), кнопка «Отправить код ещё раз» (disabled 30с с
countdown), ссылка «Использовать код восстановления» (то же поле, другой
placeholder), «Назад» → шаг 1. Ошибки — через `errorMessageRu`.

## Тестовая стратегия

- **Unit (сервис `src/lib/services/auth/twoFactor.ts`)**: создание challenge
  (upsert перезаписывает), верификация (успех/мимо/attempts=5/просрочка),
  backup-коды (генерация 10, одноразовость, перегенерация инвалидирует),
  форматы кодов.
- **Route-тесты (mock prisma+send, эталон api.manager.documents.upload)**:
  login выдаёт challenge для staff при флаге / сессию без флага / сессию для
  partner при флаге; verify — весь спектр кодов ошибок + успех выставляет
  session-cookie и гасит `2fa_pending`; resend — лимиты. Login-тесты
  существующие — не ломаются (флаг в тестовом env выключен).
- **Integration (живой PG)**: сервис twoFactor против реальной схемы
  (upsert-гонки, уникальность codeHash, транзакция перегенерации).
- **Компонент**: `LoginForm` двухшаговость (jsdom), countdown ресенда.
- **Guard-тест**: pre-auth JWT с `purpose:'2fa'`, подложенный в `session`,
  отвергается `getSession`.
- Coverage-гейт 100% как для всего `src/**`.

## Решённые вопросы (были открытыми на брейншторме)

1. Фактор: **email-код** (решение пользователя; TOTP отклонён).
2. Охват: **все staff-роли** (admin + manager + leader).
3. Внедрение: **env-флаг + обязательный шаг при логине** (staged rollout).
4. Recovery: **backup-коды self-service + перевыпуск админом**; сброса
   «отключить 2FA» нет — обязательность задаёт флаг.
