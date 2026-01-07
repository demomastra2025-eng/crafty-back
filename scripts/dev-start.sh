#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SSH_CONFIG="${HOME}/.colima/ssh_config"

cd "${ROOT_DIR}"

echo "[dev-start] Iniciando Colima..."
colima start

echo "[dev-start] Usando contexto Docker do Colima..."
docker context use colima >/dev/null

echo "[dev-start] Limpando containers antigos (se existirem)..."
docker rm -f evolution_minio evolution_redis evolution_postgres evolution_api evolution-api-n8n-1 >/dev/null 2>&1 || true

echo "[dev-start] Subindo Redis, Postgres, MinIO e n8n..."
docker compose -f docker-compose.dev.yaml up -d redis evolution-postgres minio n8n

echo "[dev-start] Abrindo tunel de portas (5432, 6379, 9000, 9001, 5679)..."
ssh -F "${SSH_CONFIG}" -f -N \
  -L 5432:127.0.0.1:5432 \
  -L 6379:127.0.0.1:6379 \
  -L 9000:127.0.0.1:9000 \
  -L 9001:127.0.0.1:9001 \
  -L 5679:127.0.0.1:5679 colima || true

echo "[dev-start] Gerando Prisma Client e aplicando migracoes..."
export DATABASE_PROVIDER=postgresql
npm run db:generate
npm run db:migrate:dev

echo "[dev-start] Iniciando API (dev)..."
npm run dev:server
