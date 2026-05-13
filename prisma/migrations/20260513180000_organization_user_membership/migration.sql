CREATE TABLE "OrganizationUser" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "organizationId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "roleInOrg" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT "OrganizationUser_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OrganizationUser_organizationId_userId_key" ON "OrganizationUser"("organizationId", "userId");
CREATE INDEX "OrganizationUser_organizationId_idx" ON "OrganizationUser"("organizationId");
CREATE INDEX "OrganizationUser_userId_idx" ON "OrganizationUser"("userId");
CREATE INDEX "OrganizationUser_organizationId_isActive_idx" ON "OrganizationUser"("organizationId", "isActive");

ALTER TABLE "OrganizationUser" ADD CONSTRAINT "OrganizationUser_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrganizationUser" ADD CONSTRAINT "OrganizationUser_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "OrganizationUser" ("id", "createdAt", "updatedAt", "organizationId", "userId", "isActive")
SELECT
  'ou_' || md5("id" || ':' || "organizationId"),
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP,
  "organizationId",
  "id",
  true
FROM "User"
WHERE "organizationId" IS NOT NULL
ON CONFLICT ("organizationId", "userId") DO NOTHING;
