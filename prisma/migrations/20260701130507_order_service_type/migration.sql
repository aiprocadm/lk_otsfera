-- CreateEnum
CREATE TYPE "ServiceType" AS ENUM ('training', 'document_development');

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "serviceType" "ServiceType" NOT NULL DEFAULT 'training';
