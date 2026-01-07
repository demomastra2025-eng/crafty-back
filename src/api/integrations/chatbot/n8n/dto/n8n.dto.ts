import { BaseChatbotDto, BaseChatbotSettingDto } from '../../base-chatbot.dto';

export class N8nDto extends BaseChatbotDto {
  // N8n specific fields
  webhookUrl?: string | null;
  basicAuthUser?: string;
  basicAuthPass?: string;
  funnelId?: string | null;
  prompt?: string;
}

export class N8nSettingDto extends BaseChatbotSettingDto {
  // N8n has no specific fields
}

export class N8nMessageDto {
  chatInput: string;
  sessionId: string;
}

export class N8nEmitDto {
  remoteJid: string;
}
