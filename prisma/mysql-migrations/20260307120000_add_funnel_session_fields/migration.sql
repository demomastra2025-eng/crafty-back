SET @col_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'IntegrationSession'
    AND COLUMN_NAME = 'funnelStatus'
);

SET @sql := IF(
  @col_exists > 0,
  'ALTER TABLE `IntegrationSession` RENAME COLUMN `funnelStatus` TO `funnelEnable`;',
  'SELECT 1;'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

ALTER TABLE `IntegrationSession`
  ADD COLUMN IF NOT EXISTS `funnelId` VARCHAR(100),
  ADD COLUMN IF NOT EXISTS `funnelStage` INT,
  ADD COLUMN IF NOT EXISTS `followUpStage` INT,
  ADD COLUMN IF NOT EXISTS `funnelEnable` TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS `followUpEnable` TINYINT(1) NOT NULL DEFAULT 0;

ALTER TABLE `Funnel`
  ADD COLUMN IF NOT EXISTS `followUpEnable` TINYINT(1) NOT NULL DEFAULT 1;
