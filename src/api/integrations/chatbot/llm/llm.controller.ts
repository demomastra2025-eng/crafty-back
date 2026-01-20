import { PrismaRepository } from '@api/repository/repository.service';

export class LlmModelController {
  constructor(private readonly prismaRepository: PrismaRepository) {}

  public async listModels() {
    return this.prismaRepository.llmModel.findMany({
      orderBy: { createdAt: 'desc' },
    });
  }
}
