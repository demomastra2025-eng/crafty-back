import { Multer } from 'multer';

declare global {
  namespace Express {
    interface Request {
      file?: Multer.File;
      files?: Multer.File[];
      userId?: string;
      companyId?: string;
      apiKeyId?: string;
    }
  }
}
