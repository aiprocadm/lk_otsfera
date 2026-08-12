-- Этап 7, PR-2 (У-59): откат импорта выписки по счёту 51.
--
-- Откатывать было физически не на чем: Excel-канал ведёт след записи
-- ("OneCImportRow"), а импорт выписки не сохранял НИЧЕГО о том, какие платежи
-- он создал, а какие обновил. Эта миграция заводит такой же след для выписки
-- и поля отката у батча.

-- 1. Поля отката у батча выписки — как у "OneCImportBatch".
ALTER TABLE "PaymentImportBatch" ADD COLUMN "rolledBackAt" TIMESTAMP(3);
ALTER TABLE "PaymentImportBatch" ADD COLUMN "rolledBackById" TEXT;

-- 2. След записи. Поле "entity" заведено сразу, хотя выписка сейчас пишет
-- только платежи: в PR-3 (У-49) сюда лягут автосозданные организации, и
-- откат обязан уметь удалять их тем же кодом.
CREATE TABLE "PaymentImportWrite" (
  "id" TEXT NOT NULL,
  "batchId" TEXT NOT NULL,
  "entity" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "before" JSONB,
  "reverted" BOOLEAN NOT NULL DEFAULT false,

  CONSTRAINT "PaymentImportWrite_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PaymentImportWrite_batchId_entity_idx"
  ON "PaymentImportWrite"("batchId", "entity");

CREATE INDEX "PaymentImportWrite_entityId_idx" ON "PaymentImportWrite"("entityId");

-- Батч удаляют вместе со следом: осиротевший след ничего не описывает.
ALTER TABLE "PaymentImportWrite"
  ADD CONSTRAINT "PaymentImportWrite_batchId_fkey"
  FOREIGN KEY ("batchId") REFERENCES "PaymentImportBatch"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Батчи, загруженные ДО этой миграции, следа не имеют — откатить их нельзя.
-- Отдельного флага для этого не нужно: пустой след даёт пустой план отката,
-- и кнопка честно скажет «откатывать нечего».
