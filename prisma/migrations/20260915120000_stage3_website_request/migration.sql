-- Этап 3 ТЗ 12.09.2026 (`У-211`): приём заявок с сайта otsfera.ru.
--
-- Значение `website` в `ClientRequestSource` существовало с самого начала, но
-- завести такую заявку было НЕЛЬЗЯ: `submittedByUserId` — обязательное поле с
-- внешним ключом на `User`, а заявку с сайта присылает посторонний человек,
-- учётной записи у него нет. Подставлять вместо автора «менеджера по
-- умолчанию» — значит соврать в карточке: там было бы написано, что заявку
-- подал сотрудник.
--
-- Поэтому поле становится необязательным. У заявок из кабинетов оно
-- по-прежнему заполнено, ничего не теряется; внешний ключ переводится на
-- `SET NULL`, как у автора заметки, пришедшей из импорта (этап 2).
--
-- Обратный SQL (миграция обратима, если в таблице нет заявок с сайта):
--   ALTER TABLE "ClientRequest" DROP CONSTRAINT "ClientRequest_submittedByUserId_fkey";
--   ALTER TABLE "ClientRequest" ALTER COLUMN "submittedByUserId" SET NOT NULL;
--   ALTER TABLE "ClientRequest" ADD CONSTRAINT "ClientRequest_submittedByUserId_fkey"
--     FOREIGN KEY ("submittedByUserId") REFERENCES "User"("id") ON UPDATE CASCADE;

-- DropForeignKey
ALTER TABLE "ClientRequest" DROP CONSTRAINT "ClientRequest_submittedByUserId_fkey";

-- AlterTable
ALTER TABLE "ClientRequest" ALTER COLUMN "submittedByUserId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "ClientRequest" ADD CONSTRAINT "ClientRequest_submittedByUserId_fkey" FOREIGN KEY ("submittedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
