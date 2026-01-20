import { CompanyCreateDto } from '@api/dto/company.dto';
import { CredentialsCreateDto } from '@api/dto/credentials.dto';
import { PrismaRepository } from '@api/repository/repository.service';
import { generateApiKey } from '@api/utils/api-key';
import { decryptApiKey, encryptApiKey } from '@api/utils/key-encryption';
import { BadRequestException, ForbiddenException, NotFoundException } from '@exceptions';

const OWNER_ROLES = new Set(['owner', 'admin']);

export class CompanyController {
  constructor(private readonly prismaRepository: PrismaRepository) {}

  private normalizeAgnoPorts(raw?: number[] | null): number[] | null {
    if (!Array.isArray(raw)) return null;
    const ports = raw.map((value) => Number(value)).filter((value) => Number.isInteger(value) && value > 0);
    return ports.length ? Array.from(new Set(ports)) : [];
  }

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

  private maskApiKey(apiKey?: string | null): string | null {
    if (!apiKey) return null;
    if (apiKey.length <= 8) return '****';
    return `${apiKey.slice(0, 4)}****${apiKey.slice(-4)}`;
  }

  public async listCompanies(userId: string) {
    const rows = await this.prismaRepository.companyMember.findMany({
      where: { userId },
      select: {
        role: true,
        Company: { select: { id: true, name: true, createdAt: true, agnoPorts: true } },
      },
      orderBy: { Company: { createdAt: 'desc' } },
    });
    return rows.map((row) => ({
      id: row.Company.id,
      name: row.Company.name,
      role: row.role,
      agnoPorts: Array.isArray(row.Company.agnoPorts) ? row.Company.agnoPorts : [],
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

    const agnoPorts = this.normalizeAgnoPorts(data.agnoPorts);

    return this.prismaRepository.$transaction(async (tx) => {
      const company = await tx.company.create({
        data: { name, agnoPorts: agnoPorts ?? undefined },
        select: { id: true, name: true, createdAt: true, agnoPorts: true },
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

  public async updateCompany(userId: string, companyId: string, data: { agnoPorts?: number[] }) {
    await this.requireMember(companyId, userId, true);
    const agnoPorts = this.normalizeAgnoPorts(data.agnoPorts);
    return this.prismaRepository.company.update({
      where: { id: companyId },
      data: { agnoPorts: agnoPorts ?? undefined },
      select: { id: true, name: true, createdAt: true, agnoPorts: true },
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

  public async listCredentials(userId: string, companyId: string) {
    await this.requireMember(companyId, userId);
    const rows = await this.prismaRepository.credentials.findMany({
      where: { companyId },
      select: { id: true, name: true, provider: true, url: true, apiKey: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      provider: row.provider,
      url: row.url,
      apiKey: this.maskApiKey(row.apiKey),
      createdAt: row.createdAt,
    }));
  }

  public async createCredential(userId: string, companyId: string, data: CredentialsCreateDto) {
    await this.requireMember(companyId, userId, true);
    const name = data.name.trim();
    const provider = data.provider.trim();
    const apiKey = data.apiKey.trim();
    const url = data.url?.trim() || null;

    if (!name || !provider || !apiKey) {
      throw new BadRequestException('Credential fields are required');
    }

    try {
      const created = await this.prismaRepository.credentials.create({
        data: {
          name,
          provider,
          apiKey,
          url: url ?? undefined,
          companyId,
        },
        select: { id: true, name: true, provider: true, url: true, apiKey: true, createdAt: true },
      });
      return {
        ...created,
        apiKey: this.maskApiKey(created.apiKey),
      };
    } catch {
      throw new BadRequestException('Failed to create credentials');
    }
  }

  public async deleteCredential(userId: string, companyId: string, credentialId: string) {
    await this.requireMember(companyId, userId, true);
    const existing = await this.prismaRepository.credentials.findFirst({
      where: { id: credentialId, companyId },
      select: { id: true },
    });
    if (!existing) {
      throw new NotFoundException('Credentials not found');
    }
    await this.prismaRepository.credentials.delete({ where: { id: credentialId } });
    return { id: credentialId };
  }
}
