# Close-out — План — Этап 1 / PR-1: настройка 1С + WhatsApp/Max baseUrl + DaData

План: [2026-07-23-stage1-pr1-integrations-settings.md](2026-07-23-stage1-pr1-integrations-settings.md) · PR [#216](https://github.com/aiprocadm/lk_otsfera/pull/216) ✅ в `main`.

## Что отгружено

- A. 1С в реестр настроек (ФТ-14.1, 14.2)
- B. whatsapp.baseUrl + max.baseUrl (ФТ-14.1)
- C. DaData: настройки + прокси (ФТ-13.1, 13.2)
- D. Env-доки и CHANGELOG
- E. Зелёные ворота
- Вне PR-1 (→ PR-2)

## Где искать подробности

Детальная запись «что именно отгружено, какие решения приняты и какие
отклонения от спеки допущены» — в журнале [docs/tz/STATUS.md](../../tz/STATUS.md)
(записи по дате плана). Итог всей программы — в
[close-out программы ТЗ](../../tz/2026-07-28-tz-program-DONE.md).

## Гейты на момент отгрузки

`typecheck` · `lint` (0 warnings) · полный unit-слой · integration на живом
Postgres — зелёные (условие мержа, см. журнал STATUS).

---

*Close-out составлен 2026-07-28 в рамках закрытия документного долга: планы
были отгружены и влиты, но close-out рядом с планом (§8 CLAUDE.md) не
создавался.*
