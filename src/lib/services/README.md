# src/lib/services — бизнес-логика (сервисный слой)

Доменные функции без знания о Next/HTTP. Сервис не импортирует ничего из `app/`,
`components/`, `server-actions/` (энфорсится `npm run boundaries`). Если внутри сервиса
понадобились Next-типы — логика лежит не там.

## Контракт (CLAUDE.md §3)

Каждая доменная функция следует единой сигнатуре с Result-типом:

```ts
function doX(
  prisma: PrismaClient,
  session: SessionPayload,
  args: XArgs
): Promise<{ ok: true; ...data } | { ok: false; error: ErrorCode }>;
```

- `error` — **стабильная строка** (`'forbidden' | 'not_found' | 'too_large' | 'invalid_mime' | 'storage' | …`).
  Существующие коды не менять без миграции всех вызовов; маппинг код → русская строка — `errorMessageRu`
  ([src/lib/errors/messages.ts](../errors/messages.ts)).
- Сервис сам фильтрует выборки по scope сессии (defense-in-depth, CLAUDE.md §4) — роут/экшен
  этому не доверяет и не подменяет.
- Побочные failure (enqueue в очередь, fan-out уведомлений) — логируем и проглатываем,
  основной путь не блокируют.
- Prisma-запросы — узкие `select`, не `findMany()` всего.

## Эталоны

- Сервис + тонкий роут: [upload-core.ts](documents/upload-core.ts) и роут
  [api/manager/documents/[id]/upload](../../app/api/manager/documents/%5Bid%5D/upload/route.ts) —
  роут только мапит код ошибки в HTTP-статус.
- Обвязка роутов поверх сервисов — [src/lib/api/README.md](../api/README.md).
