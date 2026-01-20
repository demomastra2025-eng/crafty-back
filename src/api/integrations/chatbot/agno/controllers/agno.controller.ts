import { InstanceDto } from '@api/dto/instance.dto';
import { PrismaRepository } from '@api/repository/repository.service';
import { WAMonitoringService } from '@api/services/monitor.service';
import { Agno as AgnoConfig, configService } from '@config/env.config';
import { Logger } from '@config/logger.config';
import { BadRequestException } from '@exceptions';
import { Agno as AgnoModel, IntegrationSession, SessionStatus } from '@prisma/client';

import { BaseChatbotController } from '../../base-chatbot.controller';
import { AgnoDto } from '../dto/agno.dto';
import { AgnoService } from '../services/agno.service';

export class AgnoController extends BaseChatbotController<AgnoModel, AgnoDto> {
  constructor(
    private readonly agnoService: AgnoService,
    prismaRepository: PrismaRepository,
    waMonitor: WAMonitoringService,
  ) {
    super(prismaRepository, waMonitor);

    this.botRepository = this.prismaRepository.agno;
    this.settingsRepository = this.prismaRepository.agnoSetting;
    this.sessionRepository = this.prismaRepository.integrationSession;
  }

  public readonly logger = new Logger('AgnoController');
  protected readonly integrationName = 'Agno';

  integrationEnabled = configService.get<AgnoConfig>('AGNO').ENABLED;
  botRepository: any;
  settingsRepository: any;
  sessionRepository: any;
  userMessageDebounce: { [key: string]: { message: string; timeoutId: NodeJS.Timeout } } = {};

  protected getFallbackBotId(settings: any): string | undefined {
    return settings?.agnoIdFallback;
  }

  protected getFallbackFieldName(): string {
    return 'agnoIdFallback';
  }

  protected getIntegrationType(): string {
    return 'agno';
  }

  private async createSessionsForExistingChats(instanceId: string, bot: AgnoModel): Promise<void> {
    if (!bot?.id) return;

    const chats = await this.prismaRepository.chat.findMany({
      where: { instanceId },
      select: { remoteJid: true, name: true },
    });

    if (!chats.length) return;

    const existingSessions = await this.prismaRepository.integrationSession.findMany({
      where: {
        instanceId,
        botId: bot.id,
        type: this.getIntegrationType(),
      },
      select: { remoteJid: true },
    });

    const existingSet = new Set(existingSessions.map((session) => session.remoteJid));
    const status = bot.enabled ? SessionStatus.opened : SessionStatus.paused;
    const hasFunnel = Boolean(bot.funnelId);

    const data = chats
      .filter((chat) => !existingSet.has(chat.remoteJid))
      .map((chat) => ({
        sessionId: chat.remoteJid,
        remoteJid: chat.remoteJid,
        pushName: chat.name ?? null,
        status,
        awaitUser: false,
        botId: bot.id,
        instanceId,
        type: this.getIntegrationType(),
        funnelId: bot.funnelId ?? null,
        funnelEnable: hasFunnel,
        followUpEnable: hasFunnel,
        funnelStage: null,
        followUpStage: null,
      }));

    if (!data.length) return;

    await this.prismaRepository.integrationSession.createMany({ data });
  }

  protected getAdditionalBotData(data: AgnoDto): Record<string, any> {
    const defaultPort = configService.get<AgnoConfig>('AGNO')?.DEFAULT_PORT || null;
    return {
      prompt: data.prompt,
      agentId: data.agentId,
      agentConfig: data.agentConfig ?? null,
      webhookUrl: data.webhookUrl ?? null,
      providerModel: data.providerModel,
      agnoPort: data.agnoPort ?? defaultPort,
      funnelId: data.funnelId || null,
    };
  }

  protected getAdditionalUpdateFields(data: AgnoDto): Record<string, any> {
    const defaultPort = configService.get<AgnoConfig>('AGNO')?.DEFAULT_PORT || null;
    const agnoPort = data.agnoPort === undefined ? undefined : data.agnoPort === null ? defaultPort : data.agnoPort;
    return {
      prompt: data.prompt,
      agentId: data.agentId,
      agentConfig: data.agentConfig ?? null,
      webhookUrl: data.webhookUrl ?? null,
      providerModel: data.providerModel,
      ...(agnoPort === undefined ? {} : { agnoPort }),
      funnelId: data.funnelId || null,
    };
  }

  protected async validateNoDuplicatesOnUpdate(botId: string, instanceId: string, data: AgnoDto): Promise<void> {
    void botId;
    void instanceId;
    void data;
    return;
  }

