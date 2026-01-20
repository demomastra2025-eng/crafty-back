import { RouterBroker } from '@api/abstract/abstract.router';
import { IgnoreJidDto } from '@api/dto/chatbot.dto';
import { InstanceDto } from '@api/dto/instance.dto';
import { HttpStatus } from '@api/routes/index.router';
import { agnoController } from '@api/server.module';
import { instanceSchema } from '@validate/instance.schema';
import { RequestHandler, Router } from 'express';

import { AgnoDto, AgnoEmitDto, AgnoSettingDto } from '../dto/agno.dto';
import {
  agnoEmitSchema,
  agnoIgnoreJidSchema,
  agnoSchema,
  agnoSettingSchema,
  agnoStatusSchema,
} from '../validate/agno.schema';

export class AgnoRouter extends RouterBroker {
  constructor(...guards: RequestHandler[]) {
    super();
    this.router
      .post(this.routerPath('create'), ...guards, async (req, res) => {
        const response = await this.dataValidate<AgnoDto>({
          request: req,
          schema: agnoSchema,
          ClassRef: AgnoDto,
          execute: (instance, data) => agnoController.createBot(instance, data),
        });

        res.status(HttpStatus.CREATED).json(response);
      })
      .get(this.routerPath('find'), ...guards, async (req, res) => {
        const response = await this.dataValidate<InstanceDto>({
          request: req,
          schema: instanceSchema,
          ClassRef: InstanceDto,
          execute: (instance) => agnoController.findBot(instance),
        });

        res.status(HttpStatus.OK).json(response);
      })
      .get(this.routerPath('fetch/:agnoId'), ...guards, async (req, res) => {
        const response = await this.dataValidate<InstanceDto>({
          request: req,
          schema: instanceSchema,
          ClassRef: InstanceDto,
          execute: (instance) => agnoController.fetchBot(instance, req.params.agnoId),
        });

        res.status(HttpStatus.OK).json(response);
      })
      .put(this.routerPath('update/:agnoId'), ...guards, async (req, res) => {
        const response = await this.dataValidate<AgnoDto>({
          request: req,
          schema: agnoSchema,
          ClassRef: AgnoDto,
          execute: (instance, data) => agnoController.updateBot(instance, req.params.agnoId, data),
        });

        res.status(HttpStatus.OK).json(response);
      })
      .delete(this.routerPath('delete/:agnoId'), ...guards, async (req, res) => {
        const response = await this.dataValidate<InstanceDto>({
          request: req,
          schema: instanceSchema,
          ClassRef: InstanceDto,
          execute: (instance) => agnoController.deleteBot(instance, req.params.agnoId),
        });

        res.status(HttpStatus.OK).json(response);
      })
      .post(this.routerPath('settings'), ...guards, async (req, res) => {
        const response = await this.dataValidate<AgnoSettingDto>({
          request: req,
          schema: agnoSettingSchema,
          ClassRef: AgnoSettingDto,
          execute: (instance, data) => agnoController.settings(instance, data),
        });

        res.status(HttpStatus.OK).json(response);
      })
      .get(this.routerPath('fetchSettings'), ...guards, async (req, res) => {
        const response = await this.dataValidate<InstanceDto>({
          request: req,
          schema: instanceSchema,
          ClassRef: InstanceDto,
          execute: (instance) => agnoController.fetchSettings(instance),
        });

        res.status(HttpStatus.OK).json(response);
      })
      .post(this.routerPath('changeStatus'), ...guards, async (req, res) => {
        const response = await this.dataValidate<InstanceDto>({
          request: req,
          schema: agnoStatusSchema,
          ClassRef: InstanceDto,
          execute: (instance, data) => agnoController.changeStatus(instance, data),
        });

        res.status(HttpStatus.OK).json(response);
      })
      .get(this.routerPath('fetchSessions/:agnoId'), ...guards, async (req, res) => {
        const response = await this.dataValidate<InstanceDto>({
          request: req,
          schema: instanceSchema,
          ClassRef: InstanceDto,
          execute: (instance) =>
            agnoController.fetchSessions(
              instance,
              req.params.agnoId,
              typeof req.query.remoteJid === 'string' ? req.query.remoteJid : undefined,
            ),
        });

        res.status(HttpStatus.OK).json(response);
      })
      .post(this.routerPath('emitLastMessage'), ...guards, async (req, res) => {
        const response = await this.dataValidate<AgnoEmitDto>({
          request: req,
          schema: agnoEmitSchema,
          ClassRef: AgnoEmitDto,
          execute: (instance, data) => agnoController.emitLastMessage(instance, data),
        });
        res.status(HttpStatus.OK).json(response);
      })
      .post(this.routerPath('ignoreJid'), ...guards, async (req, res) => {
        const response = await this.dataValidate<IgnoreJidDto>({
          request: req,
          schema: agnoIgnoreJidSchema,
          ClassRef: IgnoreJidDto,
          execute: (instance, data) => agnoController.ignoreJid(instance, data),
        });

        res.status(HttpStatus.OK).json(response);
      });
  }

  public readonly router: Router = Router();
}
