import { RouterBroker } from '@api/abstract/abstract.router';
import { CompanyCreateDto, CompanyUpdateDto } from '@api/dto/company.dto';
import { CredentialsCreateDto } from '@api/dto/credentials.dto';
import { userAuthGuard } from '@api/guards/user-auth.guard';
import { companyController } from '@api/server.module';
import { companyCreateSchema, companyUpdateSchema, credentialsCreateSchema } from '@validate/validate.schema';
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
      .patch('/:companyId', userAuthGuard, async (req, res) => {
        const response = await this.dataValidate<CompanyUpdateDto>({
          request: req,
          schema: companyUpdateSchema,
          ClassRef: CompanyUpdateDto,
          execute: (_, data) => companyController.updateCompany(req.userId, req.params.companyId, data),
        });

        return res.status(HttpStatus.OK).json(response);
      })
      .get('/:companyId/primary-key', userAuthGuard, async (req, res) => {
        const response = await companyController.getPrimaryKey(req.userId, req.params.companyId);
        return res.status(HttpStatus.OK).json(response);
      })
      .post('/:companyId/primary-key', userAuthGuard, async (req, res) => {
        const response = await companyController.rotatePrimaryKey(req.userId, req.params.companyId);
        return res.status(HttpStatus.OK).json(response);
      })
      .get('/:companyId/credentials', userAuthGuard, async (req, res) => {
        const response = await companyController.listCredentials(req.userId, req.params.companyId);
        return res.status(HttpStatus.OK).json(response);
      })
      .post('/:companyId/credentials', userAuthGuard, async (req, res) => {
        const response = await this.dataValidate<CredentialsCreateDto>({
          request: req,
          schema: credentialsCreateSchema,
          ClassRef: CredentialsCreateDto,
          execute: (_, data) => companyController.createCredential(req.userId, req.params.companyId, data),
        });
        return res.status(HttpStatus.CREATED).json(response);
      })
      .delete('/:companyId/credentials/:credentialId', userAuthGuard, async (req, res) => {
        const response = await companyController.deleteCredential(
          req.userId,
          req.params.companyId,
          req.params.credentialId,
        );
        return res.status(HttpStatus.OK).json(response);
      });
  }

  public readonly router: Router = Router();
}
