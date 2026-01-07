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

  public async sendTemplate({ instanceName }: InstanceDto, data: SendTemplateDto) {
    const response = await this.waMonitor.waInstances[instanceName].templateMessage(data);
    return response;
  }

  public async sendText({ instanceName }: InstanceDto, data: SendTextDto) {
    const response = await this.waMonitor.waInstances[instanceName].textMessage(data);
    return response;
  }

  public async sendMedia({ instanceName }: InstanceDto, data: SendMediaDto, file?: any) {
    if (isBase64(data?.media) && !data?.fileName && data?.mediatype === 'document') {
      throw new BadRequestException('For base64 the file name must be informed.');
    }

    if (file || isURL(data?.media) || isBase64(data?.media)) {
      const response = await this.waMonitor.waInstances[instanceName].mediaMessage(data, file);
      return response;
    }
    throw new BadRequestException('Owned media must be a url or base64');
  }

  public async sendMediaGroup({ instanceName }: InstanceDto, data: SendMediaGroupDto) {
    const instance = this.waMonitor.waInstances[instanceName];
    if (!instance?.mediaGroupMessage) {
      throw new BadRequestException('Method not available on this integration');
    }
    const response = await instance.mediaGroupMessage(data);
    return response;
  }

  public async sendPtv({ instanceName }: InstanceDto, data: SendPtvDto, file?: any) {
    if (file || isURL(data?.video) || isBase64(data?.video)) {
      const response = await this.waMonitor.waInstances[instanceName].ptvMessage(data, file);
      return response;
    }
    throw new BadRequestException('Owned media must be a url or base64');
  }

  public async sendSticker({ instanceName }: InstanceDto, data: SendStickerDto, file?: any) {
    if (file || isURL(data.sticker) || isBase64(data.sticker)) {
      const response = await this.waMonitor.waInstances[instanceName].mediaSticker(data, file);
      return response;
    }
    throw new BadRequestException('Owned media must be a url or base64');
  }

  public async sendWhatsAppAudio({ instanceName }: InstanceDto, data: SendAudioDto, file?: any) {
    if (file?.buffer || isURL(data.audio) || isBase64(data.audio)) {
      // Si file existe y tiene buffer, o si es una URL o Base64, continúa
      const response = await this.waMonitor.waInstances[instanceName].audioWhatsapp(data, file);
      return response;
    } else {
      console.error('El archivo no tiene buffer o el audio no es una URL o Base64 válida');
      throw new BadRequestException('Owned media must be a url, base64, or valid file with buffer');
    }
  }

  public async sendButtons({ instanceName }: InstanceDto, data: SendButtonsDto) {
    const response = await this.waMonitor.waInstances[instanceName].buttonMessage(data);
    return response;
  }

  public async sendLocation({ instanceName }: InstanceDto, data: SendLocationDto) {
    const response = await this.waMonitor.waInstances[instanceName].locationMessage(data);
    return response;
  }

  public async sendList({ instanceName }: InstanceDto, data: SendListDto) {
    const response = await this.waMonitor.waInstances[instanceName].listMessage(data);
    return response;
  }

  public async sendContact({ instanceName }: InstanceDto, data: SendContactDto) {
    const response = await this.waMonitor.waInstances[instanceName].contactMessage(data);
    return response;
  }

  public async sendReaction({ instanceName }: InstanceDto, data: SendReactionDto) {
    if (!isEmoji(data.reaction)) {
      throw new BadRequestException('Reaction must be a single emoji or empty string');
    }
    const response = await this.waMonitor.waInstances[instanceName].reactionMessage(data);
    return response;
  }

  public async sendPoll({ instanceName }: InstanceDto, data: SendPollDto) {
    const response = await this.waMonitor.waInstances[instanceName].pollMessage(data);
    return response;
  }

  public async sendStatus({ instanceName }: InstanceDto, data: SendStatusDto, file?: any) {
    const response = await this.waMonitor.waInstances[instanceName].statusMessage(data, file);
    return response;
  }
}
