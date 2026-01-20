# Review notes (main flows)

## Critical
- `src/api/integrations/channel/meta/whatsapp.business.service.ts:684-716` WABA contact remoteJid is taken from `received.contacts[0].profile.phone`, which is not present in Meta webhook payload (usually `wa_id`). This yields `undefined` remoteJid and breaks contact upserts.
- `src/api/integrations/channel/meta/whatsapp.business.service.ts:713-716` contact update uses `updateMany` without `instanceId` scope; may overwrite other tenants' contacts.
- `src/api/services/monitor.service.ts:393-406` provider load does not guard against missing DB row for an instanceId; null deref risk on `instance.id/name`.

## High
- `src/api/services/channel.service.ts:644-646` `fetchMessages` ignores `fromMe: false` filter (truthy check), so inbound-only queries are wrong.
- `src/api/services/channel.service.ts:744-754` duplicate `pushName` alias in `fetchChats` overrides the computed name (Chat/Contact vs Message), leading to wrong list display.
- `src/api/integrations/channel/telegram/telegram.bot.service.ts:410-412` and `src/api/integrations/channel/telegram/telegram.bot.service.ts:500` Telegram messages are persisted regardless of `DATABASE.SAVE_DATA.NEW_MESSAGE`.
- `src/api/integrations/channel/telegram/telegram.bot.service.ts:131-138` `ensureChat` never updates `unreadMessages` for existing chats; incoming Telegram messages won't increment unread count.
- `src/api/integrations/channel/meta/whatsapp.business.service.ts:674-677` and `src/api/integrations/channel/meta/whatsapp.business.service.ts:720-724` WABA messages/contacts are persisted regardless of `DATABASE.SAVE_DATA` flags.
- `src/api/integrations/channel/meta/whatsapp.business.service.ts:500-523` WABA incoming media with S3 enabled creates DB record before `mediaUrl` is added and never updates it; saved message misses `mediaUrl`/`base64`.
- `src/api/integrations/channel/meta/whatsapp.business.service.ts:674-677` WABA incoming media with S3 disabled is never persisted (only non‑media creates a message record).
- `src/api/integrations/channel/meta/whatsapp.business.service.ts:1134-1160` WABA outgoing messages are always persisted, ignoring `DATABASE.SAVE_DATA.NEW_MESSAGE`.
- `src/api/services/channel.service.ts:516-520` `fetchContacts` uses `query.page` without defaulting `query.offset`; if `page` is set and `offset` is omitted, `skip` becomes `NaN` and Prisma can throw.
- `src/api/controllers/instance.controller.ts:414-431` when `apikey` is an instance token, `auth.guard` sets `req.companyId`, so `fetchInstances` returns all instances for that company (not just the token’s instance).
- `src/api/services/monitor.service.ts:329-355` Redis instance loading parses cache keys as `id:name`, but Redis keys are `<prefix>:instance:<instanceId>`; `instanceId` becomes `"instance"` and `instanceName` becomes actual id, so instances load with wrong identifiers (or fail).
- `src/api/integrations/chatbot/chatbot.controller.ts:156-175` sessions are fetched without filtering by integration `type`; if a different integration session is newest, it can block or misroute this integration’s processing.
- `src/api/integrations/chatbot/chatbot.controller.ts:156-175` closed sessions are still returned; downstream `process()` exits early on `status === 'closed'`, so new inbound messages never create a fresh session.
- `src/api/integrations/chatbot/base-chatbot.controller.ts:300-360` `changeStatus` deletes/updates sessions by `remoteJid` without `instanceId` or `type` scope, allowing cross‑tenant session deletion.
- `src/api/integrations/chatbot/base-chatbot.controller.ts:700-820` `emit` assumes `settings` exists; if settings row is missing it dereferences `settings.*` and crashes, stopping chatbot processing for that instance.
- `src/api/integrations/chatbot/openai/services/openai.service.ts:399-414` `processChatCompletionMessage` loads session by `remoteJid`+`botId` only (no `instanceId`), risking cross‑tenant session reuse.
- `src/api/integrations/channel/whatsapp/whatsapp.baileys.service.ts:4632-4646` `updateMessage` creates `BadRequestException` for “not from me” / “deleted” but never throws it, so editing чужих/удалённых сообщений не блокируется.
- `src/api/integrations/channel/whatsapp/whatsapp.baileys.service.ts:4620-4627` “older than 15 minutes” check compares seconds to milliseconds (`messageTimestamp` vs `Date.now()`), so the time window check is effectively broken.
- `src/api/integrations/event/nats/nats.controller.ts:89-110` global NATS subjects use config event keys (underscore), but emits use dot‑separated event names; global subscribers won’t receive events.
- `src/api/integrations/event/rabbitmq/rabbitmq.controller.ts:320-380` global RabbitMQ bindings use config event keys (underscore), but emits publish dot‑separated routing keys; global queues won’t receive events.

