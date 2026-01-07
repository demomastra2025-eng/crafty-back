CREATE TABLE `Funnel` (
  `id` VARCHAR(191) NOT NULL,
  `name` VARCHAR(255) NOT NULL,
  `goal` VARCHAR(255) NOT NULL,
  `logic` VARCHAR(500),
  `followUpEnable` TINYINT(1) NOT NULL DEFAULT 1,
  `stages` JSON NOT NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'active',
  `createdAt` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `instanceId` VARCHAR(191) NOT NULL,
  `companyId` VARCHAR(100),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE INDEX `Funnel_instanceId_idx` ON `Funnel`(`instanceId`);
CREATE INDEX `Funnel_companyId_idx` ON `Funnel`(`companyId`);

ALTER TABLE `Funnel`
  ADD CONSTRAINT `Funnel_instanceId_fkey`
  FOREIGN KEY (`instanceId`) REFERENCES `Instance`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `Funnel`
  ADD CONSTRAINT `Funnel_companyId_fkey`
  FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
