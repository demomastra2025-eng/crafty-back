import { CacheEngine } from '@cache/cacheengine';
import { configService, ProviderSession } from '@config/env.config';
import { eventEmitter } from '@config/event.config';
import { Logger } from '@config/logger.config';

import { AuthController } from './controllers/auth.controller';
import { BusinessController } from './controllers/business.controller';
import { CallController } from './controllers/call.controller';
import { ChatController } from './controllers/chat.controller';
import { CompanyController } from './controllers/company.controller';
import { GroupController } from './controllers/group.controller';
import { InstanceController } from './controllers/instance.controller';
import { LabelController } from './controllers/label.controller';
import { ProxyController } from './controllers/proxy.controller';
import { SendMessageController } from './controllers/sendMessage.controller';
import { SettingsController } from './controllers/settings.controller';
import { TemplateController } from './controllers/template.controller';
import { ChannelController } from './integrations/channel/channel.controller';
import { EvolutionController } from './integrations/channel/evolution/evolution.controller';
import { MetaController } from './integrations/channel/meta/meta.controller';
import { TelegramController } from './integrations/channel/telegram/telegram.controller';
import { BaileysController } from './integrations/channel/whatsapp/baileys.controller';
import { AgnoController } from './integrations/chatbot/agno/controllers/agno.controller';
import { AgnoService } from './integrations/chatbot/agno/services/agno.service';
import { ChatbotController } from './integrations/chatbot/chatbot.controller';
import { FunnelController } from './integrations/chatbot/funnel/controllers/funnel.controller';
import { FunnelService } from './integrations/chatbot/funnel/services/funnel.service';
import { FunnelFollowUpService } from './integrations/chatbot/funnel/services/funnel-followup.service';
import { LlmModelController } from './integrations/chatbot/llm/llm.controller';
import { EventManager } from './integrations/event/event.manager';
import { S3Controller } from './integrations/storage/s3/controllers/s3.controller';
import { S3Service } from './integrations/storage/s3/services/s3.service';
import { ProviderFiles } from './provider/sessions';
import { PrismaRepository } from './repository/repository.service';
import { CacheService } from './services/cache.service';
import { WAMonitoringService } from './services/monitor.service';
import { ProxyService } from './services/proxy.service';
import { SettingsService } from './services/settings.service';
import { TemplateService } from './services/template.service';

const logger = new Logger('WA MODULE');

export const cache = new CacheService(new CacheEngine(configService, 'instance').getEngine());
const baileysCache = new CacheService(new CacheEngine(configService, 'baileys').getEngine());

let providerFiles: ProviderFiles = null;
if (configService.get<ProviderSession>('PROVIDER').ENABLED) {
  providerFiles = new ProviderFiles(configService);
}

export const prismaRepository = new PrismaRepository(configService);

export const waMonitor = new WAMonitoringService(
  eventEmitter,
  configService,
  prismaRepository,
  providerFiles,
  cache,
  baileysCache,
);

const s3Service = new S3Service(prismaRepository);
export const s3Controller = new S3Controller(s3Service);

const templateService = new TemplateService(waMonitor, prismaRepository, configService);
export const templateController = new TemplateController(templateService);

export const authController = new AuthController(prismaRepository, configService);
export const companyController = new CompanyController(prismaRepository);

const proxyService = new ProxyService(waMonitor);
export const proxyController = new ProxyController(proxyService, waMonitor);

const settingsService = new SettingsService(waMonitor);
export const settingsController = new SettingsController(settingsService);

export const instanceController = new InstanceController(
  waMonitor,
  configService,
  prismaRepository,
  eventEmitter,
  settingsService,
  proxyController,
  cache,
  baileysCache,
  providerFiles,
);
export const callController = new CallController(waMonitor);
export const chatController = new ChatController(waMonitor);
export const businessController = new BusinessController(waMonitor);
export const groupController = new GroupController(waMonitor);
export const labelController = new LabelController(waMonitor);

export const eventManager = new EventManager(prismaRepository, waMonitor);
export const chatbotController = new ChatbotController(prismaRepository, waMonitor);
export const channelController = new ChannelController(prismaRepository, waMonitor);

// channels
export const evolutionController = new EvolutionController(prismaRepository, waMonitor);
export const metaController = new MetaController(prismaRepository, waMonitor);
export const telegramController = new TelegramController(prismaRepository, waMonitor);
export const baileysController = new BaileysController(waMonitor);

// chatbots
const agnoService = new AgnoService(waMonitor, prismaRepository, configService);
export const agnoController = new AgnoController(agnoService, prismaRepository, waMonitor);
export const llmModelController = new LlmModelController(prismaRepository);

const funnelService = new FunnelService(prismaRepository, configService);
export const funnelController = new FunnelController(funnelService);
const funnelFollowUpService = new FunnelFollowUpService(prismaRepository, waMonitor, agnoService);
export { funnelFollowUpService };

export const sendMessageController = new SendMessageController(waMonitor);

logger.info('Module - ON');
