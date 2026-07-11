# Матрица фиче-флагов для прод-релиза (R0.1)

Источник истины по семантике — [src/lib/featureFlags.ts](../src/lib/featureFlags.ts) (18 флагов: 4 opt-out default-ON, 14 opt-in default-OFF). Env-переменная — `FEATURE_<UPPER_SNAKE>`. Точки чтения route-флагов — тройные (§5 CLAUDE.md): middleware (404) + навигация + page/route-гейт; поведенческие флаги (`max_channel`, `staff_2fa` и т.п.) читаются в своих точках, перечисленных в комментарии флага.

**Главный инвариант проверен (аудит 2026-07-10): ни одна незавершённая фича не «включится сама» — все сырые флаги opt-in.** Заглушечные адаптеры (Mango REST, IMAP) дополнительно защищены двойным предохранителем «флаг + креды/адаптер».

## Opt-out (default ON — зрелые, env не выставлять)

| Флаг | Назначение | Прод | Зависимости |
|---|---|---|---|
| `partner_leads` | Заявки-лиды партнёра (+вложения) | **on** | — |
| `commission_pdf` | Скачивание PDF стейтмента | **on** | Redis+worker (генерация) |
| `commission_xlsx` | Скачивание XLSX стейтмента | **on** | Redis+worker |
| `pwa_installer` | PWA-подсказка установки | **on** | — |

## Opt-in (default OFF — включать явно `=1`)

| Флаг | Назначение | Рекомендация в прод | Зависимости / почему |
|---|---|---|---|
| `organization_cabinet` | Кабинет организации | **1** (по staged-rollout runbook) | — |
| `manager_cabinet` | Кабинет менеджера | **1** | — |
| `leader_cabinet` | Кабинет руководителя | **1**, строго вместе с `manager_cabinet=1` | предупреждение в navigation/cabinet.ts |
| `enrollment_requests` | Заявки на обучение (5 ролей) | **1** | — |
| `chat` | Team-chat partner/org + чат-секция менеджера | **1** (комментарии к заказам — вне флага) | — |
| `role_constructor` | G1: конструктор ролей (`/leader/roles`, `/admin/roles`) | **1** технически готов; включать по бизнес-решению | БД |
| `sales_funnel` | G2: воронка (`/leader/funnel`, `/manager/funnel`) | **1** технически готов; по бизнес-решению | БД |
| `internal_tasks` | G3: задачи (`/manager/tasks`, `/leader/tasks`) | **1** технически готов; по бизнес-решению | БД |
| `notif_queue` | Доставка уведомлений через воркер (идемпотентность по jobId) | **1** (Redis+worker в прод-контуре есть) | `REDIS_URL` |
| `max_channel` | Канал уведомлений Max | **0**, пока владелец не подключил бота | `MAX_BOT_TOKEN`/`MAX_WEBHOOK_SECRET` |
| `whatsapp_channel` | Канал уведомлений WhatsApp (агрегатор) | **0**, пока не подключён агрегатор | `WHATSAPP_AGGREGATOR_*` |
| `inbound_messaging` | Омниканальный инбокс `/manager/inbox` | **0** на старте. Мессенджер-каналы готовы (нужны `TELEGRAM_/MAX_/WHATSAPP_WEBHOOK_SECRET`); **email-канал** — IMAP-адаптер = заглушка: `INBOUND_EMAIL_ADAPTER` держать `fake`/unset, иначе DLQ-шум каждые 2 мин | секреты вебхуков |
| `telephony_mango` | Телефония `/manager/calls` + вебхук Mango | **0** до реализации боевого REST-адаптера записей (сейчас заглушка → recording-джобы уходили бы в DLQ). При включении fail-fast требует `MANGO_API_KEY`/`MANGO_API_SALT` | `MANGO_*`, IP-allowlist |
| `staff_2fa` | 2FA сотрудников: email-код при логине admin/manager/leader (поведенческий флаг; точки чтения — login/2fa-роуты + секция настроек) | **1** после мержа PR и проверки доставки писем (EMAIL_ENABLED) | Resend (`EMAIL_ENABLED`, `RESEND_API_KEY`) |

## Как флипать в проде

`.env.production` → выставить значение → `docker compose -f docker-compose.prod.yml up -d` (пересоздаёт web+worker с новым env). Порядок включения кабинетов — [runbook-staged-rollout-cabinets.md](runbook-staged-rollout-cabinets.md), релизные шаги — [runbook-launch-deploy.md](runbook-launch-deploy.md) §3.3.
