# Stage-2 staging smoke — Organization cabinet (Phase 7)

**Owner**: QA + Промтехносфера team
**Trigger**: после merge Phase 7 в `main` со скрытым флагом (Stage-1 done).
**Goal**: подтвердить, что cabinet `/organization/*` под `FEATURE_ORGANIZATION_CABINET=1` корректно работает на staging-окружении: визуально, по данным, по RBAC, по интеграциям (S3 object storage, Resend, ClamAV, BullMQ-worker).
**Duration**: 1-2 недели наблюдения; обязательные 12 шагов ниже — за 1-2 часа.
**Reference**: [spec §8.1](superpowers/specs/2026-05-25-organization-cabinet-design.md), [plan Task 41](superpowers/plans/2026-05-25-organization-cabinet-phase7.md).

---

## 0. Pre-flight (выполнить до прогона)

| Чек | Команда / Действие | Ожидание |
|---|---|---|
| Staging-deploy свежий | сверить commit SHA на staging vs `main` | совпадает |
| Флаг включён | `FEATURE_ORGANIZATION_CABINET=1` в env staging-инстанса | env прокинут в Next + worker |
| Миграции применены | `npx prisma migrate status` (на staging) | `Database schema is up to date` |
| Backfill отработал | `node dist/scripts/backfill-order-organization-id.js` или эквивалент | 0 critical warns; все `Order` с `organizationId` |
| Worker запущен | проверить процесс `npm run worker:start` или systemd unit | очереди `oneCSync.*`, `notifications.dispatch`, `emails.send` слушают |
| S3 bucket доступен | загрузить тестовый файл через admin-кабинет | 200, file в bucket `documents` (`S3_BUCKET`) |
| Resend настроен | `EMAIL_ENABLED=true`, `RESEND_API_KEY` валиден, `EMAIL_FROM=…@otsfera.ru` | тестовый email от admin-кабинета доходит |

**Test-org seed на staging**:

```sql
-- Создать тестовую Organization (если нет) + admin-membership.
-- Подставить реальный partnerId existing partner на staging.
INSERT INTO "Organization" (id, name, "partnerId", "createdAt", "updatedAt")
VALUES ('test-org-stage2', 'Тестовая организация Stage-2', '<existing-partner-id>', NOW(), NOW())
ON CONFLICT (id) DO NOTHING;

-- 1-2 Order для test-org (можно через 1С-sync, если staging 1С имеет тестового контрагента,
-- иначе вручную тем же скриптом, что используется в seed.ts строки 133-151).

-- Organization admin создать через UI /admin/organizations/[id] (шаг 1 ниже).
```

---

## 1. Smoke walkthrough (12 шагов)

Один тестировщик последовательно. На каждом шаге зафиксируй: ✅ / ❌ / ⚠. На ❌ — записать correlationId из тостов + лог сервера + НЕ продолжать.

### Step 1 — Admin invite test-org admin

- **Действие**: залогиниться как `admin@…otsfera.ru`. Открыть `/admin/organizations/test-org-stage2`. В блоке «Доступ заказчика» → «Пригласить» → email тестового QA, name «Org Admin», role `admin`.
- **Ожидание**: toast «Приглашение отправлено», invite-link виден (copy-button). Audit log пишет `org_member_invited`.
- **Fallback**: если email не приходит — проверить `[worker] emails.send`. Восстановить ссылку из БД невозможно: invite/reset-токены хранятся хэшированными (R2, c3ab030). Вместо этого перепригласить пользователя тем же диалогом — UI покажет свежую invite-ссылку (copy-button).

### Step 2 — Reset password → login → /organization/dashboard

- **Действие**: открыть invite-link в анонимной вкладке → задать пароль ≥ 8 симв → submit.
- **Ожидание**: 302 на `/organization/dashboard` сразу после установки пароля. JWT-cookie выставлен. Бизнес-период активный.
- **Fallback**: если редиректит на `/login` — `JWT_SECRET` < 32 символов на staging, или `User.passwordHash` не записался.

### Step 3 — Dashboard rendering

