import {
  SendAudioDto,
  SendButtonsDto,
  SendContactDto,
  SendListDto,
  SendLocationDto,
  SendMediaDto,
  SendMediaGroupDto,
  SendPtvDto,
  SendReactionDto,
  SendTemplateDto,
  SendTextDto,
} from '@api/dto/sendMessage.dto';
import * as s3Service from '@api/integrations/storage/s3/libs/minio.server';
import { ProviderFiles } from '@api/provider/sessions';
import { PrismaRepository } from '@api/repository/repository.service';
import { chatbotController } from '@api/server.module';
import { CacheService } from '@api/services/cache.service';
import { ChannelStartupService } from '@api/services/channel.service';
import { Events, wa } from '@api/types/wa.types';
import { Chatwoot, ConfigService, Database, Openai, S3, TelegramBot } from '@config/env.config';
import { BadRequestException } from '@exceptions';
import { status } from '@utils/renderStatus';
import { sendTelemetry } from '@utils/sendTelemetry';
import axios from 'axios';
import { isBase64, isURL } from 'class-validator';
import EventEmitter2 from 'eventemitter2';
import FormData from 'form-data';
import mimeTypes from 'mime-types';
import { join } from 'path';

type TelegramUpdate = {
  update_id?: number;
  message?: any;
  edited_message?: any;
  channel_post?: any;
  edited_channel_post?: any;
  callback_query?: any;
};

export class TelegramBotStartupService extends ChannelStartupService {
  constructor(
    public readonly configService: ConfigService,
    public readonly eventEmitter: EventEmitter2,
    public readonly prismaRepository: PrismaRepository,
    public readonly cache: CacheService,
    public readonly chatwootCache: CacheService,
    public readonly baileysCache: CacheService,
    private readonly providerFiles: ProviderFiles,
  ) {
    super(configService, eventEmitter, prismaRepository, chatwootCache);
  }

  public stateConnection: wa.StateConnection = { state: 'open' };
  private botProfileName: string | null = null;

  public get connectionStatus() {
    return this.stateConnection;
  }

  public async closeClient() {
    this.stateConnection = { state: 'close' };
  }

  public get qrCode(): wa.QrCode {
    return {
      pairingCode: this.instance.qrcode?.pairingCode,
      code: this.instance.qrcode?.code,
      base64: this.instance.qrcode?.base64,
      count: this.instance.qrcode?.count,
    };
  }

  public async logoutInstance() {
    await this.closeClient();
  }

  private get apiBaseUrl() {
    return this.configService.get<TelegramBot>('TELEGRAM_BOT').URL || 'https://api.telegram.org';
  }

  private get fileBaseUrl() {
    return `${this.apiBaseUrl}/file/bot${this.token}`;
  }

  private async apiRequest<T = any>(method: string, payload: any) {
    const url = `${this.apiBaseUrl}/bot${this.token}/${method}`;
    const response = await axios.post(url, payload);
    return response.data as T;
  }

  private async apiRequestForm<T = any>(method: string, form: FormData) {
    const url = `${this.apiBaseUrl}/bot${this.token}/${method}`;
    const response = await axios.post(url, form, { headers: form.getHeaders() });
    return response.data as T;
  }

  private async ensureBotProfileName() {
    if (this.botProfileName) return;
    try {
      const result = await this.apiRequest<{ ok: boolean; result?: { first_name?: string; username?: string } }>(
        'getMe',
        {},
      );
      const name = result?.result?.first_name || result?.result?.username;
      if (name) {
        this.botProfileName = name;
        this.instance.profileName = name;
      }
    } catch (error) {
      this.logger.debug(`Telegram getMe failed: ${error}`);
    }
  }

  private async sendChatAction(chatId: string, action: string) {
    try {
      await this.apiRequest('sendChatAction', { chat_id: chatId, action });
    } catch (error) {
      this.logger.debug(`Telegram sendChatAction failed: ${error}`);
    }
  }

  private normalizeRemoteJid(chatId: number | string) {
    return `${chatId}@telegram`;
  }

  private normalizeChatId(chatId: number | string) {
    return String(chatId).split('@')[0];
  }

  private async ensureChat(remoteJid: string, name: string | null, fromMe: boolean) {
    if (!remoteJid) return;
    const existingChat = await this.prismaRepository.chat.findFirst({
      where: { instanceId: this.instanceId, remoteJid },
    });

    if (existingChat) return;

    const chatRaw = {
      remoteJid,
      instanceId: this.instanceId,
      name: name || undefined,
      unreadMessages: fromMe ? 0 : 1,
    };

    this.sendDataWebhook(Events.CHATS_UPSERT, [chatRaw]);

    if (this.configService.get<Database>('DATABASE').SAVE_DATA.CHATS) {
      await this.prismaRepository.chat.create({ data: chatRaw });
    }
  }

  private async getFileUrl(fileId: string): Promise<string | null> {
    try {
      const result = await this.apiRequest<{ ok: boolean; result?: { file_path?: string } }>('getFile', {
        file_id: fileId,
      });
      if (!result?.ok || !result.result?.file_path) {
        return null;
      }
      return `${this.fileBaseUrl}/${result.result.file_path}`;
    } catch (error) {
      this.logger.error(`Telegram getFile failed: ${error}`);
      return null;
    }
  }

