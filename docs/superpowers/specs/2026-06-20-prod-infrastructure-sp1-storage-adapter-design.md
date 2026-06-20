# Дизайн — прод-инфраструктура, SP1: S3-storage адаптер

**Дата:** 2026-06-20
**Статус:** утверждён (дизайн), готов к плану
**Родительская задача:** боевой запуск на РФ-инфраструктуре с нуля (см. §0 «Контекст и декомпозиция»).
**Связанные документы:** [runbook-launch-deploy.md](../../runbook-launch-deploy.md) (операторская процедура запуска), CLAUDE.md §3 (Result-контракт), §10 (документы и storage).

---

## 0. Контекст и декомпозиция

Задача «создать прод-инфраструктуру» (реальная БД, флип env, redeploy web+worker) для российской компании. Зафиксированные решения:

- **152-ФЗ применяется → РФ-хостинг.** Приложение хранит персданные граждан РФ (ФИО/email пользователей, студенты, ИНН партнёров, загружаемые документы). БД и файловое хранилище обязаны находиться в РФ. Это **исключает Supabase** (US/EU) как основное хранилище ПДн. *(Не юридическая консультация; финально подтверждает юрист/DPO. Выбран low-regret дефолт «считать, что применяется».)*
- **Топология C (гибрид):** managed PostgreSQL (бэкапы/HA/ICU-коллация — на провайдере) + Object Storage (S3-совместимый) + одна VM под web + worker + Redis через docker-compose. Профиль: базовые ops-навыки, бюджет ~5–15 тыс ₽/мес.
- **Провайдер** (Yandex Cloud / VK Cloud / Selectel) **не зафиксирован** — S3-совместимый API одинаков, отличается endpoint/ключи в env.

Работа разбита на три независимых под-проекта, каждый со своим циклом spec → plan → реализация:

| # | Под-проект | Тип | Зависит от | Содержание |
|---|---|---|---|---|
| **SP1** | **S3-storage адаптер** | код (TDD) | — | Эта спека. Заменяет Supabase Storage на S3-совместимое хранилище. **Блокирует РФ-соответствие.** |
| SP2 | Прод-упаковка | config/код | SP1 | Multi-stage Dockerfile (Next standalone) + docker-compose.prod.yml (web+worker+redis+reverse-proxy/TLS) + .env.production шаблон + healthcheck. |
| SP3 | Greenfield-runbook РФ | ops-док | SP1, SP2 | Адаптация runbook-launch-deploy.md под свежую РФ-инфру: провижн managed-PG (ICU) + S3 + VM, DNS/TLS, миграции, bootstrap-админ, флип флагов, F2-коммуникация. |

**Порядок SP1 → SP2 → SP3:** приложение должно стать РФ-совместимым (SP1) до упаковки (SP2) и разворота (SP3). Делать SP1 **до первого боевого файла** означает, что миграция уже накопленных документов между провайдерами не понадобится вообще.

---

## 1. Цель SP1

Заменить провайдер-специфичный слой Supabase Storage на узкий, провайдер-агностичный **storage-порт** с единственной реализацией поверх S3-совместимого API. После SP1 файловое хранилище свободно размещается в РФ и заменяется сменой env, без правок прикладного кода.

**Не-цель:** миграция существующих файлов (БД свежая, файлов ещё нет); browser-direct upload (мёртвый placeholder, удаляется); смена логики RBAC/скана/уведомлений вокруг документов (поведение сохраняется точь-в-точь).

---

## 2. Поверхность замены (факт из репозитория)

Весь Supabase Storage сводится к **четырём операциям** на **17 вызовах в 13 файлах** (8 в `src/lib/services`, 3 в `src/worker/processors`, **6 в `src/app/api`-роутах**):

