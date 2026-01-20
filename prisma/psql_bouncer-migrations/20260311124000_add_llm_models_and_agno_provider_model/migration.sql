ALTER TABLE "Agno" ADD COLUMN "providerModel" VARCHAR(255);

CREATE TABLE "LlmModel" (
  "id" TEXT NOT NULL,
  "name" VARCHAR(255) NOT NULL,
  "provider" VARCHAR(100) NOT NULL,
  "model" VARCHAR(200) NOT NULL,
  "type" VARCHAR(50) NOT NULL,
  "config" JSONB,
  "createdAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP NOT NULL,

  CONSTRAINT "LlmModel_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LlmModel_provider_model_key" ON "LlmModel"("provider", "model");
