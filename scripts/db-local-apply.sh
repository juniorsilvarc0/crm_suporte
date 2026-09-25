#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# CRM Suporte — aplica migrations + seed no Postgres LOCAL
# (container crm-suporte-db do docker-compose.yml).
#
#   ./scripts/db-local-apply.sh
#
# Livro-razão: cada migration roda UMA vez, numa transação só, e fica
# registrada em supabase_migrations.schema_migrations (fora de `public`, então o
# PostgREST não a expõe). Rodar de novo só aplica o que for novo. O seed é
# idempotente e roda sempre.
#
# ⚠️ Nunca aponte este script para um banco que não seja o local.
# ============================================================

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DB_CONTAINER="crm-suporte-db"

psql_db() {
  docker exec -i "$DB_CONTAINER" psql -q -U postgres -d postgres -v ON_ERROR_STOP=1 "$@"
}

if ! docker ps --format '{{.Names}}' | grep -qx "$DB_CONTAINER"; then
  echo "❌ Container $DB_CONTAINER não está rodando. Suba com: docker compose up -d --wait"
  exit 1
fi

# As migrations gravam em storage.buckets, e quem cria o schema `storage` é o
# storage-api ao subir. Rodar antes dele falharia no meio do baseline.
if [ "$(psql_db -Atc "select to_regclass('storage.buckets') is not null")" != "t" ]; then
  echo "❌ O schema storage ainda não existe. Espere o crm-suporte-storage ficar healthy:"
  echo "   docker compose up -d --wait"
  exit 1
fi

psql_db <<'SQL'
create schema if not exists supabase_migrations;
revoke all on schema supabase_migrations from public;
create table if not exists supabase_migrations.schema_migrations (
  version    text primary key,
  name       text not null,
  applied_at timestamptz not null default now()
);
SQL

echo "▶ Aplicando migrations novas (supabase/migrations/*.sql, em ordem)…"
aplicadas=0
for f in "$PROJECT_DIR"/supabase/migrations/*.sql; do
  base="$(basename "$f")"
  version="${base%%_*}"
  if [ "$(psql_db -Atc "select exists (select 1 from supabase_migrations.schema_migrations where version = '$version')")" = "t" ]; then
    continue
  fi
  echo "  · $base"
  # Migration + registro na MESMA transação: ou entra inteira, ou nada entra.
  { cat "$f"; printf "\ninsert into supabase_migrations.schema_migrations (version, name) values ('%s', '%s');\n" "$version" "$base"; } \
    | psql_db --single-transaction
  aplicadas=$((aplicadas + 1))
done
echo "  $aplicadas migration(s) aplicada(s)."

if [ -f "$PROJECT_DIR/supabase/seed.sql" ]; then
  echo "▶ Aplicando seed (supabase/seed.sql)…"
  # Transação única: um seed que falha no meio não deixa metade gravada.
  psql_db --single-transaction <"$PROJECT_DIR/supabase/seed.sql"
fi

# PostgREST cacheia o schema; avisa para recarregar sem reiniciar o container.
psql_db -c "notify pgrst, 'reload schema';" >/dev/null

echo "✅ Banco local pronto. Login do app: admin@local / 123456"