  private async downloadFile(url: string): Promise<Buffer | null> {
    try {
      const response = await axios.get(url, { responseType: 'arraybuffer' });
      return Buffer.from(response.data);
    } catch (error) {
      this.logger.error(`Telegram file download failed: ${error}`);
      return null;
    }
  }

  private async handleIncomingMedia(
    fileId: string,
    mediaType: 'image' | 'video' | 'audio' | 'document' | 'sticker',
    messageRaw: any,
  ): Promise<boolean> {
    const fileUrl = await this.getFileUrl(fileId);
    if (!fileUrl) {
      return false;
    }

    let createdMessageId: string | undefined;

    if (this.configService.get<S3>('S3').ENABLE) {
      const buffer = await this.downloadFile(fileUrl);
      if (!buffer) return false;

      const mimeType = mimeTypes.lookup(fileUrl) || 'application/octet-stream';
      const extension = mimeTypes.extension(mimeType) || 'bin';
      const fileName = `${messageRaw.key.id}.${extension}`;
      const fullName = join(`${this.instance.id}`, messageRaw.key.remoteJid, mediaType, fileName);

      await s3Service.uploadFile(fullName, buffer, buffer.length, { 'Content-Type': mimeType });

      messageRaw.message.mediaUrl = await s3Service.getObjectUrl(fullName);
      if (this.localWebhook.enabled && this.localWebhook.webhookBase64) {
        messageRaw.message.base64 = buffer.toString('base64');
      }

      const createdMessage = await this.prismaRepository.message.create({ data: messageRaw });
      createdMessageId = createdMessage.id;
      await this.prismaRepository.media.create({
        data: {
          messageId: createdMessage.id,
          instanceId: this.instanceId,
          type: mediaType,
          fileName: fullName,
          mimetype: mimeType.toString(),
        },
      });
    } else {
      messageRaw.message.mediaUrl = fileUrl;
      if (this.localWebhook.enabled && this.localWebhook.webhookBase64) {
        const buffer = await this.downloadFile(fileUrl);
        if (buffer) {
          messageRaw.message.base64 = buffer.toString('base64');
        }
      }
    }

    if (this.configService.get<Openai>('OPENAI').ENABLED) {
      if (mediaType === 'audio') {
        try {
          const transcription = await this.openaiService.speechToTextSystem(messageRaw, this);
          if (transcription) {
            messageRaw.message.speechToText = `[audio] ${transcription}`;
          }
        } catch (error) {
          this.logger.error(`OpenAI audio processing failed: ${error}`);
        }
      }
      if (mediaType === 'image') {
        try {
          const caption = await this.openaiService.describeImageSystem(messageRaw, this);
          if (caption) {
            messageRaw.message.imageCaption = caption;
          }
        } catch (error) {
          this.logger.error(`OpenAI image processing failed: ${error}`);
        }
      }
    }

    if (createdMessageId) {
      await this.prismaRepository.message.update({
        where: { id: createdMessageId },
        data: messageRaw,
      });
      return true;
    }

    return false;
  }

