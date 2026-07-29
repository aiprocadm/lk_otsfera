-- Этап 2, доработка PR-1: составной уникальный индекс (companyId, key) НЕ ловит
-- дубли общесистемных строк — в Postgres два NULL не равны друг другу, поэтому
-- можно было завести второй статус с ключом 'draft'. Ловится тестом
-- «дубль ключа и кривой ключ отвергаются».
CREATE UNIQUE INDEX "OrderStatusDefinition_key_global_unique"
  ON "OrderStatusDefinition" ("key")
  WHERE "companyId" IS NULL;
