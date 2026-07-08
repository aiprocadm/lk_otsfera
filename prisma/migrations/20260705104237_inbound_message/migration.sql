-- CreateTable
CREATE TABLE "InboundMessage" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "channel" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "senderRef" TEXT NOT NULL,
    "senderDisplay" TEXT,
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "attachmentPath" TEXT,
    "attachmentName" TEXT,
    "attachmentMime" TEXT,
    "scanStatus" TEXT NOT NULL DEFAULT 'none',
    "scanReason" TEXT,
    "resolvedOrgId" TEXT,
    "resolvedUserId" TEXT,
    "threadId" TEXT,
    "companyId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'unresolved',
    "boundAt" TIMESTAMP(3),
    "boundById" TEXT,

    CONSTRAINT "InboundMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "InboundMessage_externalId_key" ON "InboundMessage"("externalId");

-- CreateIndex
CREATE INDEX "InboundMessage_status_createdAt_idx" ON "InboundMessage"("status", "createdAt");

-- CreateIndex
CREATE INDEX "InboundMessage_companyId_createdAt_idx" ON "InboundMessage"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "InboundMessage_resolvedOrgId_createdAt_idx" ON "InboundMessage"("resolvedOrgId", "createdAt");

-- CreateIndex
CREATE INDEX "InboundMessage_channel_createdAt_idx" ON "InboundMessage"("channel", "createdAt");

-- AddForeignKey
ALTER TABLE "InboundMessage" ADD CONSTRAINT "InboundMessage_resolvedOrgId_fkey" FOREIGN KEY ("resolvedOrgId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InboundMessage" ADD CONSTRAINT "InboundMessage_resolvedUserId_fkey" FOREIGN KEY ("resolvedUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InboundMessage" ADD CONSTRAINT "InboundMessage_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "OrderThread"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InboundMessage" ADD CONSTRAINT "InboundMessage_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;
