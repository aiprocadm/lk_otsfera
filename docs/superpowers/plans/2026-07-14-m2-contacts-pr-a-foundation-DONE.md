# M2 Contacts — PR-A (Foundation) — Close-out

**Дата:** 2026-07-15
**Статус:** отгружено на ветке `claude/m2-contacts` (изолированный worktree, стек поверх M1 `claude/m1-deal-activity-spec`). 17 коммитов `04c1c68…ee2c6db`, 53 файла, +2408/−125.
**Процесс:** subagent-driven-development — свежий implementer-субагент на задачу + независимый spec+quality-ревьюер после каждой. Ревью-петля поймала реальные баги (см. §3).
**План:** [2026-07-14-m2-contacts-pr-a-foundation.md](2026-07-14-m2-contacts-pr-a-foundation.md). **Спека:** [../specs/2026-07-14-m2-contacts-design.md](../specs/2026-07-14-m2-contacts-design.md).

---

## 1. Что отгружено (по задачам плана)

| Задача | Коммит(ы) | Что |
|---|---|---|
| 1. Схема | `04c1c68` | `Contact` + `ContactChannel` + enum `ContactChannelType`; аддитивные nullable-колонки (`Order.primaryContactId`, `User.internalPhone`, `InboundMessage.contactId`, `Call.contactId`); back-relations; **per-company** уникальность канала (`@@unique([companyId, type, normalizedValue])` — не глобально, чтобы не течь C8); аддитивная миграция `20260714185841_m2_contacts_foundation`. |
| 2. Нормализатор | `06714e7` | `src/lib/phone/normalize.ts` — единый `normalizePhoneCanonical` (RU 8→+7). Три расходящихся нормализатора (`inbound/resolve`, `telephony/resolveCaller`, `notifications/preferences`) стали тонкими алиасами. **Фикс латентного бага** атрибуции. |
| 3. Резолвер | `047d3a7` | `resolveContactByChannel` — индекс канал→контакт, exactly-one/null, `phoneLike` для звонков (ищет `{phone,whatsapp}`). |
| 4. Сервис контактов | `d84fc5f`, `cc22704`, `98b76de` | `createContact` (scope-guard + **валидация org C8** — §3) + `captureChannel` (learn-on-link, идемпотентный, P2002-coded). |
| 5. Rewire входящих | `bb430de` | `resolveInboundSender` резолвит ContactChannel **первым** (fallback на User сохранён); `ingestInboundMessage` пишет `contactId`. org-less хит проваливается на User-путь. |
| 6. Rewire звонков | `e60431c` | `resolveCaller` резолвит ContactChannel первым (phone-like); `ingestCallEvent` пишет `contactId` в summary+call ветках. |
| 7. Бэкфилл | `8a755d6` | Идемпотентный `backfillContacts` из Users(role=organization) + Leads; дедуп по `(company, bucket(type), normalizedValue)` где bucket схлопывает phone/whatsapp; вшит в `prisma/seed.ts`. |
| 8. Флаг | `9f0238a` | `contacts` (opt-in). 3-точечный route-гейт откладывается в PR-B; PR-A гейтит триаж/создание поведенчески. |
| 9. Триаж звонков | `3ad1013`, `46e290a`, `98b76de` | `bindCall` (C8 + **per-manager isOrgInScope**, паритет с `bindInboundMessageAction`) + `bindCallAction`/`createContactFromCallAction`. Learn-on-link захватывает номер. `'call'` в audit-union. |
| 10. UI триажа | `e05749c`, `264c520` | `CallBindForm` (привязать / создать контакт из номера) в `/manager/calls` для неопознанных, за флагом `contacts`; опознанные — read-only. |
| 11. Inbox learn-on-link | `140af34` | `bindInboundMessageAction` + `contactId` (C8/org-гейт) + `captureChannel(senderRef)`; `createContactFromInboundAction`; UI-карточка «Создать контакт из отправителя». |
| 12. click-to-call от `internalPhone` | `c31d76a`, `ee2c6db` | `initiateCallAction` берёт `fromInternal` из `User.internalPhone` сервер-сайд (клиент больше не диктует — **security-фикс + закрытие open-Q#2 M1**); ошибка `no_internal_phone`; карточка настроек «Внутренний номер» + `updateInternalPhoneAction`. |

---

## 2. Инварианты приёмки — статус

- **C8/cross-company:** канал/контакт компании A не резолвится/не листится/не редактируется в B; per-company уникальность — нет P2002-утечки при добавлении «чужого» канала. ✅ (регресс-тесты)
- **Атрибуция:** входящее/звонок резолвят ContactChannel первым (exactly-one, безопасно на неоднозначности), пишут `contactId`, fallback на User/Lead сохранён. ✅
- **Learn-on-link:** привязка неопознанного звонка/входящего захватывает канал → будущие коммуникации авто-резолвятся. ✅
- **Триаж звонков:** неопознанный звонок можно привязать (раньше было НЕЛЬЗЯ — мёртвая запись); per-manager bind-authority. ✅
- **Нормализатор:** `8XXXXXXXXXX` и `+7…` из разных каналов матчатся. ✅
- **Бэкфилл:** идемпотентен, дедуп по каналу (в т.ч. phone↔whatsapp одного номера → один контакт). ✅
- **click-to-call:** internalPhone сервер-сайд; клиент не влияет на номер. ✅
- **Флаг `contacts=off`:** триаж-UI/создание скрыты; атрибуция работает независимо. ✅
- **Гейты:** typecheck ✅, lint (max-warnings=0) ✅, `prisma migrate status` чисто ✅. **`test:integration` — 122 файла / 936 тестов зелёные (0 упавших).** Прогон №1 (unit+integration) — 6816/6822 passed (единственный реальный провал `mango-backfill` починен `c069ced`; остальное — 1 environmental-флейк). **Пофайловое scoped-покрытие 100%** на всех M2-файлах — при этом найдены и закрыты 2 branch-дыры (`resolveCaller`/`resolve`: true-ветка `hit.userId`, коммит `de077d6`), которые полный combined-гейт поймал бы. **Полный `test:coverage` (combined 100%) дважды убит средой** (краш воркера vitest; затем смерть Docker/PG посреди прогона), не тестами — его должен прогнать владелец/CI на стабильной машине (это L3/ручной pre-release шаг по CLAUDE.md §6, НЕ CI-гейт).

---

## 3. Что поймала ревью-петля (реальные дефекты, исправлены + покрыты)

1. **Задача 4 — баг primary-канала:** `isPrimary: i===0` вычислялся до фильтра пустых каналов → при ведущем пустом канале контакт оставался без primary. Фикс: primary после фильтра (`cc22704`).
2. **Задача 7 — дедуп phone↔whatsapp:** плановый per-type ключ создавал 2 канала на один номер (whatsapp у юзера + phone у лида) → сломало бы атрибуцию звонка (2 контакта → ambiguous). Фикс: bucket схлопывает phone/whatsapp (`8a755d6`). Ревьюер (opus) признал отклонение **корректнее эталона плана**.
3. **Задача 9 — ДВА нарушения C8 (безопасность):**
   - (a) implementer снял `isOrgInScope` (визибилити ≠ право привязки) → восстановлено (`46e290a`).
   - (b) `createContact` не валидировал `organizationId` → cross-tenant orphan-контакт (эмпирически подтверждён на живой БД) → **валидация org-scope в сервисе** (защита всех вызывающих, `98b76de`).
4. **Задача 10 — пробел 100%-покрытия:** две (нашлась третья) непокрытые ветки `CallBindForm` → добавлены тесты (`264c520`).

Вывод: два реальных бага + два C8-нарушения безопасности были бы отгружены без независимого ревью каждой задачи.

---

## 4. Вне объёма PR-A → PR-B (осознанно отложено)

- **Директория `/manager/contacts`** (список+поиск+курсор) + **3-точечный route-гейт** флага `contacts` (middleware-префикс, nav-пункт, `notFoundIfDisabled`).
- **Карточка контакта** `/manager/contacts/[id]`.
- **Вкладка «Люди»** на орг-карточке.
- **Блок контакта на карточке сделки** + `setOrderPrimaryContactAction` + пикер.
- **Промоушен лида → `order.primaryContact`** (в `promoteLead`).
- **PII-контексты** `manager_contacts_list`/`manager_contact_view` (PR-A не добавляет новую staff-поверхность чтения ПДн — триаж переиспользует `calls_list`/`inbox_list`-логирование).
- **Полноценный пикер контактов** в inbox/триаже (PR-A: минимальное «создать из отправителя/номера»).

Дальше по программе CRM-паритета: **M3** (аналитика). См. [[crm-parity-program]].

## 5. Прочее

- Отклонение задачи 11: `createContactFromInboundAction` вызывает server-action `bindInboundMessageAction` напрямую (двойной `requireManager` — безвредно, нет TOCTOU; чистый рефактор в отдельный сервис — вне объёма).
- В ходе PR-A ветка стояла в изолированном worktree после того, как параллельная сессия перекинула основную папку на `main` посреди работы (восстановлено через reflog). См. [[concurrent-sessions-same-worktree]].
- **Не влито в main** — ждёт владельца (как M1). Мержить после M1.
