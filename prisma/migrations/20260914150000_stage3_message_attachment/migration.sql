-- Этап 3 ТЗ 12.09.2026 (`У-204`): вложения в диалогах — файл в обе стороны.
--
-- Почему у сообщения свои колонки, а не строка `Document`: вложение диалога —
-- это переписка, а не документ заказа. `persistUploadedDocument` заводит
-- `Document`, рассылает уведомления и требует заказ или контрагента, которых
-- у диалога нет. Тот же путь уже выбран для вложений чата (`Message`).
--
-- `scanStatus` по умолчанию `none` — у сообщений без файла проверять нечего;
-- у сообщения с файлом он проходит `pending → clean | infected | error`, и
-- наружу (клиенту и в транспорт) уходит только `clean`.
--
-- Обратный SQL (миграция обратима):
--   DROP INDEX "MessengerMessage_dialogId_scanStatus_idx";
--   ALTER TABLE "MessengerMessage"
--     DROP COLUMN "scanReason", DROP COLUMN "scanStatus",
--     DROP COLUMN "attachmentSize", DROP COLUMN "attachmentMime",
--     DROP COLUMN "attachmentName", DROP COLUMN "attachmentPath";

-- AlterTable
ALTER TABLE "MessengerMessage" ADD COLUMN     "attachmentMime" TEXT,
ADD COLUMN     "attachmentName" TEXT,
ADD COLUMN     "attachmentPath" TEXT,
ADD COLUMN     "attachmentSize" INTEGER,
ADD COLUMN     "scanReason" TEXT,
ADD COLUMN     "scanStatus" TEXT NOT NULL DEFAULT 'none';

-- CreateIndex
CREATE INDEX "MessengerMessage_dialogId_scanStatus_idx" ON "MessengerMessage"("dialogId", "scanStatus");
