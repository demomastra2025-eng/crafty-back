import { PrismaRepository } from '@api/repository/repository.service';
import { ConfigService, Openai as OpenaiConfig } from '@config/env.config';
import { Logger } from '@config/logger.config';
import { BadRequestException } from '@exceptions';
import { Credentials } from '@prisma/client';
import axios from 'axios';
import { downloadMediaMessage } from 'baileys';
import { isURL } from 'class-validator';
import FormData from 'form-data';
import OpenAI from 'openai';
import pdfParse from 'pdf-parse';
import P from 'pino';
import sharp from 'sharp';

const MAX_PDF_CHARS = 4000;

export class OpenaiService {
  protected client: OpenAI;
  private readonly logger = new Logger('OpenaiService');

  constructor(
    private readonly prismaRepository: PrismaRepository,
    private readonly configService: ConfigService,
  ) {}

  private initClient(apiKey: string) {
    this.client = new OpenAI({ apiKey });
    return this.client;
  }

  public async ensureProviderCredentials(instanceId: string, provider: string): Promise<Credentials> {
    const creds = await this.findProviderCredentials(instanceId, provider);
    if (!creds) {
      throw new BadRequestException(`Credentials for provider "${provider}" not found`);
    }
    return creds;
  }

  private async findProviderCredentials(instanceId: string, provider: string): Promise<Credentials | null> {
    if (!instanceId) return null;

    const instance = await this.prismaRepository.instance.findUnique({
      where: { id: instanceId },
      select: { companyId: true },
    });

    const baseWhere = {
      provider,
      apiKey: { not: null },
    } as const;

    if (instance?.companyId) {
      return this.prismaRepository.credentials.findFirst({
        where: {
          ...baseWhere,
          companyId: instance.companyId,
        },
        orderBy: { createdAt: 'desc' },
      });
    }

    return this.prismaRepository.credentials.findFirst({
      where: {
        ...baseWhere,
        instanceId,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  private async isRecognitionEnabled(instanceId?: string): Promise<boolean> {
    if (!instanceId) return false;
    if (!this.configService.get<OpenaiConfig>('OPENAI').ENABLED) return false;

    const settings = await this.prismaRepository.setting.findUnique({
      where: { instanceId },
      select: { mediaRecognition: true },
    });

    return settings?.mediaRecognition === true;
  }

  private async resolveApiKey(instanceId: string): Promise<string | null> {
    const creds = await this.findProviderCredentials(instanceId, 'openai');
    return creds?.apiKey || this.configService.get<OpenaiConfig>('OPENAI').API_KEY_GLOBAL || null;
  }

  private async ensureRecognitionReady(instanceId?: string): Promise<string | null> {
    if (!instanceId) return null;
    const enabled = await this.isRecognitionEnabled(instanceId);
    if (!enabled) return null;

    const apiKey = await this.resolveApiKey(instanceId);
    if (!apiKey) {
      this.logger.error('OpenAI API key not found for recognition');
      return null;
    }

    return apiKey;
  }

  private getVisionModel(): string {
    return this.configService.get<OpenaiConfig>('OPENAI').VISION_MODEL || 'gpt-5.2';
  }

  private async fetchBinaryFromUrl(url: string): Promise<Buffer | null> {
    try {
      const result = await axios.get(url, { responseType: 'arraybuffer' });
      return Buffer.from(result.data);
    } catch (error) {
      this.logger.error(`Error downloading media from URL: ${error?.message || error}`);
      return null;
    }
  }

  private resolveImageSource(msg: any): { dataUrl?: string; mime?: string } {
    const message = msg?.message || msg;
    const imageMessage = message?.imageMessage || message?.associatedChildMessage?.message?.imageMessage;
    const mime = imageMessage?.mimetype || 'image/jpeg';

    if (message?.base64) {
      return { dataUrl: `data:${mime};base64,${message.base64}`, mime };
    }

    const mediaUrl = message?.mediaUrl || imageMessage?.url;
    if (mediaUrl) {
      return { dataUrl: mediaUrl, mime };
    }

    return {};
  }

  private detectAudioFormat(buffer: Buffer): { mime: string; ext: string } | null {
    if (!buffer || buffer.length < 12) return null;

    const header4 = buffer.subarray(0, 4).toString('ascii');
    if (header4 === 'OggS') return { mime: 'audio/ogg', ext: 'ogg' };
    if (header4 === 'fLaC') return { mime: 'audio/flac', ext: 'flac' };
    if (header4 === 'RIFF') return { mime: 'audio/wav', ext: 'wav' };

    if (header4 === 'ID3' || (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0)) {
      return { mime: 'audio/mpeg', ext: 'mp3' };
    }

    if (buffer.subarray(4, 8).toString('ascii') === 'ftyp') {
      return { mime: 'audio/mp4', ext: 'mp4' };
    }

    return null;
  }

  private async buildVisionDataUrl(msg: any, instance: any): Promise<string | null> {
    const { dataUrl } = this.resolveImageSource(msg);

    const toPngDataUrl = async (buffer: Buffer) => {
      const png = await sharp(buffer).png().toBuffer();
      return `data:image/png;base64,${png.toString('base64')}`;
    };

    let buffer: Buffer | null = null;
    if (dataUrl?.startsWith('data:')) {
      const match = dataUrl.match(/^data:([^;]+);base64,(.*)$/);
      if (match) {
        const base64Data = match[2];
        try {
          buffer = Buffer.from(base64Data, 'base64');
        } catch (error) {
          this.logger.error(`Failed to parse base64 image: ${error?.message || error}`);
        }
      }
    } else if (dataUrl && isURL(dataUrl)) {
      buffer = await this.fetchBinaryFromUrl(dataUrl);
    }

    if (!buffer) {
      try {
        buffer = await downloadMediaMessage(
          { key: msg.key, message: msg?.message },
          'buffer',
          {},
          {
            logger: P({ level: 'error' }) as any,
            reuploadRequest: instance,
          },
        );
      } catch (error) {
        this.logger.error(`Failed to download image from WhatsApp: ${error?.message || error}`);
      }
    }

    if (!buffer) {
      return null;
    }

    try {
      return await toPngDataUrl(buffer);
    } catch (error) {
      this.logger.error(`Failed to convert image to png: ${error?.message || error}`);
      return null;
    }
  }

  private resolveDocumentSource(msg: any): { url?: string; base64?: string; mimetype?: string } {
    const message = msg?.message || msg;
    const doc = message?.documentMessage || message?.associatedChildMessage?.message?.documentMessage;

    return {
      url: message?.mediaUrl || doc?.url,
      base64: message?.base64,
      mimetype: doc?.mimetype,
    };
  }

  private async resolvePdfBuffer(msg: any, instance: any): Promise<Buffer | null> {
    const { url, base64, mimetype } = this.resolveDocumentSource(msg);
    if (mimetype && mimetype !== 'application/pdf') return null;

    if (base64) {
      try {
        return Buffer.from(base64, 'base64');
      } catch (error) {
        this.logger.error(`Failed to parse base64 pdf: ${error?.message || error}`);
      }
    }

    if (url && isURL(url)) {
      return this.fetchBinaryFromUrl(url);
    }

    try {
      return await downloadMediaMessage(
        { key: msg.key, message: msg?.message },
        'buffer',
        {},
        {
          logger: P({ level: 'error' }) as any,
          reuploadRequest: instance,
        },
      );
    } catch (error) {
      this.logger.error(`Failed to download pdf: ${error?.message || error}`);
      return null;
    }
  }

  public async speechToTextSystem(msg: any, instance: any): Promise<string | null> {
    const instanceId = instance?.instanceId || instance?.instance?.id || instance?.id;
    const apiKey = await this.ensureRecognitionReady(instanceId);
    if (!apiKey) return null;

    let audio: Buffer | null = null;
    const message = msg?.message || msg;

    if (message?.mediaUrl && isURL(message.mediaUrl)) {
      audio = await this.fetchBinaryFromUrl(message.mediaUrl);
    } else if (message?.base64) {
      audio = Buffer.from(message.base64, 'base64');
    } else if (message?.audioMessage?.url && isURL(message.audioMessage.url)) {
      audio = await this.fetchBinaryFromUrl(message.audioMessage.url);
    }

    if (!audio) {
      audio = await downloadMediaMessage(
        { key: msg.key, message: msg?.message },
        'buffer',
        {},
        {
          logger: P({ level: 'error' }) as any,
          reuploadRequest: instance,
        },
      );
    }

    if (!audio || audio.length === 0) {
      this.logger.error('Audio buffer is empty for speech-to-text');
      return null;
    }

    let format = this.detectAudioFormat(audio);
    if (!format) {
      try {
        const fallback = await downloadMediaMessage(
          { key: msg.key, message: msg?.message },
          'buffer',
          {},
          {
            logger: P({ level: 'error' }) as any,
            reuploadRequest: instance,
          },
        );
        if (fallback && fallback.length > 0) {
          audio = fallback;
          format = this.detectAudioFormat(audio);
        }
      } catch (error) {
        this.logger.error(`System audio fallback download failed: ${error?.message || error}`);
      }
    }

    if (!format) {
      this.logger.error('Audio format not recognized for speech-to-text');
      return null;
    }

    const formData = new FormData();
    formData.append('file', audio, { filename: `audio.${format.ext}`, contentType: format.mime });
    formData.append('model', 'whisper-1');

    let response;
    try {
      response = await axios.post('https://api.openai.com/v1/audio/transcriptions', formData, {
        headers: {
          ...formData.getHeaders(),
          Authorization: `Bearer ${apiKey}`,
        },
      });
    } catch (error) {
      this.logger.error(
        `System speech-to-text failed: ${error?.response?.status} ${JSON.stringify(error?.response?.data || error)}`,
      );
      return null;
    }

    return response?.data?.text;
  }

  public async describeImageSystem(msg: any, instance: any): Promise<string | null> {
    const instanceId = instance?.instanceId || instance?.instance?.id || instance?.id;
    const apiKey = await this.ensureRecognitionReady(instanceId);
    if (!apiKey) return null;

    this.initClient(apiKey);

    const dataUrl = await this.buildVisionDataUrl(msg, instance);
    if (!dataUrl) {
      this.logger.error('Image source not found for image description');
      return null;
    }

    const response = await this.client.chat.completions.create({
      model: this.getVisionModel(),
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Describe the image briefly.' },
            { type: 'image_url', image_url: { url: dataUrl } },
          ],
        },
      ],
    });

    return response?.choices?.[0]?.message?.content || null;
  }

  public async extractPdfTextSystem(msg: any, instance: any): Promise<string | null> {
    const instanceId = instance?.instanceId || instance?.instance?.id || instance?.id;
    const ready = await this.ensureRecognitionReady(instanceId);
    if (!ready) return null;

    const buffer = await this.resolvePdfBuffer(msg, instance);
    if (!buffer) {
      this.logger.error('PDF buffer not found');
      return null;
    }

    try {
      const parsed = await pdfParse(buffer);
      const text = (parsed.text || '').trim();
      if (!text) return null;
      if (text.length <= MAX_PDF_CHARS) return text;
      return `${text.slice(0, MAX_PDF_CHARS)}…`;
    } catch (error) {
      this.logger.error(`PDF parse failed: ${error?.message || error}`);
      return null;
    }
  }
}
