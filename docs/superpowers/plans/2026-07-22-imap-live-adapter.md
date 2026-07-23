# План: живой IMAP-адаптер входящей почты

Спека: [2026-07-22-imap-live-adapter-design.md](../specs/2026-07-22-imap-live-adapter-design.md)

- [ ] 1. Зависимости: `imapflow`, `mailparser`, `@types/mailparser`.
- [ ] 2. Реализация `fetchNewMessages` в `adapter-imap.ts` (курсор
      uidValidity:uid, батч 50, фильтр квирка `n:*`, fallback текста,
      skip без from, logout в finally).
- [ ] 3. Unit-тесты (mock imapflow/mailparser) по матрице спеки §5.
- [ ] 4. Доки: .env.example (imap теперь боевой), обновить подсказку.
- [ ] 5. Live smoke: greenmail в Docker, письмо по SMTP → адаптер → DTO.
- [ ] 6. Гейты (typecheck/lint/test:unit, гейт integration) + close-out.
