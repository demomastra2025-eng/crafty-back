import { InstanceDto } from '@api/dto/instance.dto';
import { prismaRepository } from '@api/server.module';
import { hashApiKey } from '@api/utils/api-key';
import { Logger } from '@config/logger.config';
import { ForbiddenException, UnauthorizedException } from '@exceptions';
import { NextFunction, Request, Response } from 'express';

const logger = new Logger('GUARD');

async function apikey(req: Request, _: Response, next: NextFunction) {
  const key = req.get('apikey');

  if (!key) {
    if (req.originalUrl.includes('/instance/create') || req.originalUrl.includes('/instance/fetchInstances')) {
      throw new ForbiddenException('Missing global api key', 'The global api key must be set');
    }
    throw new UnauthorizedException();
  }
  const param = req.params as unknown as InstanceDto;

  try {
    const apiKeyHash = hashApiKey(key);
    const apiKey = await prismaRepository.apiKey.findFirst({
      where: { keyHash: apiKeyHash, revokedAt: null },
      select: { id: true, companyId: true, lastUsedAt: true },
    });

    if (apiKey) {
      req.companyId = apiKey.companyId;
      req.apiKeyId = apiKey.id;

      if (param?.instanceName) {
        const instance = await prismaRepository.instance.findUnique({
          where: { name: param.instanceName },
          select: { id: true, companyId: true },
        });
        if (!instance) {
          throw new UnauthorizedException();
        }
        if (!instance.companyId) {
          await prismaRepository.instance.update({
            where: { id: instance.id },
            data: { companyId: apiKey.companyId },
          });
        } else if (instance.companyId !== apiKey.companyId) {
          throw new UnauthorizedException();
        }
      }

      const lastUsedAt = apiKey.lastUsedAt?.getTime() || 0;
      if (Date.now() - lastUsedAt > 5 * 60 * 1000) {
        await prismaRepository.apiKey.update({
          where: { id: apiKey.id },
          data: { lastUsedAt: new Date() },
        });
      }

      return next();
    }

    if (param?.instanceName) {
      const instance = await prismaRepository.instance.findUnique({
        where: { name: param.instanceName },
        select: { id: true, companyId: true, token: true },
      });

      if (instance?.token && instance.token === key) {
        req.companyId = instance.companyId || undefined;
        req.instanceId = instance.id;
        return next();
      }
    }
  } catch (error) {
    logger.error(error);
  }

  throw new UnauthorizedException();
}

export const authGuard = { apikey };