## Medium
- `src/api/integrations/channel/whatsapp/whatsapp.baileys.service.ts:1005-1017` `chats.update` always writes to DB even if `SAVE_DATA.CHATS` is false (config respected on create, not on update).
- `src/api/integrations/chatbot/session-cache.ts:1-25` session cache has no eviction or clear usage; `lastInboundKeyBySession` grows unbounded on long‑running instances.
- `src/api/integrations/channel/meta/whatsapp.business.service.ts` and `src/api/integrations/channel/telegram/telegram.bot.service.ts` ignore `author` in `Send*Dto`, so outbound messages from these channels never persist `author` (unlike Baileys which restores it from cache).
- `src/api/integrations/chatbot/chatbot.controller.ts:178-214` + `src/utils/findBotByTrigger.ts:1-92` `getConversationMessage` can return `undefined`, but trigger matching uses string methods without null guards; unsupported message types can throw and skip chatbot handling.
- `src/validate/instance.schema.ts:33-62` uses `Integration` (capitalized) and flat `webhook*` fields; `integration` in payload isn’t validated and nested `webhook` object isn’t covered, so instance creation validation is inconsistent with `InstanceDto`.
- `src/api/integrations/chatbot/base-chatbot.service.ts:78-101` session creation has no uniqueness guard; concurrent first messages can create duplicate sessions for the same `remoteJid`/`botId`.
- `src/api/integrations/chatbot/base-chatbot.controller.ts:28-82` default-setting detection uses falsy checks (`!data.*`), so valid values like `false` or `0` are treated as missing and overwritten.
- `src/utils/findBotByTrigger.ts:40-63` invalid regex in a bot trigger can throw on `new RegExp`, breaking message processing for that instance.
- `src/api/integrations/chatbot/base-chatbot.controller.ts:120-150` `fetchBot` does not verify instance ownership (lookup by id only), allowing cross‑instance bot metadata access if bot id is known.
- `src/api/routes/sendMessage.router.ts:82-93` `sendWhatsAppAudio` uses `ClassRef: SendMediaDto` instead of `SendAudioDto`; schema and DTO are mismatched, risking incorrect coercion/validation.
- `src/validate/message.schema.ts:44-83` schema uses `everyOne`, while DTOs use `mentionsEveryOne`; this mismatch means validation doesn’t cover the actual field name used in requests.
- `src/api/integrations/channel/telegram/telegram.bot.service.ts:1098-1148` edited messages are persisted without honoring `DATABASE.SAVE_DATA.NEW_MESSAGE`, and messageType is always set to `conversation` even for media edits.
- `src/api/integrations/event/sqs/sqs.controller.ts:121-132` SQS queue name normalization only replaces the first dot; events like `send.message.update` or `group-participants.update` map to queue names that do not match those created from config, so delivery fails for multi‑dot/ hyphen events.
- `src/api/integrations/event/kafka/kafka.controller.ts:164-190` Kafka topic naming uses config keys (underscore→dot) for subscriptions, but emits use the runtime event string (`group-participants.update`); hyphenated events map to different topics and will be dropped by global consumer.
- `src/main.ts:47-56` CORS blocks requests without `Origin` unless `*` is allowed (server-to-server / health checks).
- `src/main.ts:75-107` errors webhook sent without `await`/`catch`, possible unhandled rejection.
- `src/api/routes/index.router.ts:198-207` `/` endpoint fetches WhatsApp web version on every request (external dependency in health-check path).
- `src/api/routes/index.router.ts:60` metrics IP whitelist check is incorrect; allows all.
- `src/api/guards/auth.guard.ts:13-19` `ForbiddenException` for missing global key is unreachable.

## Questions
- Should `/auth/register` be public, or require API key / admin role?
- For WABA, should remoteJid be `wa_id`? The current payload mapping suggests so.
