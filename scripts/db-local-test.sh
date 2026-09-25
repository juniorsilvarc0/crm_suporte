#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# CRM Suporte — roda os testes de SQL (supabase/tests/*.sql) no Postgres LOCAL.
#
#   ./scripts/db-local-test.sh
#
# Cada arquivo roda numa transação que termina em ROLLBACK e falha (psql sai
# com erro) se algum caso não passar. Pré-requisito: ./scripts/db-local-apply.sh.
# É o mesmo comando que o job "banco" do CI roda.
# ============================================================

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DB_CONTAINER="crm-suporte-db"

falhas=0
for f in "$PROJECT_DIR"/supabase/tests/*.sql; do
  echo "▶ $(basename "$f")"
  if ! docker exec -i "$DB_CONTAINER" psql -q -U postgres -d postgres -v ON_ERROR_STOP=1 <"$f"; then
    falhas=$((falhas + 1))
  fi
done

if [ "$falhas" -gt 0 ]; then
  echo "❌ $falhas arquivo(s) de teste falharam."
  exit 1
fi
echo "✅ Testes de SQL ok."
