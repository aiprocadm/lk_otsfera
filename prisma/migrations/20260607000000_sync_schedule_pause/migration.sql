-- CreateTable
CREATE TABLE "SyncSchedulePause" (
    "schedulerId" TEXT NOT NULL,
    "pausedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "pausedBy" TEXT NOT NULL,

    CONSTRAINT "SyncSchedulePause_pkey" PRIMARY KEY ("schedulerId")
);
