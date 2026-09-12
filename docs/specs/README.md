# docs/specs — пакет ТЗ «CRM для отдела продаж — замена Битрикс24»

**Дата:** 12.09.2026 · **База:** `main` = `a35d2d22` (v0.11.0) · **Требования:** `У-177`…`У-269` · **Решения:** `Р-Б-1`…`Р-Б-12` · **Дефекты:** `Д-41`…`Д-49`.

Пакет вводится в действие задачей **Task 0** из `15_claude_code_tasks.md`: она создаёт тонкое индексное ТЗ в `docs/tz/`, переключает четыре указателя действующего ТЗ и заводит строки в `docs/tz/AUDIT.md`, чтобы страж `docs.tz-program` остался зелёным. До Task 0 действующим остаётся режим сопровождения (`docs/tz/MAINTENANCE.md`).

| Файл | Содержание | Этап |
|---|---|---|
| [00_project_audit.md](00_project_audit.md) | аудит кода с якорями: что есть, что частично, что не найдено, что лишнее | — |
| [01_product_vision.md](01_product_vision.md) | что строим, что заменяем, что не копируем, MVP, «не делать» | — |
| [02_roles_and_access.md](02_roles_and_access.md) | роли, матрица доступа, правила видимости | все |
| [03_information_architecture.md](03_information_architecture.md) | меню, хаб, карта новых маршрутов | все |
| [04_crm_core.md](04_crm_core.md) | контакты, внутренние заметки, история (`У-178`…`У-187`) | 1 |
| [16_bitrix24_migration.md](16_bitrix24_migration.md) | миграция из Битрикс24 (`У-188`…`У-203`) | 2 |
| [07_messenger_integrations.md](07_messenger_integrations.md) | коммуникационный центр v2 (`У-204`…`У-217`) | 3 |
| [11_tasks_and_workflows.md](11_tasks_and_workflows.md) | задачи и автоматизация (`У-218`…`У-227`) | 4 |
| [09_notifications.md](09_notifications.md) | центр уведомлений (`У-228`…`У-233`) | 5 |
| [05_client_cabinet.md](05_client_cabinet.md), [06_partner_cabinet.md](06_partner_cabinet.md) | доборы кабинетов (`У-234`…`У-241`) | 6 |
| [12_reports_and_dashboards.md](12_reports_and_dashboards.md) | KPI и отчёты (`У-242`…`У-250`) | 7 |
| [10_documents_and_files.md](10_documents_and_files.md), [08_1c_integration.md](08_1c_integration.md) | документы и 1С (`У-251`…`У-258`) | 8 |
| [13_cleanup_and_simplification.md](13_cleanup_and_simplification.md) | очистка (`У-259`…`У-267`) | 9 |
| [14_implementation_roadmap.md](14_implementation_roadmap.md) | этапы, реестр требований, решения, вопросы, приёмка (`У-268`, `У-269`) | все |
| [15_claude_code_tasks.md](15_claude_code_tasks.md) | Task 0…Task 49 для Claude Code | все |

Порядок реализации: 0 → 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 (этап 5 можно вести параллельно этапу 2).
