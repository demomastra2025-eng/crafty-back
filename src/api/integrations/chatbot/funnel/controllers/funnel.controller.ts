import { InstanceDto } from '@api/dto/instance.dto';
import { Logger } from '@config/logger.config';

import { FunnelDto, FunnelSessionDto } from '../dto/funnel.dto';
import { FunnelService } from '../services/funnel.service';

export class FunnelController {
  public readonly logger = new Logger('FunnelController');

  constructor(private readonly funnelService: FunnelService) {}

  public async createFunnel(instance: InstanceDto, data: FunnelDto) {
    return this.funnelService.createFunnel(instance, data);
  }

  public async listFunnels(instance: InstanceDto) {
    return this.funnelService.listFunnels(instance);
  }

  public async fetchFunnel(instance: InstanceDto, funnelId: string) {
    return this.funnelService.fetchFunnel(instance, funnelId);
  }

  public async updateFunnel(instance: InstanceDto, funnelId: string, data: FunnelDto) {
    return this.funnelService.updateFunnel(instance, funnelId, data);
  }

  public async deleteFunnel(instance: InstanceDto, funnelId: string) {
    return this.funnelService.deleteFunnel(instance, funnelId);
  }

  public async updateSession(instance: InstanceDto, data: FunnelSessionDto) {
    return this.funnelService.updateSessionFunnel(instance, data);
  }
}
