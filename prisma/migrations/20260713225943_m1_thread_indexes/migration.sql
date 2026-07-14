-- CreateIndex
CREATE INDEX "Call_threadId_idx" ON "Call"("threadId");

-- CreateIndex
CREATE INDEX "InboundMessage_threadId_idx" ON "InboundMessage"("threadId");
