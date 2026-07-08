-- CreateTable
CREATE TABLE "Call" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "provider" TEXT NOT NULL DEFAULT 'mango',
    "externalId" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "callerNumber" TEXT NOT NULL,
    "internalNumber" TEXT,
    "startedAt" TIMESTAMP(3),
    "answeredAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "durationSec" INTEGER,
    "status" TEXT NOT NULL,
    "recordingId" TEXT,
    "recordingPath" TEXT,
    "recordingScanStatus" TEXT NOT NULL DEFAULT 'none',
    "resolvedOrgId" TEXT,
    "resolvedUserId" TEXT,
    "threadId" TEXT,
    "companyId" TEXT,

    CONSTRAINT "Call_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Call_companyId_createdAt_idx" ON "Call"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "Call_resolvedOrgId_createdAt_idx" ON "Call"("resolvedOrgId", "createdAt");

-- CreateIndex
CREATE INDEX "Call_callerNumber_createdAt_idx" ON "Call"("callerNumber", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Call_provider_externalId_key" ON "Call"("provider", "externalId");

-- AddForeignKey
ALTER TABLE "Call" ADD CONSTRAINT "Call_resolvedOrgId_fkey" FOREIGN KEY ("resolvedOrgId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Call" ADD CONSTRAINT "Call_resolvedUserId_fkey" FOREIGN KEY ("resolvedUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Call" ADD CONSTRAINT "Call_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;
