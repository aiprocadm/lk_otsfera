# Хаб «Настройки» + русификация аудита — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans.
> Шаги отмечаются чекбоксами `- [ ]`.

**Goal:** Свести девять служебно-конфигурационных разделов кабинетов сотрудников
под единый хаб `/admin/settings` (зеркало `/leader/settings`) и перевести журнал
аудита полностью на русский язык.

**Architecture:** Единый реестр разделов (`src/lib/navigation/settings.ts`)
порождает карточки хаба, боковую навигацию, крошки, проверку прав и карту
редиректов. Права — семь новых `capability`-кодов поверх существующего
`AccessProfile` с «дедушкиной оговоркой» для legacy-профилей. Раскатка — флаг
`settings_hub`: выключен → старая навигация и старые страницы на месте, включён →
новое меню + редиректы. Русификация аудита — отдельный слой представления
(`src/lib/audit/labels.ts`) поверх рантайм-реестров `AUDIT_ACTIONS`/`AUDIT_ENTITIES`.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript 5 (strict +
`exactOptionalPropertyTypes` + `noUncheckedIndexedAccess`), Prisma 6, Zod, Vitest.

**Спека:** [2026-08-04-settings-hub-design.md](../specs/2026-08-04-settings-hub-design.md)

## Global Constraints

- Ветка одна (`worktree-settings-hub`), один PR с `base: main` (CLAUDE.md §14 —
  стек PR-ов запрещён). Коммиты — по задачам.
- Бизнес-логику переносимых страниц **не менять**: содержимое переезжает как есть.
- Схему БД не менять. Новые коды прав — значения в `capabilities: String[]`,
  миграции не требуются.
- Клиентские кабинеты (`/organization`, `/partner`, `/student`) не трогать.
- Порог покрытия 100/100/100/100 на `src/app/**/*.tsx`, `src/components/**`,
  `src/lib/**` — каждая новая страница/компонент/модуль приходит со своим тестом.
- Русский в UI, английский в кодах и идентификаторах (CLAUDE.md §13).
- Цвета — только через примитивы `src/components/ui`, новые UI-библиотеки не подключать.
- Redirect для старых путей — `redirect()` (307), не `permanentRedirect` (см. спеку §3.3).
- Перед коммитом: `npm run typecheck` + `npm run lint`. Push только с `--no-verify`
  (хуки не влезают в окно), гейты гонять руками.

---

### Задача 1: Реестр разделов настроек

**Файлы:**
- Создать: `src/lib/navigation/settings.ts`
- Тест: `src/__tests__/lib.navigation.settings.test.ts`

**Интерфейсы (Produces):**
```ts
export type SettingsGroupId = 'integrations' | 'catalogs' | 'access' | 'security';
export type SettingsCabinet = 'admin' | 'leader';
export type SettingsSection = {
  id: string;
  group: SettingsGroupId;
  title: string;
  description: string;
  icon: string;
  path: string;              // хвост после /<cabinet>/settings, например 'integrations/sync'
  capability: SettingsCapability;
  flag?: FeatureFlag | undefined;
  cabinets: SettingsCabinet[];
  legacyHrefs: string[];     // полные старые пути
};
export const SETTINGS_GROUPS: ReadonlyArray<{ id: SettingsGroupId; title: string }>;
export const SETTINGS_SECTIONS: readonly SettingsSection[];
export function settingsHref(section: SettingsSection, cabinet: SettingsCabinet): string;
export function sectionsForCabinet(cabinet: SettingsCabinet): SettingsSection[];
export function sectionByPath(cabinet: SettingsCabinet, pathname: string): SettingsSection | undefined;
export function legacyRedirectMap(): ReadonlyMap<string, string>;
```

Состав (группы и порядок — из ТЗ §3):

