-- CreateTable
CREATE TABLE "JidAlias" (
    "id" TEXT NOT NULL,
    "aliasJid" VARCHAR(100) NOT NULL,
    "canonicalJid" VARCHAR(100) NOT NULL,
    "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP NOT NULL,
    "instanceId" TEXT NOT NULL,

    CONSTRAINT "JidAlias_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "JidAlias_instanceId_aliasJid_key" ON "JidAlias"("instanceId", "aliasJid");

-- CreateIndex
CREATE INDEX "JidAlias_instanceId_canonicalJid_idx" ON "JidAlias"("instanceId", "canonicalJid");

-- AddForeignKey
ALTER TABLE "JidAlias" ADD CONSTRAINT "JidAlias_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "Instance"("id") ON DELETE CASCADE ON UPDATE CASCADE;
