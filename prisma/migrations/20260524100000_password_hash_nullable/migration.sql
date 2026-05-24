-- AlterTable: User — make passwordHash nullable to support invite-based account activation
ALTER TABLE "User" ALTER COLUMN "passwordHash" DROP NOT NULL;