| id | группа | title | path | capability | cabinets | legacyHrefs |
|---|---|---|---|---|---|---|
| `integrations.overview` | integrations | Интеграции | `integrations` | `settings.integrations.view` | admin | `/admin/integrations` |
| `integrations.sync` | integrations | Синхронизация | `integrations/sync` | `settings.integrations.manage` | admin | `/admin/sync` |
| `integrations.oneC.excel` | integrations | Обмен с 1С: загрузка Excel | `integrations/1c/excel` | `settings.integrations.manage` | admin | `/admin/import` |
| `integrations.oneC.payments` | integrations | Обмен с 1С: выписка (сч. 51) | `integrations/1c/payments` | `settings.integrations.manage` | admin | `/admin/payments-import` |
| `integrations.notifications` | integrations | Каналы уведомлений | `integrations/notifications` | `settings.integrations.view` | admin, leader | — |
| `catalogs.applicationStatuses` | catalogs | Статусы заявок | `catalogs/application-statuses` | `settings.catalogs.manage` | admin, leader | `/admin/order-statuses`, `/leader/settings/order-statuses` |
| `catalogs.customFields` | catalogs | Дополнительные поля | `catalogs/custom-fields` | `settings.catalogs.manage` | admin, leader | `/admin/custom-fields`, `/leader/settings/custom-fields` |
| `catalogs.requisites` | catalogs | Реквизиты исполнителя | `catalogs/requisites` | `settings.catalogs.manage` | admin | — |
| `access.roles` | access | Роли и профили доступа | `access/roles` | `settings.access.manage` | admin, leader | `/admin/roles`, `/leader/roles` |
| `security.audit` | security | Аудит | `security/audit` | `settings.audit.view` | admin | `/admin/audit` |
| `security.personalData` | security | Доступ к персональным данным | `security/personal-data` | `settings.personal_data.view` | admin | `/admin/pii-access` |
| `security.personal` | security | Личная безопасность | `security/personal` | `settings.system.view` | admin, leader | — |
| `system.health` | security | Здоровье системы | `system/health` | `settings.system.view` | admin | `/admin/health` |
| `system.featureFlags` | security | Флаги функциональности | `system/feature-flags` | `settings.system.view` | admin | — |

`access.roles` несёт `flag: 'role_constructor'`.
`legacyHrefs` для leader-путей относятся к тому кабинету, чей префикс в строке.

- [ ] **Шаг 1: тест-инварианты реестра**

```ts
// src/__tests__/lib.navigation.settings.test.ts
import { describe, it, expect } from 'vitest';
import {
  SETTINGS_SECTIONS, SETTINGS_GROUPS, settingsHref, sectionsForCabinet,
  sectionByPath, legacyRedirectMap,
} from '@/lib/navigation/settings';

describe('реестр разделов настроек', () => {
  it('id и path уникальны', () => {
    const ids = SETTINGS_SECTIONS.map((s) => s.id);
    const paths = SETTINGS_SECTIONS.map((s) => s.path);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(paths).size).toBe(paths.length);
  });
  it('каждый раздел принадлежит известной группе и хотя бы одному кабинету', () => {
    const groupIds = new Set(SETTINGS_GROUPS.map((g) => g.id));
    for (const s of SETTINGS_SECTIONS) {
      expect(groupIds.has(s.group)).toBe(true);
      expect(s.cabinets.length).toBeGreaterThan(0);
    }
  });
  it('старые пути уникальны и ведут на свой кабинет', () => {
    const map = legacyRedirectMap();
    expect(map.get('/admin/sync')).toBe('/admin/settings/integrations/sync');
    expect(map.get('/leader/roles')).toBe('/leader/settings/access/roles');
    expect(map.get('/admin/pii-access')).toBe('/admin/settings/security/personal-data');
    const all = SETTINGS_SECTIONS.flatMap((s) => s.legacyHrefs);
    expect(new Set(all).size).toBe(all.length);
  });
  it('settingsHref собирает путь по кабинету', () => {
    const roles = SETTINGS_SECTIONS.find((s) => s.id === 'access.roles')!;
    expect(settingsHref(roles, 'admin')).toBe('/admin/settings/access/roles');
    expect(settingsHref(roles, 'leader')).toBe('/leader/settings/access/roles');
  });
  it('sectionsForCabinet отдаёт только разделы кабинета', () => {
    const leader = sectionsForCabinet('leader').map((s) => s.id);
    expect(leader).toContain('access.roles');
    expect(leader).not.toContain('security.audit');
  });
  it('sectionByPath находит раздел по URL, в т.ч. по вложенному', () => {
    expect(sectionByPath('admin', '/admin/settings/integrations/sync')?.id)
      .toBe('integrations.sync');
    expect(sectionByPath('admin', '/admin/settings')).toBeUndefined();
  });
});
```

