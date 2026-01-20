import { PrismaRepository } from '@api/repository/repository.service';
import { WAMonitoringService } from '@api/services/monitor.service';
import { Agno as AgnoConfig, ConfigService } from '@config/env.config';
import { Agno as AgnoModel, AgnoSetting, IntegrationSession } from '@prisma/client';
import axios from 'axios';
import { isURL } from 'class-validator';
import FormData from 'form-data';
import mimeTypes from 'mime-types';

import { BaseChatbotService } from '../../base-chatbot.service';
import { AgnoCache } from '../agno-cache';

type FileAttachment = {
  buffer: Buffer;
  filename: string;
  contentType: string;
};

export class AgnoService extends BaseChatbotService<AgnoModel, AgnoSetting> {
  private agnoCache: AgnoCache;

  constructor(waMonitor: WAMonitoringService, prismaRepository: PrismaRepository, configService: ConfigService) {
    super(waMonitor, prismaRepository, 'AgnoService', configService);
    this.agnoCache = new AgnoCache(configService);
  }

  protected getBotType(): string {
    return 'agno';
  }

  private funnelCacheKey(funnelId: string): string {
    return `funnel:${funnelId}`;
  }

  private async getFunnelPayload(
    funnelId: string,
  ): Promise<{ payload: Record<string, any> | null; updatedAt: Date | null; followUpEnable: boolean | null } | null> {
    if (!funnelId) return null;

    const cacheKey = this.funnelCacheKey(funnelId);
    const cached = await this.agnoCache.get<{
      payload: Record<string, any> | null;
      updatedAt: string | null;
      followUpEnable: boolean | null;
    }>(cacheKey);
    if (cached !== undefined) {
      return {
        payload: cached?.payload ?? null,
        updatedAt: cached?.updatedAt ? new Date(cached.updatedAt) : null,
        followUpEnable: cached?.followUpEnable ?? null,
      };
    }

    let payload: Record<string, any> | null = null;
    let updatedAt: Date | null = null;
    let followUpEnable: boolean | null = null;
    try {
      const funnel = await this.prismaRepository.funnel.findFirst({
        where: { id: funnelId },
      });
      if (funnel) {
        updatedAt = funnel.updatedAt || null;
        followUpEnable = funnel.followUpEnable ?? null;
        payload = {
          id: funnel.id,
          name: funnel.name,
          goal: funnel.goal,
          logic: funnel.logic,
          followUp: {
            stages: funnel.stages,
          },
          stages: funnel.stages,
          status: funnel.status,
        };
      }
    } catch (error) {
      this.logger.warn(`[Agno] Failed to load funnel payload: ${error}`);
    }

    await this.agnoCache.set(cacheKey, {
      payload,
      updatedAt: updatedAt ? updatedAt.toISOString() : null,
      followUpEnable,
    });
    return { payload, updatedAt, followUpEnable };
  }

  private buildFunnelPayloadFromModel(funnel?: {
    id?: string;
    name?: string | null;
    goal?: string | null;
    logic?: string | null;
    stages?: any;
    status?: string | null;
  }): Record<string, any> | null {
    if (!funnel?.id) return null;
    return {
      id: funnel.id,
      name: funnel.name ?? null,
      goal: funnel.goal ?? null,
      logic: funnel.logic ?? null,
      followUp: {
        stages: funnel.stages ?? null,
      },
      stages: funnel.stages ?? null,
      status: funnel.status ?? null,
    };
  }

  private resolveBaseUrl(bot: AgnoModel, agnoPort?: number | null): string | null {
    const webhookUrl = bot?.webhookUrl?.trim();
    if (webhookUrl) {
      return webhookUrl.replace(/\/+$/, '');
    }

    const agnoConfig = this.configService.get<AgnoConfig>('AGNO');
    const baseUrl = agnoConfig?.BASE_URL || '';
    if (!baseUrl.trim()) return null;

    try {
      const url = new URL(baseUrl.trim());
      const resolvedPort = typeof agnoPort === 'number' && agnoPort > 0 ? agnoPort : agnoConfig?.DEFAULT_PORT || 0;
      if (resolvedPort > 0) {
        url.port = String(resolvedPort);
      }
      return url.toString().replace(/\/+$/, '');
    } catch {
      return baseUrl.trim().replace(/\/+$/, '');
    }
  }

