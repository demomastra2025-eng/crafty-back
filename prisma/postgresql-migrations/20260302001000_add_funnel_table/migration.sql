CREATE TABLE "Funnel" (
  "id" TEXT NOT NULL,
  "name" VARCHAR(255) NOT NULL,
  "goal" VARCHAR(255) NOT NULL,
  "logic" VARCHAR(500),
  "followUpEnable" BOOLEAN NOT NULL DEFAULT true,
  "stages" JSONB NOT NULL,
  "status" VARCHAR(20) NOT NULL DEFAULT 'active',
  "createdAt" TIMESTAMP DEFAULT now(),
  "updatedAt" TIMESTAMP NOT NULL,
  "instanceId" TEXT NOT NULL,
  "companyId" VARCHAR(100),

  CONSTRAINT "Funnel_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Funnel_instanceId_idx" ON "Funnel"("instanceId");
CREATE INDEX "Funnel_companyId_idx" ON "Funnel"("companyId");

ALTER TABLE "Funnel" ADD CONSTRAINT "Funnel_instanceId_fkey"
  FOREIGN KEY ("instanceId") REFERENCES "Instance"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Funnel" ADD CONSTRAINT "Funnel_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;