- [ ] **Шаг 2: прогнать — падает («Cannot find module '@/lib/navigation/settings'»)**

`npx vitest run --mode=unit src/__tests__/lib.navigation.settings.test.ts`

- [ ] **Шаг 3: написать реестр** по таблице выше. `settingsHref` = `` `/${cabinet}/settings/${section.path}` ``;
      `sectionByPath` ищет самый длинный совпавший `path` (важно: `integrations`
      против `integrations/sync`); `legacyRedirectMap` строит `Map` из
      `legacyHrefs` → `settingsHref` того кабинета, чей префикс в старом пути.

- [ ] **Шаг 4: тест зелёный**

- [ ] **Шаг 5: коммит** `feat(settings): реестр разделов хаба настроек`

---

### Задача 2: Слой прав (7 новых capability + матрица доступа)

**Файлы:**
- Изменить: `src/lib/auth/accessProfileSchema.ts` (расширить `capabilitySchema`)
- Создать: `src/lib/auth/settingsAccess.ts`
- Тест: `src/__tests__/lib.auth.settings-access.test.ts`

**Интерфейсы:**
- Consumes: `SETTINGS_SECTIONS`, `SettingsSection` (задача 1); `can`,
  `SessionPayload`.
- Produces:
```ts
export const SETTINGS_CAPABILITIES = [
  'settings.integrations.view', 'settings.integrations.manage',
  'settings.catalogs.manage', 'settings.access.manage',
  'settings.audit.view', 'settings.personal_data.view', 'settings.system.view',
] as const;
export type SettingsCapability = (typeof SETTINGS_CAPABILITIES)[number];
export function canAccessSettingsSection(session: SessionPayload, section: SettingsSection): boolean;
export function visibleSettingsSections(session: SessionPayload, cabinet: SettingsCabinet): SettingsSection[];
export function hasAnySettingsAccess(session: SessionPayload, cabinet: SettingsCabinet): boolean;
```

Правило (спека §3.2): admin → `true`; иначе роль должна пускать в кабинет
(`leader` = `role==='manager' && managerRole==='leader'`); дальше — нет профиля
**или** в профиле нет ни одного `settings.*`-кода → `true` (legacy); иначе —
`profile.capabilities.includes(section.capability)`.

- [ ] **Шаг 1: тест матрицы**

```ts
const base = { sub: 'u1', role: 'manager', managerRole: 'leader', companyId: 'c1' } as any;
const roles = SETTINGS_SECTIONS.find((s) => s.id === 'access.roles')!;
const audit = SETTINGS_SECTIONS.find((s) => s.id === 'security.audit')!;

it('admin видит всё (Model A)', () => {
  expect(canAccessSettingsSection({ ...base, role: 'admin' }, audit)).toBe(true);
});
it('руководитель без профиля сохраняет прежний доступ', () => {
  expect(canAccessSettingsSection(base, roles)).toBe(true);
});
it('руководитель с профилем без settings-кодов сохраняет прежний доступ', () => {
  const s = { ...base, accessProfile: { id: 'p', name: 'x', capabilities: ['export'] } };
  expect(canAccessSettingsSection(s, roles)).toBe(true);
});
it('профиль с settings-кодами: default-deny на остальное', () => {
  const s = { ...base, accessProfile: { id: 'p', name: 'x', capabilities: ['settings.catalogs.manage'] } };
  expect(canAccessSettingsSection(s, roles)).toBe(false);
});
it('менеджер без роли руководителя не видит разделов', () => {
  expect(hasAnySettingsAccess({ ...base, managerRole: null }, 'leader')).toBe(false);
});
it('раздел под выключенным флагом не виден', () => { /* vi.mock featureFlags → role_constructor off */ });
it('в кабинете руководителя нет админских разделов', () => {
  expect(visibleSettingsSections({ ...base }, 'leader').map((s) => s.id)).not.toContain('security.audit');
});
```

