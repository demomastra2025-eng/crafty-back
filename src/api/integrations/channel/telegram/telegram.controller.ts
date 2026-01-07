import { PrismaRepository } from '@api/repository/repository.service';
import { WAMonitoringService } from '@api/services/monitor.service';
import { Integration } from '@api/types/wa.types';
import { Logger } from '@config/logger.config';

import { ChannelController, ChannelControllerInterface } from '../channel.controller';

export class TelegramController extends ChannelController implements ChannelControllerInterface {
  private readonly logger = new Logger('TelegramController');

  constructor(prismaRepository: PrismaRepository, waMonitor: WAMonitoringService) {
    super(prismaRepository, waMonitor);
  }

  public async receiveWebhook(data: any, instanceName?: string) {
    if (!instanceName) {
      this.logger.error('WebhookService -> receiveWebhookTelegram -> instance not provided');
      return { status: 'error' };
    }
    const instance = await this.prismaRepository.instance.findFirst({
      where: { name: instanceName },
    });

    if (!instance) {
      this.logger.error('WebhookService -> receiveWebhookTelegram -> instance not found');
      return { status: 'success' };
    }
    if (instance.integration && instance.integration !== Integration.TELEGRAM_BOT) {
      this.logger.error('WebhookService -> receiveWebhookTelegram -> instance integration mismatch');
      return { status: 'success' };
    }

    await this.waMonitor.waInstances[instance.name].connectToWhatsapp(data);

    return { status: 'success' };
  }
}
