# План: антивирус для вложений клиентского чата

Спека: [2026-08-17-chat-attachment-scan-design.md](../specs/2026-08-17-chat-attachment-scan-design.md).
Один PR от `main`. Эталон всей цепочки — служебный чат (StaffMessage).

- [x] 1. Миграция `chat_attachment_scan`: колонка `scanStatus` (default
      `'none'`) + бэкфилл `pending` для `attachmentPath LIKE 'chat/%'` +
      индекс; `@@index` в схеме; `prisma generate` + `migrate deploy` на
      локальной базе + `migrate status` без дрейфа.
- [x] 2. `lib/jobs/types.ts`: kind `chat_attachment`.
- [x] 3. `chat/messages.ts`: `scanStatus` при создании + best-effort enqueue;
      `listMessages` отдаёт `scanStatus`.
- [x] 4. `scan-document.ts`: ветки `loadTarget`/`persistResult` для Message.
- [x] 5. `scan/backfill.ts`: ключ `chatAttachments` + ветка Message.
- [x] 6. `chat/attachments.ts`: гейт `infected`/`not_ready`, новая шапка.
- [x] 7. Роут `api/messages/attachment`: `409 not_ready` / `410 infected`,
      новая шапка.
- [x] 8. UI: бейджи «проверяется»/«заражён» в чат-компонентах (+ лента
      сделки менеджера, если рисует ссылку).
- [x] 9. Тесты по §4 спеки (схема, сервисы, процессор, sweep, роут, UI).
- [x] 10. Гейты: `typecheck` · `lint` · целевые vitest · полный
      `test:coverage` на живом Postgres.
- [x] 11. CHANGELOG.md · AUDIT.md (закрыть запись «Вне объёма») · PR
      `base: main` · close-out.
