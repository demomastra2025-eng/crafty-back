/*
  Warnings:

*/
-- CreateEnum
CREATE TYPE "SessionStatus" AS ENUM ('opened', 'closed', 'paused');

-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "sessionId" TEXT;

-- CreateTable
CREATE TABLE "IntegrationSession" (
    "id" TEXT NOT NULL,
    "sessionId" VARCHAR(255) NOT NULL,
    "remoteJid" VARCHAR(100) NOT NULL,
    "pushName" TEXT,
    "status" "SessionStatus" NOT NULL,
    "awaitUser" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP NOT NULL,
    "instanceId" TEXT NOT NULL,
    "parameters" JSONB,
    "botId" TEXT,

    CONSTRAINT "IntegrationSession_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "IntegrationSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntegrationSession" ADD CONSTRAINT "IntegrationSession_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "Instance"("id") ON DELETE CASCADE ON UPDATE CASCADE;
