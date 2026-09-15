-- Этап 4 ТЗ 12.09.2026, `У-224`: пять правил автоматизации «из коробки».
--
-- Все ВЫКЛЮЧЕНЫ (`isActive = false`): правило включает человек галочкой, и
-- вместе с включением записывается тот, кто включил, — он станет автором задач,
-- которые правило поставит (`Р-Э4-4`). Поэтому `createdById` здесь пуст.
--
-- Ни одно правило из коробки НЕ использует действие «написать клиенту»
-- (`Р-Э4-13`): робот, который сам пишет клиенту, включается осознанно, а не
-- достаётся компании по умолчанию.
--
-- Правила заводятся КАЖДОЙ существующей компании: `AutomationRule.companyId`
-- обязателен, платформенных правил нет (робот, создающий задачи сразу во всех
-- компаниях, — не функция, а происшествие). Новая компания правил из коробки не
-- получит: это осознанное упрощение, добавить их можно кнопкой в разделе.
--
-- Повторный прогон безопасен: вставляем только то, чего у компании ещё нет
-- (проверка по паре «компания + название»).

INSERT INTO "AutomationRule" ("id", "createdAt", "updatedAt", "companyId", "name", "isActive", "isBuiltin", "trigger", "conditions", "actions", "createdById", "updatedBy")
SELECT
  gen_random_uuid()::text,
  NOW(),
  NOW(),
  c."id",
  r."name",
  false,
  true,
  r."trigger",
  '{}'::jsonb,
  r."actions"::jsonb,
  NULL,
  NULL
FROM "Company" c
CROSS JOIN (
  VALUES
    (
      'Счёт выставлен — проверить оплату',
      'document_issued',
      '[{"kind":"create_task","titleTemplate":"Проверить оплату по счёту {{document.number}}","assignee":"responsible_manager","dueInDays":5}]'
    ),
    (
      'Заказ в работе — подготовить документы',
      'order_status_changed',
      '[{"kind":"create_task","titleTemplate":"Подготовить документы по заказу {{order.number}}","assignee":"responsible_manager","dueInDays":2}]'
    ),
    (
      'КП без ответа — позвонить',
      'proposal_no_answer',
      '[{"kind":"create_task","titleTemplate":"Позвонить по КП {{document.number}}","assignee":"responsible_manager","dueInDays":1}]'
    ),
    (
      'Обращение с сайта — сообщить руководителю',
      'client_request_submitted',
      '[{"kind":"notify","audience":"role:leader","template":"Поступило обращение с сайта от {{organization.name}}."}]'
    ),
    (
      'Клиент ждёт ответа дольше SLA — сообщить руководителю',
      'dialog_waiting_staff_overdue',
      '[{"kind":"notify","audience":"role:leader","template":"Клиент ждёт ответа дольше нормы. Проверьте переписку."}]'
    )
) AS r("name", "trigger", "actions")
WHERE NOT EXISTS (
  SELECT 1 FROM "AutomationRule" existing
  WHERE existing."companyId" = c."id" AND existing."name" = r."name"
);