| Операция | Сайты | Текущая Supabase-форма | S3-эквивалент |
|---|---|---|---|
| `upload(path, buffer, {contentType, upsert:false})` | [documents/upload-core.ts:94](../../../src/lib/services/documents/upload-core.ts), [chat/attachments.ts:99](../../../src/lib/services/chat/attachments.ts), [partner/leadAttachments.ts:143](../../../src/lib/services/partner/leadAttachments.ts), [oneCSync/document-fetch.ts:39](../../../src/lib/services/oneCSync/document-fetch.ts), [worker/.../generate-commission-pdf.ts:35](../../../src/worker/processors/generate-commission-pdf.ts), [worker/.../generate-commission-xlsx.ts:34](../../../src/worker/processors/generate-commission-xlsx.ts), [api/documents/upload/route.ts:104](../../../src/app/api/documents/upload/route.ts) | `{ error }` | `PutObjectCommand` |
| `createSignedUrl(path, ttl, {download?})` | [partner/leadAttachments.ts:297](../../../src/lib/services/partner/leadAttachments.ts), [chat/attachments.ts:159](../../../src/lib/services/chat/attachments.ts), [api/documents/[id]/download/route.ts:43](../../../src/app/api/documents/[id]/download/route.ts), [api/organization/documents/[id]/download/route.ts:54](../../../src/app/api/organization/documents/[id]/download/route.ts), [api/manager/documents/[id]/download/route.ts:50](../../../src/app/api/manager/documents/[id]/download/route.ts), [api/partner/finance/statements/[id]/xlsx/route.ts:34](../../../src/app/api/partner/finance/statements/[id]/xlsx/route.ts), [api/partner/finance/statements/[id]/pdf/route.ts:34](../../../src/app/api/partner/finance/statements/[id]/pdf/route.ts) | `{ data: {signedUrl}, error }` | presigned `GetObjectCommand` + `ResponseContentDisposition` |
| `remove([paths])` | [partner/leadAttachments.ts:194,252](../../../src/lib/services/partner/leadAttachments.ts) | best-effort, результат игнорируется | `DeleteObjectsCommand` |
| `download(path) → Buffer` | [worker/processors/scan-document.ts:63](../../../src/worker/processors/scan-document.ts) | `{ data: Blob, error }` | `GetObjectCommand` → Buffer |

**Тонкость `download`-опции (две формы в проде):** `leadAttachments` зовёт `createSignedUrl(path, ttl, { download: attachment.name })` — **строка** (форс-скачивание с конкретным именем); финансовые роуты (`statements/.../xlsx|pdf`) зовут `{ download: true }` — **boolean** (форс-скачивание, имя берёт браузер из URL/ключа); `chat` и documents-download-роуты зовут вообще без `download` (инлайн-просмотр). Порт обязан принять **`download?: boolean | string`**: `true` → `ResponseContentDisposition: attachment` (без имени); строка → `attachment; filename="<name>"`; отсутствует → без заголовка (инлайн).

---

## 3. Дизайн порта

### 3.1 Интерфейс

```ts
// src/lib/storage/objectStorage.ts
export interface ObjectStorage {
  upload(path: string, body: Buffer, opts: { contentType: string }): Promise<void>;
  createSignedUrl(path: string, ttlSeconds: number, opts?: { download?: boolean | string }): Promise<string>;
  remove(paths: string[]): Promise<void>;
  download(path: string): Promise<Buffer>;
}

export class StorageError extends Error {
  constructor(public op: 'upload' | 'sign' | 'remove' | 'download', message: string) {
    super(`STORAGE_${op.toUpperCase()}: ${message}`);
    this.name = 'StorageError';
  }
}

export function getObjectStorage(): ObjectStorage; // ленивый синглтон (как нынешний getServerClient)
export const documentBucket: string;               // = process.env.S3_BUCKET ?? 'documents'
```

### 3.2 Модель ошибок — throw-based (утверждено)

Методы порта **кидают `StorageError`** при сбое провайдера; адаптер — единственная граница, транслирующая ошибки S3 SDK. Обоснование:

