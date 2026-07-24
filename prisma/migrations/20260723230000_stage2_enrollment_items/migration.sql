-- Этап 2 (Модуль 2): заявка на обучение = шапка + позиции.
-- Миграция написана руками: данные существующих однострочных заявок НЕ теряются —
-- courseTitle переименовывается (не drop+add), слушатель шапки переезжает в позицию.

-- 1. Конвейер статусов: два новых значения (additive; в этой транзакции они не
--    используются — PG12+ это разрешает).
ALTER TYPE "EnrollmentStatus" ADD VALUE 'in_training';
ALTER TYPE "EnrollmentStatus" ADD VALUE 'certificates_ready';

-- 2. Шапка: направление из справочника + legacy-текст старых заявок.
ALTER TABLE "EnrollmentRequest" RENAME COLUMN "courseTitle" TO "legacyCourseTitle";
ALTER TABLE "EnrollmentRequest" ALTER COLUMN "legacyCourseTitle" DROP NOT NULL;
ALTER TABLE "EnrollmentRequest" ADD COLUMN "directionId" TEXT;

CREATE INDEX "EnrollmentRequest_directionId_idx" ON "EnrollmentRequest"("directionId");

ALTER TABLE "EnrollmentRequest"
  ADD CONSTRAINT "EnrollmentRequest_directionId_fkey"
  FOREIGN KEY ("directionId") REFERENCES "TrainingDirection"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- 3. Позиции заявки.
CREATE TABLE "EnrollmentRequestItem" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "requestId" TEXT NOT NULL,
    "studentId" TEXT,
    "fullName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "position" TEXT,
    "snils" TEXT,
    "birthDate" TIMESTAMP(3),
    "extra" TEXT,
    "status" "EnrollmentStatus" NOT NULL DEFAULT 'pending',
    "externalStudentId" TEXT,

    CONSTRAINT "EnrollmentRequestItem_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "EnrollmentRequestItem_requestId_idx" ON "EnrollmentRequestItem"("requestId");
CREATE INDEX "EnrollmentRequestItem_studentId_idx" ON "EnrollmentRequestItem"("studentId");

ALTER TABLE "EnrollmentRequestItem"
  ADD CONSTRAINT "EnrollmentRequestItem_requestId_fkey"
  FOREIGN KEY ("requestId") REFERENCES "EnrollmentRequest"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "EnrollmentRequestItem"
  ADD CONSTRAINT "EnrollmentRequestItem_studentId_fkey"
  FOREIGN KEY ("studentId") REFERENCES "Student"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- 4. Бэкфилл: каждая существующая заявка получает одну позицию со слушателем шапки
--    (статус позиции = статус шапки; только старые значения enum — см. п.1).
INSERT INTO "EnrollmentRequestItem"
  ("id", "createdAt", "updatedAt", "requestId", "fullName", "email", "status", "externalStudentId")
SELECT gen_random_uuid()::text, r."createdAt", CURRENT_TIMESTAMP, r."id",
       r."studentName", r."studentEmail", r."status", r."externalStudentId"
FROM "EnrollmentRequest" r;

-- 5. Слушатель уходит с шапки.
ALTER TABLE "EnrollmentRequest" DROP COLUMN "studentName";
ALTER TABLE "EnrollmentRequest" DROP COLUMN "studentEmail";
ALTER TABLE "EnrollmentRequest" DROP COLUMN "externalStudentId";
