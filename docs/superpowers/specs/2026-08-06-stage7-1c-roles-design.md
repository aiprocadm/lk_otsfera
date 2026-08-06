# Этап 7 «Роли: админ + руководитель» — дизайн

**Дата:** 2026-08-06
**ТЗ:** [починка загрузки выгрузки из 1С](../../tz/2026-08-04-tz-fix-1c-import.md), требования **Т-25…Т-29** (решение владельца №2)
**Этап в STATUS.md:** 7 из 10 · риск «средний» · строго **после** этапа 6 (развязка Т-26а снята)
**Статус:** 📝 ждёт подтверждения заказчика (кода нет)

---

## 1. Зачем

Сегодня импорт из 1С доступен **любому** менеджеру: `isStaff()` в сервисах
пускает `admin | manager` без различия суб-роли. Решение владельца №2 (§0.1
ТЗ): право на импорт — у **админа и руководителя**, у обычного менеджера — нет.
Руководитель при этом получает нормальный дом для импорта — зеркальные страницы
в своём хабе «Настройки», как у админа. Этап 6 снял главную мину Т-26а: новая
организация руководителя создаётся в его собственной компании, а не отбивается
`out_of_scope`.

## 2. Что в объёме (Т-25…Т-29)

| Требование | Суть |
|---|---|
| **Т-25** | Право импорта: `admin` и `manager-leader`. Обычный менеджер — нет. Зафиксировать в матрице ролей |
| **Т-26** | Единый предикат `mayImportOneC(session)` вместо продублированного `isStaff()` в `import/index.ts` и `oneCAccountCard/import-batch.ts` |
| **Т-26а** | Согласование со скоупом — **уже закрыто этапом 6** (Т-41/Т-43): здесь только проверка тестом |
| **Т-27** | Зеркальные страницы `/leader/settings/integrations/1c/excel` и `…/payments` через `requireSettingsSection('integrations.oneC', 'leader')` + пункты навигации |
| **Т-28** | Отказ по правам → страница `/forbidden` с внятным русским текстом, не пустой экран |
| **Т-29** | Задокументировать в README/RUNBOOK значения флагов на проде для доступности страниц |

**Вне объёма:** очередь ручного разбора выписки (`resolve-queue.ts`,
`resolve-picker.ts`) — их `isStaff()` Т-26 не называет; кнопка «создать
организацию из очереди» и её права — этап 10 (Т-30…Т-31). Откат — этапы 8–9.

## 3. Разведка по коду (факт на `main` 9b6240c6)

- `isStaff()` живёт **в четырёх** файлах: `import/index.ts`,
  `oneCAccountCard/import-batch.ts` (эти два меняет Т-26) и
  `oneCAccountCard/resolve-queue.ts` / `resolve-picker.ts` (очередь разбора —
  вне объёма, доступ к её странице всё равно станет leader-gated).
- `isManagerLeader` — уже в `lib/auth/managerPolicy.ts`. **Guard-тест матрицы
  ролей** (`security.role-access-matrix.guardrail.test.ts`) читает экспорты
  этого файла и падает, если новый предикат не описан в матрице — то есть
  `mayImportOneC` в `managerPolicy.ts` автоматически потребует строку-фиксацию
  (это и есть Т-25 «зафиксировать»).
- **Файла `docs/tz/2026-07-30-role-access-matrix.md`, на который ссылается
  Т-25, в репозитории нет** — решением заказчика от 30.07.2026 матрица ролей
  живёт в guard-тесте (авто-контроль полноты), а не в документе. Фиксируем в
  тесте (§8, отклонение 1).
- Реестр хаба: `integrations.oneC` — `cabinets: ['admin']`, capability
  `settings.integrations.manage`, флага раздела нет. `legacyRedirectMap()`
  выводит кабинет из **префикса** старого пути (`/leader/*` → leader, иначе
  admin) — для `/manager/import` нужен явный признак кабинета в `LegacyHref`.