- [ ] **Шаг 2: прогнать — падает**
- [ ] **Шаг 3: реализовать** (`capabilitySchema` = старые 6 кодов + `...SETTINGS_CAPABILITIES`)
- [ ] **Шаг 4: тесты зелёные + `npm run typecheck`**
- [ ] **Шаг 5: коммит** `feat(settings): права доступа к разделам настроек`

---

### Задача 3: Флаг `settings_hub`

**Файлы:**
- Изменить: `src/lib/featureFlags.ts` (добавить в `FEATURE_FLAGS` + комментарий-описание точек чтения)
- Изменить: `src/__tests__/lib.featureFlags.test.ts` (если список флагов там зафиксирован — сверить)
- Изменить: `.env.example`, `docs/CI.md`/`docs/RUNBOOK.md` — только если там есть перечень флагов

Флаг **поведенческий** (не route-флаг): точки чтения — навигация
(`navItemsFor`/шелл) и старые страницы (редирект vs рендер на месте). В
`FEATURE_PREFIXES` middleware **не добавлять** — иначе при выключенном флаге
новые пути 404-ят, а редирект уведёт в никуда.

- [ ] **Шаг 1:** добавить `'settings_hub'` в `FEATURE_FLAGS` с комментарием по образцу `staff_2fa`
- [ ] **Шаг 2:** `npx vitest run --mode=unit src/__tests__/lib.featureFlags.test.ts` — зелено
- [ ] **Шаг 3: коммит** `feat(settings): флаг раскатки settings_hub`

---

### Задача 4: Каркас хаба — layout, боковая навигация, крошки, поиск

**Файлы:**
- Создать: `src/components/settings/settings-shell.tsx` (серверный: крошки + сетка)
- Создать: `src/components/settings/settings-nav.tsx` (`'use client'`: список групп + мобильный `<select>`)
- Создать: `src/components/settings/settings-breadcrumbs.tsx`
- Создать: `src/components/settings/settings-hub-cards.tsx` (`'use client'`: поиск + карточки)
- Создать: `src/app/admin/settings/layout.tsx`
- Изменить: `src/app/admin/settings/page.tsx` → хаб (прежнее содержимое разъезжает в задачах 5–8)
- Тесты: `src/__tests__/components.settings-nav.test.tsx`,
  `components.settings-hub-cards.test.tsx`, `components.settings-breadcrumbs.test.tsx`,
  `pages.admin.settings-hub.test.tsx`

**Интерфейсы:**
- Consumes: `visibleSettingsSections`, `sectionByPath`, `settingsHref`, `SETTINGS_GROUPS`.
- Produces:
```ts
export function SettingsShell(props: {
  cabinet: SettingsCabinet; sections: SettingsSection[]; pathname: string; children: ReactNode;
}): JSX.Element;
export function SettingsHubCards(props: { cabinet: SettingsCabinet; sections: SettingsSection[] }): JSX.Element;
```

Требования ТЗ §4: двухуровневая навигация (слева группы/подразделы, справа
контент; на узком экране — `<select>` c `onChange` → `router.push`); крошки
`Настройки → Интеграции → Обмен с 1С`; клиентский поиск по названию и описанию;
`<h1>` и `<title>` на русском (`export const metadata` в каждой странице).

Layout получает `pathname` из `headers()` (`x-pathname` не проставляется —
использовать серверный компонент-обёртку, читающий путь через
`next/navigation` в клиентской части: активный пункт определяет `SettingsNav`
через `usePathname()`, а крошки — по `params`-независимому `sectionByPath` в
клиентском компоненте). Проще и надёжнее: **и навигация, и крошки — клиентские**,
оба берут путь из `usePathname()`; layout остаётся серверным и только гейтит доступ.

Гейт в layout:
```tsx
const session = await requireAdmin();
if (!hasAnySettingsAccess(session, 'admin')) redirect('/forbidden');
```

- [ ] **Шаг 1: тесты компонентов** (jsdom): в хабе четыре заголовка групп;
      ввод в поиск оставляет только совпавшие карточки; карточка без прав не
      рендерится; в навигации активный пункт помечен `data-active="true"`;
      мобильный `<select>` вызывает `push`.
