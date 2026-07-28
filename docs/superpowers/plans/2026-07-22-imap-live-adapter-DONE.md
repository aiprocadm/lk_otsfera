# Close-out — живой IMAP-адаптер входящей почты

План: [2026-07-22-imap-live-adapter.md](2026-07-22-imap-live-adapter.md) ·
Спека: [2026-07-22-imap-live-adapter-design.md](../specs/2026-07-22-imap-live-adapter-design.md) ·
PR [#230](https://github.com/aiprocadm/lk_otsfera/pull/230) ✅ в `main` (коммит `99428c5`, 23.07.2026).

## Что отгружено

- **Зависимости:** `imapflow` + `mailparser`.
- **Реальный `fetchNewMessages`** в [`src/lib/inbound/email/adapter-imap.ts`](../../../src/lib/inbound/email/adapter-imap.ts):
  соединение по конфигу из настроек (`host/port/user/password/tls`), INBOX,
  выборка UID больше курсора, разбор письма `mailparser`'ом. Неполный конфиг →
  понятная ошибка со ссылкой на `/admin/integrations`.
- **Курсор** `uidValidity:lastUid`: смена `uidValidity` (сервер пересоздал ящик)
  сбрасывает курсор — UID-ы становятся несравнимыми.
- **Unit-тесты** — [`inbound.email.adapter-imap-live.test.ts`](../../../src/__tests__/inbound.email.adapter-imap-live.test.ts).
- **Документация окружения** — блок IMAP в `.env.example`.
- Выбор адаптера (`fake` ↔ `imap`) и креды задаются из UI; смена применяется
  без рестарта (сброс синглтона в server-action).

## Live smoke (пункт 5 плана) — выполнен 28.07.2026

Изначально пункт закрывался как «не выполнялся»: поведение считалось покрытым
unit-тестами на моках. 28.07 проверка проведена **по-настоящему** — greenmail в
Docker, письма по SMTP, чтение **реальным** `ImapInboundEmailAdapter`.

| Проверка | Результат |
|---|---|
| Соединение и выборка INBOX | ✅ письма получены |
| Отправитель (`from`) | ✅ `client@example.org` разобран |
| Текстовое тело | ✅ «Тело письма из greenmail. Вторая строка.» |
| Письмо **только с HTML** | ✅ теги сняты → «HTML-тело без текстовой части»: `bodyTextFrom` отработал на настоящем письме, а не на фикстуре |
| Курсор `uidValidity:uid` | ✅ повторный вызов с курсором вернул **0 писем** — дублей не будет |

### Как повторить

```bash
docker run -d --name greenmail-smoke -p 3025:3025 -p 3143:3143 \
  -e GREENMAIL_OPTS='-Dgreenmail.setup.test.smtp -Dgreenmail.setup.test.imap \
     -Dgreenmail.hostname=0.0.0.0 -Dgreenmail.users=smoke:smokepass@example.local' \
  greenmail/standalone:2.1.0
```

Отправить письмо по SMTP на `127.0.0.1:3025`, затем вызвать
`new ImapInboundEmailAdapter({ host: '127.0.0.1', port: 3143, user: 'smoke',
password: 'smokepass', tls: false }).fetchNewMessages(null)` — конструктор
принимает конфиг напрямую, БД и настройки интеграций для проверки не нужны.
После — `docker rm -f greenmail-smoke`.

**Грабля:** поля DTO называются `from` / `text` / `subject` / `externalId`
(не `fromEmail`/`bodyText`). На неверных именах проверка покажет пустого
отправителя и пустое тело — легко принять за дефект адаптера, хотя дефект в
скрипте проверки.

### Почему не завели автотест

Тест потребовал бы поднимать почтовый сервер в CI — это расширение гейта, а
§11 CLAUDE.md просит обсуждать такие изменения до реализации. Проверка
оформлена воспроизводимым рецептом выше.

---

*Close-out составлен 2026-07-28 при закрытии документного долга: работа влита
23.07, но close-out рядом с планом (§8 CLAUDE.md) не создавался, из-за чего
план выглядел невыполненным (шесть неотмеченных пунктов).*