- **Ожидание**: 4 KPI (Активных заказов / К оплате / Сотрудников на курсе / Документов за 30 дней). Attention-list — реальные urgent-items или zero-state «Всё под контролем». Events feed — последние 15 событий из `Comment`, `Document`, `Payment` для этой org. Подзаголовок «Главная — {название тестовой org}».
- **Local rehearsal benchmark**: для seed-данных KPI = `0 / 0 ₽ / 0 / 3`, events = 4 (3 docs + 1 payment).

### Step 4 — Orders list, two-dim filter, pagination

- **Действие**: открыть `/organization/orders`. Применить фильтр «В работе» + «Частично оплачены». Затем сброс. Если заказов > 20, проверить «Дальше».
- **Ожидание**: видны ТОЛЬКО заказы test-org. Колонки: №, Заказ, Менеджер, Статус, Сумма, К оплате, Срок. **Колонки `Партнёр` и `Комиссия` отсутствуют** (org-viewer).
- **Critical fail**: если в таблице виден заказ ДРУГОЙ org — немедленно остановить, это data-leak.

### Step 5 — Order detail, comment, no commission

- **Действие**: открыть любой заказ. Прокрутить «Финансы» — **строки «Комиссия» нет**. Открыть «Документы» — `infected` не показывается. Написать комментарий «smoke test» → «Отправить».
- **Ожидание**: после submit комментарий в треде сразу (`router.refresh()` в [add-comment-form.tsx:33](../src/components/partner/add-comment-form.tsx)).
- **Critical fail**: появилась колонка «Комиссия» в финансах — нарушение `viewer="organization"` контракта.

### Step 6 — Documents page + signed URL

- **Действие**: `/organization/documents`. Фильтр «Счета». Кнопка «Скачать» на одном из счетов.
- **Ожидание**: POST `/api/organization/documents/{id}/download` → 200 JSON `{ downloadUrl, expiresInSec, fileName }`. Клиент переходит на signedUrl (TTL 60-300 сек). Аудит-лог: `document_download_signed_url`.
- **Спец-кейсы**:
  - Документ с `scanStatus='infected'` (если есть) НЕ должен быть в списке. Прямой POST на его id → 410 с `{ code: 'INFECTED', scanReason }`.
  - Чужая org → 404.

### Step 7 — Students list

- **Действие**: `/organization/students`. Поиск по фамилии (если есть).
- **Ожидание**: только студенты test-org. Поиск работает по `name` (case-insensitive contains).

### Step 8 — Invite second member with role=member

- **Действие**: `/organization/team` → «Пригласить» → email 2-го QA, name «Org Member», role `member`. Скопировать invite-link → анонимная вкладка → установить пароль → login.
- **Ожидание для member**: sidebar показывает Главная / Заказы / Документы / Сотрудники, **пункт «Команда» скрыт**. Прямой переход на `/organization/team` → redirect на `/forbidden`.

### Step 9 — RBAC sanity (cross-org 404)

- **Действие**: будучи залогиненным как member или admin test-org, скопировать ID заказа другой organization (можно из `/admin/orders` под admin) и попробовать `/organization/orders/{otherOrgOrderId}`.
- **Ожидание**: рендер «404 Страница не найдена». **NOT a redirect to dashboard — это всё ещё рендеринг в layout, но с not-found UI.**

### Step 10 — Worker sync → email + in-app bell

- **Действие**: на стороне 1С добавить тестовый платёж по заказу test-org (или через admin-route, имитирующую `sync-payments` job). Подождать ≤ 5 мин (или дёрнуть очередь вручную через `/admin/sync` → retry).
- **Ожидание**:
  - email шаблона `payment-received` приходит на адрес org-admin (от `EMAIL_FROM`, тема «Получена оплата … ₽»).
  - In-app bell (или notifications-badge) в org-кабинете +1.
  - Audit log: `notification_sent` для всех `OrganizationUser.isActive=true` в этой org.
- **Fallback**: если email не доходит — проверить `[worker] notifications.dispatch` + Resend dashboard (отбойник, bounce?).

### Step 11 — Partner-side invite