- [ ] **Шаг 2: прогнать — падают**
- [ ] **Шаг 3: реализовать компоненты и layout**
- [ ] **Шаг 4: тест страницы-хаба** через `renderServerComponent` (мок сессии/прав)
- [ ] **Шаг 5: тесты зелёные, `npm run lint`**
- [ ] **Шаг 6: коммит** `feat(settings): каркас хаба настроек`

---

### Задача 5: Группа «Конфигурация процессов»

Переносим: статусы заявок, доп-поля, реквизиты. **Порядок переноса каждой
страницы одинаковый** (эталон для задач 6–8):

1. `git mv` файла страницы в новый маршрут; в новом файле — только правка `<h1>`
   (если был) и добавление `export const metadata = { title: '<Название> · Настройки' }`.
2. Старый маршрут превращается в тонкий шлюз:

```tsx
// src/app/admin/order-statuses/page.tsx
import { redirect } from 'next/navigation';
import { isFeatureEnabled } from '@/lib/featureFlags';
import SettingsApplicationStatusesPage from '@/app/admin/settings/catalogs/application-statuses/page';

/** Старый маршрут: при включённом хабе — редирект, иначе прежняя страница на месте. */
export default async function AdminOrderStatusesLegacyPage() {
  if (isFeatureEnabled('settings_hub')) redirect('/admin/settings/catalogs/application-statuses');
  return SettingsApplicationStatusesPage();
}
```

3. Существующие тесты страницы правятся на новый путь импорта; добавляется тест
   шлюза (флаг ON → `redirect` вызван с нужным путём; флаг OFF → рендерится
   содержимое).
4. Внутренние ссылки на старый путь по всему `src/` переводятся на новый
   (`grep -rn "'/admin/order-statuses'" src`).

**Файлы:**
- `src/app/admin/settings/catalogs/application-statuses/page.tsx` ← `src/app/admin/order-statuses/page.tsx`
- `src/app/admin/settings/catalogs/custom-fields/page.tsx` ← `src/app/admin/custom-fields/page.tsx`
- `src/app/admin/settings/catalogs/requisites/page.tsx` ← блок реквизитов из старого `settings/page.tsx`
- Зеркала руководителя: `src/app/leader/settings/catalogs/{application-statuses,custom-fields}/page.tsx`
  ← `src/app/leader/settings/{order-statuses,custom-fields}/page.tsx`
- Тесты: правка существующих `pages.admin.order-statuses*`, `pages.admin.custom-fields*`,
  `pages.leader.settings*`; новые тесты шлюзов и страницы реквизитов.

- [ ] **Шаг 1:** перенести три админских страницы + два leader-зеркала
- [ ] **Шаг 2:** шлюзы на старых путях + тесты шлюзов
- [ ] **Шаг 3:** перевести внутренние ссылки
- [ ] **Шаг 4:** `npx vitest run --mode=unit src/__tests__/pages.admin.*custom-fields* src/__tests__/pages.admin.*order-statuses*` — зелено
- [ ] **Шаг 5: коммит** `refactor(settings): перенос конфигурации процессов в хаб`

---

### Задача 6: Группа «Интеграции»

**Файлы:**
- `src/app/admin/settings/integrations/page.tsx` ← `src/app/admin/integrations/page.tsx`
- `src/app/admin/settings/integrations/sync/page.tsx` ← `src/app/admin/sync/page.tsx`
- `src/app/admin/settings/integrations/1c/layout.tsx` — вкладки «Загрузка Excel» / «Выписка (сч. 51)»
- `src/app/admin/settings/integrations/1c/page.tsx` — `redirect` на `1c/excel`
- `src/app/admin/settings/integrations/1c/excel/page.tsx` ← `src/app/admin/import/page.tsx`
- `src/app/admin/settings/integrations/1c/payments/page.tsx` ← `src/app/admin/payments-import/page.tsx`
- `src/app/admin/settings/integrations/notifications/page.tsx` — Telegram + каналы уведомлений
  (из прежнего `admin/settings/page.tsx`), leader-зеркало
  `src/app/leader/settings/integrations/notifications/page.tsx`