  protected async messageHandle(update: TelegramUpdate) {
    try {
      const message =
        update.message || update.edited_message || update.channel_post || update.edited_channel_post || null;
      const callbackQuery = update.callback_query;
      const isEdited = Boolean(update.edited_message || update.edited_channel_post);
      const eventName = isEdited ? Events.MESSAGES_EDITED : Events.MESSAGES_UPSERT;

      if (!message && !callbackQuery) {
        return;
      }

      const chat = message?.chat || callbackQuery?.message?.chat;
      const from = message?.from || callbackQuery?.from;
      const chatId = chat?.id;

      if (!chatId) {
        return;
      }

      const remoteJid = this.normalizeRemoteJid(chatId);
      const pushName = [from?.first_name, from?.last_name].filter(Boolean).join(' ') || from?.username || '';

      const messageRaw: any = {
        key: {
          id: String(message?.message_id || callbackQuery?.message?.message_id || update.update_id),
          remoteJid,
          fromMe: false,
        },
        pushName,
        messageTimestamp: message?.date || Math.round(Date.now() / 1000),
        source: 'unknown',
        status: status[2],
        instanceId: this.instanceId,
      };

      if (callbackQuery?.id) {
        await this.apiRequest('answerCallbackQuery', { callback_query_id: callbackQuery.id });
      }

      let messageStored = false;

      if (callbackQuery?.data) {
        messageRaw.message = { conversation: callbackQuery.data };
        messageRaw.messageType = 'conversation';
      } else if (message?.text) {
        messageRaw.message = { conversation: message.text };
        messageRaw.messageType = 'conversation';
      } else if (message?.photo?.length) {
        const photo = message.photo[message.photo.length - 1];
        messageRaw.message = {
          imageMessage: { fileId: photo.file_id, caption: message.caption || '' },
        };
        messageRaw.messageType = 'imageMessage';
        messageStored = await this.handleIncomingMedia(photo.file_id, 'image', messageRaw);
      } else if (message?.video) {
        messageRaw.message = {
          videoMessage: { fileId: message.video.file_id, caption: message.caption || '' },
        };
        messageRaw.messageType = 'videoMessage';
        messageStored = await this.handleIncomingMedia(message.video.file_id, 'video', messageRaw);
      } else if (message?.audio) {
        messageRaw.message = {
          audioMessage: { fileId: message.audio.file_id },
        };
        messageRaw.messageType = 'audioMessage';
        messageStored = await this.handleIncomingMedia(message.audio.file_id, 'audio', messageRaw);
      } else if (message?.voice) {
        messageRaw.message = {
          audioMessage: { fileId: message.voice.file_id },
        };
        messageRaw.messageType = 'audioMessage';
        messageStored = await this.handleIncomingMedia(message.voice.file_id, 'audio', messageRaw);
      } else if (message?.document) {
        const mimeType = message.document.mime_type || '';
        const isImageDoc = mimeType.startsWith('image/');

        if (isImageDoc) {
          messageRaw.message = {
            imageMessage: { fileId: message.document.file_id, caption: message.caption || '' },
          };
          messageRaw.messageType = 'imageMessage';
          messageStored = await this.handleIncomingMedia(message.document.file_id, 'image', messageRaw);
        } else {
          messageRaw.message = {
            documentMessage: { fileId: message.document.file_id, caption: message.caption || '' },
          };
          messageRaw.messageType = 'documentMessage';
          messageStored = await this.handleIncomingMedia(message.document.file_id, 'document', messageRaw);
        }
      } else if (message?.sticker) {
        messageRaw.message = {
          stickerMessage: { fileId: message.sticker.file_id },
        };
        messageRaw.messageType = 'stickerMessage';
        messageStored = await this.handleIncomingMedia(message.sticker.file_id, 'sticker', messageRaw);
      } else if (message?.location) {
        messageRaw.message = {
          locationMessage: {
            degreesLatitude: message.location.latitude,
            degreesLongitude: message.location.longitude,
          },
        };
        messageRaw.messageType = 'locationMessage';
      } else if (message?.contact) {
        messageRaw.message = {
          contactMessage: {
            displayName: `${message.contact.first_name || ''} ${message.contact.last_name || ''}`.trim(),
          },
        };
        messageRaw.messageType = 'contactMessage';
      } else {
        messageRaw.message = { conversation: '[unsupported]' };
        messageRaw.messageType = 'conversation';
      }

      sendTelemetry(`received.message.${messageRaw.messageType ?? 'unknown'}`);

      if (isEdited && this.configService.get<Chatwoot>('CHATWOOT').ENABLED && this.localChatwoot?.enabled) {
        this.chatwootService.eventWhatsapp(
          'messages.edit',
          { instanceName: this.instance.name, instanceId: this.instanceId },
          messageRaw,
        );
      }

      this.sendDataWebhook(eventName, messageRaw);

      await chatbotController.emit({
        instance: { instanceName: this.instance.name, instanceId: this.instanceId },
        remoteJid: messageRaw.key.remoteJid,
        msg: messageRaw,
        pushName: messageRaw.pushName,
      });

      if (this.configService.get<Chatwoot>('CHATWOOT').ENABLED && this.localChatwoot?.enabled) {
        const chatwootSentMessage = await this.chatwootService.eventWhatsapp(
          Events.MESSAGES_UPSERT,
          { instanceName: this.instance.name, instanceId: this.instanceId },
          messageRaw,
        );

        if (chatwootSentMessage?.id) {
          messageRaw.chatwootMessageId = chatwootSentMessage.id;
          messageRaw.chatwootInboxId = chatwootSentMessage.id;
          messageRaw.chatwootConversationId = chatwootSentMessage.id;
        }
      }

      if (!messageStored) {
        await this.prismaRepository.message.create({ data: messageRaw });
      }

      await this.ensureChat(remoteJid, pushName || null, false);

      const contactRaw = {
        remoteJid,
        pushName,
        instanceId: this.instanceId,
      };

      this.sendDataWebhook(Events.CONTACTS_UPSERT, contactRaw);

      if (this.configService.get<Chatwoot>('CHATWOOT').ENABLED && this.localChatwoot?.enabled) {
        await this.chatwootService.eventWhatsapp(
          Events.CONTACTS_UPSERT,
          { instanceName: this.instance.name, instanceId: this.instanceId },
          contactRaw,
        );
      }

      if (this.configService.get<Database>('DATABASE').SAVE_DATA.CONTACTS) {
        await this.prismaRepository.contact.upsert({
          where: { remoteJid_instanceId: { remoteJid: contactRaw.remoteJid, instanceId: contactRaw.instanceId } },
          create: contactRaw,
          update: contactRaw,
        });
      }
    } catch (error) {
      this.logger.error(error);
    }
  }

  public async connectToWhatsapp(data?: TelegramUpdate): Promise<any> {
    if (!data) return;
    try {
      this.loadChatwoot();
      this.loadSettings();
      this.loadWebhook();
      await this.ensureBotProfileName();
      await this.messageHandle(data);
    } catch (error) {
      this.logger.error(error);
      throw new BadRequestException(error?.toString());
    }
  }