  protected async processBot(
    instance: any,
    remoteJid: string,
    bot: AgnoModel,
    session: IntegrationSession,
    settings: any,
    content: string,
    pushName?: string,
    msg?: any,
  ) {
    await this.agnoService.process(instance, remoteJid, bot, session, settings, content, pushName, msg);
  }

  public async createBot(instance: InstanceDto, data: AgnoDto) {
    if (!this.integrationEnabled) throw new BadRequestException('Agno is disabled');
    if (data.funnelId !== undefined) {
      const instanceRecord = await this.prismaRepository.instance.findFirst({
        where: { name: instance.instanceName },
        select: { id: true },
      });
      if (!instanceRecord) {
        throw new Error('Instance not found');
      }
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
    const bot = (await super.createBot(instance, data)) as AgnoModel;
    if (bot) {
      if (bot.instanceId) {
        await this.createSessionsForExistingChats(bot.instanceId, bot);
      }
    }
    return bot;
  }

  public async updateBot(instance: InstanceDto, botId: string, data: AgnoDto) {
    if (!this.integrationEnabled) throw new BadRequestException(`${this.integrationName} is disabled`);

    const instanceRecord = await this.prismaRepository.instance.findFirst({
      where: { name: instance.instanceName },
      select: { id: true },
    });
    if (!instanceRecord) {
      throw new Error('Instance not found');
    }

    const current = (await this.botRepository.findFirst({
      where: { id: botId, instanceId: instanceRecord.id },
    })) as AgnoModel | null;
    if (!current) {
      throw new Error(`${this.integrationName} not found`);
    }

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
    const updated = (await super.updateBot(instance, botId, data)) as AgnoModel;
    await this.agnoService.invalidateDependenciesCache(current);
    return updated;
  }

  public async deleteBot(instance: InstanceDto, botId: string) {
    if (!this.integrationEnabled) throw new BadRequestException(`${this.integrationName} is disabled`);

    const instanceRecord = await this.prismaRepository.instance.findFirst({
      where: { name: instance.instanceName },
      select: { id: true },
    });
    if (!instanceRecord) {
      throw new Error('Instance not found');
    }

    const current = (await this.botRepository.findFirst({
      where: { id: botId, instanceId: instanceRecord.id },
    })) as AgnoModel | null;
    if (!current) {
      throw new Error(`${this.integrationName} not found`);
    }

    const result = await super.deleteBot(instance, botId);
    await this.agnoService.invalidateDependenciesCache(current);
    return result;
  }

  public async changeStatus(instance: InstanceDto, data: any) {
    if (!this.integrationEnabled) throw new BadRequestException('Agno is disabled');

    if (data?.allSessions) {
      const instanceId = await this.prismaRepository.instance
        .findFirst({
          where: { name: instance.instanceName },
          select: { id: true },
        })
        .then((record) => record?.id);

      if (!instanceId) {
        throw new Error('Instance not found');
      }

      const botId = data.botId as string | undefined;
      if (!botId) {
        throw new Error('Bot ID is required');
      }

      const bot = (await this.botRepository.findFirst({ where: { id: botId } })) as AgnoModel | null;
      if (!bot || bot.instanceId !== instanceId) {
        throw new Error('Agno bot not found');
      }

      const settings = await this.settingsRepository.findFirst({
        where: { instanceId },
      });

      const status = data.status as string;
      if (status === 'delete') {
        await this.sessionRepository.deleteMany({
          where: { instanceId, botId, type: this.getIntegrationType() },
        });
        return { bot: { remoteJid: data.remoteJid ?? 'all', status } };
      }

      if (status === 'closed') {
        if (settings?.keepOpen) {
          await this.sessionRepository.updateMany({
            where: { instanceId, botId, type: this.getIntegrationType() },
            data: { status: 'closed' },
          });
        } else {
          await this.sessionRepository.deleteMany({
            where: { instanceId, botId, type: this.getIntegrationType() },
          });
        }
        await this.botRepository.update({
          where: { id: botId },
          data: { enabled: false },
        });
        return { bot: { remoteJid: data.remoteJid ?? 'all', status } };
      }

      await this.sessionRepository.updateMany({
        where: { instanceId, botId, type: this.getIntegrationType() },
        data: { status },
      });

      await this.botRepository.update({
        where: { id: botId },
        data: { enabled: status === 'opened' },
      });

      return { bot: { remoteJid: data.remoteJid ?? 'all', status } };
    }

    return super.changeStatus(instance, data);
  }

  public async emitLastMessage(instance: InstanceDto, data: { remoteJid: string }) {
    if (!this.integrationEnabled) throw new BadRequestException('Agno is disabled');

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
}
