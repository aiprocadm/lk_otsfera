-- CreateEnum
CREATE TYPE "Role_new" AS ENUM ('admin', 'manager', 'partner', 'organization', 'student');
ALTER TABLE "User" ALTER COLUMN "role" DROP DEFAULT;
ALTER TABLE "User" ALTER COLUMN "role" TYPE "Role_new" USING (CASE
  WHEN "role"::text = 'client' THEN 'organization'::"Role_new"
  ELSE "role"::text::"Role_new"
END);
DROP TYPE "Role";
ALTER TYPE "Role_new" RENAME TO "Role";
ALTER TABLE "User" ALTER COLUMN "role" SET DEFAULT 'organization';

ALTER TABLE "User" ADD COLUMN "partnerId" TEXT;
ALTER TABLE "User" ADD COLUMN "organizationId" TEXT;
ALTER TABLE "User" ADD COLUMN "externalStudentId" TEXT;
ALTER TABLE "User" ALTER COLUMN "companyId" DROP NOT NULL;

CREATE TABLE "Partner" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "name" TEXT NOT NULL,
  CONSTRAINT "Partner_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Organization" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "name" TEXT NOT NULL,
  "partnerId" TEXT NOT NULL,
  "companyId" TEXT,
  CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Student" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "email" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "externalStudentId" TEXT,
  CONSTRAINT "Student_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Student_email_key" ON "Student"("email");

ALTER TABLE "User" ADD CONSTRAINT "User_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "User" ADD CONSTRAINT "User_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Organization" ADD CONSTRAINT "Organization_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Organization" ADD CONSTRAINT "Organization_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Student" ADD CONSTRAINT "Student_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