  public async textMessage(data: SendTextDto, isIntegration = false) {
    try {
      const chatId = this.normalizeChatId(data.number);
      await this.ensureBotProfileName();
      await this.sendChatAction(chatId, 'typing');
      const result = await this.apiRequest<any>('sendMessage', {
        chat_id: chatId,
        text: data.text,
        parse_mode: data.parseMode,
        disable_web_page_preview: data.linkPreview === false,
      });

      const messageRaw: any = {
        key: { fromMe: true, id: String(result?.result?.message_id), remoteJid: this.normalizeRemoteJid(chatId) },
        pushName: this.botProfileName || this.instance.profileName || undefined,
        message: { conversation: data.text },
        messageType: 'conversation',
        messageTimestamp: result?.result?.date || Math.round(Date.now() / 1000),
        instanceId: this.instanceId,
        status: status[1],
        source: 'unknown',
      };

      this.sendDataWebhook(Events.SEND_MESSAGE, messageRaw);

      if (this.configService.get<Chatwoot>('CHATWOOT').ENABLED && this.localChatwoot?.enabled && !isIntegration) {
        this.chatwootService.eventWhatsapp(
          Events.SEND_MESSAGE,
          { instanceName: this.instance.name, instanceId: this.instanceId },
          messageRaw,
        );
      }

      if (this.configService.get<Chatwoot>('CHATWOOT').ENABLED && this.localChatwoot?.enabled && isIntegration) {
        await chatbotController.emit({
          instance: { instanceName: this.instance.name, instanceId: this.instanceId },
          remoteJid: messageRaw.key.remoteJid,
          msg: messageRaw,
          pushName: messageRaw.pushName,
        });
      }

      await this.prismaRepository.message.create({ data: messageRaw });
      await this.ensureChat(messageRaw.key.remoteJid, this.botProfileName || null, true);

      return messageRaw;
    } catch (error) {
      this.logger.error(error);
      throw new BadRequestException(error?.toString());
    }
  }

  public async mediaMessage(data: SendMediaDto, file?: any, isIntegration = false) {
    const chatId = this.normalizeChatId(data.number);
    const caption = data.caption || '';
    const parseMode = data.parseMode;
    await this.ensureBotProfileName();

    if (data.mediatype === 'image') {
      await this.sendChatAction(chatId, 'upload_photo');
    } else if (data.mediatype === 'video') {
      await this.sendChatAction(chatId, 'upload_video');
    } else if (data.mediatype === 'audio') {
      await this.sendChatAction(chatId, 'upload_audio');
    } else {
      await this.sendChatAction(chatId, 'upload_document');
    }

    const sendWithUrl = async (method: string, field: string, url: string) => {
      return await this.apiRequest<any>(method, { chat_id: chatId, caption, parse_mode: parseMode, [field]: url });
    };

    const sendWithBuffer = async (method: string, field: string, buffer: Buffer, filename: string) => {
      const form = new FormData();
      form.append('chat_id', chatId);
      if (caption) form.append('caption', caption);
      if (parseMode) form.append('parse_mode', parseMode);
      form.append(field, buffer, { filename });
      return await this.apiRequestForm<any>(method, form);
    };

    const mediaType = data.mediatype;
    let method = 'sendDocument';
    let field = 'document';

    if (mediaType === 'image') {
      method = 'sendPhoto';
      field = 'photo';
    } else if (mediaType === 'video') {
      method = 'sendVideo';
      field = 'video';
    } else if (mediaType === 'audio') {
      method = 'sendAudio';
      field = 'audio';
    } else if (mediaType === 'document') {
      method = 'sendDocument';
      field = 'document';
    }

    let result: any;
    if (file?.buffer) {
      const filename = data.fileName || file.originalname || `file.${mediaType}`;
      result = await sendWithBuffer(method, field, file.buffer, filename);
    } else if (isURL(data.media)) {
      result = await sendWithUrl(method, field, data.media);
    } else if (isBase64(data.media)) {
      const buffer = Buffer.from(data.media, 'base64');
      const filename = data.fileName || `file.${mediaType}`;
      result = await sendWithBuffer(method, field, buffer, filename);
    } else {
      throw new BadRequestException('Owned media must be a url or base64');
    }

    const messageRaw: any = {
      key: { fromMe: true, id: String(result?.result?.message_id), remoteJid: this.normalizeRemoteJid(chatId) },
      pushName: this.botProfileName || this.instance.profileName || undefined,
      messageTimestamp: result?.result?.date || Math.round(Date.now() / 1000),
      instanceId: this.instanceId,
      status: status[1],
      source: 'unknown',
    };

    if (mediaType === 'image') {
      messageRaw.message = { imageMessage: { caption } };
      messageRaw.messageType = 'imageMessage';
    } else if (mediaType === 'video') {
      messageRaw.message = { videoMessage: { caption } };
      messageRaw.messageType = 'videoMessage';
    } else if (mediaType === 'audio') {
      messageRaw.message = { audioMessage: {} };
      messageRaw.messageType = 'audioMessage';
    } else {
      messageRaw.message = { documentMessage: { caption } };
      messageRaw.messageType = 'documentMessage';
    }

    this.sendDataWebhook(Events.SEND_MESSAGE, messageRaw);

    if (this.configService.get<Chatwoot>('CHATWOOT').ENABLED && this.localChatwoot?.enabled && !isIntegration) {
      this.chatwootService.eventWhatsapp(
        Events.SEND_MESSAGE,
        { instanceName: this.instance.name, instanceId: this.instanceId },
        messageRaw,
      );
    }

    if (this.configService.get<Chatwoot>('CHATWOOT').ENABLED && this.localChatwoot?.enabled && isIntegration) {
      await chatbotController.emit({
        instance: { instanceName: this.instance.name, instanceId: this.instanceId },
        remoteJid: messageRaw.key.remoteJid,
        msg: messageRaw,
        pushName: messageRaw.pushName,
      });
    }

    await this.prismaRepository.message.create({ data: messageRaw });
    await this.ensureChat(messageRaw.key.remoteJid, this.botProfileName || null, true);

    return messageRaw;
  }

