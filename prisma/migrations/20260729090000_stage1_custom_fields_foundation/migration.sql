-- Этап 1 ТЗ v0.5 (§11): 12 типов данных + подсказка + роли видимости/правки.

-- AlterEnum: семь новых типов поля. Существующие пять не трогаем — они лежат
-- в боевых строках CustomFieldDefinition.fieldType.
ALTER TYPE "CustomFieldType" ADD VALUE 'textarea';
ALTER TYPE "CustomFieldType" ADD VALUE 'money';
ALTER TYPE "CustomFieldType" ADD VALUE 'datetime';
ALTER TYPE "CustomFieldType" ADD VALUE 'multiselect';
ALTER TYPE "CustomFieldType" ADD VALUE 'phone';
ALTER TYPE "CustomFieldType" ADD VALUE 'email';
ALTER TYPE "CustomFieldType" ADD VALUE 'url';

-- AlterTable
ALTER TABLE "CustomFieldDefinition" ADD COLUMN     "helpText" TEXT,
ADD COLUMN     "visibleToRoles" TEXT[],
ADD COLUMN     "editableByRoles" TEXT[],
ADD COLUMN     "isSystem" BOOLEAN NOT NULL DEFAULT false;

-- Обратная совместимость (спека §3.2): до этого этапа значения полей заказа
-- правил и менеджер в скоупе. Новый дефолт (пустой массив = admin+leader)
-- отобрал бы у менеджеров это право на боевых данных, поэтому существующим
-- строкам проставляем прежний состав ролей явно. Новые поля создаются с
-- дефолтом Q1 (admin + leader).
UPDATE "CustomFieldDefinition"
SET "editableByRoles" = ARRAY['admin', 'leader', 'manager']
WHERE cardinality("editableByRoles") = 0;
