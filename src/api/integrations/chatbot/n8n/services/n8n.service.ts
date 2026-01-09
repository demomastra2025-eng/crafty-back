import { PrismaRepository } from '@api/repository/repository.service';
import { WAMonitoringService } from '@api/services/monitor.service';
import { ConfigService, HttpServer } from '@config/env.config';
import { IntegrationSession, N8n, N8nSetting } from '@prisma/client';
import axios from 'axios';

import { BaseChatbotService } from '../../base-chatbot.service';
import { OpenaiService } from '../../openai/services/openai.service';
import {
  clearLastInboundKeyId,
  getLastInboundKeyAgeMs,
  getLastInboundKeyId,
  setLastInboundKeyId,
} from '../../session-cache';

export class N8nService extends BaseChatbotService<N8n, N8nSetting> {
  private openaiService: OpenaiService;
  private readonly inboundKeyCacheTtlMs = 60000;
  private readonly inboundKeyDbRefreshMs = 20000;

  constructor(
    waMonitor: WAMonitoringService,
    prismaRepository: PrismaRepository,
    configService: ConfigService,
    openaiService: OpenaiService,
  ) {
    super(waMonitor, prismaRepository, 'N8nService', configService);
    this.openaiService = openaiService;
  }

  private normalizeStages(stages: unknown): Array<Record<string, any>> | null {
    if (Array.isArray(stages)) return stages as Array<Record<string, any>>;
    if (typeof stages === 'string') {
      try {
        const parsed = JSON.parse(stages);
        return Array.isArray(parsed) ? (parsed as Array<Record<string, any>>) : null;
      } catch {
        return null;
      }
    }
    return null;
  }

  private mergePrompt(parts: Array<string | null | undefined>): string | null {
    const cleaned = parts.map((part) => (typeof part === 'string' ? part.trim() : '')).filter((part) => Boolean(part));
    if (!cleaned.length) return null;
    return cleaned.join('\n\n');
  }

  /**
   * Return the bot type for N8n
   */
  protected getBotType(): string {
    return 'n8n';
  }

  protected async shouldSendResponse(session?: IntegrationSession, responseKeyId?: string): Promise<boolean> {
    if (!session?.id || !responseKeyId) return true;

    const cachedKey = getLastInboundKeyId(session.id);
    const cachedAge = getLastInboundKeyAgeMs(session.id);
    if (cachedKey && cachedAge !== undefined && cachedAge <= this.inboundKeyDbRefreshMs) {
      if (cachedKey !== responseKeyId) {
        this.logger.log('[N8n] Skipping stale response for outdated message (cache)');
        return false;
      }
      return true;
    }
    if (cachedAge !== undefined && cachedAge > this.inboundKeyCacheTtlMs) {
      clearLastInboundKeyId(session.id);
    }

    const latest = await this.prismaRepository.integrationSession.findUnique({
      where: { id: session.id },
      select: { context: true },
    });
    const context =
      latest?.context && typeof latest.context === 'object' ? (latest.context as Record<string, any>) : {};
    const latestInboundKeyId = context?.lastInboundKeyId;
    if (latestInboundKeyId) {
      setLastInboundKeyId(session.id, latestInboundKeyId);
    }
    if (latestInboundKeyId && latestInboundKeyId !== responseKeyId) {
      this.logger.log('[N8n] Skipping stale response for outdated message');
      return false;
    }
    return true;
  }