  public async audioWhatsapp(data: SendAudioDto, file?: any, isIntegration = false) {
    const chatId = this.normalizeChatId(data.number);
    await this.ensureBotProfileName();
    await this.sendChatAction(chatId, 'record_voice');
    const sendVoice = async (buffer: Buffer, filename: string) => {
      const form = new FormData();
      form.append('chat_id', chatId);
      form.append('voice', buffer, { filename });
      return await this.apiRequestForm<any>('sendVoice', form);
    };

    let result: any;
    if (file?.buffer) {
      result = await sendVoice(file.buffer, file.originalname || 'voice.ogg');
    } else if (isURL(data.audio)) {
      result = await this.apiRequest<any>('sendVoice', { chat_id: chatId, voice: data.audio });
    } else if (isBase64(data.audio)) {
      const buffer = Buffer.from(data.audio, 'base64');
      result = await sendVoice(buffer, 'voice.ogg');
    } else {
      throw new BadRequestException('Owned media must be a url, base64, or valid file with buffer');
    }

    const messageRaw: any = {
      key: { fromMe: true, id: String(result?.result?.message_id), remoteJid: this.normalizeRemoteJid(chatId) },
      pushName: this.botProfileName || this.instance.profileName || undefined,
      message: { audioMessage: {} },
      messageType: 'audioMessage',
      messageTimestamp: result?.result?.date || Math.round(Date.now() / 1000),
      instanceId: this.instanceId,
      status: status[1],
      source: 'unknown',
    };

    this.sendDataWebhook(Events.SEND_MESSAGE, messageRaw);

    if (this.configService.get<Chatwoot>('CHATWOOT').ENABLED && this.localChatwoot?.enabled && !isIntegration) {
      this.chatwootService.eventWhatsapp(
        Events.SEND_MESSAGE,
        { instanceName: this.instance.name, instanceId: this.instanceId },
        messageRaw,
      );
    }

    if (this.configService.get<Chatwoot>('CHATWOOT').ENABLED && this.localChatwoot?.enabled && isIntegration) {
      await chatbotController.emit({
        instance: { instanceName: this.instance.name, instanceId: this.instanceId },
        remoteJid: messageRaw.key.remoteJid,
        msg: messageRaw,
        pushName: messageRaw.pushName,
      });
    }

    await this.prismaRepository.message.create({ data: messageRaw });
    await this.ensureChat(messageRaw.key.remoteJid, this.botProfileName || null, true);

    return messageRaw;
  }

  public async ptvMessage(data: SendPtvDto, file?: any) {
    const chatId = this.normalizeChatId(data.number);
    await this.ensureBotProfileName();
    await this.sendChatAction(chatId, 'record_video');
    const sendVideoNote = async (buffer: Buffer, filename: string) => {
      const form = new FormData();
      form.append('chat_id', chatId);
      form.append('video_note', buffer, { filename });
      return await this.apiRequestForm<any>('sendVideoNote', form);
    };

    let result: any;
    if (file?.buffer) {
      result = await sendVideoNote(file.buffer, file.originalname || 'video_note.mp4');
    } else if (isURL(data.video)) {
      result = await this.apiRequest<any>('sendVideoNote', { chat_id: chatId, video_note: data.video });
    } else if (isBase64(data.video)) {
      const buffer = Buffer.from(data.video, 'base64');
      result = await sendVideoNote(buffer, 'video_note.mp4');
    } else {
      throw new BadRequestException('Owned media must be a url or base64');
    }

    const messageRaw: any = {
      key: { fromMe: true, id: String(result?.result?.message_id), remoteJid: this.normalizeRemoteJid(chatId) },
      pushName: this.botProfileName || this.instance.profileName || undefined,
      message: { ptvMessage: {} },
      messageType: 'ptvMessage',
      messageTimestamp: result?.result?.date || Math.round(Date.now() / 1000),
      instanceId: this.instanceId,
      status: status[1],
      source: 'unknown',
    };

    this.sendDataWebhook(Events.SEND_MESSAGE, messageRaw);

    if (this.configService.get<Chatwoot>('CHATWOOT').ENABLED && this.localChatwoot?.enabled) {
      this.chatwootService.eventWhatsapp(
        Events.SEND_MESSAGE,
        { instanceName: this.instance.name, instanceId: this.instanceId },
        messageRaw,
      );
    }

    await this.prismaRepository.message.create({ data: messageRaw });
    await this.ensureChat(messageRaw.key.remoteJid, this.botProfileName || null, true);

    return messageRaw;
  }

