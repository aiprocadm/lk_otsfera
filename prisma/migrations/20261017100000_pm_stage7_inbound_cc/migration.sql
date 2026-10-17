-- Этап 7 ТЗ 13.10.2026 (`У-316`, `Р-7-4`): «Копия» (CC) входящего письма.
-- Только добавление (`Р-ПМ-5`): у прежних писем и у мессенджеров — пусто.
ALTER TABLE "InboundMessage" ADD COLUMN "ccRecipients" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
