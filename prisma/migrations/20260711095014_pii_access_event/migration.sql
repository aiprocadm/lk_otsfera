-- CreateTable
CREATE TABLE "PiiAccessEvent" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT NOT NULL,
    "userRole" TEXT NOT NULL,
    "companyId" TEXT,
    "context" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "subjectType" TEXT NOT NULL,
    "subjectIds" TEXT[],
    "subjectCount" INTEGER NOT NULL,
    "meta" JSONB,

    CONSTRAINT "PiiAccessEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PiiAccessEvent_subjectIds_idx" ON "PiiAccessEvent" USING GIN ("subjectIds");

-- CreateIndex
CREATE INDEX "PiiAccessEvent_userId_createdAt_idx" ON "PiiAccessEvent"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "PiiAccessEvent_subjectType_createdAt_idx" ON "PiiAccessEvent"("subjectType", "createdAt");

-- CreateIndex
CREATE INDEX "PiiAccessEvent_createdAt_idx" ON "PiiAccessEvent"("createdAt");

-- AddForeignKey
ALTER TABLE "PiiAccessEvent" ADD CONSTRAINT "PiiAccessEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
