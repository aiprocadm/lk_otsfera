-- Этап 7 ТЗ 13.10.2026 (`У-318`, `Р-7-6`): пометка «Важное» во «Входящих
-- обращениях». Только добавление (`Р-ПМ-5`): у прежних записей — пусто.
ALTER TABLE "InboundMessage" ADD COLUMN "importantAt" TIMESTAMP(3);
ALTER TABLE "InboundMessage" ADD COLUMN "importantById" TEXT;
ALTER TABLE "Call" ADD COLUMN "importantAt" TIMESTAMP(3);
ALTER TABLE "Call" ADD COLUMN "importantById" TEXT;
