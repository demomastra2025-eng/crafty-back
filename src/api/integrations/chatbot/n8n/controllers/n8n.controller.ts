import { InstanceDto } from '@api/dto/instance.dto';
import { N8nDto } from '@api/integrations/chatbot/n8n/dto/n8n.dto';
import { N8nService } from '@api/integrations/chatbot/n8n/services/n8n.service';
import { PrismaRepository } from '@api/repository/repository.service';
import { CacheService } from '@api/services/cache.service';
import { WAMonitoringService } from '@api/services/monitor.service';
import { configService } from '@config/env.config';
import { Logger } from '@config/logger.config';
import { BadRequestException } from '@exceptions';
import { IntegrationSession, N8n as N8nModel } from '@prisma/client';

import { BaseChatbotController } from '../../base-chatbot.controller';

export class N8nController extends BaseChatbotController<N8nModel, N8nDto> {
  constructor(
    private readonly n8nService: N8nService,
    prismaRepository: PrismaRepository,
    waMonitor: WAMonitoringService,
    private readonly cache?: CacheService,
  ) {
    super(prismaRepository, waMonitor);

    this.botRepository = this.prismaRepository.n8n;
    this.settingsRepository = this.prismaRepository.n8nSetting;
    this.sessionRepository = this.prismaRepository.integrationSession;
  }

  public readonly logger = new Logger('N8nController');
  protected readonly integrationName = 'N8n';

  integrationEnabled = configService.get('N8N').ENABLED;
  botRepository: any;
  settingsRepository: any;
  sessionRepository: any;
  userMessageDebounce: { [key: string]: { message: string; timeoutId: NodeJS.Timeout } } = {};

  protected getFallbackBotId(settings: any): string | undefined {
    return settings?.fallbackId;
  }

  protected getFallbackFieldName(): string {
    return 'n8nIdFallback';
  }

  protected getIntegrationType(): string {
    return 'n8n';
  }

  private promptCacheKey(instanceId: string): string {
    return `prompt-funnel:${instanceId}`;
  }

  private async updatePromptFunnelCache(bot: N8nModel): Promise<void> {
    if (!this.cache || !bot?.instanceId || !bot?.id) return;

    const funnel = bot.funnelId ? await this.prismaRepository.funnel.findFirst({ where: { id: bot.funnelId } }) : null;
    const payload = {
      prompt: bot.prompt || null,
      funnelId: bot.funnelId || null,
      stages: funnel?.stages ?? [],
      updatedAt: new Date().toISOString(),
    };

    await this.cache.hSet(this.promptCacheKey(bot.instanceId), bot.id, payload);
  }

  private getDefaultWebhookUrl(): string | null {
    const url = configService.get('N8N')?.DEFAULT_WEBHOOK_URL || '';
    return url.trim() ? url.trim() : null;
  }

  private applyWebhookDefaults(data: N8nDto, options?: { allowMissing?: boolean; useDefaultWhenMissing?: boolean }) {
    const defaultWebhook = this.getDefaultWebhookUrl();
    const hasCustomWebhook = Boolean(data.webhookUrl && String(data.webhookUrl).trim());
    const missingWebhook = data.webhookUrl === undefined;

    if (!hasCustomWebhook && defaultWebhook && (!missingWebhook || options?.useDefaultWhenMissing)) {
      data.webhookUrl = defaultWebhook;
      data.basicAuthUser = null;
      data.basicAuthPass = null;
      return;
    }

    if (!hasCustomWebhook && !defaultWebhook && !missingWebhook) {
      throw new Error('WebhookUrl is required');
    }

    if (!hasCustomWebhook && !defaultWebhook && !options?.allowMissing) {
      throw new Error('WebhookUrl is required');
    }
  }

  private stripDefaultWebhook<
    T extends { webhookUrl?: string | null; basicAuthUser?: string | null; basicAuthPass?: string | null },
  >(bot: T): T {
    const defaultWebhook = this.getDefaultWebhookUrl();
    if (!defaultWebhook || !bot?.webhookUrl) return bot;
    if (bot.webhookUrl !== defaultWebhook) return bot;
    return {
      ...bot,
      webhookUrl: null,
      basicAuthUser: null,
      basicAuthPass: null,
    };
  }

  protected getAdditionalBotData(data: N8nDto): Record<string, any> {
    return {
      webhookUrl: data.webhookUrl,
      prompt: data.prompt,
      basicAuthUser: data.basicAuthUser,
      basicAuthPass: data.basicAuthPass,
      funnelId: data.funnelId || null,
    };
  }

  // Implementation for bot-specific updates
  protected getAdditionalUpdateFields(data: N8nDto): Record<string, any> {
    return {
      webhookUrl: data.webhookUrl,
      prompt: data.prompt,
      basicAuthUser: data.basicAuthUser,
      basicAuthPass: data.basicAuthPass,
      funnelId: data.funnelId || null,
    };
  }

  protected async validateNoDuplicatesOnUpdate(botId: string, instanceId: string, data: N8nDto): Promise<void> {
    const defaultWebhook = this.getDefaultWebhookUrl();
    if (defaultWebhook && data.webhookUrl === defaultWebhook) {
      return;
    }
    const checkDuplicate = await this.botRepository.findFirst({
      where: {
        id: {
          not: botId,
        },
        instanceId: instanceId,
        webhookUrl: data.webhookUrl,
        basicAuthUser: data.basicAuthUser,
        basicAuthPass: data.basicAuthPass,
      },
    });

    if (checkDuplicate) {
      throw new Error('N8n already exists');
    }
  }

  public async findBot(instance: InstanceDto) {
    const bots = await super.findBot(instance);
    return Array.isArray(bots) ? bots.map((bot) => this.stripDefaultWebhook(bot)) : bots;
  }