  private isWebhookEnabled(bot: AgnoModel): boolean {
    return Boolean(bot?.webhookUrl?.trim());
  }

  private resolveAgentId(bot: AgnoModel): string | null {
    const fromBot = bot?.agentId?.trim();
    if (fromBot) return fromBot;
    const fallback = this.configService.get<AgnoConfig>('AGNO')?.DEFAULT_AGENT_ID || '';
    return fallback.trim() ? fallback.trim() : null;
  }

  private resolveTimeout(): number {
    const timeout = this.configService.get<AgnoConfig>('AGNO')?.TIMEOUT_MS;
    if (typeof timeout === 'number' && timeout > 0) return timeout;
    return 120000;
  }

  private buildSessionState(session: IntegrationSession, msg?: any) {
    return {
      funnelStage: session.funnelStage ?? null,
      followUpStage: session.followUpStage ?? null,
      funnelEnable: session.funnelEnable ?? false,
      followUpEnable: session.followUpEnable ?? false,
      quotedMessage: msg?.contextInfo?.quotedMessage ?? null,
    };
  }

  private buildBaseDependencies(
    funnelPayload?: Record<string, any> | null,
    agentPrompt?: string | null,
    agentConfig?: Record<string, any> | null,
  ) {
    return {
      funnel: funnelPayload ?? null,
      agent_prompt: agentPrompt ?? null,
      agent_config: agentConfig ?? null,
    };
  }

  private buildFollowUpDependencies(
    baseDependencies: Record<string, any>,
    step: Record<string, any>,
    nextStep: Record<string, any> | null,
  ) {
    return {
      ...baseDependencies,
      event: 'followup',
      stage: step?.stage ?? null,
      touch: step?.touch ?? null,
      delayMin: step?.delayMin ?? null,
      condition: step?.condition ?? null,
      logicStage: step?.logicStage ?? null,
      commonTouchCondition: step?.commonTouchCondition ?? null,
      objective: step?.objective ?? null,
      title: step?.title ?? null,
      nextStage: nextStep?.stage ?? null,
      nextTouch: nextStep?.touch ?? null,
    };
  }

  private redactDependencies(dependencies: Record<string, any>): Record<string, any> {
    const sanitized = { ...dependencies };
    if ('llm_api_key' in sanitized) {
      sanitized.llm_api_key = sanitized.llm_api_key ? '[REDACTED]' : sanitized.llm_api_key;
    }
    return sanitized;
  }

  private buildAgnoLogPayload(input: {
    endpoint: string;
    message: string;
    sessionId: string | null;
    userId: string;
    sessionState: Record<string, any>;
    dependencies: Record<string, any>;
    attachment?: FileAttachment | null;
  }) {
    return {
      endpoint: input.endpoint,
      message: input.message,
      stream: false,
      session_id: input.sessionId,
      user_id: input.userId,
      session_state: input.sessionState,
      dependencies: this.redactDependencies(input.dependencies),
      attachment: input.attachment
        ? {
            filename: input.attachment.filename,
            contentType: input.attachment.contentType,
            size: input.attachment.buffer.length,
          }
        : null,
    };
  }

  private buildDependenciesCacheKey(
    bot: AgnoModel,
    funnelId?: string | null,
    funnelUpdatedAt?: Date | string | null,
  ): string {
    const botUpdatedAt =
      bot?.updatedAt instanceof Date ? bot.updatedAt.toISOString() : String(bot?.updatedAt ?? 'none');
    const funnelUpdated =
      funnelUpdatedAt instanceof Date ? funnelUpdatedAt.toISOString() : String(funnelUpdatedAt ?? 'none');
    return `deps:${bot?.id ?? 'unknown'}:${botUpdatedAt}:${funnelId ?? 'none'}:${funnelUpdated}`;
  }

