import { RouterBroker } from '@api/abstract/abstract.router';
import { InstanceDto } from '@api/dto/instance.dto';
import { HttpStatus } from '@api/routes/index.router';
import { funnelController } from '@api/server.module';
import { funnelSchema, funnelSessionSchema, funnelUpdateSchema, instanceSchema } from '@validate/validate.schema';
import { RequestHandler, Router } from 'express';

import { FunnelDto, FunnelSessionDto } from '../dto/funnel.dto';

export class FunnelRouter extends RouterBroker {
  constructor(...guards: RequestHandler[]) {
    super();
    this.router
      .post(this.routerPath('funnel/create'), ...guards, async (req, res) => {
        const response = await this.dataValidate<FunnelDto>({
          request: req,
          schema: funnelSchema,
          ClassRef: FunnelDto,
          execute: (instance, data) => funnelController.createFunnel(instance, data),
        });
        res.status(HttpStatus.CREATED).json(response);
      })
      .get(this.routerPath('funnel/list'), ...guards, async (req, res) => {
        const response = await this.dataValidate<InstanceDto>({
          request: req,
          schema: instanceSchema,
          ClassRef: InstanceDto,
          execute: (instance) => funnelController.listFunnels(instance),
        });
        res.status(HttpStatus.OK).json(response);
      })
      .get(this.routerPath('funnel/fetch/:funnelId'), ...guards, async (req, res) => {
        const response = await this.dataValidate<InstanceDto>({
          request: req,
          schema: instanceSchema,
          ClassRef: InstanceDto,
          execute: (instance) => funnelController.fetchFunnel(instance, req.params.funnelId),
        });
        res.status(HttpStatus.OK).json(response);
      })
      .put(this.routerPath('funnel/update/:funnelId'), ...guards, async (req, res) => {
        const response = await this.dataValidate<FunnelDto>({
          request: req,
          schema: funnelUpdateSchema,
          ClassRef: FunnelDto,
          execute: (instance, data) => funnelController.updateFunnel(instance, req.params.funnelId, data),
        });
        res.status(HttpStatus.OK).json(response);
      })
      .delete(this.routerPath('funnel/delete/:funnelId'), ...guards, async (req, res) => {
        const response = await this.dataValidate<InstanceDto>({
          request: req,
          schema: instanceSchema,
          ClassRef: InstanceDto,
          execute: (instance) => funnelController.deleteFunnel(instance, req.params.funnelId),
        });
        res.status(HttpStatus.OK).json(response);
      })
      .post(this.routerPath('funnel/session'), ...guards, async (req, res) => {
        const response = await this.dataValidate<FunnelSessionDto>({
          request: req,
          schema: funnelSessionSchema,
          ClassRef: FunnelSessionDto,
          execute: (instance, data) => funnelController.updateSession(instance, data),
        });
        res.status(HttpStatus.OK).json(response);
      });
  }

  public readonly router: Router = Router();
}
