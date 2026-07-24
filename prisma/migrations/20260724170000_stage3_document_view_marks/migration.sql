-- Этап 3 PR-2 (ФТ-6.6): отметки просмотра документов — бейдж «новый»
-- в клиентских списках. Ставится при скачивании; one row per (document, user).

CREATE TABLE "DocumentViewMark" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "viewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "documentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "DocumentViewMark_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DocumentViewMark_documentId_userId_key" ON "DocumentViewMark"("documentId", "userId");

CREATE INDEX "DocumentViewMark_userId_idx" ON "DocumentViewMark"("userId");

ALTER TABLE "DocumentViewMark"
  ADD CONSTRAINT "DocumentViewMark_documentId_fkey"
  FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DocumentViewMark"
  ADD CONSTRAINT "DocumentViewMark_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