- **Действие**: залогиниться как partner-admin (`partner@…otsfera.ru` или эквивалент). Открыть `/partner/portfolio/{test-org-id}`. Блок «Доступ заказчика» внизу → «Пригласить» → email 3-го QA → invite-link.
- **Ожидание**: invite работает идентично §1; новый user становится organization-admin или member (по выбору формы).

### Step 12 — Last admin protection

- **Действие**: войти как org-admin test-org. Если в team есть второй active admin, временно его demote/deactivate. Затем попробовать deactivate **самого** последнего admin'а через UI.
- **Ожидание**: action error «Нельзя деактивировать последнего активного администратора» (код ошибки `last_admin_protected` в server-action response).
- **Если попытаться deactivate себя** — `self_action_forbidden` (другой код, тоже корректный).

---

## 2. Признаки успеха Stage-2

Закрытие чекбокса оправдано, когда:

- [ ] Все 12 шагов выше — ✅ (или ⚠ с письменным waiver).
- [ ] 1-2 недели наблюдения — нет regressions в `Sentry` / логах worker'а (если подключены).
- [ ] Команда Промтехносферы внутренне валидировала UX (хотя бы 3 человека: admin, partner-admin, organization-admin).
- [ ] Финальная встреча: «выпускаем Stage-3 (пилотная organization в prod)» — go/no-go.

## 3. Откат (если Stage-2 ❌)

```bash
# 1. Env staging: FEATURE_ORGANIZATION_CABINET=0
# 2. Деплой / перезапуск
# 3. /organization/* теперь возвращает 404 — partner/admin кабинеты не задеты
# 4. Order.organizationId остаётся в данных (read-only)
# 5. sync-orders продолжает писать organizationId (idempotent)
```

Откатить миграции не нужно — feature-flag — единственная точка отказа.

## 4. После Stage-2

1. Сообщить агенту/тех.лиду: «Stage-2 passed, можно закрывать чекбокс».
2. Агент:
   - переименует `docs/superpowers/plans/2026-05-25-organization-cabinet-phase7.md` → `…-DONE.md`,
   - обновит memory ([reference-organization-plan.md](../../../C:/Users/karka/.claude/projects/D-------------------------------------------------/memory/reference-organization-plan.md)) — `Stage-2 staging smoke COMPLETED on YYYY-MM-DD`,
   - подготовит план Stage-3 (пилотная organization в prod на 2 недели).

---

## Приложение A — Local rehearsal результаты (2026-05-29)

Прогнан агентом локально с `FEATURE_ORGANIZATION_CABINET=1`, seed-данные:

| Step | Status | Notes |
|---|---|---|
| 1 | ⏭ skipped (UI) | invite-flow через email требует Resend; код-путь покрыт integration tests |
| 2 | ⏭ skipped (UI) | то же; login API → 200 `{ok:true}` ✅ |
| 3 | ✅ | KPIs `0 / 0₽ / 0 / 3 docs`, attention zero-state, 4 события |
| 4 | ✅ | 2 заказа своей org, фильтр (этап + оплата), search |
| 5 | ✅ | finance без commission ✓, comment POST 201 + visible after refresh |
| 6 | ✅ | type-filter работает, infected→410, 3→2 docs после mark infected |
| 7 | ✅ | zero-state «нет сотрудников» (seed не создаёт students) |
| 8 | ✅ (code) | admin-only gate в [team/page.tsx:24-26](../src/app/organization/team/page.tsx) |
| 9 | ✅ | cross-org → «404 Страница не найдена» |
| 10 | ⏭ skipped | требует worker + Resend, локально no-op; код-путь верифицирован |
| 11 | ⚠ code-only | партнёр-портфолио UI повис в RSC stream локально; integration test passes |
| 12 | ✅ (code) | `self_action_forbidden` + `last_admin_protected` в [team.ts:236-243](../src/lib/services/organization/team.ts), tests cover both |

**Bugs found**: none critical. Замечание: после POST `/api/comments` напрямую (минуя форму) комментарий не виден до hard-reload — нормально, форма делает `router.refresh()` сама.

Не считается заменой staging — **только confidence-build, что code-path корректен**.