  public async contactMessage(data: SendContactDto) {
    const [contact] = data.contact || [];
    if (!contact) {
      throw new BadRequestException('Contact is required');
    }

    const chatId = this.normalizeChatId(data.number);
    await this.ensureBotProfileName();
    await this.sendChatAction(chatId, 'typing');
    const result = await this.apiRequest<any>('sendContact', {
      chat_id: chatId,
      phone_number: contact.phoneNumber,
      first_name: contact.fullName,
    });

    const messageRaw: any = {
      key: { fromMe: true, id: String(result?.result?.message_id), remoteJid: this.normalizeRemoteJid(chatId) },
      pushName: this.botProfileName || this.instance.profileName || undefined,
      message: { contactMessage: { displayName: contact.fullName } },
      messageType: 'contactMessage',
      messageTimestamp: result?.result?.date || Math.round(Date.now() / 1000),
      instanceId: this.instanceId,
      status: status[1],
      source: 'unknown',
    };

    this.sendDataWebhook(Events.SEND_MESSAGE, messageRaw);

    if (this.configService.get<Chatwoot>('CHATWOOT').ENABLED && this.localChatwoot?.enabled) {
      this.chatwootService.eventWhatsapp(
        Events.SEND_MESSAGE,
        { instanceName: this.instance.name, instanceId: this.instanceId },
        messageRaw,
      );
    }

    await this.prismaRepository.message.create({ data: messageRaw });
    await this.ensureChat(messageRaw.key.remoteJid, this.botProfileName || null, true);

    return messageRaw;
  }

  public async locationMessage(data: SendLocationDto) {
    const chatId = this.normalizeChatId(data.number);
    await this.ensureBotProfileName();
    await this.sendChatAction(chatId, 'find_location');
    const result = await this.apiRequest<any>('sendLocation', {
      chat_id: chatId,
      latitude: data.latitude,
      longitude: data.longitude,
    });

    const messageRaw: any = {
      key: { fromMe: true, id: String(result?.result?.message_id), remoteJid: this.normalizeRemoteJid(chatId) },
      pushName: this.botProfileName || this.instance.profileName || undefined,
      message: {
        locationMessage: { degreesLatitude: data.latitude, degreesLongitude: data.longitude },
      },
      messageType: 'locationMessage',
      messageTimestamp: result?.result?.date || Math.round(Date.now() / 1000),
      instanceId: this.instanceId,
      status: status[1],
      source: 'unknown',
    };

    this.sendDataWebhook(Events.SEND_MESSAGE, messageRaw);

    if (this.configService.get<Chatwoot>('CHATWOOT').ENABLED && this.localChatwoot?.enabled) {
      this.chatwootService.eventWhatsapp(
        Events.SEND_MESSAGE,
        { instanceName: this.instance.name, instanceId: this.instanceId },
        messageRaw,
      );
    }

    await this.prismaRepository.message.create({ data: messageRaw });
    await this.ensureChat(messageRaw.key.remoteJid, this.botProfileName || null, true);

    return messageRaw;
  }

  public async buttonMessage(_data: SendButtonsDto) {
    const keyboardType = _data.keyboardType || 'inline';
    await this.ensureBotProfileName();
    if (keyboardType === 'reply') {
      const keyboard = _data.buttons.map((btn) => [{ text: btn.displayText || 'Button' }]);
      const text = [_data.title, _data.description, _data.footer].filter(Boolean).join('\n');
      const chatId = this.normalizeChatId(_data.number);
      await this.sendChatAction(chatId, 'typing');

      const result = await this.apiRequest<any>('sendMessage', {
        chat_id: chatId,
        text: text || 'Select',
        parse_mode: _data.parseMode,
        reply_markup: {
          keyboard,
          resize_keyboard: true,
          one_time_keyboard: false,
        },
      });

      const messageRaw: any = {
        key: { fromMe: true, id: String(result?.result?.message_id), remoteJid: this.normalizeRemoteJid(chatId) },
        pushName: this.botProfileName || this.instance.profileName || undefined,
        message: { conversation: text || 'Select' },
        messageType: 'conversation',
        messageTimestamp: result?.result?.date || Math.round(Date.now() / 1000),
        instanceId: this.instanceId,
        status: status[1],
        source: 'unknown',
      };

      this.sendDataWebhook(Events.SEND_MESSAGE, messageRaw);
      await this.prismaRepository.message.create({ data: messageRaw });
      await this.ensureChat(messageRaw.key.remoteJid, this.botProfileName || null, true);

      return messageRaw;
    }

    const inlineKeyboard = _data.buttons.map((btn) => {
      if (btn.type === 'reply') {
        return [{ text: btn.displayText || 'Button', callback_data: btn.id || btn.displayText || 'callback' }];
      }
      if (btn.type === 'url') {
        return [{ text: btn.displayText || 'Open', url: btn.url }];
      }
      throw new BadRequestException('Button type not supported on Telegram Bot API');
    });

    const text = [_data.title, _data.description, _data.footer].filter(Boolean).join('\n');
    const chatId = this.normalizeChatId(_data.number);
    await this.sendChatAction(chatId, 'typing');

    const result = await this.apiRequest<any>('sendMessage', {
      chat_id: chatId,
      text: text || 'Select',
      parse_mode: _data.parseMode,
      reply_markup: { inline_keyboard: inlineKeyboard },
    });

    const messageRaw: any = {
      key: { fromMe: true, id: String(result?.result?.message_id), remoteJid: this.normalizeRemoteJid(chatId) },
      pushName: this.botProfileName || this.instance.profileName || undefined,
      message: { conversation: text || 'Select' },
      messageType: 'conversation',
      messageTimestamp: result?.result?.date || Math.round(Date.now() / 1000),
      instanceId: this.instanceId,
      status: status[1],
      source: 'unknown',
    };

    this.sendDataWebhook(Events.SEND_MESSAGE, messageRaw);
    await this.prismaRepository.message.create({ data: messageRaw });
    await this.ensureChat(messageRaw.key.remoteJid, this.botProfileName || null, true);

    return messageRaw;
  }
  public async listMessage(_data: SendListDto) {
    void _data;
    throw new BadRequestException('Method not available on Telegram Bot API');
  }
  public async templateMessage(_data: SendTemplateDto) {
    void _data;
    throw new BadRequestException('Method not available on Telegram Bot API');
  }
  public async reactionMessage(_data: SendReactionDto) {
    const chatId = this.normalizeChatId(_data.key.remoteJid);
    const messageId = Number(_data.key.id);
    if (!messageId) {
      throw new BadRequestException('Message ID is required');
    }

    const reaction = _data.reaction ? [{ type: 'emoji', emoji: _data.reaction }] : [];

    return await this.apiRequest<any>('setMessageReaction', {
      chat_id: chatId,
      message_id: messageId,
      reaction,
    });
  }

