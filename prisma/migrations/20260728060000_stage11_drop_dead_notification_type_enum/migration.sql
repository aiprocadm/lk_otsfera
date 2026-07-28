-- Этап 11 PR-3 (ФТ-15.7): удаление мёртвого enum-типа NotificationType.
--
-- Безопасно: тип не был связан ни с одной колонкой (Notification.type — String
-- с самого начала) и не упоминался в коде. Данные не затрагиваются.
-- Единый источник правды по типам уведомлений — src/lib/notifications/registry.ts.
DROP TYPE "NotificationType";
