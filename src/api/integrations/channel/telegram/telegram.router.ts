import { telegramController } from '@api/server.module';
import { Router } from 'express';

export class TelegramRouter {
  public readonly router: Router;

  constructor() {
    this.router = Router();

    this.router.post('/webhook/telegram/:instanceName', async (req, res) => {
      const { instanceName } = req.params;
      const response = await telegramController.receiveWebhook(req.body, instanceName);
      return res.status(200).json(response);
    });
  }
}
