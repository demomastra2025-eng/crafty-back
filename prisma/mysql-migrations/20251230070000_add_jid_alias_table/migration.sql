-- CreateTable
CREATE TABLE `JidAlias` (
    `id` VARCHAR(191) NOT NULL,
    `aliasJid` VARCHAR(100) NOT NULL,
    `canonicalJid` VARCHAR(100) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `instanceId` VARCHAR(191) NOT NULL,

    UNIQUE INDEX `JidAlias_instanceId_aliasJid_key`(`instanceId`, `aliasJid`),
    INDEX `JidAlias_instanceId_canonicalJid_idx`(`instanceId`, `canonicalJid`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `JidAlias` ADD CONSTRAINT `JidAlias_instanceId_fkey` FOREIGN KEY (`instanceId`) REFERENCES `Instance`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
