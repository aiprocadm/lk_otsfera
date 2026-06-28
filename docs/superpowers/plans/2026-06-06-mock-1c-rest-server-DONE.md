# Close-out — mock 1С REST-сервер (для контрактных/shadow-тестов)

**План:** [2026-06-06-mock-1c-rest-server.md](2026-06-06-mock-1c-rest-server.md)
**Ветка/PR:** #98 (merge `fc96957`, финализация 2026-06-28) · **Метод:** subagent-driven-development.

> Бэкфилл close-out (housekeeping). Standalone-инструмент вне `src/` (одностороннее правило `src ↛ mock-1c`).

## Что отгружено

Автономный mock 1С REST-сервер: воспроизводит контракт боевого 1С для контрактных и shadow-sync тестов, со сценарной конфигурацией крайних случаев.

| Задача | Отгружено | Коммит |
|---|---|---|
| 0 | vitest обнаруживает тест-корень `mock-1c/` | `c2ecb09` |
| 1 | сценарный конфиг + чистое формирование ответов (Q1 envelope / Q6 пагинация / Q7 datetime / Q10 диалект статусов) | `0917714` |
| 2 | in-memory dataset из фикстур (`since`-фильтр + touch) | `0540e5b` |
| 3 | lead-store — dedup по `cabinetLeadId` + наблюдение ключа партнёра (Q5) | `5c564a4` |
| 4 | парсер env → `ScenarioConfig` с fail-fast | `1a5a53e` |
| 5 | HTTP-сервер (5 endpoint'ов + `/__health` `/__state` `/__control`) + entry | `069f74d` |
| 6 | eslint-guardrail `src ↛ mock-1c` + `.env.example` блок | `4f0e429` |
| 7 | контрактный тест `RestOneCAdapter` через реальный сокет | `d37e2af` |
| 8 | README + таблица сценариев + runbook shadow-репетиции | `a88932e` |
| 9 | integration: shadow-sync против mock'а ничего не пишет, логи проверены | `8619f6e` |

npm-скрипт `mock:1c`.

## Гейты (merge-time, PR #98)

typecheck ✅ · lint ✅ (включая guardrail) · test:unit ✅ · integration ✅.

## Остаток

- Боевая shadow-репетиция против реального 1С — операторская задача по runbook'у (`mock-1c/README.md`).
