export class FunnelDto {
  name: string;
  goal: string;
  logic?: string;
  followUpEnable?: boolean;
  status?: string;
  stages?: Array<Record<string, any>>;
}

export class FunnelSessionDto {
  remoteJid: string;
  funnelId?: string | null;
  funnelStage?: number;
  followUpStage?: number;
  funnelEnable?: boolean;
  followUpEnable?: boolean;
  resetStages?: boolean;
}
