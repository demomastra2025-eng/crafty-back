import { PrismaRepository } from '@api/repository/repository.service';
import { WAMonitoringService } from '@api/services/monitor.service';
import { Logger } from '@config/logger.config';
import { IntegrationSession, N8n, N8nSetting } from '@prisma/client';
import cron, { ScheduledTask } from 'node-cron';

import { N8nService } from '../../n8n/services/n8n.service';

type FunnelStep = {
  stage: number;
  touch: number;
  delayMin: number;
  template?: string;
  condition?: string;
  title?: string;
  objective?: string;
  logicStage?: string;
  commonTouchCondition?: string;
};

export class FunnelFollowUpService {
  private readonly logger = new Logger('FunnelFollowUpService');
  private scheduler: ScheduledTask;

  constructor(
    private readonly prismaRepository: PrismaRepository,
    private readonly waMonitor: WAMonitoringService,
    private readonly n8nService: N8nService,
  ) {}

  public startScheduler() {
    if (this.scheduler) return;
    this.scheduler = cron.schedule('*/1 * * * *', async () => {
      try {
        await this.processPendingFollowUps();
      } catch (error) {
        this.logger.error(['Funnel follow-up scheduler error', error?.message || error]);
      }
    });
  }

  private normalizeStages(stages: unknown): Array<Record<string, any>> {
    if (Array.isArray(stages)) return stages as Array<Record<string, any>>;
    if (typeof stages === 'string') {
      try {
        const parsed = JSON.parse(stages);
        return Array.isArray(parsed) ? (parsed as Array<Record<string, any>>) : [];
      } catch {
        this.logger.warn('Failed to parse funnel stages JSON');
        return [];
      }
    }
    return [];
  }

  private flattenStages(stages: Array<Record<string, any>>): FunnelStep[] {
    const steps: FunnelStep[] = [];
    stages.forEach((stage, stageIndex) => {
      const touches = Array.isArray(stage?.touches) ? stage.touches : [];
      const stageNumber = Number(stage?.stage) || stageIndex + 1;
      const title = stage?.title ? String(stage.title) : `Stage ${stageNumber}`;
      const objective = stage?.objective ? String(stage.objective) : undefined;
      const logicStage = stage?.logicStage ? String(stage.logicStage) : undefined;
      const commonTouchCondition = stage?.commonTouchCondition ? String(stage.commonTouchCondition) : undefined;
      touches.forEach((touch: Record<string, any>, idx: number) => {
        const delayMin = Number(touch?.delayMin);
        if (!Number.isFinite(delayMin) || delayMin < 0) return;
        steps.push({
          stage: stageNumber,
          touch: Number(touch?.touch) || idx + 1,
          delayMin,
          template: touch?.template ? String(touch.template) : undefined,
          condition: touch?.condition ? String(touch.condition) : undefined,
          title,
          objective,
          logicStage,
          commonTouchCondition,
        });
      });
    });
    return steps;
  }

  public async processPendingFollowUps(instanceName?: string) {
    const instanceRecord = instanceName
      ? await this.prismaRepository.instance.findFirst({ where: { name: instanceName } })
      : null;

    const sessionWhere: Record<string, any> = {
      status: 'opened',
      awaitUser: true,
      followUpEnable: true,
      funnelId: { not: null },
      type: 'n8n',
    };

    if (instanceRecord) {
      sessionWhere.instanceId = instanceRecord.id;
    }

    const sessions = await this.prismaRepository.integrationSession.findMany({
      where: sessionWhere,
      select: {
        id: true,
        remoteJid: true,
        followUpStage: true,
        context: true,
        botId: true,
        instanceId: true,
        funnelId: true,
        funnelEnable: true,
      },
    });

    if (!sessions.length) return;

    const funnelIds = Array.from(new Set(sessions.map((session) => session.funnelId).filter(Boolean)));
    const funnels = await this.prismaRepository.funnel.findMany({
      where: { id: { in: funnelIds } },
    });
    const funnelMap = new Map<string, any>(funnels.map((funnel) => [funnel.id, funnel]));

    for (const session of sessions) {
      if (!session.funnelId) continue;
      const funnel = funnelMap.get(session.funnelId);
      if (!funnel) continue;
      if (funnel.followUpEnable === false) continue;
      if (!session.funnelEnable) continue;

      const funnelStages = this.normalizeStages(funnel.stages);
      const steps = this.flattenStages(funnelStages);
      const stepIndex = session.followUpStage ?? 0;
      if (!steps.length || stepIndex >= steps.length) continue;

      const step = steps[stepIndex];
      const delayMin = Number(step?.delayMin);
      if (!Number.isFinite(delayMin) || delayMin < 0) continue;

      const context =
        session.context && typeof session.context === 'object' ? (session.context as Record<string, any>) : {};
      const lastInboundAt = Number(context?.lastInboundAt);
      const lastOutboundAt = Number(context?.lastOutboundAt);
      const lastOutboundBy = context?.lastOutboundBy;
      const referenceAtCandidates = [lastInboundAt, lastOutboundAt].filter(
        (value) => Number.isFinite(value) && value > 0,
      ) as number[];
      const referenceAt = referenceAtCandidates.length ? Math.max(...referenceAtCandidates) : null;

      if (!referenceAt) continue;
      if (lastOutboundBy === 'manager') continue;
      if (lastOutboundAt && lastInboundAt > lastOutboundAt) continue;

      const now = Math.floor(Date.now() / 1000);
      if (now - referenceAt < delayMin * 60) continue;

      if (!session.botId) continue;

      const [bot, settings, instanceInfo] = await Promise.all([
        this.prismaRepository.n8n.findFirst({ where: { id: session.botId } }),
        this.prismaRepository.n8nSetting.findFirst({ where: { instanceId: session.instanceId } }),
        this.prismaRepository.instance.findFirst({ where: { id: session.instanceId } }),
      ]);

      if (!bot || !settings || !instanceInfo) continue;

      const waInstance = this.waMonitor.waInstances[instanceInfo.name];
      if (!waInstance) continue;

      const sent = await this.sendFollowUpToN8n(
        waInstance,
        session as IntegrationSession,
        settings as N8nSetting,
        bot as N8n,
        funnel,
        steps,
        stepIndex,
      );

      if (!sent) continue;

      await this.prismaRepository.integrationSession.update({
        where: { id: session.id },
        data: { followUpStage: stepIndex + 1 },
      });
    }
  }

  private async sendFollowUpToN8n(
    instance: any,
    session: IntegrationSession,
    settings: N8nSetting,
    bot: N8n,
    funnel: any,
    steps: FunnelStep[],
    stepIndex: number,
  ): Promise<boolean> {
    try {
      return await this.n8nService.sendFollowUpStep(instance, session, settings, bot, funnel, steps, stepIndex);
    } catch (error) {
      this.logger.error(['Failed to send funnel follow-up', error?.message || error]);
      return false;
    }
  }
}
