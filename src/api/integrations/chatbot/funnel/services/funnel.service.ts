import { InstanceDto } from '@api/dto/instance.dto';
import { PrismaRepository } from '@api/repository/repository.service';
import { ConfigService } from '@config/env.config';
import { Logger } from '@config/logger.config';

import { AgnoCache } from '../../agno/agno-cache';
import { FunnelDto, FunnelSessionDto } from '../dto/funnel.dto';

export class FunnelService {
  private readonly logger = new Logger('FunnelService');
  private readonly agnoCache: AgnoCache;

  constructor(
    private readonly prismaRepository: PrismaRepository,
    configService: ConfigService,
  ) {
    this.agnoCache = new AgnoCache(configService);
  }

  private funnelCacheKey(funnelId: string): string {
    return `funnel:${funnelId}`;
  }

  private normalizeStages(stages: unknown): Array<Record<string, any>> | undefined {
    if (stages === undefined) return undefined;
    if (Array.isArray(stages)) return stages as Array<Record<string, any>>;
    if (typeof stages === 'string') {
      try {
        const parsed = JSON.parse(stages);
        return Array.isArray(parsed) ? (parsed as Array<Record<string, any>>) : undefined;
      } catch {
        this.logger.warn('Failed to parse funnel stages JSON');
        return undefined;
      }
    }
    return undefined;
  }

  private async resolveInstance(instance: InstanceDto) {
    const record = await this.prismaRepository.instance.findFirst({
      where: { name: instance.instanceName },
      select: { id: true, companyId: true },
    });
    if (!record) {
      throw new Error('Instance not found');
    }
    return record;
  }

  public async createFunnel(instance: InstanceDto, data: FunnelDto) {
    const instanceRecord = await this.resolveInstance(instance);
    const stages = this.normalizeStages(data.stages);
    if (!stages) {
      throw new Error('Invalid funnel stages');
    }

    const funnel = await this.prismaRepository.funnel.create({
      data: {
        name: data.name,
        goal: data.goal,
        logic: data.logic || null,
        followUpEnable: data.followUpEnable ?? true,
        status: data.status || 'active',
        stages: stages ?? [],
        instanceId: instanceRecord.id,
        companyId: instanceRecord.companyId,
      },
    });

    await this.agnoCache.delete(this.funnelCacheKey(funnel.id));
    return funnel;
  }

  public async listFunnels(instance: InstanceDto) {
    const instanceRecord = await this.resolveInstance(instance);

    return await this.prismaRepository.funnel.findMany({
      where: { instanceId: instanceRecord.id },
      orderBy: { updatedAt: 'desc' },
    });
  }

  public async fetchFunnel(instance: InstanceDto, funnelId: string) {
    const instanceRecord = await this.resolveInstance(instance);

    return await this.prismaRepository.funnel.findFirst({
      where: { id: funnelId, instanceId: instanceRecord.id },
    });
  }

  public async updateFunnel(instance: InstanceDto, funnelId: string, data: FunnelDto) {
    const existing = await this.fetchFunnel(instance, funnelId);
    if (!existing) {
      throw new Error('Funnel not found');
    }

    const updateData: Record<string, any> = {};
    if (data.name !== undefined) updateData.name = data.name;
    if (data.goal !== undefined) updateData.goal = data.goal;
    if (data.logic !== undefined) updateData.logic = data.logic || null;
    if (data.followUpEnable !== undefined) updateData.followUpEnable = data.followUpEnable;
    if (data.status !== undefined) updateData.status = data.status;
    if (data.stages !== undefined) {
      const stages = this.normalizeStages(data.stages);
      if (!stages) {
        throw new Error('Invalid funnel stages');
      }
      updateData.stages = stages ?? [];
    }

    const funnel = await this.prismaRepository.funnel.update({
      where: { id: existing.id },
      data: updateData,
    });

    await this.agnoCache.delete(this.funnelCacheKey(funnel.id));
    return funnel;
  }

  public async deleteFunnel(instance: InstanceDto, funnelId: string) {
    const existing = await this.fetchFunnel(instance, funnelId);
    if (!existing) {
      throw new Error('Funnel not found');
    }

    const instanceRecord = await this.resolveInstance(instance);
    await this.prismaRepository.agno.updateMany({
      where: { instanceId: instanceRecord.id, funnelId: existing.id },
      data: { funnelId: null },
    });
    await this.prismaRepository.integrationSession.updateMany({
      where: { instanceId: instanceRecord.id, funnelId: existing.id },
      data: {
        funnelId: null,
        funnelEnable: false,
        followUpEnable: false,
        funnelStage: null,
        followUpStage: null,
      },
    });
    await this.prismaRepository.funnel.delete({
      where: { id: existing.id },
    });

    await this.agnoCache.delete(this.funnelCacheKey(existing.id));
    return { deleted: true };
  }

  public async updateSessionFunnel(instance: InstanceDto, data: FunnelSessionDto) {
    const instanceRecord = await this.resolveInstance(instance);
    const session = await this.prismaRepository.integrationSession.findFirst({
      where: {
        instanceId: instanceRecord.id,
        remoteJid: data.remoteJid,
      },
      orderBy: { updatedAt: 'desc' },
    });

    if (!session) {
      return null;
    }

    const updateData: Record<string, any> = {};
    if (data.resetStages) {
      updateData.funnelStage = 0;
      updateData.followUpStage = 0;
    }

    if (data.funnelId !== undefined) {
      if (data.funnelId) {
        const funnel = await this.prismaRepository.funnel.findFirst({
          where: { id: data.funnelId, instanceId: instanceRecord.id },
        });
        if (!funnel) {
          throw new Error('Funnel not found');
        }
        updateData.funnelId = funnel.id;
        updateData.funnelStage = 0;
        updateData.followUpStage = 0;
        updateData.funnelEnable = true;
        updateData.followUpEnable = data.followUpEnable ?? funnel.followUpEnable ?? true;
      } else {
        updateData.funnelId = null;
        updateData.funnelStage = null;
        updateData.followUpStage = null;
        updateData.funnelEnable = false;
        updateData.followUpEnable = false;
      }
    }

    if (data.funnelStage !== undefined) {
      updateData.funnelStage = data.funnelStage;
      if (data.followUpStage === undefined && session.funnelStage !== data.funnelStage) {
        updateData.followUpStage = 0;
      }
    }
    if (data.followUpStage !== undefined) updateData.followUpStage = data.followUpStage;
    if (data.funnelEnable !== undefined) updateData.funnelEnable = data.funnelEnable;
    if (data.followUpEnable !== undefined) updateData.followUpEnable = data.followUpEnable;

    if (updateData.funnelEnable === false) {
      updateData.followUpEnable = false;
    }

    return await this.prismaRepository.integrationSession.update({
      where: { id: session.id },
      data: updateData,
    });
  }
}
