ALTER TABLE `N8n`
  ADD COLUMN `funnelId` VARCHAR(100);

CREATE INDEX `N8n_funnelId_idx` ON `N8n`(`funnelId`);
