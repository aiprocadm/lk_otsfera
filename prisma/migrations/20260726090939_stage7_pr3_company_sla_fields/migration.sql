-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "slaResponseHours" INTEGER NOT NULL DEFAULT 24,
ADD COLUMN     "slaWarningHours" INTEGER NOT NULL DEFAULT 4;
