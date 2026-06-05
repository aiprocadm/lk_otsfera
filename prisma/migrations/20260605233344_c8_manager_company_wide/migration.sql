-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "managerTeamVisibility" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "managerRole" TEXT;