  public async mediaGroupMessage(data: SendMediaGroupDto) {
    const chatId = this.normalizeChatId(data.number);
    await this.ensureBotProfileName();
    await this.sendChatAction(chatId, 'upload_document');

    const form = new FormData();
    form.append('chat_id', chatId);

    const media: any[] = [];
    let attachIndex = 0;

    for (const item of data.medias) {
      if (isURL(item.media)) {
        media.push({
          type: item.type,
          media: item.media,
          caption: item.caption,
          parse_mode: item.parseMode,
        });
        continue;
      }
      if (isBase64(item.media)) {
        const buffer = Buffer.from(item.media, 'base64');
        const fieldName = `file${attachIndex}`;
        const fileName = item.fileName || `${fieldName}.bin`;
        form.append(fieldName, buffer, { filename: fileName });
        media.push({
          type: item.type,
          media: `attach://${fieldName}`,
          caption: item.caption,
          parse_mode: item.parseMode,
        });
        attachIndex += 1;
        continue;
      }
      throw new BadRequestException('Media must be a url or base64');
    }

    form.append('media', JSON.stringify(media));

    const result = await this.apiRequestForm<any>('sendMediaGroup', form);

    const messageRaw: any = {
      key: {
        fromMe: true,
        id: String(result?.result?.[0]?.message_id || Date.now()),
        remoteJid: this.normalizeRemoteJid(chatId),
      },
      pushName: this.botProfileName || this.instance.profileName || undefined,
      message: { conversation: '[media_group]' },
      messageType: 'conversation',
      messageTimestamp: result?.result?.[0]?.date || Math.round(Date.now() / 1000),
      instanceId: this.instanceId,
      status: status[1],
      source: 'unknown',
    };

    this.sendDataWebhook(Events.SEND_MESSAGE, messageRaw);
    await this.prismaRepository.message.create({ data: messageRaw });
    await this.ensureChat(messageRaw.key.remoteJid, this.botProfileName || null, true);

    return messageRaw;
  }

  public async getBase64FromMediaMessage(data: any) {
    const message = data?.message || data;
    const mediaUrl = message?.message?.mediaUrl;
    if (mediaUrl && isURL(mediaUrl)) {
      const buffer = await this.downloadFile(mediaUrl);
      return buffer?.toString('base64');
    }

    const fileId =
      message?.message?.imageMessage?.fileId ||
      message?.message?.videoMessage?.fileId ||
      message?.message?.audioMessage?.fileId ||
      message?.message?.documentMessage?.fileId ||
      message?.message?.stickerMessage?.fileId;

    if (!fileId) {
      throw new BadRequestException('Media file not found');
    }

    const url = await this.getFileUrl(fileId);
    if (!url) {
      throw new BadRequestException('Media file not found');
    }

    const buffer = await this.downloadFile(url);
    return buffer?.toString('base64');
  }

  public async profilePicture() {
    return { wuid: null, profilePictureUrl: null };
  }
  public async getProfileName() {
    return null;
  }
  public async profilePictureUrl() {
    return null;
  }
  public async getProfileStatus() {
    return null;
  }

