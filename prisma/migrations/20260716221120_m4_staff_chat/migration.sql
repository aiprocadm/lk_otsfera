-- CreateEnum
CREATE TYPE "StaffConversationKind" AS ENUM ('dm', 'general');

-- CreateTable
CREATE TABLE "StaffConversation" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "companyId" TEXT NOT NULL,
    "kind" "StaffConversationKind" NOT NULL,
    "dmKey" TEXT,
    "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaffConversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffParticipant" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "conversationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "StaffParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffMessage" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "conversationId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "attachmentPath" TEXT,
    "attachmentName" TEXT,
    "attachmentMime" TEXT,
    "scanStatus" TEXT NOT NULL DEFAULT 'none',

    CONSTRAINT "StaffMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffMessageRead" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "lastReadAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaffMessageRead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffReaction" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "messageId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "emoji" TEXT NOT NULL,

    CONSTRAINT "StaffReaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StaffConversation_dmKey_key" ON "StaffConversation"("dmKey");

-- CreateIndex
CREATE INDEX "StaffConversation_companyId_lastMessageAt_idx" ON "StaffConversation"("companyId", "lastMessageAt");

-- CreateIndex
CREATE INDEX "StaffParticipant_userId_idx" ON "StaffParticipant"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "StaffParticipant_conversationId_userId_key" ON "StaffParticipant"("conversationId", "userId");

-- CreateIndex
CREATE INDEX "StaffMessage_conversationId_createdAt_idx" ON "StaffMessage"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "StaffMessageRead_userId_idx" ON "StaffMessageRead"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "StaffMessageRead_conversationId_userId_key" ON "StaffMessageRead"("conversationId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "StaffReaction_messageId_userId_emoji_key" ON "StaffReaction"("messageId", "userId", "emoji");

-- AddForeignKey
ALTER TABLE "StaffConversation" ADD CONSTRAINT "StaffConversation_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffParticipant" ADD CONSTRAINT "StaffParticipant_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "StaffConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffParticipant" ADD CONSTRAINT "StaffParticipant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffMessage" ADD CONSTRAINT "StaffMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "StaffConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffMessage" ADD CONSTRAINT "StaffMessage_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffMessageRead" ADD CONSTRAINT "StaffMessageRead_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "StaffConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffMessageRead" ADD CONSTRAINT "StaffMessageRead_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffReaction" ADD CONSTRAINT "StaffReaction_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "StaffMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffReaction" ADD CONSTRAINT "StaffReaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- M4: ровно один general-канал на компанию (Prisma не выражает partial unique; прецедент C-01)
CREATE UNIQUE INDEX "StaffConversation_one_general_per_company" ON "StaffConversation"("companyId") WHERE "kind" = 'general';
