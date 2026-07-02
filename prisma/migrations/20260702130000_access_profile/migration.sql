-- Трек G1: AccessProfile (роль-профиль как данные) + ScopeLevel enum + User.accessProfileId.
-- Additive & reversible: new enum + new table + new nullable FK column.
-- Existing users get accessProfileId = NULL → legacy teamMode-поведение сохраняется.
-- Rollback:
--   ALTER TABLE "User" DROP CONSTRAINT "User_accessProfileId_fkey";
--   ALTER TABLE "User" DROP COLUMN "accessProfileId";
--   DROP TABLE "AccessProfile";
--   DROP TYPE "ScopeLevel";

-- CreateEnum
CREATE TYPE "ScopeLevel" AS ENUM ('own', 'assigned', 'all');

-- CreateTable
CREATE TABLE "AccessProfile" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ordersScope" "ScopeLevel" NOT NULL DEFAULT 'all',
    "organizationsScope" "ScopeLevel" NOT NULL DEFAULT 'all',
    "threadsScope" "ScopeLevel" NOT NULL DEFAULT 'all',
    "documentsScope" "ScopeLevel" NOT NULL DEFAULT 'all',
    "financeScope" "ScopeLevel" NOT NULL DEFAULT 'all',
    "leadsScope" "ScopeLevel" NOT NULL DEFAULT 'all',
    "capabilities" TEXT[],

    CONSTRAINT "AccessProfile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AccessProfile_companyId_idx" ON "AccessProfile"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "AccessProfile_companyId_name_key" ON "AccessProfile"("companyId", "name");

-- AlterTable
ALTER TABLE "User" ADD COLUMN "accessProfileId" TEXT;

-- AddForeignKey
ALTER TABLE "AccessProfile" ADD CONSTRAINT "AccessProfile_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_accessProfileId_fkey" FOREIGN KEY ("accessProfileId") REFERENCES "AccessProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
