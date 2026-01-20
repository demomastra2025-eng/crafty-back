import { HttpStatus } from '@api/routes/index.router';
import { llmModelController } from '@api/server.module';
import { RequestHandler, Router } from 'express';

export class LlmModelRouter {
  public readonly router: Router;

  constructor(...guards: RequestHandler[]) {
    this.router = Router();
    this.router.get('/', ...guards, async (_req, res) => {
      const response = await llmModelController.listModels();
      return res.status(HttpStatus.OK).json(response);
    });
  }
}
