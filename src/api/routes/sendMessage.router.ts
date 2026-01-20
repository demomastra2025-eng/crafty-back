import { RouterBroker } from '@api/abstract/abstract.router';
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
import { sendMessageController } from '@api/server.module';
import {
  audioMessageSchema,
  buttonsMessageSchema,
  contactMessageSchema,
  listMessageSchema,
  locationMessageSchema,
  mediaGroupMessageSchema,
  mediaMessageSchema,
  pollMessageSchema,
  ptvMessageSchema,
  reactionMessageSchema,
  statusMessageSchema,
  stickerMessageSchema,
  templateMessageSchema,
  textMessageSchema,
} from '@validate/validate.schema';
import { Request, RequestHandler, Router } from 'express';
import multer from 'multer';

import { HttpStatus } from './index.router';

const upload = multer({ storage: multer.memoryStorage() });

const allowedAuthors = new Set(['client', 'owner', 'manager', 'api', 'agent', 'followup']);

const getMessageAuthor = (req: Request) => {
  const bodyAuthor = typeof (req as any)?.body?.author === 'string' ? String((req as any).body.author).trim() : '';
  const raw = bodyAuthor || req.get?.('x-message-author') || req.get?.('X-Message-Author');
  if (!raw) return 'api';
  const normalized = String(raw).trim().toLowerCase();
  return allowedAuthors.has(normalized) ? normalized : 'api';
};

