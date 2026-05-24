-- AlterTable: User and Partner — add isActive soft-delete flag (default true)
ALTER TABLE "User" ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Partner" ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true;
