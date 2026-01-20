import { Router } from 'express';

import { AgnoRouter } from './agno/routes/agno.router';
import { FunnelRouter } from './funnel/routes/funnel.router';

export class ChatbotRouter {
  public readonly router: Router;

  constructor(...guards: any[]) {
    this.router = Router();

    this.router.use('/agno', new AgnoRouter(...guards).router);
    this.router.use('/', new FunnelRouter(...guards).router);
  }
}
