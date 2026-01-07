import { RouterBroker } from '@api/abstract/abstract.router';
import { CompanyCreateDto } from '@api/dto/company.dto';
import { userAuthGuard } from '@api/guards/user-auth.guard';
import { companyController } from '@api/server.module';
import { companyCreateSchema } from '@validate/validate.schema';
import { Router } from 'express';

import { HttpStatus } from './index.router';

export class CompanyRouter extends RouterBroker {
  constructor() {
    super();
    this.router
      .get('/', userAuthGuard, async (req, res) => {
        const response = await companyController.listCompanies(req.userId);
        return res.status(HttpStatus.OK).json(response);
      })
      .post('/', userAuthGuard, async (req, res) => {
        const response = await this.dataValidate<CompanyCreateDto>({
          request: req,
          schema: companyCreateSchema,
          ClassRef: CompanyCreateDto,
          execute: (_, data) => companyController.createCompany(req.userId, data),
        });

        return res.status(HttpStatus.CREATED).json(response);
      })
      .get('/:companyId/primary-key', userAuthGuard, async (req, res) => {
        const response = await companyController.getPrimaryKey(req.userId, req.params.companyId);
        return res.status(HttpStatus.OK).json(response);
      })
      .post('/:companyId/primary-key', userAuthGuard, async (req, res) => {
        const response = await companyController.rotatePrimaryKey(req.userId, req.params.companyId);
        return res.status(HttpStatus.OK).json(response);
      });
  }

  public readonly router: Router = Router();
}
