import { prismaRepository } from '@api/server.module';
import { Auth, configService } from '@config/env.config';
import { UnauthorizedException } from '@exceptions';
import jwt from 'jsonwebtoken';
import { NextFunction, Request, Response } from 'express';

type JwtPayload = {
  userId: string;
};

export async function userAuthGuard(req: Request, _: Response, next: NextFunction) {
  const authHeader = req.get('Authorization') || '';
  if (!authHeader.startsWith('Bearer ')) {
    throw new UnauthorizedException();
  }

  const token = authHeader.slice(7).trim();
  if (!token) {
    throw new UnauthorizedException();
  }

  try {
    const secret = configService.get<Auth>('AUTHENTICATION').JWT_SECRET;
    const payload = jwt.verify(token, secret) as JwtPayload;
    if (!payload?.userId) {
      throw new UnauthorizedException();
    }
    const user = await prismaRepository.user.findUnique({ where: { id: payload.userId } });
    if (!user) {
      throw new UnauthorizedException();
    }
    req.userId = user.id;
    next();
  } catch {
    throw new UnauthorizedException();
  }
}