- Шлюзы на `/admin/integrations`, `/admin/sync`, `/admin/import`, `/admin/payments-import`

ТЗ §10: страницы 1С **не сливаются** (разная логика) — только общий подраздел с
вкладками.

- [ ] **Шаг 1:** перенести четыре страницы + собрать подраздел 1С с вкладками
- [ ] **Шаг 2:** страница «Каналы уведомлений» + её тест
- [ ] **Шаг 3:** шлюзы + тесты шлюзов
- [ ] **Шаг 4:** внутренние ссылки (`/admin/sync` встречается в сервисах уведомлений — проверить каждое вхождение)
- [ ] **Шаг 5:** прогнать затронутые тесты
- [ ] **Шаг 6: коммит** `refactor(settings): перенос интеграций в хаб`

---

### Задача 7: Группа «Доступ и роли» + хаб руководителя

**Файлы:**
- `src/app/admin/settings/access/roles/page.tsx` ← `src/app/admin/roles/page.tsx`
- `src/app/leader/settings/access/roles/page.tsx` ← `src/app/leader/roles/page.tsx`
- `src/app/leader/settings/layout.tsx` + `src/app/leader/settings/page.tsx` (хаб руководителя)
- `src/app/leader/settings/personal/page.tsx` ← личная часть прежнего `leader/settings/page.tsx`
- Шлюзы: `/admin/roles`, `/leader/roles`, `/leader/settings/custom-fields`, `/leader/settings/order-statuses`

Внимание: `/leader/settings` сейчас — реальная страница личных настроек; она
становится хабом, личная часть уезжает в `personal`. Гейт `role_constructor`
внутри страницы ролей сохраняется как есть (`notFound()`).

- [ ] **Шаг 1:** перенести обе страницы ролей
- [ ] **Шаг 2:** хаб руководителя (layout + page, те же компоненты, `cabinet='leader'`)
- [ ] **Шаг 3:** шлюзы + тесты
- [ ] **Шаг 4:** прогнать `src/__tests__/pages.leader.*`
- [ ] **Шаг 5: коммит** `refactor(settings): роли и хаб руководителя`

---

### Задача 8: Группа «Безопасность и система»

**Файлы:**
- `src/app/admin/settings/security/audit/page.tsx` ← `src/app/admin/audit/page.tsx`
  (внутри — правка ссылки «Загрузить ещё» на новый путь)
- `src/app/admin/settings/security/personal-data/page.tsx` ← `src/app/admin/pii-access/page.tsx`
- `src/app/admin/settings/security/personal/page.tsx` — 2FA-коды + карточка безопасности
- `src/app/admin/settings/system/health/page.tsx` ← `src/app/admin/health/page.tsx`
- `src/app/admin/settings/system/feature-flags/page.tsx` — матрица флагов
- `src/app/leader/settings/personal/page.tsx` уже создан в задаче 7
- Шлюзы: `/admin/audit`, `/admin/pii-access`, `/admin/health`
- E2E-снимки: `src/e2e/snapshots/admin-audit.spec.ts` — обновить путь (снимки
  перегенерировать нельзя без стенда → **пометить в PR как требующее
  `npm run e2e:visual:update` при приёмке**)

- [ ] **Шаг 1:** перенести четыре страницы + собрать две новые
- [ ] **Шаг 2:** шлюзы + тесты
- [ ] **Шаг 3:** внутренние ссылки (`/admin/health` встречается в алертах/раннбуке — проверить)
- [ ] **Шаг 4:** прогнать затронутые тесты
- [ ] **Шаг 5: коммит** `refactor(settings): перенос безопасности и системы в хаб`

---

### Задача 9: Навигация — девять пунктов убрать, «Настройки» закрепить внизу

**Файлы:**
- Изменить: `src/lib/navigation/cabinet.ts` (`NavItem.pinnedBottom?: boolean`;
  админский и leader-каноны)
- Изменить: `src/components/admin/admin-sidebar.tsx`, `src/components/leader/leader-sidebar.tsx`
  (отдельный нижний блок с `border-t`)
