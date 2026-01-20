import { ConfigService, SessionMessagesCacheConf } from '@config/env.config';
import { Logger } from '@config/logger.config';
import NodeCache from 'node-cache';
import { createClient, RedisClientType } from 'redis';

export class SessionMessagesCache {
  private readonly logger = new Logger('SessionMessagesCache');
  private readonly conf: SessionMessagesCacheConf;
  private readonly localCache: NodeCache;
  private client: RedisClientType | null = null;

  constructor(configService: ConfigService) {
    this.conf = configService.get<SessionMessagesCacheConf>('SESSION_MESSAGES_CACHE') || {
      ENABLED: false,
      URI: '',
      PREFIX_KEY: 'session-messages',
      TTL: 3600,
    };
    this.localCache = new NodeCache({ stdTTL: this.conf.TTL || 3600, useClones: false, checkperiod: 7200 });

    if (this.conf.ENABLED && this.conf.URI) {
      this.client = createClient({ url: this.conf.URI });
      this.client.on('error', (err) => this.logger.error(`redis error: ${err?.message || err}`));
      this.client.on('connect', () => this.logger.verbose('redis connecting'));
      this.client.on('ready', () => this.logger.verbose('redis ready'));
      this.client.connect().catch((err) => this.logger.error(`redis connect error: ${err?.message || err}`));
    }
  }

  private buildKey(key: string) {
    return `${this.conf.PREFIX_KEY}:${key}`;
  }

  public async get<T = unknown>(key: string): Promise<T | undefined> {
    const cacheKey = this.buildKey(key);
    if (this.client) {
      try {
        const raw = await this.client.get(cacheKey);
        return raw ? (JSON.parse(raw) as T) : undefined;
      } catch (error) {
        this.logger.error(`redis get error: ${error?.message || error}`);
      }
    }
    return this.localCache.get(cacheKey) as T | undefined;
  }

  public async set(key: string, value: unknown, ttl?: number): Promise<void> {
    const cacheKey = this.buildKey(key);
    const ttlSeconds = typeof ttl === 'number' && ttl > 0 ? ttl : this.conf.TTL || 3600;
    if (this.client) {
      try {
        await this.client.setEx(cacheKey, ttlSeconds, JSON.stringify(value));
        return;
      } catch (error) {
        this.logger.error(`redis set error: ${error?.message || error}`);
      }
    }
    this.localCache.set(cacheKey, value, ttlSeconds);
  }

  public async delete(key: string): Promise<void> {
    const cacheKey = this.buildKey(key);
    if (this.client) {
      try {
        await this.client.del(cacheKey);
      } catch (error) {
        this.logger.error(`redis delete error: ${error?.message || error}`);
      }
    }
    this.localCache.del(cacheKey);
  }
}