- `scan-document` уже оборачивает `download()` в try/catch и **ре-throw'ит ради BullMQ-ретрая** (см. SECURITY-комментарий [scan-document.ts:144-166](../../../src/worker/processors/scan-document.ts)) — throwing `download` ложится без изменения логики.
- `leadAttachments` (весь метод в try/catch) и `chat` (Result-возврат) ловят `StorageError` и мапят в свой код (`STORAGE_FAILURE` / `'storage'`) — поведение сохраняется.
- Это паттерн «boundary try/catch» из CLAUDE.md §3 (как в C4).

**`upsert:false` — намеренно НЕ переносится в интерфейс.** Supabase соблюдает его честно; строгий S3-аналог (`IfNoneMatch:'*'`) поддержан не всеми РФ-провайдерами. Все пути уже содержат `randomUUID()` → коллизия практически невозможна. Решение: `upload` трактует уникальность как гарантированную вызывающим (UUID в пути); провайдер-специфичная фича не тащится. Зафиксировать в JSDoc `upload`.

**`createSignedUrl(..., {download})`** должен сохранить три режима (см. §2): `download:string` → `ResponseContentDisposition: attachment; filename="<name>"`; `download:true` → `attachment` (без имени); опция отсутствует → без заголовка (инлайн-просмотр). Без этого скачивание документов/ведомостей потеряет force-download или имя файла (регрессия UX). Покрыть тестом все три ветки.

### 3.3 S3-реализация

```
src/lib/storage/s3.ts
```

- `@aws-sdk/client-s3` (`S3Client`, `PutObjectCommand`, `GetObjectCommand`, `DeleteObjectsCommand`) + `@aws-sdk/s3-request-presigner` (`getSignedUrl`).
- Конфиг клиента из env (§4): `endpoint`, `region`, `credentials`, `forcePathStyle`.
- `download`: `GetObject` возвращает stream → собрать в Buffer (`transformToByteArray()` из SDK v3).
- Все вызовы SDK обёрнуты в try/catch → `throw new StorageError(op, providerMsg)`.

### 3.4 Раскладка модулей

| Файл | Действие |
|---|---|
| `src/lib/storage/objectStorage.ts` | **создать** — интерфейс, `StorageError`, `getObjectStorage()`, `documentBucket`. |
| `src/lib/storage/s3.ts` | **создать** — S3-реализация. |
| `src/lib/storage/supabase.ts` | **удалить** — включая `getUserClient` (мёртвый placeholder под несуществующий browser-direct flow). |
| `src/lib/storage/mimeValidator.ts` | без изменений (провайдер-агностичен). |
| 17 вызовов в 13 файлах (8 lib + 3 worker + 6 app-роутов) | переключить с `getServerClient()/supabaseAdmin .storage.from(bucket).X` на `getObjectStorage().X`; снять инлайн-проверку `.error`, положиться на throw. **app-роуты download** обёрнуть в try/catch → их текущий HTTP-маппинг ошибки (502/500) сохранить. |

### 3.5 Зависимости

- **Убрать:** `@supabase/supabase-js`.
- **Добавить:** `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`.

---

## 4. Env (заменяет `SUPABASE_*`)

| Переменная | Назначение | Пример (MinIO dev) |
|---|---|---|
| `S3_ENDPOINT` | URL S3-эндпоинта провайдера | `http://localhost:9000` |
| `S3_REGION` | регион (для подписи; РФ-провайдеры часто `ru-central1`) | `ru-central1` |
| `S3_ACCESS_KEY_ID` | access key | — |
| `S3_SECRET_ACCESS_KEY` | secret key | — |
| `S3_BUCKET` | bucket файлов (= нынешний `documents`) | `documents` |
| `S3_FORCE_PATH_STYLE` | `1` для MinIO/провайдеров без virtual-host стиля | `1` |

