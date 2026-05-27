-- CreateTable
CREATE TABLE "OrganizationManager" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assignedBy" TEXT,
    "deactivatedAt" TIMESTAMP(3),

    CONSTRAINT "OrganizationManager_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OrganizationManager_userId_isActive_idx" ON "OrganizationManager"("userId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "OrganizationManager_organizationId_userId_key" ON "OrganizationManager"("organizationId", "userId");

-- CreateIndex
CREATE INDEX "Comment_authorId_orderId_idx" ON "Comment"("authorId", "orderId");

-- CreateIndex
CREATE INDEX "Order_managerId_executionStatus_idx" ON "Order"("managerId", "executionStatus");

-- AddForeignKey
ALTER TABLE "OrganizationManager" ADD CONSTRAINT "OrganizationManager_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizationManager" ADD CONSTRAINT "OrganizationManager_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