  public async fetchBot(instance: InstanceDto, botId: string) {
    const bot = await super.fetchBot(instance, botId);
    return bot ? this.stripDefaultWebhook(bot) : bot;
  }

  public async emitLastMessage(instance: InstanceDto, data: { remoteJid: string }) {
    if (!this.integrationEnabled) throw new BadRequestException('N8n is disabled');

    const instanceRecord = await this.prismaRepository.instance.findFirst({
      where: {
        name: instance.instanceName,
      },
    });

    if (!instanceRecord) {
      throw new Error('Instance not found');
    }

    instance.instanceId = instanceRecord.id;

    const lastMessage = await this.prismaRepository.message.findFirst({
      where: {
        instanceId: instanceRecord.id,
        OR: [
          { key: { path: ['remoteJid'], equals: data.remoteJid } },
          { key: { path: ['remoteJidAlt'], equals: data.remoteJid } },
        ],
      },
      orderBy: { messageTimestamp: 'desc' },
    });

    if (!lastMessage) {
      return { sent: false, reason: 'not_found' };
    }

    const keyData = lastMessage.key as { fromMe?: boolean | string } | null;
    const rawFromMe = keyData?.fromMe;
    const isFromMe = rawFromMe === true || rawFromMe === 'true';
    if (isFromMe) {
      return { sent: false, reason: 'last_from_me', messageId: lastMessage.id };
    }

    const msg = {
      key: lastMessage.key,
      message: lastMessage.message,
      contextInfo: lastMessage.contextInfo,
      messageTimestamp: lastMessage.messageTimestamp,
      messageType: lastMessage.messageType,
    };

    await this.emit({
      instance,
      remoteJid: data.remoteJid,
      msg,
      pushName: lastMessage.pushName || undefined,
    });

    return { sent: true, messageId: lastMessage.id };
  }

  // Bots
  public async createBot(instance: InstanceDto, data: N8nDto) {
    if (!this.integrationEnabled) throw new BadRequestException('N8n is disabled');

    this.applyWebhookDefaults(data, { useDefaultWhenMissing: true });

    const instanceRecord = await this.prismaRepository.instance.findFirst({
      where: {
        name: instance.instanceName,
      },
      select: { id: true, companyId: true },
    });
    if (!instanceRecord) {
      throw new Error('Instance not found');
    }
    const instanceId = instanceRecord.id;

    if (data.funnelId !== undefined) {
      const funnelId = data.funnelId || null;
      if (funnelId) {
        const funnel = await this.prismaRepository.funnel.findFirst({
          where: { id: funnelId, instanceId: instanceRecord.id },
          select: { id: true },
        });
        if (!funnel) {
          throw new Error('Funnel not found');
        }
      }
      data.funnelId = funnelId;
    }

    const defaultWebhook = this.getDefaultWebhookUrl();
    if (!defaultWebhook || data.webhookUrl !== defaultWebhook) {
      const checkDuplicate = await this.botRepository.findFirst({
        where: {
          instanceId: instanceId,
          webhookUrl: data.webhookUrl,
          basicAuthUser: data.basicAuthUser,
          basicAuthPass: data.basicAuthPass,
        },
      });

      if (checkDuplicate) {
        throw new Error('N8n already exists');
      }
    }

    // Let the base class handle the rest of the bot creation process
    const bot = (await super.createBot(instance, data)) as N8nModel;
    if (bot) {
      await this.updatePromptFunnelCache(bot);
    }
    return this.stripDefaultWebhook(bot);
  }

  public async updateBot(instance: InstanceDto, botId: string, data: N8nDto) {
    const current = (await this.botRepository.findFirst({ where: { id: botId } })) as N8nModel | null;
    const instanceRecord = await this.prismaRepository.instance.findFirst({
      where: { name: instance.instanceName },
      select: { id: true, companyId: true },
    });
    if (!instanceRecord) {
      throw new Error('Instance not found');
    }

    this.applyWebhookDefaults(data, { allowMissing: true });

    if (data.funnelId !== undefined) {
      const funnelId = data.funnelId || null;
      if (funnelId) {
        const funnel = await this.prismaRepository.funnel.findFirst({
          where: { id: funnelId, instanceId: instanceRecord.id },
          select: { id: true },
        });
        if (!funnel) {
          throw new Error('Funnel not found');
        }
      }
      data.funnelId = funnelId;
    }

    const updated = (await super.updateBot(instance, botId, data)) as N8nModel;
    const promptChanged = data.prompt !== undefined && data.prompt !== current?.prompt;
    const funnelChanged = data.funnelId !== undefined && data.funnelId !== current?.funnelId;

    if (updated && (promptChanged || funnelChanged)) {
      await this.updatePromptFunnelCache(updated);
    }

    return this.stripDefaultWebhook(updated);
  }

  public async deleteBot(instance: InstanceDto, botId: string) {
    const bot = (await this.botRepository.findFirst({ where: { id: botId } })) as N8nModel | null;
    const instanceId = bot?.instanceId;
    const result = await super.deleteBot(instance, botId);

    if (this.cache && instanceId) {
      await this.cache.hDelete(this.promptCacheKey(instanceId), botId);
    }

    return result;
  }

  // Process N8n-specific bot logic
  protected async processBot(
    instance: any,
    remoteJid: string,
    bot: N8nModel,
    session: IntegrationSession,
    settings: any,
    content: string,
    pushName?: string,
    msg?: any,
  ) {
    // Use the base class pattern instead of calling n8nService.process directly
    await this.n8nService.process(instance, remoteJid, bot, session, settings, content, pushName, msg);
  }
}
