-- AlterTable
ALTER TABLE "Student" ADD COLUMN     "birthDate" TIMESTAMP(3),
ADD COLUMN     "note" TEXT,
ADD COLUMN     "phone" TEXT,
ADD COLUMN     "snils" TEXT,
ALTER COLUMN "email" DROP NOT NULL;