Под Yandex/VK/Selectel меняются только `S3_ENDPOINT` + регион + ключи; код один. Удалить из `.env.example` блок `SUPABASE_*`, добавить блок `S3_*` с комментариями. (Сам выбор провайдера и боевые значения — в SP3-runbook, не в коде.)

---

## 5. Тест-стратегия

Следуем четырёхслойной дисциплине CLAUDE.md §6.

- **Unit** (`src/__tests__/storage.s3.test.ts`, замена `storage.supabase.test.ts`): мок S3-клиента (`aws-sdk-client-mock` или ручной мок команд), проверка:
  - `upload` шлёт `PutObject` с `Bucket/Key/Body/ContentType`;
  - `createSignedUrl` три ветки `download` (отсутствует / `true` / строка) → корректный `ResponseContentDisposition`;
  - `remove` шлёт `DeleteObjects` со списком ключей;
  - `download` собирает stream в Buffer;
  - сбой каждой операции → `StorageError` с правильным `op`.
- **Сайт-юнит-тесты (13 файлов, вкл. 6 роут-тестов):** существующие мокают `@/lib/storage/supabase` через `vi.mock`. Перенацелить мок на `@/lib/storage/objectStorage` (throw-based: `mockRejectedValue(new StorageError(...))` вместо `{ error }`). Проверить, что маппинг в Result-коды (`'storage'` / `STORAGE_FAILURE`) и HTTP-статусы download-роутов (502/500/410) сохранён. **Гочадж (C4-урок):** не оставлять старые `{ error }`-моки — иначе тест молча слабеет.
- **Integration** (gate, L2.5/L3): поднять **MinIO** (S3-совместимый) в [docker-compose.yml](../../../docker-compose.yml) рядом с Postgres. Реальный round-trip upload → download → createSignedUrl(fetch) → remove. Перенацелить существующий `chat.attachments.integration` на MinIO. MinIO заодно = локальный dev-storage (заменяет dev-Supabase).
- **Worker coverage guardrail:** scan-document остаётся покрыт; `defaultDownload` помечен `/* v8 ignore */` (как сейчас) — внутренность провайдер-специфична, проверяется в integration.

---

## 6. Риски и решения

| Риск | Решение |
|---|---|
| Презайн-семантика / path-style / content-disposition тонки и провайдер-зависимы | Integration round-trip против реального S3-API (MinIO) ловит то, что мок не поймает. |
| `upsert:false` не строгий на S3 | Уникальность даёт `randomUUID()` в пути; задокументировано в JSDoc. |
| Регрессия имени файла при скачивании | Тест на `ResponseContentDisposition`. |
| Старые `{ error }`-моки молча ослабляют сайт-тесты (C4-грабли) | Аудит всех 13 сайт-тестов в плане отдельной задачей. |
| Забыт один из 13 сайтов (особенно app-роуты — их легко пропустить) | grep-гард `storage/supabase\|\.storage\.from\(` после рефактора → 0 совпадений в `src/`. |

---

## 7. Критерии готовности SP1

- [ ] `src/lib/storage/supabase.ts` удалён; `@supabase/supabase-js` нет в зависимостях; `grep -r "storage/supabase"` по `src/` → 0.
- [ ] Все 13 файлов-сайтов используют `getObjectStorage()`; поведение Result-кодов и HTTP-статусов download-роутов сохранено.
- [ ] Unit-тест порта зелёный (вкл. 3 ветки `download`); сайт-тесты (13 файлов) перенацелены и зелёные.
- [ ] MinIO в docker-compose; integration round-trip зелёный (gate).
- [ ] `.env.example`: `SUPABASE_*` → `S3_*`.
- [ ] `npm run typecheck` + `npm run lint` + `npm run test:unit` зелёные; gate (L2.5) зелёный.
- [ ] CLAUDE.md §10 обновлён (bucket/скачивание через signed URL — формулировки про Supabase → S3).
