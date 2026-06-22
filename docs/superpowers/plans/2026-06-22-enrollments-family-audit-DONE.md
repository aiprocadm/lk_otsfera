# Close-out — аудит семейства «Заявки на обучение» (Track D, SP6 — финал)

FINDINGS: `docs/superpowers/specs/2026-06-22-enrollments-family-audit-FINDINGS.md`.

## Отгружено
- **DE1** org-заголовок `font-bold`→`font-semibold` — единственная находка семейства (partner/manager/leader/
  admin уже на каноне `font-semibold text-[#111111]`).

Самое консистентное семейство из шести: единый флаг `enrollment_requests` (`notFound` во всех 5),
канонические `require*`-хелперы, `space-y-5`, общие компоненты `enrollment/*` без локальных форматтеров.
Намеренные различия (НЕ трогали): submitter-вид `EnrollmentList` (partner/org) vs processor-вид
`EnrollmentQueue` (manager/leader/admin); отсутствие формы подачи у leader (чистый processor).

## Верификация
typecheck ✅ · lint ✅ · test:unit (прогон) · build (прогон). e2e:visual operator-deferred.

## Открытых решений владельцу нет.

---

# Track D — ИТОГ (все 6 семейств)

| SP | Семейство | PR | Главное |
|----|-----------|----|---------|
| SP1 | Заказы | #138–#141 (merged) | basePath/cursor-offset/param-раскол вскрыты; `ui/Paginator`+`pluralizeRu` извлечены |
| SP2 | Финансы | #142 | **DF3 P1**: мёртвая ссылка платёж→заказ у admin; DF7 `?org=`; basePath-канон |
| SP3 | Документы | #143 | DD2 manager `q`→`search`; DD3 локальный Paginator→`ui/Paginator`; admin англ.→рус |
| SP4 | Сообщения | #144 | §5-гейтинг намеренный; DM2 org на сыром getSession→`requireOrganization()` |
| SP5 | Команда | #145 | DT1–DT3 заголовки/плюрализаторы/fmtDate; DT-mobile владельцу |
| SP6 | Заявки | #146 | DE1 org-заголовок — единственная находка (самое консистентное семейство) |

**Сквозной паттерн:** убывающий объём находок (Заказы → Заявки) — каждый извлечённый общий примитив
(`ui/Paginator`, `pluralizeRu`, `fmtMoney`/`fmtDate`, `OrderThreadInbox`, `require*`-хелперы) гасит класс
будущих расхождений. Рекуррентные баги между семействами: font-bold-vs-semibold заголовки, hardcoded
basePath в шаренных компонентах, `q`-vs-`search` param, локальные копии форматтеров.

**Вынесено владельцу (по семействам):** DF4 общий `PaymentsTable` + DF8 (Финансы); DD-tabs/DD-typefilter
(Документы); DT-mobile org-таблица (Команда). Все — judgment-call sibling-vs-shared (§4) или визуальные.

**Гейтинг намеренно НЕ трогали:** §5 chat-матрица (Сообщения), Model A admin (нет списков/команды),
cursor/offset пагинация (spec §6), submitter/processor вид (Заявки).