- Изменить: `src/components/admin/admin-app-shell.tsx`, `leader-app-shell.tsx`
  (скрыть «Настройки», если `hasAnySettingsAccess` = false; при выключенном
  `settings_hub` — прежний канон меню)
- Тесты: `src/__tests__/lib.navigation.cabinet.test.ts` (состав меню при флаге ON/OFF),
  `components.admin-sidebar.test.tsx`

Флаг ON: из `navByRole.admin` уходят `/admin/health`, `/admin/integrations`,
`/admin/sync`, `/admin/import`, `/admin/payments-import`, `/admin/audit`,
`/admin/pii-access`, `/admin/custom-fields`, `/admin/order-statuses`,
`/admin/roles`; остаётся один пункт `/admin/settings` («Настройки», иконка `⚙`,
`pinnedBottom`). Группа «Обмен с 1С» исчезает целиком. У руководителя уходят
`/leader/roles`, `/leader/settings/custom-fields`, `/leader/settings/order-statuses`.

Проверить: в основном меню остались организации, партнёры, пользователи,
направления обучения, документы, сообщения, комиссии, корректировки, финансы,
заявки на обучение, обращения, входящие.

- [ ] **Шаг 1:** тест: при `settings_hub=1` в меню админа нет ни одного из девяти
      путей и есть ровно один `/admin/settings`; при `settings_hub=0` меню
      прежнее (сравнить со снимком старого состава)
- [ ] **Шаг 2:** прогнать — падает
- [ ] **Шаг 3:** реализовать
- [ ] **Шаг 4:** тесты зелёные
- [ ] **Шаг 5: коммит** `feat(settings): единый пункт «Настройки» в сайдбарах`

---

### Задача 10: Реестры аудита (`AUDIT_ACTIONS` / `AUDIT_ENTITIES`)

**Файлы:**
- Изменить: `src/lib/auth/audit.ts`
- Тест: `src/__tests__/lib.auth.audit-registry.test.ts`

```ts
export const AUDIT_ENTITIES = ['user', 'partner', /* … все 43 */] as const;
export type AuditEntity = (typeof AUDIT_ENTITIES)[number];
export const AUDIT_ACTIONS = ['user_created', /* … */] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];
export type AuditRecord = { …; action: AuditAction; entity: AuditEntity; … };
```

Способ собрать полный список действий: типизировать `action` как `AuditAction` с
заведомо неполным реестром и прогнать `npm run typecheck` — компилятор перечислит
каждый использованный литерал. Дополнять реестр до зелёного тайпчека.
Два нетривиальных места: `src/app/api/student/bridge/token/route.ts`
(`params.action` — типизировать параметр как `AuditAction`) и
`src/lib/services/commission/corrections.ts` (шаблон
`` `commission_correction_${next}` `` — вывести union явным `satisfies AuditAction`).

- [ ] **Шаг 1:** тест: `AUDIT_ACTIONS` и `AUDIT_ENTITIES` без дублей, отсортированы,
      непустые; `recordAudit` пишет `meta.status='success'` по умолчанию
- [ ] **Шаг 2:** прогнать — падает
- [ ] **Шаг 3:** реализовать реестры, типизировать `AuditRecord`
- [ ] **Шаг 4:** `npm run typecheck` до зелёного (итеративно дополняя `AUDIT_ACTIONS`)
- [ ] **Шаг 5: коммит** `refactor(audit): рантайм-реестры действий и сущностей`

---

### Задача 11: Словарь аудита + тест полноты

**Файлы:**
- Создать: `src/lib/audit/labels.ts`
- Тест: `src/__tests__/lib.audit.labels.test.ts`

```ts
export function auditActionLabel(action: string): string;   // 'user_created' → 'Создание пользователя'
export function auditEntityLabel(entity: string): string;   // 'organization' → 'Организация'
export function auditStatusLabel(status: string): string;   // 'success' → 'Успешно'
export function auditFieldLabel(field: string): string;     // 'commissionRate' → 'Ставка комиссии'
export const AUDIT_TABLE_HEADERS: { when: string; actor: string; action: string; entity: string; id: string; detail: string };
export function formatAuditDateTime(d: Date): string;       // 'ДД.ММ.ГГГГ ЧЧ:ММ:СС'
```

