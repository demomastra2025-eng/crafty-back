import { InstanceDto } from '@api/dto/instance.dto';
import {
  SendAudioDto,
  SendButtonsDto,
  SendContactDto,
  SendListDto,
  SendLocationDto,
  SendMediaDto,
  SendMediaGroupDto,
  SendPollDto,
  SendPtvDto,
  SendReactionDto,
  SendStatusDto,
  SendStickerDto,
  SendTemplateDto,
  SendTextDto,
} from '@api/dto/sendMessage.dto';
import { WAMonitoringService } from '@api/services/monitor.service';
import { BadRequestException } from '@exceptions';
import { isBase64, isURL } from 'class-validator';
import emojiRegex from 'emoji-regex';

const regex = emojiRegex();

function isEmoji(str: string) {
  if (str === '') return true;

  const match = str.match(regex);
  return match?.length === 1 && match[0] === str;
}

export class SendMessageController {
  constructor(private readonly waMonitor: WAMonitoringService) {}

  private applyAuthor<T extends { author?: string }>(data: T, author?: string): T {
    if (author) data.author = author;
    return data;
  }

  private async cacheOutboundAuthor(instanceName: string, response: any, author?: string) {
    if (!author) return;
    const instance = this.waMonitor.waInstances[instanceName];
    const instanceId = instance?.instanceId;
    if (!instanceId) return;

    const collectIds = (value: any): string[] => {
      if (!value) return [];
      if (Array.isArray(value)) return value.flatMap((item) => collectIds(item));
      const keyId = value?.key?.id || value?.message?.key?.id || value?.messageId;
      return keyId ? [keyId] : [];
    };

    const ids = collectIds(response);
    if (!ids.length) return;
    await Promise.all(ids.map((id) => this.waMonitor.cacheMessageAuthor(instanceId, id, author)));
  }

  public async sendTemplate({ instanceName }: InstanceDto, data: SendTemplateDto, author?: string) {
    this.applyAuthor(data, author);
    const response = await this.waMonitor.waInstances[instanceName].templateMessage(data);
    await this.cacheOutboundAuthor(instanceName, response, author);
    return response;
  }

  public async sendText({ instanceName }: InstanceDto, data: SendTextDto, author?: string) {
    this.applyAuthor(data, author);
    const response = await this.waMonitor.waInstances[instanceName].textMessage(data);
    await this.cacheOutboundAuthor(instanceName, response, author);
    return response;
  }

  public async sendMedia({ instanceName }: InstanceDto, data: SendMediaDto, file?: any, author?: string) {
    this.applyAuthor(data, author);
    if (isBase64(data?.media) && !data?.fileName && data?.mediatype === 'document') {
      throw new BadRequestException('For base64 the file name must be informed.');
    }

    if (file || isURL(data?.media) || isBase64(data?.media)) {
      const response = await this.waMonitor.waInstances[instanceName].mediaMessage(data, file);
      await this.cacheOutboundAuthor(instanceName, response, author);
      return response;
    }
    throw new BadRequestException('Owned media must be a url or base64');
  }

  public async sendMediaGroup({ instanceName }: InstanceDto, data: SendMediaGroupDto, author?: string) {
    this.applyAuthor(data, author);
    const instance = this.waMonitor.waInstances[instanceName];
    if (!instance?.mediaGroupMessage) {
      throw new BadRequestException('Method not available on this integration');
    }
    const response = await instance.mediaGroupMessage(data);
    await this.cacheOutboundAuthor(instanceName, response, author);
    return response;
  }

  public async sendPtv({ instanceName }: InstanceDto, data: SendPtvDto, file?: any, author?: string) {
    this.applyAuthor(data, author);
    if (file || isURL(data?.video) || isBase64(data?.video)) {
      const response = await this.waMonitor.waInstances[instanceName].ptvMessage(data, file);
      await this.cacheOutboundAuthor(instanceName, response, author);
      return response;
    }
    throw new BadRequestException('Owned media must be a url or base64');
  }

  public async sendSticker({ instanceName }: InstanceDto, data: SendStickerDto, file?: any, author?: string) {
    this.applyAuthor(data, author);
    if (file || isURL(data.sticker) || isBase64(data.sticker)) {
      const response = await this.waMonitor.waInstances[instanceName].mediaSticker(data, file);
      await this.cacheOutboundAuthor(instanceName, response, author);
      return response;
    }
    throw new BadRequestException('Owned media must be a url or base64');
  }

  public async sendWhatsAppAudio({ instanceName }: InstanceDto, data: SendAudioDto, file?: any, author?: string) {
    this.applyAuthor(data, author);
    if (file?.buffer || isURL(data.audio) || isBase64(data.audio)) {
      // Si file existe y tiene buffer, o si es una URL o Base64, continúa
      const response = await this.waMonitor.waInstances[instanceName].audioWhatsapp(data, file);
      await this.cacheOutboundAuthor(instanceName, response, author);
      return response;
    } else {
      console.error('El archivo no tiene buffer o el audio no es una URL o Base64 válida');
      throw new BadRequestException('Owned media must be a url, base64, or valid file with buffer');
    }
  }

  public async sendButtons({ instanceName }: InstanceDto, data: SendButtonsDto, author?: string) {
    this.applyAuthor(data, author);
    const response = await this.waMonitor.waInstances[instanceName].buttonMessage(data);
    await this.cacheOutboundAuthor(instanceName, response, author);
    return response;
  }

  public async sendLocation({ instanceName }: InstanceDto, data: SendLocationDto, author?: string) {
    this.applyAuthor(data, author);
    const response = await this.waMonitor.waInstances[instanceName].locationMessage(data);
    await this.cacheOutboundAuthor(instanceName, response, author);
    return response;
  }

  public async sendList({ instanceName }: InstanceDto, data: SendListDto, author?: string) {
    this.applyAuthor(data, author);
    const response = await this.waMonitor.waInstances[instanceName].listMessage(data);
    await this.cacheOutboundAuthor(instanceName, response, author);
    return response;
  }

  public async sendContact({ instanceName }: InstanceDto, data: SendContactDto, author?: string) {
    this.applyAuthor(data, author);
    const response = await this.waMonitor.waInstances[instanceName].contactMessage(data);
    await this.cacheOutboundAuthor(instanceName, response, author);
    return response;
  }

  public async sendReaction({ instanceName }: InstanceDto, data: SendReactionDto, author?: string) {
    void author;
    if (!isEmoji(data.reaction)) {
      throw new BadRequestException('Reaction must be a single emoji or empty string');
    }
    const response = await this.waMonitor.waInstances[instanceName].reactionMessage(data);
    await this.cacheOutboundAuthor(instanceName, response, author);
    return response;
  }

  public async sendPoll({ instanceName }: InstanceDto, data: SendPollDto, author?: string) {
    this.applyAuthor(data, author);
    const response = await this.waMonitor.waInstances[instanceName].pollMessage(data);
    await this.cacheOutboundAuthor(instanceName, response, author);
    return response;
  }

  public async sendStatus({ instanceName }: InstanceDto, data: SendStatusDto, file?: any, author?: string) {
    this.applyAuthor(data, author);
    const response = await this.waMonitor.waInstances[instanceName].statusMessage(data, file);
    await this.cacheOutboundAuthor(instanceName, response, author);
    return response;
  }
}