- Карта редиректов продублирована в `next.config.mjs`
  (`SETTINGS_HUB_REDIRECTS`) под существующим тестом-сверкой.
- `requireSettingsSection(id, 'leader')` готов: `requireManagerLeader` →
  `canAccessSettingsSection` → отказ = `/forbidden` (русская страница есть).
  «Дедушкина оговорка» пускает руководителя без профиля; профиль с
  размеченными `settings.*`-кодами может доступ отнять — это штатно.
- Навигация: `navItemsFor` уже умеет `leaderOnly` (фильтр по суб-роли);
  пункты `/manager/import` и `/manager/payments-import` сейчас видны всем
  менеджерам.
- Флаг `settings_hub` — **opt-out** (включён, пока env не 0/false/off);
  гейтит только редиректы со старых адресов, сами страницы хаба отвечают
  всегда. У раздела `integrations.oneC` собственного флага нет.
- Тесты, живущие на «менеджер может импортировать»: `import.contract`
  (managerSession в preview), `import.unified.integration` (тест скоупа
  обычного менеджера через сервис) — перечислены в §6 к переводу.

## 4. Решения

### 4.1. `mayImportOneC` — в `managerPolicy.ts` (Т-25, Т-26)

```ts
export function mayImportOneC(session: SessionPayload): boolean {
  return session.role === 'admin' || isManagerLeader(session);
}
```

`import/index.ts` и `oneCAccountCard/import-batch.ts` заменяют локальные
`isStaff()` на импорт этого предиката; код ошибки `'forbidden'` не меняется.
Размещение в `managerPolicy.ts` — сознательное: guard-тест матрицы сам
потребует строку с раскладкой по всем шести ролям (обычный менеджер — false).

### 4.2. Реестр: `integrations.oneC` для кабинета `leader` (Т-27)

- `cabinets: ['admin', 'leader']` — карточка в хабе, боковая навигация, крошки
  и право (`settings.integrations.manage`) выводятся из реестра автоматически.
- `LegacyHref` получает опциональное поле `cabinet` — для старых путей чужого
  префикса: `{ from: '/manager/import', toPath: 'integrations/1c/excel',
  cabinet: 'leader' }` и аналогично `/manager/payments-import`. Дубль карты в
  `next.config.mjs` пополняется — существующий тест-сверка не даст разъехаться.

### 4.3. Зеркальные страницы руководителя (Т-27)

`src/app/leader/settings/integrations/1c/{layout,page,excel,payments}` — копии
админских поверх тех же компонентов (`OneCTabs`, `ImportForm`,
`PaymentImportForm`, `PaymentQueueTable`), но:

- гард — `requireSettingsSection('integrations.oneC', 'leader')`;
- **excel-страница НЕ передаёт список компаний**: у руководителя компанию
  задаёт скоуп сессии (Т-41), селект не нужен;
- payments-страница зовёт те же `listQueue`/`listQueueOrgNames` — очередь уже
  company-scoped по сессии.

Компоненты форм общие с админом сознательно (не sibling): они презентационные
и domain-agnostic — исключение, которое §4 CLAUDE.md прямо разрешает.

### 4.4. Старые адреса менеджерского кабинета — тонкие шлюзы (Т-25, Т-28)

`/manager/import` и `/manager/payments-import`:

- гард меняется `requireManager` → `requireManagerLeader` — право Т-25
  держится и при выключенном флаге; обычный менеджер получает `/forbidden`;
- при включённом `settings_hub` — `redirectToSettingsHub('<старый путь>')` →
  307 на `/leader/settings/integrations/1c/…`;
- при выключенном — прежнее содержимое рендерится на месте (шаблон §2b).

### 4.5. Навигация (Т-27)

Оба пункта менеджерского меню («Загрузка из 1С», «Импорт оплат») получают
`leaderOnly: true` — обычный менеджер их больше не видит (а страница за ними
всё равно отбивает `/forbidden`, defense-in-depth §4). Руководителю в хабе
карточка появляется из реестра автоматически.

