-- CreateTable
CREATE TABLE "Agno" (
    "id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "description" VARCHAR(255),
    "agentId" VARCHAR(255),
    "funnelId" VARCHAR(100),
    "expire" INTEGER DEFAULT 0,
    "keywordFinish" VARCHAR(100),
    "delayMessage" INTEGER,
    "unknownMessage" VARCHAR(100),
    "listeningFromMe" BOOLEAN DEFAULT false,
    "stopBotFromMe" BOOLEAN DEFAULT false,
    "keepOpen" BOOLEAN DEFAULT false,
    "debounceTime" INTEGER,
    "ignoreJids" JSONB,
    "splitMessages" BOOLEAN DEFAULT false,
    "timePerChar" INTEGER DEFAULT 50,
    "triggerType" "TriggerType",
    "triggerOperator" "TriggerOperator",
    "triggerValue" TEXT,
    "createdAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP NOT NULL,
    "instanceId" TEXT NOT NULL,

    CONSTRAINT "Agno_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgnoSetting" (
    "id" TEXT NOT NULL,
    "expire" INTEGER DEFAULT 0,
    "keywordFinish" VARCHAR(100),
    "delayMessage" INTEGER,
    "unknownMessage" VARCHAR(100),
    "listeningFromMe" BOOLEAN DEFAULT false,
    "stopBotFromMe" BOOLEAN DEFAULT false,
    "keepOpen" BOOLEAN DEFAULT false,
    "debounceTime" INTEGER,
    "ignoreJids" JSONB,
    "splitMessages" BOOLEAN DEFAULT false,
    "timePerChar" INTEGER DEFAULT 50,
    "createdAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP NOT NULL,
    "agnoIdFallback" VARCHAR(100),
    "instanceId" TEXT NOT NULL,

    CONSTRAINT "AgnoSetting_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AgnoSetting_instanceId_key" ON "AgnoSetting"("instanceId");

-- CreateIndex
CREATE INDEX "Agno_funnelId_idx" ON "Agno"("funnelId");

-- AddForeignKey
ALTER TABLE "Agno" ADD CONSTRAINT "Agno_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "Instance"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgnoSetting" ADD CONSTRAINT "AgnoSetting_agnoIdFallback_fkey" FOREIGN KEY ("agnoIdFallback") REFERENCES "Agno"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgnoSetting" ADD CONSTRAINT "AgnoSetting_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "Instance"("id") ON DELETE CASCADE ON UPDATE CASCADE;
