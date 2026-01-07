-- Create enum for company roles (if not exists)
DO $$
BEGIN
  CREATE TYPE "CompanyRole" AS ENUM ('owner', 'admin', 'member');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Add companyId to Instance
ALTER TABLE "Instance" ADD COLUMN IF NOT EXISTS "companyId" VARCHAR(100);
CREATE INDEX IF NOT EXISTS "Instance_companyId_idx" ON "Instance"("companyId");

-- Create User table
CREATE TABLE IF NOT EXISTS "User" (
    "id" TEXT NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "passwordHash" VARCHAR(255) NOT NULL,
    "name" VARCHAR(100),
    "createdAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "User_email_key" ON "User"("email");

-- Create Company table
CREATE TABLE IF NOT EXISTS "Company" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "createdAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP NOT NULL,

    CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Company_name_key" ON "Company"("name");

-- Create CompanyMember table
CREATE TABLE IF NOT EXISTS "CompanyMember" (
    "id" TEXT NOT NULL,
    "role" "CompanyRole" NOT NULL DEFAULT 'member',
    "createdAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,

    CONSTRAINT "CompanyMember_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "CompanyMember_userId_companyId_key" ON "CompanyMember"("userId", "companyId");
CREATE INDEX IF NOT EXISTS "CompanyMember_companyId_idx" ON "CompanyMember"("companyId");
CREATE INDEX IF NOT EXISTS "CompanyMember_userId_idx" ON "CompanyMember"("userId");

-- Create ApiKey table
CREATE TABLE IF NOT EXISTS "ApiKey" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(100),
    "keyHash" VARCHAR(128) NOT NULL,
    "prefix" VARCHAR(16) NOT NULL,
    "createdAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP,
    "revokedAt" TIMESTAMP,
    "companyId" TEXT NOT NULL,

    CONSTRAINT "ApiKey_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ApiKey_keyHash_key" ON "ApiKey"("keyHash");
CREATE INDEX IF NOT EXISTS "ApiKey_companyId_idx" ON "ApiKey"("companyId");

-- Foreign keys
DO $$
BEGIN
  ALTER TABLE "Instance" ADD CONSTRAINT "Instance_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "CompanyMember" ADD CONSTRAINT "CompanyMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "CompanyMember" ADD CONSTRAINT "CompanyMember_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "ApiKey" ADD CONSTRAINT "ApiKey_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