Fallback (ТЗ §6.4.1): значения нет в словаре → вернуть исходное + `log.warn`
(логгер `@/lib/logging`, сырой `console` запрещён). Тест полноты:

```ts
it('перевод есть для каждого действия из реестра', () => {
  const missing = AUDIT_ACTIONS.filter((a) => auditActionLabel(a) === a);
  expect(missing).toEqual([]);
});
it('перевод есть для каждой сущности из реестра', () => {
  const missing = AUDIT_ENTITIES.filter((e) => auditEntityLabel(e) === e);
  expect(missing).toEqual([]);
});
it('неизвестное значение отдаётся как есть и логируется', () => {
  const warn = vi.spyOn(log, 'warn').mockImplementation(() => {});
  expect(auditActionLabel('never_seen')).toBe('never_seen');
  expect(warn).toHaveBeenCalled();
});
it('дата в формате ДД.ММ.ГГГГ ЧЧ:ММ:СС', () => {
  expect(formatAuditDateTime(new Date('2026-08-04T09:05:07Z'))).toMatch(/^\d{2}\.\d{2}\.\d{4} \d{2}:\d{2}:\d{2}$/);
});
```

- [ ] **Шаг 1:** тесты полноты и fallback
- [ ] **Шаг 2:** прогнать — падают
- [ ] **Шаг 3:** написать словарь (стиль формулировок — из ТЗ §6.3: «Создание»,
      «Изменение», «Вход в систему», «Организация», «Заявка»…)
- [ ] **Шаг 4:** зелёные
- [ ] **Шаг 5: коммит** `feat(audit): словарь русских названий журнала`

---

### Задача 12: Русский журнал аудита в UI

**Файлы:**
- Изменить: `src/components/admin/audit-log-table.tsx` (заголовки колонок,
  русские `action`/`entity`, дата через `formatAuditDateTime`, колонка «Результат»
  из `meta.status`)
- Изменить: `src/components/admin/audit-log-filters.tsx` (в `<option>` — русское
  название, `value` остаётся машинным; `optgroup` по русской группе)
- Изменить: `src/components/admin/audit-diff-dialog.tsx` (заголовок
  «Изменение · Организация», ключи полей через `auditFieldLabel`)
- Тесты: правка `components.audit-*` + новые проверки

Проверка критерия приёмки 7: тест сканирует отрендеренный HTML таблицы и
фильтров и падает, если встречает машинный код из `AUDIT_ACTIONS`/`AUDIT_ENTITIES`
как видимый текст.

- [ ] **Шаг 1:** тест «в разметке нет машинных значений»
- [ ] **Шаг 2:** прогнать — падает
- [ ] **Шаг 3:** правки компонентов
- [ ] **Шаг 4:** зелёные, визуально проверить на стенде
- [ ] **Шаг 5: коммит** `feat(audit): русский журнал в таблице, фильтрах и карточке`

---

### Задача 13: Гейты, документация, приёмка

- [ ] **Шаг 1:** `npm run typecheck`
- [ ] **Шаг 2:** `npm run lint`
- [ ] **Шаг 3:** `npm run boundaries`
- [ ] **Шаг 4:** `npm run deadcode` (knip: новые экспорты обязаны использоваться)
- [ ] **Шаг 5:** `npm run dup:check` (порог 3% — шлюзы похожи друг на друга, следить)
- [ ] **Шаг 6:** `npm run format:check`
- [ ] **Шаг 7:** `npm run test:unit` (в фоне, ~6 мин, ничего параллельно не гонять)
- [ ] **Шаг 8:** точечные integration-тесты прав на живом Postgres
- [ ] **Шаг 9:** CHANGELOG.md + `docs/ARCHITECTURE.md` (карта маршрутов) + close-out
      `2026-08-04-settings-hub-DONE.md`
- [ ] **Шаг 10:** ручная проверка по чек-листу ТЗ §8 на стенде (светлая/тёмная тема,
      десктоп/узкий экран)
- [ ] **Шаг 11:** PR с `base: main`, в описании — выполненные гейты, отклонение по
      307/308 и вопросы заказчику из спеки §6
