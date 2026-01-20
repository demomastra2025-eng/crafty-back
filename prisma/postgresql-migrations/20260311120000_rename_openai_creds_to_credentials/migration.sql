ALTER TABLE "OpenaiBot" RENAME COLUMN "openaiCredsId" TO "credentialsId";
ALTER TABLE "OpenaiSetting" RENAME COLUMN "openaiCredsId" TO "credentialsId";
ALTER TABLE "OpenaiCreds" RENAME TO "Credentials";

ALTER TABLE "Credentials" ADD COLUMN "provider" VARCHAR(100);
ALTER TABLE "Credentials" ADD COLUMN "url" VARCHAR(500);
ALTER TABLE "Credentials" ADD COLUMN "companyId" TEXT;

UPDATE "Credentials" SET "provider" = 'openai' WHERE "provider" IS NULL;

UPDATE "Credentials" c
SET "companyId" = i."companyId"
FROM "Instance" i
WHERE c."instanceId" = i."id" AND c."companyId" IS NULL;

ALTER TABLE "Credentials" ALTER COLUMN "provider" SET NOT NULL;

ALTER TABLE "Credentials"
  ADD CONSTRAINT "Credentials_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "Credentials_companyId_idx" ON "Credentials"("companyId");
