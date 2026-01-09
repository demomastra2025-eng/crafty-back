import { CompanyCreateDto } from '@api/dto/company.dto';
import { PrismaRepository } from '@api/repository/repository.service';
import { generateApiKey } from '@api/utils/api-key';
import { decryptApiKey, encryptApiKey } from '@api/utils/key-encryption';
import { BadRequestException, ForbiddenException, NotFoundException } from '@exceptions';

const OWNER_ROLES = new Set(['owner', 'admin']);

export class CompanyController {
  constructor(private readonly prismaRepository: PrismaRepository) {}

  private async requireMember(companyId: string, userId: string, requireAdmin = false) {
    const membership = await this.prismaRepository.companyMember.findUnique({
      where: { userId_companyId: { userId, companyId } },
      select: { role: true },
    });
    if (!membership) {
      throw new ForbiddenException('Access denied');
    }
    if (requireAdmin && !OWNER_ROLES.has(membership.role)) {
      throw new ForbiddenException('Insufficient role');
    }
    return membership;
  }

  public async listCompanies(userId: string) {
    const rows = await this.prismaRepository.companyMember.findMany({
      where: { userId },
      select: {
        role: true,
        Company: { select: { id: true, name: true, createdAt: true } },
      },
      orderBy: { Company: { createdAt: 'desc' } },
    });
    return rows.map((row) => ({
      id: row.Company.id,
      name: row.Company.name,
      role: row.role,
      createdAt: row.Company.createdAt,
    }));
  }

  public async createCompany(userId: string, data: CompanyCreateDto) {
    const existingMembership = await this.prismaRepository.companyMember.findFirst({
      where: { userId },
      select: { companyId: true },
    });
    if (existingMembership) {
      throw new BadRequestException('Company already exists for this user');
    }

    const name = data.name.trim();
    if (!name) {
      throw new BadRequestException('Company name is required');
    }

    return this.prismaRepository.$transaction(async (tx) => {
      const company = await tx.company.create({
        data: { name },
        select: { id: true, name: true, createdAt: true },
      });
      await tx.companyMember.create({
        data: { companyId: company.id, userId, role: 'owner' },
      });
      const { raw, hash, prefix } = generateApiKey();
      const { encryptedKey, keyIv } = encryptApiKey(raw);
      await tx.apiKey.create({
        data: {
          companyId: company.id,
          name: 'primary',
          keyHash: hash,
          prefix,
          isPrimary: true,
          encryptedKey,
          keyIv,
        },
      });
      return { ...company, primaryKey: raw };
    });
  }

  public async rotatePrimaryKey(userId: string, companyId: string) {
    await this.requireMember(companyId, userId);
    const { raw, hash, prefix } = generateApiKey();
    const { encryptedKey, keyIv } = encryptApiKey(raw);
    const existing = await this.prismaRepository.apiKey.findFirst({
      where: { companyId, isPrimary: true },
      select: { id: true },
    });
    if (existing) {
      await this.prismaRepository.apiKey.update({
        where: { id: existing.id },
        data: {
          keyHash: hash,
          prefix,
          encryptedKey,
          keyIv,
          revokedAt: null,
        },
      });
    } else {
      await this.prismaRepository.apiKey.create({
        data: {
          companyId,
          name: 'primary',
          keyHash: hash,
          prefix,
          isPrimary: true,
          encryptedKey,
          keyIv,
        },
      });
    }
    return { apiKey: raw };
  }

  public async getPrimaryKey(userId: string, companyId: string) {
    await this.requireMember(companyId, userId);
    const key = await this.prismaRepository.apiKey.findFirst({
      where: { companyId, isPrimary: true, revokedAt: null },
      select: { encryptedKey: true, keyIv: true },
    });
    if (!key?.encryptedKey || !key?.keyIv) {
      throw new NotFoundException('Primary key not found');
    }
    return { apiKey: decryptApiKey(key.encryptedKey, key.keyIv) };
  }
}
