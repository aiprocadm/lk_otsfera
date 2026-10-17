-- Этап 7 ТЗ 13.10.2026 (`У-315`, `Р-7-3`): свои чаты команды.
-- Только добавление (`Р-ПМ-5`): новый вид беседы и её название; прежние
-- беседы («# Общий» и личные) не меняются, у них `title` пустой.
ALTER TYPE "StaffConversationKind" ADD VALUE 'group';
ALTER TABLE "StaffConversation" ADD COLUMN "title" TEXT;
