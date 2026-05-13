CREATE TABLE "StudentBridgeTokenJti" (
  "jti" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "StudentBridgeTokenJti_pkey" PRIMARY KEY ("jti")
);

CREATE INDEX "StudentBridgeTokenJti_expiresAt_idx" ON "StudentBridgeTokenJti"("expiresAt");
