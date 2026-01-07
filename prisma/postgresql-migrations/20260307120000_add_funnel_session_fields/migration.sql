DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'IntegrationSession'
      AND column_name = 'funnelStatus'
  ) THEN
    ALTER TABLE "IntegrationSession" RENAME COLUMN "funnelStatus" TO "funnelEnable";
  END IF;
END
$$;

ALTER TABLE "IntegrationSession"
  ADD COLUMN IF NOT EXISTS "funnelId" VARCHAR(100),
  ADD COLUMN IF NOT EXISTS "funnelStage" INTEGER,
  ADD COLUMN IF NOT EXISTS "followUpStage" INTEGER,
  ADD COLUMN IF NOT EXISTS "funnelEnable" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "followUpEnable" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "Funnel"
  ADD COLUMN IF NOT EXISTS "followUpEnable" BOOLEAN NOT NULL DEFAULT true;
