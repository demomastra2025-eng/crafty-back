/*
  Warnings:

  - You are about to drop the `GenericBot` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `GenericSetting` table. If the table is not empty, all the data it contains will be lost.

*/
-- AlterEnum
ALTER TYPE "TriggerOperator" ADD VALUE 'regex';

-- DropForeignKey
ALTER TABLE "GenericBot" DROP CONSTRAINT "GenericBot_instanceId_fkey";

-- DropForeignKey
ALTER TABLE "GenericSetting" DROP CONSTRAINT "GenericSetting_botIdFallback_fkey";

-- DropForeignKey
ALTER TABLE "GenericSetting" DROP CONSTRAINT "GenericSetting_instanceId_fkey";

-- AlterTable
ALTER TABLE "OpenaiCreds" RENAME CONSTRAINT "OpenaiCreds_pkey" TO "Credentials_pkey";

-- DropTable
DROP TABLE "GenericBot";

-- DropTable
DROP TABLE "GenericSetting";

-- RenameForeignKey
ALTER TABLE "OpenaiCreds" RENAME CONSTRAINT "OpenaiCreds_instanceId_fkey" TO "Credentials_instanceId_fkey";

-- RenameIndex
ALTER INDEX "OpenaiCreds_apiKey_key" RENAME TO "Credentials_apiKey_key";

-- RenameIndex
ALTER INDEX "OpenaiCreds_name_key" RENAME TO "Credentials_name_key";
