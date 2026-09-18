# Этап 6 «Кабинеты заказчика и партнёра — добор» — план

Спека — [2026-09-17-stage6-client-partner-cabinets-design.md](../specs/2026-09-17-stage6-client-partner-cabinets-design.md).
Требования `У-234`…`У-241`. Пять PR, каждый от `main`, с зелёными
`typecheck` · `lint` · `boundaries` · `deadcode` · `dup:check` · `format:check` ·
`tz:status` · unit ×4 · integration ×4 (живой Postgres) — локально, CI не
запускается. Каждый новый страж проверяется мутацией до PR.

REQUIRED SUB-SKILL: superpowers:subagent-driven-development

## PR-1. Ответ на обращение, «Ваш менеджер» (`У-238`, `У-240`)

- [x] Миграция: `ClientRequest.staffReply/staffRepliedAt/staffRepliedById`, `Partner.managerId`
- [x] `services/clientRequests/reply.ts` — `replyToClientRequest` (скоуп ЦО, аудит `client_request_replied`), уведомление подателю с текстом (`client_request_status_changed`, подстановка `reply` в шаблоне)
- [x] Форма ответа в деталке обращения у admin/leader/manager; блок «Ответ менеджера» в `client-request-detail-view.tsx`
- [x] `Partner.managerId` в карточке партнёра у администратора (`updatePartner`)
- [x] `services/organization/yourManager.ts`, `services/partner/yourManager.ts` (первый активный / `managerId` → первая организация), презентационный `your-manager-card.tsx`, блок на обеих главных
- [x] Страж `client-requests.reply-visible` (мутация: письмо без текста); тесты сервисов, компонентов, страниц
- [x] AUDIT `У-238`, `У-240` → ✅; CHANGELOG; STATUS

## PR-2. Счета у заказчика, «Первые шаги» (`У-235`, `У-239`)

- [x] `services/organization/invoices.ts` — счета организации с состоянием из `invoicePaymentState`, фильтры (период, состояние), «к оплате»; счета в экспорте финансов
- [x] Блок «Счета» в `/organization/finance` (таблица → карточки на мобильном), «Скачать» через существующий роут документов; исключение зеркала «Счета» с причиной
- [x] Миграция: `OrganizationUser.onboardingDismissedAt`, `PartnerUser.onboardingDismissedAt`
- [x] `services/organization/firstSteps.ts`, `services/partner/firstSteps.ts` — пункты по данным; `first-steps-card.tsx` с view-моделью; действие «Закрыть»
- [x] Страж `dashboard.first-steps` (мутация: выполненность из базы); тесты
- [x] AUDIT `У-235`, `У-239` → ✅; CHANGELOG; STATUS

## PR-3. Материалы для партнёров (`У-237`)

- [x] Миграция: `PartnerMaterial` + enum категории; `kind: 'partner_material'` в антивирусе
- [x] Сервис `services/partnerMaterials/*` (список для хаба и для партнёра со скоупом компаний, публикация только при `clean`, замена файла через `replacesDocumentId`, снятие, аудит скачивания)
- [x] Раздел хаба `catalogs.partnerMaterials` (`processes/partner-materials`, admin/leader), загрузка через API-роут `readMultipart`, форма, история «кто скачал»
- [x] `/partner/materials` (пункт меню, `sectionKey: 'materials'`, исключение зеркала), карточки по категориям, поиск, «Новое» 7 дней, скачивание presigned
- [x] Тип `partner_material_published` в реестре (значок, маршрут), рассылка единой точкой
- [x] Стражи `partner.materials-scope`, `partner.materials-download-audited` (мутации); IDOR-тест; `upload.core-usage`
- [x] AUDIT `У-237` → ✅; CHANGELOG; STATUS

## PR-4. «Переписка с менеджером», видимость `member` (`У-234`, `У-236`)

- [x] `services/cabinetDialogs/{list,get,reply}.ts` — диалоги пользователя всех каналов, реплики только `in`/`out`, ответ из кабинета через `ingestInboundMessage`
- [x] API `GET/POST /api/{organization,partner}/messages/...` или server actions; вкладки «Переписка с менеджером» / «По заказам» в «Сообщениях» заказчика и партнёра; гейт `cabinet_questions` / `chat`
- [x] Реестр: `inbound_reply` — аудитория клиентов, маршрут на вкладку; «Написать» из «Ваш менеджер» → вкладка
- [x] Миграция `Organization.membersSeeOwnOrdersOnly`; настройка на вкладке «Настройки» «Моей организации» (только `admin`); подсказка у роли `member`
- [x] `memberOrderScope` в `organizationPolicy.ts`; `listOrgOrders`, `getOrgOrder`, счётчики главной, экспорт — через него; `canSeeOrder` с флагом и ролью
- [x] Стражи `messengers.cabinet-notes-not-served`, `security.org-member-scope` (мутации); интеграционные тесты диалогов и IDOR
- [x] AUDIT `У-234`, `У-236` → ✅; CHANGELOG; STATUS

## PR-5. Зеркало, стражи мутацией, эталоны, close-out (`У-241`)

- [x] Сводная мутация стражей этапа — таблица в `AUDIT.md`
- [x] Глоссарий: «Переписка с менеджером», «Материалы для партнёров», «Ответ менеджера», «Первые шаги»
- [x] Мобильные эталоны 390×844 новых экранов (dev + seed на этой машине; иначе — записать хвост честно)
- [x] Замер покрытия своих файлов (прицельно)
- [x] AUDIT по `У-234`…`У-241` целиком; CHANGELOG; STATUS (этап закрыт, текущий — 7); CLAUDE.md снимок
- [x] Close-out `2026-09-17-stage6-client-partner-cabinets-DONE.md`