  public async invalidateDependenciesCache(bot: AgnoModel): Promise<void> {
    if (!bot?.id) return;

    try {
      const funnelId = bot?.funnelId ?? null;
      let funnelUpdatedAt: Date | string | null = null;
      if (funnelId) {
        const funnel = await this.prismaRepository.funnel.findFirst({
          where: { id: funnelId },
          select: { updatedAt: true },
        });
        funnelUpdatedAt = funnel?.updatedAt ?? null;
      }

      const cacheKey = this.buildDependenciesCacheKey(bot, funnelId, funnelUpdatedAt);
      await this.agnoCache.delete(cacheKey);
    } catch (error) {
      this.logger.warn(`[Agno] Failed to invalidate dependencies cache: ${error}`);
    }
  }

  private async getBaseDependencies(
    bot: AgnoModel,
    funnelPayload: Record<string, any> | null,
    funnelUpdatedAt?: Date | string | null,
    agentPrompt?: string | null,
    agentConfig?: Record<string, any> | null,
  ): Promise<Record<string, any>> {
    const funnelId = funnelPayload?.id ?? null;
    const cacheKey = this.buildDependenciesCacheKey(bot, funnelId, funnelUpdatedAt);
    const cached = await this.agnoCache.get<Record<string, any>>(cacheKey);
    if (cached) return cached;

    const dependencies = this.buildBaseDependencies(funnelPayload, agentPrompt, agentConfig);
    await this.agnoCache.set(cacheKey, dependencies);
    return dependencies;
  }

  private normalizeMessageContent(content: string): string {
    if (!content) return '';

    const parts = content.split('|');
    if (parts[0] === 'imageMessage' || parts[0] === 'viewOnceMessageV2') {
      return parts[2] || content;
    }
    if (parts[0] === 'videoMessage' || parts[0] === 'documentMessage' || parts[0] === 'documentWithCaptionMessage') {
      return parts[2] || content;
    }
    return content;
  }

  private buildChatInput(content: string, msg?: any): string {
    if (!msg) return content;

    const hasImage =
      msg?.message?.imageMessage || msg?.message?.viewOnceMessageV2?.message?.imageMessage ? true : false;

    if (!hasImage) return content;

    const userCaption =
      msg?.message?.imageMessage?.caption || msg?.message?.viewOnceMessageV2?.message?.imageMessage?.caption;
    const aiCaption = msg?.message?.imageCaption || msg?.message?.viewOnceMessageV2?.message?.imageCaption || undefined;

    if (!userCaption && !aiCaption) return content;

    const captions: string[] = [];
    if (userCaption) captions.push(userCaption);
    if (aiCaption && aiCaption !== userCaption) captions.push(aiCaption);

    const captionText = captions.join(' | ');

    if (content.includes('imageMessage|') || content.includes('viewOnceMessageV2|')) {
      const parts = content.split('|');
      if (parts.length >= 2) {
        return `${parts[0]}|${parts[1]}|${captionText}`;
      }
      return `${content}|${captionText}`;
    }

    return `${content}\n${captionText}`;
  }

  private async resolveFileAttachment(msg?: any): Promise<FileAttachment | null> {
    const base64 = msg?.message?.base64;
    const mediaUrl = msg?.message?.mediaUrl;
    const mimeType =
      msg?.message?.mimetype || (mediaUrl ? (mimeTypes.lookup(mediaUrl) as string) : '') || 'application/octet-stream';

    if (base64) {
      const extension = mimeTypes.extension(mimeType) || 'bin';
      const filename = msg?.message?.fileName || `${msg?.key?.id || 'file'}.${extension}`;
      return { buffer: Buffer.from(base64, 'base64'), filename, contentType: mimeType };
    }

    if (mediaUrl && isURL(mediaUrl)) {
      const response = await axios.get(mediaUrl, { responseType: 'arraybuffer' });
      const extension = mimeTypes.extension(mimeType) || 'bin';
      const filename = msg?.message?.fileName || `${msg?.key?.id || 'file'}.${extension}`;
      return { buffer: Buffer.from(response.data), filename, contentType: mimeType };
    }

    return null;
  }

