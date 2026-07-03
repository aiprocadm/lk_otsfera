-- Трек G3: внутренние задачи/канбан. TaskStatus/TaskPriority enums + TaskColumn
-- (словарь колонок) + Task + TaskAssignee (M:N исполнители) + AccessProfile.tasksScope.
-- Additive & reversible: новые enum/таблицы + новая nullable-колонка scope (DEFAULT 'all').
-- Существующие AccessProfile получают tasksScope='all' (не сужает поведение).
-- Rollback:
--   ALTER TABLE "Task" DROP CONSTRAINT "Task_linkedOrganizationId_fkey";
--   ALTER TABLE "Task" DROP CONSTRAINT "Task_linkedOrderId_fkey";
--   ALTER TABLE "Task" DROP CONSTRAINT "Task_createdById_fkey";
--   ALTER TABLE "Task" DROP CONSTRAINT "Task_columnId_fkey";
--   ALTER TABLE "Task" DROP CONSTRAINT "Task_companyId_fkey";
--   ALTER TABLE "TaskAssignee" DROP CONSTRAINT "TaskAssignee_userId_fkey";
--   ALTER TABLE "TaskAssignee" DROP CONSTRAINT "TaskAssignee_taskId_fkey";
--   ALTER TABLE "TaskColumn" DROP CONSTRAINT "TaskColumn_companyId_fkey";
--   ALTER TABLE "AccessProfile" DROP COLUMN "tasksScope";
--   DROP TABLE "TaskAssignee";
--   DROP TABLE "Task";
--   DROP TABLE "TaskColumn";
--   DROP TYPE "TaskPriority";
--   DROP TYPE "TaskStatus";

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('todo', 'in_progress', 'review', 'done');

-- CreateEnum
CREATE TYPE "TaskPriority" AS ENUM ('low', 'medium', 'high');

-- AlterTable
ALTER TABLE "AccessProfile" ADD COLUMN "tasksScope" "ScopeLevel" NOT NULL DEFAULT 'all';

-- CreateTable
CREATE TABLE "TaskColumn" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "statusAnchor" "TaskStatus" NOT NULL,
    "color" TEXT,
    "isDoneColumn" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "TaskColumn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Task" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "companyId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "TaskStatus" NOT NULL DEFAULT 'todo',
    "priority" "TaskPriority",
    "columnId" TEXT,
    "dueDate" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "linkedOrderId" TEXT,
    "linkedOrganizationId" TEXT,

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskAssignee" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "taskId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "TaskAssignee_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TaskColumn_companyId_idx" ON "TaskColumn"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "TaskColumn_companyId_position_key" ON "TaskColumn"("companyId", "position");

-- CreateIndex
CREATE INDEX "Task_companyId_status_idx" ON "Task"("companyId", "status");

-- CreateIndex
CREATE INDEX "Task_companyId_createdAt_idx" ON "Task"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "Task_linkedOrderId_idx" ON "Task"("linkedOrderId");

-- CreateIndex
CREATE INDEX "Task_linkedOrganizationId_idx" ON "Task"("linkedOrganizationId");

-- CreateIndex
CREATE UNIQUE INDEX "TaskAssignee_taskId_userId_key" ON "TaskAssignee"("taskId", "userId");

-- CreateIndex
CREATE INDEX "TaskAssignee_userId_idx" ON "TaskAssignee"("userId");

-- AddForeignKey
ALTER TABLE "TaskColumn" ADD CONSTRAINT "TaskColumn_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_columnId_fkey" FOREIGN KEY ("columnId") REFERENCES "TaskColumn"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_linkedOrderId_fkey" FOREIGN KEY ("linkedOrderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_linkedOrganizationId_fkey" FOREIGN KEY ("linkedOrganizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskAssignee" ADD CONSTRAINT "TaskAssignee_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskAssignee" ADD CONSTRAINT "TaskAssignee_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
