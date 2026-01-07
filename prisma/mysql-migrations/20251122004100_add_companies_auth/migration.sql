-- Add companyId to Instance
ALTER TABLE `Instance` ADD COLUMN `companyId` VARCHAR(100) NULL;
CREATE INDEX `Instance_companyId_idx` ON `Instance`(`companyId`);

-- Create User table
CREATE TABLE `User` (
  `id` VARCHAR(191) NOT NULL,
  `email` VARCHAR(255) NOT NULL,
  `passwordHash` VARCHAR(255) NOT NULL,
  `name` VARCHAR(100) NULL,
  `createdAt` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` TIMESTAMP NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `User_email_key`(`email`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Create Company table
CREATE TABLE `Company` (
  `id` VARCHAR(191) NOT NULL,
  `name` VARCHAR(150) NOT NULL,
  `createdAt` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` TIMESTAMP NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `Company_name_key`(`name`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Create CompanyMember table
CREATE TABLE `CompanyMember` (
  `id` VARCHAR(191) NOT NULL,
  `role` ENUM('owner','admin','member') NOT NULL DEFAULT 'member',
  `createdAt` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  `userId` VARCHAR(191) NOT NULL,
  `companyId` VARCHAR(191) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `CompanyMember_userId_companyId_key`(`userId`, `companyId`),
  INDEX `CompanyMember_companyId_idx`(`companyId`),
  INDEX `CompanyMember_userId_idx`(`userId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Create ApiKey table
CREATE TABLE `ApiKey` (
  `id` VARCHAR(191) NOT NULL,
  `name` VARCHAR(100) NULL,
  `keyHash` VARCHAR(128) NOT NULL,
  `prefix` VARCHAR(16) NOT NULL,
  `createdAt` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  `lastUsedAt` TIMESTAMP NULL,
  `revokedAt` TIMESTAMP NULL,
  `companyId` VARCHAR(191) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `ApiKey_keyHash_key`(`keyHash`),
  INDEX `ApiKey_companyId_idx`(`companyId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Foreign keys
ALTER TABLE `Instance` ADD CONSTRAINT `Instance_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `CompanyMember` ADD CONSTRAINT `CompanyMember_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `CompanyMember` ADD CONSTRAINT `CompanyMember_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `ApiKey` ADD CONSTRAINT `ApiKey_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
