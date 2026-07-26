/*
  Warnings:

  - The primary key for the `DocumentCounter` table will be changed. If it partially fails, the table could be left without primary key constraint.

*/
-- AlterTable
ALTER TABLE "DocumentCounter" DROP CONSTRAINT "DocumentCounter_pkey",
ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'invoice',
ADD CONSTRAINT "DocumentCounter_pkey" PRIMARY KEY ("companyId", "year", "kind");
