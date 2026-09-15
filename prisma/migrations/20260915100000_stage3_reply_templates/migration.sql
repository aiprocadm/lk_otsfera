-- Этап 3 ТЗ 12.09.2026 (`У-208`): шаблоны быстрых ответов в диалоге.
--
-- Отдельная таблица, а не строки в настройках: у шаблона есть порядок,
-- признак «в работе», счётчик использований и привязка к каналам — всё это
-- пришлось бы хранить в JSON и разбирать руками.
--
-- `companyId` обязателен и каскадный: шаблон принадлежит компании-продавцу,
-- чужие шаблоны не видны, а удаление компании уносит их с собой.
--
-- Обратный SQL (миграция обратима):
--   DROP TABLE "ReplyTemplate";

-- CreateTable
CREATE TABLE "ReplyTemplate" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "companyId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "channels" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "updatedById" TEXT,
    "usageCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ReplyTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReplyTemplate_companyId_isActive_sortOrder_idx" ON "ReplyTemplate"("companyId", "isActive", "sortOrder");

-- AddForeignKey
ALTER TABLE "ReplyTemplate" ADD CONSTRAINT "ReplyTemplate_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
