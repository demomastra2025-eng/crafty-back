import { RouterBroker } from '@api/abstract/abstract.router';
import { AuthLoginDto, AuthRegisterDto } from '@api/dto/auth.dto';
import { userAuthGuard } from '@api/guards/user-auth.guard';
import { authController } from '@api/server.module';
import { loginSchema, registerSchema } from '@validate/validate.schema';
import { Router } from 'express';

import { HttpStatus } from './index.router';

export class AuthRouter extends RouterBroker {
  constructor() {
    super();
    this.router
      .post('/register', async (req, res) => {
        const response = await this.dataValidate<AuthRegisterDto>({
          request: req,
          schema: registerSchema,
          ClassRef: AuthRegisterDto,
          execute: (_, data) => authController.register(data),
        });

        return res.status(HttpStatus.CREATED).json(response);
      })
      .post('/login', async (req, res) => {
        const response = await this.dataValidate<AuthLoginDto>({
          request: req,
          schema: loginSchema,
          ClassRef: AuthLoginDto,
          execute: (_, data) => authController.login(data),
        });

        return res.status(HttpStatus.OK).json(response);
      })
      .get('/me', userAuthGuard, async (req, res) => {
        const response = await authController.me(req.userId);
        return res.status(HttpStatus.OK).json(response);
      });
  }

  public readonly router: Router = Router();
}