  // methods not available on Telegram Bot API
  public async deleteMessage(data: any) {
    const chatId = this.normalizeChatId(data?.remoteJid);
    const messageId = Number(data?.id);
    if (!chatId || !messageId) {
      throw new BadRequestException('remoteJid and message id are required');
    }

    const result = await this.apiRequest<any>('deleteMessage', {
      chat_id: chatId,
      message_id: messageId,
    });

    const messageKey = { id: String(messageId), remoteJid: `${chatId}@telegram`, fromMe: data?.fromMe ?? false };
    this.sendDataWebhook(Events.MESSAGES_DELETE, messageKey);

    const existing = await this.prismaRepository.message.findFirst({
      where: {
        instanceId: this.instanceId,
        key: {
          path: ['id'],
          equals: messageKey.id,
        },
      },
      select: { id: true },
    });
    if (existing) {
      await this.prismaRepository.message.update({
        where: { id: existing.id },
        data: { status: 'DELETED' },
      });
    }

    return result;
  }
  public async mediaSticker() {
    throw new BadRequestException('Method not available on Telegram Bot API');
  }
  public async pollMessage() {
    throw new BadRequestException('Method not available on Telegram Bot API');
  }
  public async statusMessage() {
    throw new BadRequestException('Method not available on Telegram Bot API');
  }
  public async reloadConnection() {
    throw new BadRequestException('Method not available on Telegram Bot API');
  }
  public async whatsappNumber() {
    throw new BadRequestException('Method not available on Telegram Bot API');
  }
  public async markMessageAsRead() {
    throw new BadRequestException('Method not available on Telegram Bot API');
  }
  public async archiveChat() {
    throw new BadRequestException('Method not available on Telegram Bot API');
  }
  public async markChatUnread() {
    throw new BadRequestException('Method not available on Telegram Bot API');
  }
  public async fetchProfile() {
    throw new BadRequestException('Method not available on Telegram Bot API');
  }
  public async offerCall() {
    throw new BadRequestException('Method not available on Telegram Bot API');
  }
  public async sendPresence() {
    throw new BadRequestException('Method not available on Telegram Bot API');
  }
  public async setPresence() {
    throw new BadRequestException('Method not available on Telegram Bot API');
  }
  public async fetchPrivacySettings() {
    throw new BadRequestException('Method not available on Telegram Bot API');
  }
  public async updatePrivacySettings() {
    throw new BadRequestException('Method not available on Telegram Bot API');
  }
  public async updateProfileName() {
    throw new BadRequestException('Method not available on Telegram Bot API');
  }
  public async updateProfileStatus() {
    throw new BadRequestException('Method not available on Telegram Bot API');
  }
  public async updateProfilePicture() {
    throw new BadRequestException('Method not available on Telegram Bot API');
  }
  public async removeProfilePicture() {
    throw new BadRequestException('Method not available on Telegram Bot API');
  }
  public async updateMessage(data: any) {
    const chatId = this.normalizeChatId(data?.key?.remoteJid || data?.number);
    const messageId = Number(data?.key?.id);
    if (!chatId || !messageId) {
      throw new BadRequestException('Message key is required');
    }

    const parseMode = data?.parseMode;
    let result: any;

    if (data?.media && data?.mediatype) {
      const mediaType = data.mediatype === 'image' ? 'photo' : data.mediatype;
      if (isBase64(data.media)) {
        const form = new FormData();
        const buffer = Buffer.from(data.media, 'base64');
        form.append('chat_id', chatId);
        form.append('message_id', String(messageId));
        form.append(
          'media',
          JSON.stringify({ type: mediaType, media: 'attach://file', caption: data.caption, parse_mode: parseMode }),
        );
        form.append('file', buffer, { filename: `edit.${mediaType}` });
        result = await this.apiRequestForm<any>('editMessageMedia', form);
      } else {
        const mediaPayload: any = {
          type: mediaType,
          media: data.media,
          caption: data.caption,
          parse_mode: parseMode,
        };
        result = await this.apiRequest<any>('editMessageMedia', {
          chat_id: chatId,
          message_id: messageId,
          media: mediaPayload,
        });
      }
    } else if (data?.caption) {
      result = await this.apiRequest<any>('editMessageCaption', {
        chat_id: chatId,
        message_id: messageId,
        caption: data.caption,
        parse_mode: parseMode,
      });
    } else {
      result = await this.apiRequest<any>('editMessageText', {
        chat_id: chatId,
        message_id: messageId,
        text: data?.text || '',
        parse_mode: parseMode,
      });
    }

    const messageRaw: any = {
      key: { id: String(messageId), remoteJid: `${chatId}@telegram`, fromMe: true },
      message: { conversation: data?.text || data?.caption || '' },
      messageType: 'conversation',
      messageTimestamp: Math.round(Date.now() / 1000),
      instanceId: this.instanceId,
      status: 'EDITED',
      source: 'unknown',
    };

    this.sendDataWebhook(Events.MESSAGES_EDITED, messageRaw);

    const existing = await this.prismaRepository.message.findFirst({
      where: {
        instanceId: this.instanceId,
        key: {
          path: ['id'],
          equals: messageRaw.key.id,
        },
      },
      select: { id: true },
    });
    if (existing) {
      await this.prismaRepository.message.update({
        where: { id: existing.id },
        data: {
          message: messageRaw.message,
          messageType: messageRaw.messageType,
          messageTimestamp: messageRaw.messageTimestamp,
          status: 'EDITED',
        },
      });
    }

    return result;
  }
  public async blockUser() {
    throw new BadRequestException('Method not available on Telegram Bot API');
  }
}
