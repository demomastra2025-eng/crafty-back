const lastInboundKeyBySession = new Map<string, string>();
const lastInboundKeyUpdatedAt = new Map<string, number>();
const MAX_ENTRIES = 10000;
const TTL_MS = 6 * 60 * 60 * 1000;

function pruneCache(now = Date.now()) {
  for (const [sessionId, updatedAt] of lastInboundKeyUpdatedAt.entries()) {
    if (now - updatedAt > TTL_MS) {
      lastInboundKeyBySession.delete(sessionId);
      lastInboundKeyUpdatedAt.delete(sessionId);
    }
  }

  if (lastInboundKeyBySession.size <= MAX_ENTRIES) return;

  const entries = Array.from(lastInboundKeyUpdatedAt.entries()).sort((a, b) => a[1] - b[1]);
  const overflow = entries.length - MAX_ENTRIES;
  for (let i = 0; i < overflow; i += 1) {
    const sessionId = entries[i]?.[0];
    if (sessionId) {
      lastInboundKeyBySession.delete(sessionId);
      lastInboundKeyUpdatedAt.delete(sessionId);
    }
  }
}

export function setLastInboundKeyId(sessionId: string, keyId: string) {
  if (!sessionId || !keyId) return;
  const now = Date.now();
  lastInboundKeyBySession.set(sessionId, keyId);
  lastInboundKeyUpdatedAt.set(sessionId, now);
  pruneCache(now);
}

export function getLastInboundKeyId(sessionId: string): string | undefined {
  if (!sessionId) return undefined;
  const updatedAt = lastInboundKeyUpdatedAt.get(sessionId);
  if (!updatedAt || Date.now() - updatedAt > TTL_MS) {
    clearLastInboundKeyId(sessionId);
    return undefined;
  }
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