  protected async sendMessageToBot(
    instance: any,
    session: IntegrationSession,
    settings: AgnoSetting,
    bot: AgnoModel,
    remoteJid: string,
    pushName: string,
    content: string,
    msg?: any,
  ): Promise<void> {
    try {
      void pushName;
      if (!session) {
        this.logger.error('[Agno] Session is null in sendMessageToBot');
        return;
      }

      if ((bot as any).funnelId && session.funnelId !== (bot as any).funnelId) {
        try {
          const updated = await this.prismaRepository.integrationSession.update({
            where: { id: session.id },
            data: {
              funnelId: (bot as any).funnelId,
              funnelEnable: true,
            },
            select: {
              funnelId: true,
              funnelEnable: true,
            },
          });
          session = { ...session, ...updated };
        } catch (error) {
          this.logger.warn(`[Agno] Failed to update funnel binding: ${error}`);
        }
      }

      const funnelId = (bot as any).funnelId;
      const funnelResult = funnelId ? await this.getFunnelPayload(funnelId) : null;
      const resolvedFunnelPayload = funnelResult?.payload ?? null;
      if (resolvedFunnelPayload) {
        const followUpEnable = funnelResult?.followUpEnable ?? null;
        if (followUpEnable !== null && session.followUpEnable !== followUpEnable) {
          const updated = await this.prismaRepository.integrationSession.update({
            where: { id: session.id },
            data: { followUpEnable },
            select: { followUpEnable: true },
          });
          session = { ...session, ...updated };
        }
      }
      const baseUrl = this.resolveBaseUrl(bot, bot?.agnoPort ?? null);
      if (!baseUrl) {
        this.logger.error('[Agno] BASE_URL is not configured');
        return;
      }

      const agentId = this.resolveAgentId(bot);
      if (!agentId) {
        this.logger.error('[Agno] Agent ID is not configured');
        return;
      }

      const processedContent = this.buildChatInput(this.normalizeMessageContent(content), msg);

      const form = new FormData();
      form.append('message', processedContent);
      form.append('stream', 'false');
      form.append('session_id', session?.id);
      form.append('user_id', `${remoteJid}:${instance.instanceId || 'unknown'}`);

      const sessionState = this.buildSessionState(session, msg);
      form.append('session_state', JSON.stringify(sessionState));

      const agentPrompt = bot?.prompt?.trim() || null;
      const agentConfig = (bot as any)?.agentConfig ?? null;
      const baseDependencies = await this.getBaseDependencies(
        bot,
        resolvedFunnelPayload,
        funnelResult?.updatedAt ?? null,
        agentPrompt,
        agentConfig,
      );
      const sessionMessages = await this.getSessionMessagesCache(session.id);
      const dependencies = { ...baseDependencies, session_messages: sessionMessages };
      form.append('dependencies', JSON.stringify(dependencies));

      const attachment = await this.resolveFileAttachment(msg);

      const webhookEnabled = this.isWebhookEnabled(bot);
      const endpoint = webhookEnabled ? baseUrl : `${baseUrl}/agents/${encodeURIComponent(agentId)}/runs`;
      const logPayload = this.buildAgnoLogPayload({
        endpoint,
        message: processedContent,
        sessionId: session?.id ?? null,
        userId: `${remoteJid}:${instance.instanceId || 'unknown'}`,
        sessionState,
        dependencies,
        attachment,
      });
      this.logger.debug(`[Agno] Request payload: ${JSON.stringify(logPayload)}`);

      let response;
      if (webhookEnabled) {
        const payload = {
          message: processedContent,
          stream: false,
          session_id: session?.id ?? null,
          user_id: `${remoteJid}:${instance.instanceId || 'unknown'}`,
          session_state: sessionState,
          dependencies,
          attachment: attachment
            ? {
                filename: attachment.filename,
                content_type: attachment.contentType,
                base64: attachment.buffer.toString('base64'),
              }
            : null,
        };
        response = await axios.post(endpoint, payload, {
          headers: { 'Content-Type': 'application/json' },
          timeout: this.resolveTimeout(),
        });
      } else {
        if (attachment) {
          form.append('files', attachment.buffer, {
            filename: attachment.filename,
            contentType: attachment.contentType,
          });
        }
        response = await axios.post(endpoint, form, {
          headers: form.getHeaders(),
          timeout: this.resolveTimeout(),
        });
      }
      this.logger.debug(`[Agno] Response payload: ${JSON.stringify({ status: response.status, data: response.data })}`);

      const reply =
        response?.data?.content ?? response?.data?.output ?? response?.data?.answer ?? response?.data?.message;

      if (reply) {
        await this.sendMessageWhatsApp(instance, remoteJid, reply, settings, true, session);
      }

      await this.updateSession(session.id, { status: 'opened', awaitUser: true });
    } catch (error) {
      this.logger.error(`[Agno] Error sending message: ${error?.response?.data || error}`);
    }
  }