  protected async sendMessageToBot(
    instance: any,
    session: IntegrationSession,
    settings: N8nSetting,
    n8n: N8n,
    remoteJid: string,
    pushName: string,
    content: string,
    msg?: any,
  ) {
    try {
      if (!session) {
        this.logger.error('Session is null in sendMessageToBot');
        return;
      }

      if (n8n.funnelId && session.funnelId !== n8n.funnelId) {
        try {
          const updated = await this.prismaRepository.integrationSession.update({
            where: { id: session.id },
            data: {
              funnelId: n8n.funnelId,
              funnelEnable: true,
            },
            select: {
              funnelId: true,
              funnelEnable: true,
            },
          });
          session = { ...session, ...updated };
        } catch (error) {
          this.logger.warn(`[N8n] Failed to update funnel binding: ${error}`);
        }
      }

      const endpoint: string = n8n.webhookUrl;
      const chatInput = this.buildChatInput(content, msg);
      let funnelPayload: Record<string, any> | null = null;
      let funnelFollowUpEnable: boolean | null = null;
      if (n8n.funnelId) {
        try {
          const funnel = await this.prismaRepository.funnel.findFirst({
            where: { id: n8n.funnelId },
          });
          if (funnel) {
            const stages = this.normalizeStages(funnel.stages);
            funnelPayload = {
              id: funnel.id,
              name: funnel.name,
              goal: funnel.goal,
              logic: funnel.logic,
              followUpEnable: funnel.followUpEnable,
              stages: stages ?? funnel.stages,
              status: funnel.status,
            };
            funnelFollowUpEnable = funnel.followUpEnable ?? null;
          }
        } catch (error) {
          this.logger.warn(`[N8n] Failed to load funnel payload: ${error}`);
        }
      }
      if (funnelFollowUpEnable !== null && session.followUpEnable !== funnelFollowUpEnable) {
        try {
          const updated = await this.prismaRepository.integrationSession.update({
            where: { id: session.id },
            data: { followUpEnable: funnelFollowUpEnable },
            select: { followUpEnable: true },
          });
          session = { ...session, ...updated };
        } catch (error) {
          this.logger.warn(`[N8n] Failed to sync followUpEnable: ${error}`);
        }
      }
      const funnelPrompt =
        funnelPayload && (funnelPayload.goal || funnelPayload.logic)
          ? [funnelPayload.goal, funnelPayload.logic].filter(Boolean).join('\n')
          : null;
      const mergedPrompt = this.mergePrompt([n8n?.prompt || null, funnelPrompt]);
      const payload: any = {
        chatInput,
        sessionId: session.id,
        remoteJid: remoteJid,
        pushName: pushName,
        keyId: msg?.key?.id,
        fromMe: msg?.key?.fromMe,
        quotedMessage: msg?.contextInfo?.quotedMessage,
        funnelStage: session.funnelStage ?? null,
        followUpStage: session.followUpStage ?? null,
        funnelEnable: session.funnelEnable ?? false,
        followUpEnable: session.followUpEnable ?? false,
        funnel: funnelPayload,
        agentPrompt: mergedPrompt,
        funnelId: funnelPayload?.id || n8n?.funnelId || null,
        instanceName: instance.instanceName,
        instanceId: instance.instanceId,
        serverUrl: this.configService.get<HttpServer>('SERVER').URL,
        apiKey: instance.token,
      };

      // Handle audio messages
      if (this.isAudioMessage(content) && msg) {
        try {
          this.logger.debug(`[N8n] Downloading audio for Whisper transcription`);
          const transcription = await this.openaiService.speechToTextSystem(msg, instance);
          if (transcription) {
            payload.chatInput = `[audio] ${transcription}`;
          }
        } catch (err) {
          this.logger.error(`[N8n] Failed to transcribe audio: ${err}`);
        }
      }

      const headers: Record<string, string> = {};
      if (n8n.basicAuthUser && n8n.basicAuthPass) {
        const auth = Buffer.from(`${n8n.basicAuthUser}:${n8n.basicAuthPass}`).toString('base64');
        headers['Authorization'] = `Basic ${auth}`;
      }
      this.logger.log(`[N8n] Sending request to ${endpoint}`);
      const response = await axios.post(endpoint, payload, { headers, timeout: 120000 });
      this.logger.log(`[N8n] Response status: ${response?.status}, data: ${JSON.stringify(response?.data ?? {})}`);
      const message = response?.data?.output || response?.data?.answer;

      // Use base class method instead of custom implementation
      const responseKeyId = msg?.key?.id;
      if (!(await this.shouldSendResponse(session, responseKeyId))) return;
      await this.sendMessageWhatsApp(instance, remoteJid, message, settings, true, session, responseKeyId);

      await this.prismaRepository.integrationSession.update({
        where: {
          id: session.id,
        },
        data: {
          status: 'opened',
          awaitUser: true,
        },
      });
      if (responseKeyId) {
        setLastInboundKeyId(session.id, responseKeyId);
      }
    } catch (error) {
      this.logger.error(error.response?.data || error);
      return;
    }
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

  public async sendFollowUpStep(
    instance: any,
    session: IntegrationSession,
    settings: N8nSetting,
    n8n: N8n,
    funnel: { id: string; goal?: string | null; logic?: string | null; followUpEnable?: boolean | null },
    steps: Array<Record<string, any>>,
    stepIndex: number,
  ): Promise<boolean> {
    try {
      if (!session) return false;

      const endpoint: string = n8n.webhookUrl;
      const step = steps?.[stepIndex] || {};
      const nextStep = steps?.[stepIndex + 1] || null;
      const mergedPrompt = this.mergePrompt([n8n?.prompt || null, funnel?.goal || null, funnel?.logic || null]);
      const stageLabel = step?.stage ?? null;
      const touchLabel = step?.touch ?? null;
      const logicStage = step?.logicStage ?? null;
      const commonTouchCondition = step?.commonTouchCondition ?? null;
      const touchCondition = step?.condition ?? null;
      const objective = step?.objective ?? null;
      const title = step?.title ?? null;
      const systemFollowUpMessage =
        `Follow-up: продолжи диалог на этапе ${stageLabel ?? '—'}` +
        (touchLabel ? `, касание ${touchLabel}` : '') +
        `. Этап: ${commonTouchCondition || '—'}. Касание: ${touchCondition || '—'}.` +
        ` Логика: ${logicStage || '—'}. Цель: ${objective || '—'}.`;

      const payload: any = {
        event: 'followup',
        stage: stageLabel,
        touch: touchLabel,
        delayMin: step?.delayMin ?? null,
        condition: touchCondition,
        logicStage,
        commonTouchCondition,
        objective,
        title,
        nextStage: nextStep?.stage ?? null,
        nextTouch: nextStep?.touch ?? null,
        funnelId: funnel?.id || null,
        funnelEnable: session.funnelEnable ?? false,
        followUpEnable: session.followUpEnable ?? false,
        agentPrompt: mergedPrompt,
        chatInput: systemFollowUpMessage,
        sessionId: session.id,
        remoteJid: session.remoteJid,
        instanceName: instance.instanceName,
        instanceId: instance.instanceId,
        serverUrl: this.configService.get<HttpServer>('SERVER').URL,
        apiKey: instance.token,
      };

      const headers: Record<string, string> = {};
      if (n8n.basicAuthUser && n8n.basicAuthPass) {
        const auth = Buffer.from(`${n8n.basicAuthUser}:${n8n.basicAuthPass}`).toString('base64');
        headers['Authorization'] = `Basic ${auth}`;
      }

      this.logger.log(`[N8n] Sending follow-up step ${stepIndex + 1} to ${endpoint}`);
      const response = await axios.post(endpoint, payload, { headers, timeout: 60000 });
      this.logger.log(
        `[N8n] Follow-up response status: ${response?.status}, data: ${JSON.stringify(response?.data ?? {})}`,
      );
      const message = response?.data?.output || response?.data?.answer;

      await this.sendMessageWhatsApp(instance, session.remoteJid, message, settings, true, session, undefined, true);

      await this.prismaRepository.integrationSession.update({
        where: {
          id: session.id,
        },
        data: {
          status: 'opened',
          awaitUser: true,
        },
      });

      return true;
    } catch (error) {
      this.logger.error(error.response?.data || error);
      return false;
    }
  }
}
