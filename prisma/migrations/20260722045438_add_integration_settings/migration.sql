-- CreateTable
CREATE TABLE "IntegrationSetting" (
    "key" TEXT NOT NULL,
    "value" TEXT,
    "isSecret" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "IntegrationSetting_pkey" PRIMARY KEY ("key")
);