  public async sendFollowUpStep(
    instance: any,
    session: IntegrationSession,
    settings: AgnoSetting,
    bot: AgnoModel,
    funnel: {
      id: string;
      goal?: string | null;
      logic?: string | null;
      followUpEnable?: boolean | null;
      name?: string | null;
      status?: string | null;
      stages?: any;
      updatedAt?: Date | null;
    },
    steps: Array<Record<string, any>>,
    stepIndex: number,
  ): Promise<boolean> {
    try {
      if (!session) return false;

      const baseUrl = this.resolveBaseUrl(bot, bot?.agnoPort ?? null);
      if (!baseUrl) return false;

      const agentId = this.resolveAgentId(bot);
      if (!agentId) return false;

      const step = steps?.[stepIndex] || {};
      const nextStep = steps?.[stepIndex + 1] || null;
      const systemFollowUpMessage = 'continue';

      const form = new FormData();
      form.append('message', systemFollowUpMessage);
      form.append('stream', 'false');
      form.append('session_id', session?.sessionId || session?.id || session.remoteJid);
      form.append('user_id', `${session.remoteJid}:${instance.instanceId || 'unknown'}`);

      const sessionState = this.buildSessionState(session);
      form.append('session_state', JSON.stringify(sessionState));

      const agentPrompt = bot?.prompt?.trim() || null;
      const agentConfig = (bot as any)?.agentConfig ?? null;
      const funnelPayload = this.buildFunnelPayloadFromModel(funnel);
      const baseDependencies = await this.getBaseDependencies(
        bot,
        funnelPayload,
        funnel?.updatedAt ?? null,
        agentPrompt,
        agentConfig,
      );
      const sessionMessages = await this.getSessionMessagesCache(session.id);
      const dependencies = this.buildFollowUpDependencies(
        { ...baseDependencies, session_messages: sessionMessages },
        step,
        nextStep,
      );
      form.append('dependencies', JSON.stringify(dependencies));

      const webhookEnabled = this.isWebhookEnabled(bot);
      const endpoint = webhookEnabled ? baseUrl : `${baseUrl}/agents/${encodeURIComponent(agentId)}/runs`;
      const logPayload = this.buildAgnoLogPayload({
        endpoint,
        message: systemFollowUpMessage,
        sessionId: session?.sessionId || session?.id || session.remoteJid,
        userId: `${session.remoteJid}:${instance.instanceId || 'unknown'}`,
        sessionState,
        dependencies,
        attachment: null,
      });
      this.logger.debug(`[Agno] Request payload: ${JSON.stringify(logPayload)}`);

      let response;
      if (webhookEnabled) {
        const payload = {
          message: systemFollowUpMessage,
          stream: false,
          session_id: session?.sessionId || session?.id || session.remoteJid,
          user_id: `${session.remoteJid}:${instance.instanceId || 'unknown'}`,
          session_state: sessionState,
          dependencies,
          attachment: null,
        };
        response = await axios.post(endpoint, payload, {
          headers: { 'Content-Type': 'application/json' },
          timeout: this.resolveTimeout(),
        });
      } else {
        response = await axios.post(endpoint, form, {
          headers: form.getHeaders(),
          timeout: this.resolveTimeout(),
        });
      }
      this.logger.debug(`[Agno] Response payload: ${JSON.stringify({ status: response.status, data: response.data })}`);

      const reply =
        response?.data?.content ?? response?.data?.output ?? response?.data?.answer ?? response?.data?.message;

      if (reply) {
        await this.sendMessageWhatsApp(instance, session.remoteJid, reply, settings, true, session, undefined, true);
      }

      await this.updateSession(session.id, { status: 'opened', awaitUser: true });

      return true;
    } catch (error) {
      this.logger.error(`[Agno] Failed to send follow-up: ${error?.response?.data || error}`);
      return false;
    }
  }
}
