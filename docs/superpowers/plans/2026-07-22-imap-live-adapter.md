# План: живой IMAP-адаптер входящей почты

Спека: [2026-07-22-imap-live-adapter-design.md](../specs/2026-07-22-imap-live-adapter-design.md)

- [x] 1. Зависимости: `imapflow`, `mailparser`, `@types/mailparser`.
- [x] 2. Реализация `fetchNewMessages` в `adapter-imap.ts` (курсор
      uidValidity:uid, батч 50, фильтр квирка `n:*`, fallback текста,
      skip без from, logout в finally).
- [x] 3. Unit-тесты (mock imapflow/mailparser) по матрице спеки §5.
- [x] 4. Доки: .env.example (imap теперь боевой), обновить подсказку.
- [x] 5. Live smoke: greenmail в Docker, письмо по SMTP → адаптер → DTO.
- [x] 6. Гейты (typecheck/lint/test:unit, гейт integration) + close-out.
