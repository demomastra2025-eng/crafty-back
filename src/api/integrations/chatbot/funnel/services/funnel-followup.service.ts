import { PrismaRepository } from '@api/repository/repository.service';
import { WAMonitoringService } from '@api/services/monitor.service';
import { Logger } from '@config/logger.config';
import { Agno, AgnoSetting, IntegrationSession } from '@prisma/client';
import cron, { ScheduledTask } from 'node-cron';

import { AgnoService } from '../../agno/services/agno.service';

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
    private readonly agnoService: AgnoService,
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
      type: { in: ['agno'] },
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
        type: true,
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

      const instanceInfo = await this.prismaRepository.instance.findFirst({ where: { id: session.instanceId } });
      if (!instanceInfo) continue;

      if (session.type === 'agno') {
        const [bot, settings] = await Promise.all([
          this.prismaRepository.agno.findFirst({ where: { id: session.botId } }),
          this.prismaRepository.agnoSetting.findFirst({ where: { instanceId: session.instanceId } }),
        ]);
        if (!bot || !settings) continue;

        const waInstance = this.waMonitor.waInstances[instanceInfo.name];
        if (!waInstance) continue;

        const sent = await this.sendFollowUpToAgno(
          waInstance,
          session as IntegrationSession,
          settings as AgnoSetting,
          bot as Agno,
          funnel,
          steps,
          stepIndex,
        );

        if (!sent) continue;

        await this.prismaRepository.integrationSession.update({
          where: { id: session.id },
          data: { followUpStage: stepIndex + 1 },
        });

        continue;
      }
    }
  }

  private async sendFollowUpToAgno(
    instance: any,
    session: IntegrationSession,
    settings: AgnoSetting,
    bot: Agno,
    funnel: any,
    steps: FunnelStep[],
    stepIndex: number,
  ): Promise<boolean> {
    try {
      return await this.agnoService.sendFollowUpStep(instance, session, settings, bot, funnel, steps, stepIndex);
    } catch (error) {
      this.logger.error(['Failed to send funnel follow-up', error?.message || error]);
      return false;
    }
  }
}
