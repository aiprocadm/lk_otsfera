-- Мессенджеры как канал общения с клиентами (спека 2026-09-12, Р-М-1…Р-М-3).
-- Миграция аддитивная и обратимая: две новые таблицы, ни одна существующая
-- строка не меняется. `InboundMessage` остаётся источником для «Входящих в
-- работу», вложений и антивируса; диалог — история разговора с собеседником.
--
-- `MessengerDialog`: один собеседник (канал + адрес) — один диалог. Уникальный
-- индекс `(channel, peerRef)` держит это на уровне базы: бот у платформы один,
-- и два вебхука, пришедшие одновременно, не заведут два диалога — второй
-- получит нарушение уникальности и найдёт первый. `companyId` NULL — общая
-- очередь непривязанных (как `InboundMessage.status = 'unresolved'`).
--
-- Внешние ключи привязок — ON DELETE SET NULL: диалог переживает удаление
-- организации/контакта/пользователя (переписка — исторический факт).
-- У `MessengerMessage.authorId` внешнего ключа нет намеренно: исходящее
-- сообщение не должно исчезать вместе с уволенным сотрудником.

-- CreateTable
CREATE TABLE "MessengerDialog" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "channel" TEXT NOT NULL,
    "peerRef" TEXT NOT NULL,
    "peerDisplay" TEXT,
    "companyId" TEXT,
    "organizationId" TEXT,
    "contactId" TEXT,
    "userId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastInboundAt" TIMESTAMP(3),
    "lastMessagePreview" TEXT,
    "lastMessageDirection" TEXT,
    "unreadCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "MessengerDialog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MessengerMessage" (
    "id" TEXT NOT NULL,
    "dialogId" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "authorId" TEXT,
    "inboundMessageId" TEXT,
    "externalId" TEXT,
    "deliveryStatus" TEXT NOT NULL DEFAULT 'sent',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessengerMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MessengerDialog_companyId_lastMessageAt_idx" ON "MessengerDialog"("companyId", "lastMessageAt");

-- CreateIndex
CREATE INDEX "MessengerDialog_organizationId_idx" ON "MessengerDialog"("organizationId");

-- CreateIndex
CREATE INDEX "MessengerDialog_contactId_idx" ON "MessengerDialog"("contactId");

-- CreateIndex
CREATE UNIQUE INDEX "MessengerDialog_channel_peerRef_key" ON "MessengerDialog"("channel", "peerRef");

-- CreateIndex
CREATE UNIQUE INDEX "MessengerMessage_inboundMessageId_key" ON "MessengerMessage"("inboundMessageId");

-- CreateIndex
CREATE INDEX "MessengerMessage_dialogId_createdAt_idx" ON "MessengerMessage"("dialogId", "createdAt");

-- AddForeignKey
ALTER TABLE "MessengerDialog" ADD CONSTRAINT "MessengerDialog_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessengerDialog" ADD CONSTRAINT "MessengerDialog_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessengerDialog" ADD CONSTRAINT "MessengerDialog_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessengerDialog" ADD CONSTRAINT "MessengerDialog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessengerMessage" ADD CONSTRAINT "MessengerMessage_dialogId_fkey" FOREIGN KEY ("dialogId") REFERENCES "MessengerDialog"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessengerMessage" ADD CONSTRAINT "MessengerMessage_inboundMessageId_fkey" FOREIGN KEY ("inboundMessageId") REFERENCES "InboundMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE;
