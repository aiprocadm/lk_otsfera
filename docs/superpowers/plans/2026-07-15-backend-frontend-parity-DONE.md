# Backend-Frontend Parity — close-out (2026-07-17)

План: [2026-07-15-backend-frontend-parity.md](2026-07-15-backend-frontend-parity.md) ·
Спека: [2026-07-15-backend-frontend-parity-design.md](../specs/2026-07-15-backend-frontend-parity-design.md) ·
Ветка `claude/backend-frontend-parity-c44a4e`.

## Статус: ВСЕ 22 ЗАДАЧИ ВЫПОЛНЕНЫ

Все 21 кодовая задача (H1, B1–B3, A1–A4, D1, F1, C1–C3, E1–E5, G1–G4) + FINAL отгружены.
Каждая прошла двухступенчатое ревью (spec-compliance → code-quality) свежими агентами;
замечания уровня Important чинились до принятия. Полировочный пасс закрыл 20+ Minor-пунктов
четырьмя коммитами (пагинация calls/inbox, `ActionToastButton`, валидация фильтров, доки).

## Коммиты (по трекам)

- H1 `8c306f1`; B1 `91e4e2c`; B2 `6dfa469`+`472f165`; B3 `866c642`+`74d2e72`
- A1 `3b95767`; A2 `586c1ae`+`a55452e`; A3 `92ba353`+`5c79509`; A4 `8f81edb`+`2e0dd32`
- D1 `aa2629a`+`cac385b`; F1 `ef8263e`+`b1a10bc`
- C1 `ed9a896`; C2 `b82cbf8`+`fdc253c`+`475bfc3`; C3 `df66a60`
- E1 `a87dd51`; E2 `507362f`+`2dbf36d`+`d1f3822`; E3 `2a5010d`; E4 `2ae8dc6`; E5 `0db4bf3`+`032da57`
- G1 `6eeb8f4`; G2 `98134c2`; G3 `418ea73`+`c096aa5`; G4 `c00f7d0`
- Полировка `2c76c11`, `5acaca9`, `74a678e`, `2078cbb`; merge main `b60740b`

## Отклонения от плана (все — в плюс, зафиксированы в ревью)

1. **B3 jobId**: плановый статический `push-lead:<id>` был бы тупиком после финального фейла
   (removeOnFail:false → вечный дедуп с ложным ok) — заменён на timestamped по прецеденту
   `triggerSync`; дубль-пуш гасится claim'ом воркера.
2. **A2 → бэкенд**: `claimOrder` получил leader-bypass (`isLeaderSameCompany`) — иначе кнопка
   была бы видима, но нерабоча для лидера при дефолтной видимости. Привилегий не расширяет
   (лидер и так назначает себя через assign-экшен).
3. **E2 сверх плана**: (а) единый scope-модуль `inbound/scope.ts` (план нёс третью копию
   предиката с ослабленным null-гардом); (б) архив unresolved закрепляет обращение за
   компанией — плановая семантика создавала «чёрную дыру» (archived+companyId=null невидим
   всем); (в) CAS-guard от кросс-C8 гонки bind vs archive; (г) scope-гейт в bind
   (pre-existing security-дыра, стала однострочной благодаря модулю).
4. **C2**: плановая ветка `meta.url` принимала только относительные пути — но продьюсеры
   пишут абсолютные; починено pathname-извлечением с протокол-гейтом.
5. **E5/M2 merge**: клиентский `fromInternal` удалён — M2 перенесла внутренний номер на
   сервер (`User.internalPhone`); композер сохранён целиком.
6. **A4**: подпись различения осей потребовала переименования верхнего блока в
   «Операционный статус» (плановый текст ссылался на несуществующий заголовок).
7. **Полировка нашла и починила pre-existing баг**: пагинация calls И inbox не работала
   (page- vs take/skip-конвенция Paginator).

## Верификация

- Каждая задача: TDD red→green, целевые тесты + typecheck + pre-commit hook.
- Merge `origin/main` (M2-contacts, M3-analytics): 6 конфликтов разрешены с сохранением
  обеих функциональностей, hook прогнал 3407 тестов.
- FINAL: полный `test:unit`, `test:coverage` (100%-гейт), `gate` — результаты в PR.

## Отложено (follow-ups, не блокеры PR)

- Миграция `SyncTriggerButton` на toast/`ActionToastButton` (9 legacy-кнопок).
- Серверный `all:true` для «Прочитать все» (панель метит загруженные 50).
- `fmtPercent` в `lib/format` + общий резолвер имён rateHistory (rule-of-three не достигнут).
- Sibling-drift текстов `invalid_manager` admin↔leader форм назначения.
- Валидация «текущий менеджер вне кандидатов» в обеих assign-формах (disabled-опция).
- Общий vitest-хелпер мока `HTMLDialogElement` (20+ файлов).
- `CountPill` в ui/ (пилл unread-badge/notification-bell разошёлся на 4px).
