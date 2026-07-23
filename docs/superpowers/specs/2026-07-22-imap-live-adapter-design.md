# Живой IMAP-адаптер входящей почты

Дата: 2026-07-22 · Статус: approved · Продолжение волны 2 настроек
интеграций (адаптер настраивается в /admin/integrations, конфиг — через
`readImapConfig`, лениво).

## 1. Цель

Заменить заглушку `ImapInboundEmailAdapter.fetchNewMessages` («not wired»)
реальным IMAP-клиентом, чтобы режим `imap.adapter=imap` стал боевым:
cron-джоба `inbound.email.poll` читает новые письма ящика и отдаёт их в
`ingestInboundMessage` (омниканальный инбокс). Убирается landmine из
.env.example «в проде НЕ ставить imap — джоба уходит в DLQ».

## 2. Библиотеки

`imapflow` (IMAP-клиент от команды Nodemailer, promise-API, свои типы) +
`mailparser`/`simpleParser` (MIME → from/subject/text). Письмо тянем целиком
(`source`) и парсим одним инструментом — без ручного разбора bodyStructure.

## 3. Протокол курсора

Курсор `SyncState.cursor` — строка `"<uidValidity>:<lastSeenUid>"`.

- UID монотонно растут внутри одного поколения ящика; `uidValidity` меняется,
  когда сервер пересоздал ящик (UID-ы стали несравнимы) → в этом случае
  курсор сбрасывается и чтение идёт с UID 1 (дедуп в ingest по `externalId`
  гасит возможные повторы только внутри того же uidValidity-поколения;
  новое поколение = новые externalId — принято, письма важнее дублей).
- Выборка: `search({ uid: "<lastUid+1>:*" })`; IMAP-квирк — диапазон `n:*`
  ВСЕГДА включает письмо с максимальным UID, даже если его UID < n, поэтому
  результат дополнительно фильтруется `uid > lastUid`.
- Батч ограничен 50 письмами за прогон (следующий poll доберёт хвост);
  курсор продвигается по максимальному UID обработанного батча — но
  фактически пишется в SyncState только процессором и только при
  безошибочном ingest (существующее поведение «cursor held for retry»).

`externalId = "<uidValidity>-<uid>"` (процессор добавляет префикс `email:`).

## 4. Поведение

- Конфиг читается лениво из `readImapConfig` (БД → env). Отсутствие
  host/user/password → throw `imap config incomplete` — джоба падает в
  retry/DLQ, как и раньше при кривом конфиге (fail-loud, не тихий no-op:
  оператор включил imap — молчание скрыло бы опечатку в хосте).
- Соединение per-poll: connect → mailboxLock('INBOX') → search/fetch →
  release → logout в `finally`. Никакого постоянного коннекта в воркере.
- `tls` → `secure`; `port` дефолтится самим imapflow (993/143 по secure).
- Логгер imapflow отключён (`logger: false`) — сырой console запрещён §12.
- Письмо без текста: `parsed.text` → fallback на strip-нутый `parsed.html`
  → пустая строка (ingest сам решает, что делать с пустым телом).
- Отправитель: `parsed.from.value[0].address`; письмо без адреса
  отправителя пропускается (курсор всё равно продвигается — иначе оно
  вечно блокирует хвост).

## 5. Тесты

Unit (mock `imapflow`/`mailparser`): happy-path (курсор продвинулся, DTO
собраны), первый запуск без курсора, смена uidValidity (сброс), фильтр
IMAP-квирка `n:*`, батч-лимит, письмо без from (skip), без text (fallback
html/пусто), неполный конфиг (throw), logout в finally при ошибке fetch.
Live smoke вне тестового слоя: docker greenmail (IMAP 3143/SMTP 3025,
без TLS), реальное письмо через SMTP → adapter → DTO.

## 6. Вне скоупа

IDLE/push-уведомления (остаётся poll по cron), несколько ящиков, папки
кроме INBOX, вложения (только текст — контракт `InboundEmailDto`).
