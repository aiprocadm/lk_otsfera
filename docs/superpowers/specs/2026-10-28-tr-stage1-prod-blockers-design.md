# Этап 1 ТЗ 28.10.2026 — блокеры выхода в прод (`У-321`…`У-325`)

**Источник:** ДП §1 ([расшифровка](../../tz/sources/2026-10-28-release-plan.md)) — аудит программиста
23.10.2026. **Подтверждение спеки:** снято (`Р-ТР-3`). Сверено против `main` = `cba0051`.

## Что нашла сверка

| Требование | Что в коде | Вывод |
|---|---|---|
| `У-322` ClamAV | Скан готов ([scan-document.ts](../../../src/worker/processors/scan-document.ts) читает `CLAMAV_HOST`, в production без него отказывается ставить `clean`), но в `docker-compose.prod.yml` сервиса нет, а в `.env.production.example` переменные закомментированы с неверным пояснением «без него скан помечает clean» | Добавить сервис, раскомментировать переменные, поправить пояснение, страж на compose |
| `У-323` мост слушателя | `getStudentBridgeSecret` при пустом `STUDENT_BRIDGE_JWT_SECRET` подписывает мост ключом `JWT_SECRET`; `verifyToken` и middleware не смотрят `aud` — токен площадки (`aud: external-student-portal`, `role: student`) проходит `sessionPayloadSchema` | Два слоя: (1) `aud` есть → не сессия, в `verifyToken` и middleware; (2) в production секрет моста обязателен и ≠ `JWT_SECRET` (`env.ts`). На стенде секрет задан и отличается — проверено сравнением без вывода значений |
| `У-324` выход | `POST /api/auth/logout` только стирает cookie; механизм отзыва уже есть — `sessionVersion` + `revokeAllSessions` | Выход = тот же отзыв (`endSessionOnLogout`, аудит `logout`). Цена: выход завершает сессии на всех устройствах — список отозванных `jti` (точечный выход) отклонён: новая таблица и запрос на каждый вход ради редкого случая |
| `У-325` лимит по учётной записи | Только `login:<ip>` (10/мин) | Второй счётчик `login:acct:<sha256(email)>` — в Redis отпечаток, не адрес (ПДн). По умолчанию 20 попыток / 15 минут, настраивается в «Политиках входа» (`login.accountRateLimit*`). Проверка ДО пароля — иначе счётчик выдавал бы существование записи. Цена — чужие попытки на время окна закрывают вход владельцу; ему остаётся «Забыли пароль?». Ответ 429 `ACCOUNT_TOO_MANY_ATTEMPTS` + `Retry-After` + `retryAfterMinutes`; форма входа называет срок |
| `У-321` зависимости | `nodemailer` — не прямая зависимость, а `overrides: ^9.1.1` для `mailparser` 3.9 и `imapflow` 1.5. `npm audit --omit=dev` шире ДП: **5 уязвимостей** — critical `@sentry/nextjs` < 10.75.2 (обход middleware через tunnel-route), high `nodemailer` ≤ 10.1.3, high `zod` < 4.6.6 (вся линия 3.x), moderate `fast-uri`, `imapflow`, `mailparser` | Почта: `mailparser` ^3.12 (сам тянет nodemailer 10.2), `imapflow` — свежий, override → ^10.2.1; Sentry — внутри 10.x до ≥ 10.75.2; `fast-uri` — `npm audit fix`. `zod` 4 — мажор с правкой схем по всему проекту: отдельный PR |

## План PR

1. **PR-1 (этот):** `У-322`, `У-323`, `У-324`, `У-325` + спека + отметки этапа 0 (#719). Стражи проверены мутациями (5 из 5 поломок пойманы + compose).
2. **PR-2:** `У-321` часть 1 — почта (`mailparser`, `imapflow`, `nodemailer` 10), `@sentry/*` в пределах 10.x, `fast-uri`. Проверка: тесты почты и входящей почты, `npm run build`, `audit:prod` без critical.
3. **PR-3:** `У-321` часть 2 — `zod` 4 (`required_error` → `error` и прочие изменения API), `audit:prod` = 0 high, 0 critical. После него `У-321` → `✅`, этап 1 закрыт.

## Чего этап не делает

`FEATURE_STAFF_2FA=1` на проде — настройка среды (`Н-8`), в коде флаг уже есть. CSP `script-src` — вне программы (§7 ТЗ).
