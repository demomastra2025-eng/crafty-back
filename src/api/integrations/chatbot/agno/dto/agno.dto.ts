import { BaseChatbotDto, BaseChatbotSettingDto } from '../../base-chatbot.dto';

export class AgnoDto extends BaseChatbotDto {
  prompt?: string;
  agentId?: string;
  agentConfig?: Record<string, any> | null;
  webhookUrl?: string | null;
  providerModel?: string | null;
  agnoPort?: number;
  funnelId?: string;
}

export class AgnoSettingDto extends BaseChatbotSettingDto {
  agnoIdFallback?: string;
}

export class AgnoEmitDto {
  remoteJid: string;
}
