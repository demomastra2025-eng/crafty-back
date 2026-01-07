const lastInboundKeyBySession = new Map<string, string>();
const lastInboundKeyUpdatedAt = new Map<string, number>();

export function setLastInboundKeyId(sessionId: string, keyId: string) {
  if (!sessionId || !keyId) return;
  lastInboundKeyBySession.set(sessionId, keyId);
  lastInboundKeyUpdatedAt.set(sessionId, Date.now());
}

export function getLastInboundKeyId(sessionId: string): string | undefined {
  if (!sessionId) return undefined;
  return lastInboundKeyBySession.get(sessionId);
}

export function getLastInboundKeyAgeMs(sessionId: string): number | undefined {
  if (!sessionId) return undefined;
  const ts = lastInboundKeyUpdatedAt.get(sessionId);
  if (!ts) return undefined;
  return Date.now() - ts;
}

export function clearLastInboundKeyId(sessionId: string) {
  if (!sessionId) return;
  lastInboundKeyBySession.delete(sessionId);
  lastInboundKeyUpdatedAt.delete(sessionId);
}
