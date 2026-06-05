# Arch-debt C5: split bloated services — close-out (DONE)

**Дата:** 2026-06-05 · **Ветка:** `claude/c5-split-bloated-services` · **Спека:** [c5-split-bloated-services-design](../specs/2026-06-05-c5-split-bloated-services-design.md) · **План:** [c5-split-bloated-services](2026-06-05-c5-split-bloated-services.md)

Компаньон к плану (не замена). План — «что собирались», этот файл — «что отгрузили». Трек **C / C5** из [completion-roadmap](../specs/2026-06-02-completion-roadmap.md). Третья «быстрая внутренняя победа» после [C3](2026-06-05-arch-debt-dashboard-types-DONE.md) и [C4](2026-06-05-arch-debt-result-contract-DONE.md).

## Статус

**Отгружено, 4 коммита:** `e50a7e7` (notifications), `e8bc51d` (admin/users), `3ab5f38` (manager/dashboard), docs+close-out. Объём = **все три файла** (выбор пользователя). Каждый распил — **чистый перенос (move-only)** за `index.ts`-barrel: под-модули вынесены в директорию, исходный файл удалён, barrel реэкспортит сегодняшнюю публичную поверхность через `export *`. Импорт-спецификаторы (`@/lib/notifications`, `@/lib/services/admin/users`, `@/lib/services/manager/dashboard`) не изменились — директория резолвится в `index.ts`, поэтому ~20 вызывающих и все тесты **не тронуты**.

## Что отгрузили

| Модуль | Было | Стало | Шов |
|---|---|---|---|
| `notifications.ts` | 693 стр. | `notifications/{shared,core,org,manager}.ts` + `index.ts` | по аудитории (core in-app / org fan-out / manager fan-out); общие `getAppBaseUrl`/`orderLabel` → приватный `shared` |
| `admin/users.ts` | 442 стр. | `users/{errors,queries,mutations}.ts` + `index.ts` | чтение vs запись; `errors` = внутр. throw-механизм C4; `mutations→queries` (getUser/UserDetail) однонаправленно |
| `manager/dashboard.ts` | 376 стр. | `dashboard/{constants,kpis,attention,events}.ts` + `index.ts` | по виджету; общие time-константы → приватный `constants` |

**Отклонение от roadmap (осознанное):** roadmap предлагал `notifications` пилить «по каналам (in-app/email/dispatch)». Реальный код **переплетает** in-app `notification.create` + email-dispatch в одном цикле fan-out'а — разрез по каналу разорвал бы control-flow. Распилено **по аудитории** (по собственным разделителям файла), что делает это чистым переносом. Зафиксировано в спеке §2.

## Верификация

База: ветка отрезана от свежего green `main` (3392625, включает C3+C4) → до правок всё зелёное.

- **typecheck** чисто (×3 — после каждого распила; barrel обязан воспроизвести точную типизированную поверхность, иначе ~20 вызывающих не сойдутся) · **lint** чисто (вкл. C3 `no-restricted-imports` guardrail).
- **unit: 1082** (135 файлов) — байт-в-байт паритет с C4 baseline, 0 сломанных.
- **integration: 334** (45 файлов, полный L3) — паритет с C4.
- **`next build`** собрался (exit 0).
- Per-module контракт: notifications **24** integration (notifyManagers 8 + worker-hooks 7 + invariant 4 + notifyOrgUsers 5); admin/users **58** unit (baseline match, integration нет); dashboard **13** integration.
- **diff `main...HEAD --stat`:** 15 файлов, 971+/942− — **только файлы распила**, ни одного вызывающего/теста. git распознал `notifications.ts→manager.ts` и `users.ts→mutations.ts` как rename.
- **Ревью (инлайн A–E + субагент-corroboration):** (A) тела функций verbatim — доказано 334 integration-тестами с ассертами на точные значения; (B) вне 15 файлов ничего не менялось; (C) barrel = прежняя поверхность (typecheck для всех вызывающих); (D) barrels реэкспортят только публичные под-модули — `shared`/`constants` не утекают (внешние grep-совпадения = неизменные sibling-файлы с собственными одноимёнными символами); (E) графы импортов ацикличны.

## Принятые решения (выбор пользователя)

1. **Scope = все три файла** (полный C5), а не только `notifications.ts`.
2. **Barrel = `<name>/index.ts`** (по конвенции репо `oneCSync/`, `email/templates/`), не «файл рядом с папкой».
3. **Inline-исполнение** (executing-plans), не subagent-per-task — move-рефактор, весь контекст в одной голове.

## Не-issues / отложено (задокументировано, не тихие пробелы)

- **Component-unit таргет в плане (Task 3 Step 9) не существует:** у `manager-kpi-grid`/`events-feed`/`attention-list` нет dedicated unit-тестов (C3 менял их только на импорт типов). Контракт дашборда держат 13 integration-тестов + typecheck. Не пробел — план over-specified несуществующую цель.
- **Стрэй `AGENTS.md`** (untracked, появился во время прогона хука) — **не часть C5**, оставлен untracked, в коммиты не попал (staging строго по путям).
- **Subagent-ревьюер «завис»** — ложная тревога: его output-файл не флашился (0 байт), но агент работал и при остановке вернул результат, совпавший с инлайн-проверкой.

## Гочи для будущего

- **Файл → директория: удаляй исходник ДО typecheck.** Пока `notifications.ts` и `notifications/` сосуществуют, `@/lib/notifications` резолвится в **старый файл** (file wins over dir), и typecheck зелёный против устаревшего кода. `git rm` исходника обязателен перед проверкой.
- **`export *` из barrel'а не тащит приватное** — но только если хелперы остаются без `export` внутри под-модулей. Общие-для-сиблингов хелперы (`shared`/`constants`) `export`ятся для соседей, но barrel их **не** реэкспортит → поверхность не расширяется.
- **diff `main...HEAD --stat` — сильнейший pure-move сигнал:** если в нём есть хоть один вызывающий/тест, перенос не чистый. git-rename (`a.ts→b.ts (NN%)`) — нормальный артефакт распила, помогает `git log --follow`.
- **0-байтный output фонового агента ≠ зависание** — транскрипт буферизуется; судить по mtime/размеру ненадёжно, у local-agent результат приходит при остановке.
