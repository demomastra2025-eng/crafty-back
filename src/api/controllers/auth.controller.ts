import { AuthLoginDto, AuthRegisterDto } from '@api/dto/auth.dto';
import { PrismaRepository } from '@api/repository/repository.service';
import { hashPassword, verifyPassword } from '@api/utils/password';
import { Auth, ConfigService } from '@config/env.config';
import { BadRequestException, UnauthorizedException } from '@exceptions';
import jwt from 'jsonwebtoken';

type SafeUser = {
  id: string;
  email: string;
  name?: string | null;
};

export class AuthController {
  private readonly jwtSecret: string;
  private readonly jwtExpiresIn: string;

  constructor(
    private readonly prismaRepository: PrismaRepository,
    configService: ConfigService,
  ) {
    const auth = configService.get<Auth>('AUTHENTICATION');
    this.jwtSecret = auth.JWT_SECRET;
    this.jwtExpiresIn = auth.JWT_EXPIRES_IN;
  }

  private normalizeEmail(email: string) {
    return email.trim().toLowerCase();
  }

  private toSafeUser(user: { id: string; email: string; name?: string | null }): SafeUser {
    return { id: user.id, email: user.email, name: user.name ?? null };
  }

  private issueToken(userId: string) {
    return jwt.sign({ userId }, this.jwtSecret, { expiresIn: this.jwtExpiresIn });
  }

  public async register(data: AuthRegisterDto) {
    const email = this.normalizeEmail(data.email);
    const existing = await this.prismaRepository.user.findUnique({ where: { email } });
    if (existing) {
      throw new BadRequestException('Email already registered');
    }

    const user = await this.prismaRepository.user.create({
      data: {
        email,
        name: data.name?.trim() || null,
        passwordHash: hashPassword(data.password),
      },
      select: { id: true, email: true, name: true },
    });

    return {
      token: this.issueToken(user.id),
      user: this.toSafeUser(user),
    };
  }

  public async login(data: AuthLoginDto) {
    const email = this.normalizeEmail(data.email);
    const user = await this.prismaRepository.user.findUnique({
      where: { email },
      select: { id: true, email: true, name: true, passwordHash: true },
    });
    if (!user || !verifyPassword(data.password, user.passwordHash)) {
      throw new UnauthorizedException();
    }

    return {
      token: this.issueToken(user.id),
      user: this.toSafeUser(user),
    };
  }

  public async me(userId: string) {
    const user = await this.prismaRepository.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, name: true },
    });
    if (!user) {
      throw new UnauthorizedException();
    }
    return this.toSafeUser(user);
  }
}
