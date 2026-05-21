-- Fix pre-existing schema drift:
-- 1. Create missing StudentBridgeGrant table (defined in schema, never had a migration)
-- 2. Realign User.companyId FK to SET NULL (column became nullable in role_cabinets but FK kept RESTRICT)

-- DropForeignKey
ALTER TABLE "User" DROP CONSTRAINT "User_companyId_fkey";

-- CreateTable
CREATE TABLE "StudentBridgeGrant" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "code" TEXT NOT NULL,
    "jti" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),

    CONSTRAINT "StudentBridgeGrant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StudentBridgeGrant_code_key" ON "StudentBridgeGrant"("code");

-- CreateIndex
CREATE UNIQUE INDEX "StudentBridgeGrant_jti_key" ON "StudentBridgeGrant"("jti");

-- CreateIndex
CREATE INDEX "StudentBridgeGrant_userId_idx" ON "StudentBridgeGrant"("userId");

-- CreateIndex
CREATE INDEX "StudentBridgeGrant_expiresAt_idx" ON "StudentBridgeGrant"("expiresAt");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentBridgeGrant" ADD CONSTRAINT "StudentBridgeGrant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
