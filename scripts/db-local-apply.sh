#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# CRM Suporte — aplica migrations + seed no Postgres LOCAL
# (container crm-suporte-db do docker-compose.yml).
#
#   ./scripts/db-local-apply.sh
#
# Idempotente: as migrations usam IF NOT EXISTS / CREATE OR REPLACE
# e o seed usa ON CONFLICT, então rodar de novo é seguro.
# ============================================================

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DB_CONTAINER="crm-suporte-db"

if ! docker ps --format '{{.Names}}' | grep -qx "$DB_CONTAINER"; then
  echo "❌ Container $DB_CONTAINER não está rodando. Suba com: docker compose up -d db"
  exit 1
fi

echo "▶ Aplicando migrations (supabase/migrations/*.sql, em ordem)…"
for f in "$PROJECT_DIR"/supabase/migrations/*.sql; do
  echo "  · $(basename "$f")"
  docker exec -i "$DB_CONTAINER" psql -q -U postgres -d postgres -v ON_ERROR_STOP=1 <"$f"
done

if [ -f "$PROJECT_DIR/supabase/seed.sql" ]; then
  echo "▶ Aplicando seed (supabase/seed.sql)…"
  docker exec -i "$DB_CONTAINER" psql -q -U postgres -d postgres -v ON_ERROR_STOP=1 <"$PROJECT_DIR/supabase/seed.sql"
fi

# PostgREST cacheia o schema; avisa para recarregar sem reiniciar o container.
docker exec "$DB_CONTAINER" psql -q -U postgres -d postgres -c "notify pgrst, 'reload schema';" >/dev/null

echo "✅ Banco local pronto. Login do app: admin@local / 123456"
