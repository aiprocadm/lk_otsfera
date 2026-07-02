-- AlterTable
ALTER TABLE "User" ADD COLUMN     "maxChatId" TEXT,
ADD COLUMN     "maxLinkCode" TEXT,
ADD COLUMN     "maxLinkCodeExpiresAt" TIMESTAMP(3),
ADD COLUMN     "notificationChannels" JSONB,
ADD COLUMN     "whatsappPhone" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "User_maxChatId_key" ON "User"("maxChatId");

-- CreateIndex
CREATE UNIQUE INDEX "User_whatsappPhone_key" ON "User"("whatsappPhone");

