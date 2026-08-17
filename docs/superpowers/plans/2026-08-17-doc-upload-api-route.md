# План: загрузка документов партнёра и организации через API-роут

Спека: [2026-08-17-doc-upload-api-route-design.md](../specs/2026-08-17-doc-upload-api-route-design.md).
Один PR от `main`. Сервисы не трогаем.

- [x] 1. Роут `POST /api/partner/documents/upload` (по эталону manager-роута:
      `requirePartner()`, `readMultipart`/`formFields`/`readFile`, маппинг
      кодов, 201 `{ ok, documentId }`).
- [x] 2. Роут `POST /api/organization/documents/upload`
      (`notFoundIfDisabled('organization_cabinet')`, `requireOrganization()`,
      опциональный `orderId` → order-less ветка).
- [x] 3. Тесты роутов — все ветки, 100 % покрытие.
- [x] 4. `partner-document-upload-form` → `useFetchSubmit` + пре-чеки
      (нет файла / слишком большой) + хинт из константы.
- [x] 5. Обе организационные формы → `useFetchSubmit` + пре-чеки
      (хинт уже из константы).
- [x] 6. Хинты менеджерских форм («20 МБ» → константа) + JSDoc manager-роута.
- [x] 7. Удалить оба server actions и их тесты; компонентные тесты форм
      переписать на мок `fetch`.
- [x] 8. Страж «нет хардкода цифры МБ в формах с file-input» + проверка
      мутацией.
- [x] 9. Гейты: `typecheck`, `lint`, целевые vitest, полный
      `test:coverage` (живой Postgres, перед этим чистка `OneCImportBatch`).
- [x] 10. CHANGELOG.md, строка задела в STATUS.md, PR с `base: main`.
