ALTER TABLE "Message" DROP COLUMN IF EXISTS "chatwootMessageId";
ALTER TABLE "Message" DROP COLUMN IF EXISTS "chatwootInboxId";
ALTER TABLE "Message" DROP COLUMN IF EXISTS "chatwootConversationId";
ALTER TABLE "Message" DROP COLUMN IF EXISTS "chatwootContactInboxSourceId";
ALTER TABLE "Message" DROP COLUMN IF EXISTS "chatwootIsRead";

DROP TABLE IF EXISTS "Chatwoot";