### 4.6. Документация флагов (Т-29)

В `docs/RUNBOOK.md` (раздел про хаб) и README: страницы импорта доступны при
дефолтных значениях — `FEATURE_SETTINGS_HUB` **не выставлен** в `0/false/off`
(флаг opt-out), собственного флага у раздела `integrations.oneC` нет; для
кабинета руководителя нужны включённые `manager_cabinet` (+`leader_cabinet`
только вместе с ним — существующее правило навигации).

## 5. Что меняется в файлах

| Файл | Изменение |
|---|---|
| `lib/auth/managerPolicy.ts` | + `mayImportOneC` |
| `lib/services/import/index.ts` | `isStaff` → `mayImportOneC` |
| `lib/services/import/oneCAccountCard/import-batch.ts` | `isStaff` → `mayImportOneC` |
| `lib/navigation/settings.ts` | `integrations.oneC.cabinets` + leader; `LegacyHref.cabinet`; 2 legacy-пути |
| `next.config.mjs` | + 2 строки в `SETTINGS_HUB_REDIRECTS` |
| `app/leader/settings/integrations/1c/*` | **новые** — layout, index-redirect, excel, payments |
| `app/manager/import/page.tsx`, `app/manager/payments-import/page.tsx` | шлюзы: leader-гард + redirect + fallback |
| `lib/navigation/cabinet.ts` | `leaderOnly: true` у двух пунктов |
| `docs/RUNBOOK.md`, `README.md` | Т-29 |
| тесты | §6 |

Схема БД не меняется, миграций нет.

## 6. Тесты

| Слой | Что проверяем |
|---|---|
| unit `managerPolicy` | `mayImportOneC` по всем ролям; строка в матрице guard-теста (авто-требование) |
| unit `import/index`, `import-batch` | обычный менеджер → `forbidden`; руководитель → ok; admin → ok |
| unit pages | leader excel (форма БЕЗ селекта компаний) / payments / layout-вкладки / index-redirect; шлюзы менеджера: leader-гард, 307 при флаге, fallback без флага |
| unit nav/registry | пункты leaderOnly; leader-хаб показывает карточку «Обмен с 1С» (обновится канон разделов leader в `lib.auth.settings-access`); карта редиректов = дублю next.config (существующий тест) |
| **integration** (живой Postgres) | руководитель: `previewImport`/`commitImport` через СЕРВИС (не writer) — организация в его компании без `companyId`-арга; обычный менеджер через сервис → `forbidden`; перевод `import.contract`/`import.unified` с manager-сессий на leader |

Гейты: typecheck, lint, prettier, покрытие изменённых файлов 100%, **полный**
`test:integration` локально (урок этапа 6 — адресного прогона мало), полный
`test:unit`.

## 7. Риски

Средний. Главные: (1) отъём права у обычного менеджера — поведенческое
изменение, видимое живым людям; закрыто внятным `/forbidden` (Т-28), скрытием
пунктов меню и абзацем в CHANGELOG; (2) шлюзы старых адресов — паттерн §2b уже
обкатан девятью разделами хаба; (3) волна по тестам, живущим на
manager-сессии, перечислена заранее (§3).

## 8. Решения, требующие «ок» заказчика

Оба встроены в спеку, отдельного ответа не требуют — «ок» подтверждает:

1. **Т-25, фиксация матрицы:** файла `docs/tz/2026-07-30-role-access-matrix.md`
   в репо не существует — матрица ролей решением от 30.07.2026 живёт в
   guard-тесте с авто-контролем полноты. Фиксируем `mayImportOneC` там;
   отдельный markdown-файл не заводим (вторая копия матрицы разойдётся).
2. **Очередь разбора выписки** (`resolve-queue`/`resolve-picker`) остаётся на
   прежнем staff-предикате: Т-26 называет только два файла импорта, страница
   очереди и так становится leader-gated, а права кнопок очереди — предмет
   этапа 10.
