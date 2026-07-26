-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "bankAccount" TEXT,
ADD COLUMN     "bankName" TEXT,
ADD COLUMN     "bic" TEXT,
ADD COLUMN     "corrAccount" TEXT,
ADD COLUMN     "email" TEXT,
ADD COLUMN     "inn" TEXT,
ADD COLUMN     "kpp" TEXT,
ADD COLUMN     "legalAddress" TEXT,
ADD COLUMN     "legalName" TEXT,
ADD COLUMN     "ogrn" TEXT,
ADD COLUMN     "phone" TEXT,
ADD COLUMN     "signerBasis" TEXT,
ADD COLUMN     "signerName" TEXT,
ADD COLUMN     "signerPosition" TEXT;

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "bankAccount" TEXT,
ADD COLUMN     "bankName" TEXT,
ADD COLUMN     "bic" TEXT,
ADD COLUMN     "corrAccount" TEXT,
ADD COLUMN     "legalAddress" TEXT,
ADD COLUMN     "legalName" TEXT,
ADD COLUMN     "ogrn" TEXT,
ADD COLUMN     "signerBasis" TEXT,
ADD COLUMN     "signerName" TEXT,
ADD COLUMN     "signerPosition" TEXT;

-- AlterTable
ALTER TABLE "Partner" ADD COLUMN     "bankAccount" TEXT,
ADD COLUMN     "bankName" TEXT,
ADD COLUMN     "bic" TEXT,
ADD COLUMN     "corrAccount" TEXT,
ADD COLUMN     "kpp" TEXT,
ADD COLUMN     "legalAddress" TEXT,
ADD COLUMN     "ogrn" TEXT,
ADD COLUMN     "signerBasis" TEXT,
ADD COLUMN     "signerName" TEXT,
ADD COLUMN     "signerPosition" TEXT;