export class MessageRouter extends RouterBroker {
  constructor(...guards: RequestHandler[]) {
    super();
    this.router
      .post(this.routerPath('sendTemplate'), ...guards, async (req, res) => {
        const author = getMessageAuthor(req);
        const response = await this.dataValidate<SendTemplateDto>({
          request: req,
          schema: templateMessageSchema,
          ClassRef: SendTemplateDto,
          execute: (instance, data) => sendMessageController.sendTemplate(instance, data, author),
        });

        return res.status(HttpStatus.CREATED).json(response);
      })
      .post(this.routerPath('sendText'), ...guards, async (req, res) => {
        const author = getMessageAuthor(req);
        const response = await this.dataValidate<SendTextDto>({
          request: req,
          schema: textMessageSchema,
          ClassRef: SendTextDto,
          execute: (instance, data) => sendMessageController.sendText(instance, data, author),
        });

        return res.status(HttpStatus.CREATED).json(response);
      })
      .post(this.routerPath('sendMedia'), ...guards, upload.single('file'), async (req, res) => {
        const bodyData = req.body;
        const author = getMessageAuthor(req);

        const response = await this.dataValidate<SendMediaDto>({
          request: req,
          schema: mediaMessageSchema,
          ClassRef: SendMediaDto,
          execute: (instance) => sendMessageController.sendMedia(instance, bodyData, req.file as any, author),
        });

        return res.status(HttpStatus.CREATED).json(response);
      })
      .post(this.routerPath('sendMediaGroup'), ...guards, upload.array('files'), async (req, res) => {
        const bodyData: any = req.body || {};
        const files = (req.files || []) as any[];
        const author = getMessageAuthor(req);
        let rawMedias: any = bodyData.medias;
        if (typeof bodyData.medias === 'string') {
          try {
            rawMedias = JSON.parse(bodyData.medias);
          } catch {
            rawMedias = bodyData.medias;
          }
        }

        if (Array.isArray(rawMedias)) {
          const fileMap = new Map<string, any>();
          files.forEach((file, idx) => {
            if (file?.originalname) fileMap.set(file.originalname, file);
            if (file?.fieldname) fileMap.set(file.fieldname, file);
            fileMap.set(String(idx), file);
          });

          bodyData.medias = rawMedias.map((item, idx) => {
            const mediaRef = item?.media;
            const fileRef = typeof mediaRef === 'string' && mediaRef.startsWith('file:') ? mediaRef.slice(5) : null;
            const lookupKey = fileRef || item?.fileName || String(idx);
            const file = fileMap.get(lookupKey) || files[idx];

            if ((!mediaRef || fileRef) && file?.buffer) {
              return { ...item, media: file.buffer.toString('base64') };
            }
            return item;
          });
        }

        const response = await this.dataValidate<SendMediaGroupDto>({
          request: req,
          schema: mediaGroupMessageSchema,
          ClassRef: SendMediaGroupDto,
          execute: (instance, data) => sendMessageController.sendMediaGroup(instance, data, author),
        });

        return res.status(HttpStatus.CREATED).json(response);
      })
      .post(this.routerPath('sendPtv'), ...guards, upload.single('file'), async (req, res) => {
        const bodyData = req.body;
        const author = getMessageAuthor(req);

        const response = await this.dataValidate<SendPtvDto>({
          request: req,
          schema: ptvMessageSchema,
          ClassRef: SendPtvDto,
          execute: (instance) => sendMessageController.sendPtv(instance, bodyData, req.file as any, author),
        });

        return res.status(HttpStatus.CREATED).json(response);
      })
      .post(this.routerPath('sendWhatsAppAudio'), ...guards, upload.single('file'), async (req, res) => {
        const bodyData = req.body;
        const author = getMessageAuthor(req);

        const response = await this.dataValidate<SendAudioDto>({
          request: req,
          schema: audioMessageSchema,
          ClassRef: SendAudioDto,
          execute: (instance) => sendMessageController.sendWhatsAppAudio(instance, bodyData, req.file as any, author),
        });

        return res.status(HttpStatus.CREATED).json(response);
      })
      // TODO: Revisar funcionamento do envio de Status
      .post(this.routerPath('sendStatus'), ...guards, upload.single('file'), async (req, res) => {
        const bodyData = req.body;
        const author = getMessageAuthor(req);

        const response = await this.dataValidate<SendStatusDto>({
          request: req,
          schema: statusMessageSchema,
          ClassRef: SendStatusDto,
          execute: (instance) => sendMessageController.sendStatus(instance, bodyData, req.file as any, author),
        });

        return res.status(HttpStatus.CREATED).json(response);
      })
      .post(this.routerPath('sendSticker'), ...guards, upload.single('file'), async (req, res) => {
        const bodyData = req.body;
        const author = getMessageAuthor(req);

        const response = await this.dataValidate<SendStickerDto>({
          request: req,
          schema: stickerMessageSchema,
          ClassRef: SendStickerDto,
          execute: (instance) => sendMessageController.sendSticker(instance, bodyData, req.file as any, author),
        });

        return res.status(HttpStatus.CREATED).json(response);
      })
      .post(this.routerPath('sendLocation'), ...guards, async (req, res) => {
        const author = getMessageAuthor(req);
        const response = await this.dataValidate<SendLocationDto>({
          request: req,
          schema: locationMessageSchema,
          ClassRef: SendLocationDto,
          execute: (instance, data) => sendMessageController.sendLocation(instance, data, author),
        });

        return res.status(HttpStatus.CREATED).json(response);
      })
      .post(this.routerPath('sendContact'), ...guards, async (req, res) => {
        const author = getMessageAuthor(req);
        const response = await this.dataValidate<SendContactDto>({
          request: req,
          schema: contactMessageSchema,
          ClassRef: SendContactDto,
          execute: (instance, data) => sendMessageController.sendContact(instance, data, author),
        });

        return res.status(HttpStatus.CREATED).json(response);
      })
      .post(this.routerPath('sendReaction'), ...guards, async (req, res) => {
        const author = getMessageAuthor(req);
        const response = await this.dataValidate<SendReactionDto>({
          request: req,
          schema: reactionMessageSchema,
          ClassRef: SendReactionDto,
          execute: (instance, data) => sendMessageController.sendReaction(instance, data, author),
        });

        return res.status(HttpStatus.CREATED).json(response);
      })
      .post(this.routerPath('sendPoll'), ...guards, async (req, res) => {
        const author = getMessageAuthor(req);
        const response = await this.dataValidate<SendPollDto>({
          request: req,
          schema: pollMessageSchema,
          ClassRef: SendPollDto,
          execute: (instance, data) => sendMessageController.sendPoll(instance, data, author),
        });

        return res.status(HttpStatus.CREATED).json(response);
      })
      .post(this.routerPath('sendList'), ...guards, async (req, res) => {
        const author = getMessageAuthor(req);
        const response = await this.dataValidate<SendListDto>({
          request: req,
          schema: listMessageSchema,
          ClassRef: SendListDto,
          execute: (instance, data) => sendMessageController.sendList(instance, data, author),
        });

        return res.status(HttpStatus.CREATED).json(response);
      })
      .post(this.routerPath('sendButtons'), ...guards, async (req, res) => {
        const author = getMessageAuthor(req);
        const response = await this.dataValidate<SendButtonsDto>({
          request: req,
          schema: buttonsMessageSchema,
          ClassRef: SendButtonsDto,
          execute: (instance, data) => sendMessageController.sendButtons(instance, data, author),
        });

        return res.status(HttpStatus.CREATED).json(response);
      });
  }

  public readonly router: Router = Router();
}
