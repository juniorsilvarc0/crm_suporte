#!/usr/bin/env bash
# ============================================================================
# Backup do CRM Suporte. Roda NO SERVIDOR, como root (cron diário).
#
# Guarda TRÊS coisas, porque restaurar só uma não recupera o sistema:
#   1. o banco (pg_dump -Fc: comprimido e com restauração seletiva);
#   2. a mídia do Storage: o banco guarda o caminho, não o arquivo;
#   3. a chave raiz do Vault: sem ela, os segredos do Vault que estão no dump
#      (token da uazapi, chave da OpenAI) são ilegíveis.
#
# ⚠️ Backup LOCAL, na mesma VPS: protege de erro humano e de migration ruim,
# NÃO de perder a máquina. Cópia fora da VPS é requisito de go-live.
# ⚠️ Dump e chave juntos decifram os segredos: o diretório é 0700 e cada
# arquivo 0600. Não copie este diretório para lugar menos protegido.
#
#   backup.sh                                   executa um backup
#   backup.sh restaurar <arquivo.dump> <banco>  restaura em banco NOVO, para conferir
# ============================================================================
set -Eeuo pipefail
umask 077

DESTINO=${CRMSUP_BACKUP_DIR:-/opt/crm-suporte/backups}
RETENCAO_DIAS=${CRMSUP_BACKUP_RETENCAO:-30}
# A mídia sai como cópia CHEIA todo dia; a mais recente já tem tudo. Guardar 30
# cópias cheias multiplicaria o volume de mídia por 30 no disco compartilhado.
RETENCAO_MIDIA_DIAS=${CRMSUP_BACKUP_RETENCAO_MIDIA:-7}
# Folga mínima que o backup deixa livre no disco (a VPS é compartilhada: encher
# o disco derruba o Postgres das outras stacks também).
RESERVA_PCT=${CRMSUP_BACKUP_RESERVA_PCT:-10}
DB=crmsup-db
STORAGE=crmsup-storage
STAMP=$(date +%Y%m%d-%H%M%S)

msg() { printf '%s  %s\n' "$(date '+%F %T')" "$*"; }
falha() { msg "ERRO: $*"; exit 1; }

cmd_backup() {
  mkdir -p "$DESTINO"
  chmod 700 "$DESTINO"

  # Globais de propósito (sem `local`): o trap de EXIT lê estes nomes, e quando
  # o `set -e` derruba o script o bash já desfez as variáveis locais — o trap
  # morreria com "unbound variable" e deixaria o backup parcial no disco.
  dump="$DESTINO/db-$STAMP.dump"
  midia="$DESTINO/storage-$STAMP.tgz"
  chave="$DESTINO/vault-key-$STAMP.tgz"
  local n_origem tam_db tam_md avail total estimativa ultimo_dump

  # Retenção PRIMEIRO: rodando só no fim, um backup que falha (ex.: disco
  # cheio) nunca mais apagaria os antigos, e o disco não se recuperaria.
  find "$DESTINO" -maxdepth 1 -name 'storage-*.tgz' -mtime +"$RETENCAO_MIDIA_DIAS" -delete
  find "$DESTINO" -maxdepth 1 \( -name '*.dump' -o -name 'vault-key-*.tgz' \) -mtime +"$RETENCAO_DIAS" -delete

  # Espaço: estimativa = mídia atual + o último dump; exige a reserva livre depois.
  avail=$(df --output=avail -B1 "$DESTINO" | tail -1 | tr -d '[:space:]')
  total=$(df --output=size -B1 "$DESTINO" | tail -1 | tr -d '[:space:]')
  ultimo_dump=$(find "$DESTINO" -maxdepth 1 -name 'db-*.dump' -printf '%s\n' | sort -n | tail -1)
  estimativa=$(( $(docker exec "$STORAGE" du -sb /var/lib/storage | cut -f1) + ${ultimo_dump:-52428800} ))
  if [ $(( avail - estimativa )) -lt $(( total * RESERVA_PCT / 100 )) ]; then
    falha "espaço insuficiente: livre $((avail / 1048576))MB, backup ~$((estimativa / 1048576))MB, reserva ${RESERVA_PCT}% — nada gravado"
  fi

  # Falhou no meio? Apaga os arquivos DESTE backup: um .dump truncado com nome
  # e permissão de backup bom é pior que nenhum na hora de restaurar. A saída
  # No sucesso o trap é desarmado antes de a função retornar.
  trap 'rm -f "$dump" "$midia" "$chave"' EXIT

  # Tudo sai por `docker exec` nos containers do stack, não por `docker run -v`:
  # volume com nome errado no `run` não falha — cria um vazio, e o .tgz de
  # ~100 bytes parece backup.
  msg "banco..."
  docker exec "$DB" pg_dump -U supabase_admin -d postgres -Fc > "$dump"

  msg "storage..."
  n_origem=$(docker exec "$STORAGE" sh -c 'find /var/lib/storage -type f | wc -l' | tr -d '[:space:]')
  docker exec "$STORAGE" tar czf - -C /var/lib/storage . > "$midia"

  msg "chave raiz do Vault..."
  docker exec "$DB" tar czf - -C /etc/postgresql-custom pgsodium_root.key > "$chave" \
    || falha "chave raiz do Vault não encontrada em $DB:/etc/postgresql-custom"

  tam_db=$(wc -c < "$dump" | tr -d '[:space:]')
  tam_md=$(wc -c < "$midia" | tr -d '[:space:]')

  # Um dump menor que 10 KB não é um banco: é um erro que virou arquivo.
  [ "$tam_db" -ge 10240 ] || falha "dump do banco tem só ${tam_db}B — backup inválido"
  # Origem com arquivos e .tgz minúsculo = arquivei o lugar errado.
  if [ "${n_origem:-0}" -gt 0 ] && [ "$tam_md" -lt 1024 ]; then
    falha "storage tem ${n_origem} arquivo(s) mas o .tgz saiu com ${tam_md}B"
  fi

  chmod 600 "$dump" "$midia" "$chave"
  trap - EXIT
  msg "ok: $(basename "$dump") ($((tam_db / 1024))KB) · $(basename "$midia") ($((tam_md / 1024))KB, ${n_origem:-0} arquivo(s)) · $(basename "$chave")"
  msg "retenção: banco e chave ${RETENCAO_DIAS} dias, mídia ${RETENCAO_MIDIA_DIAS} dias"
}

cmd_restaurar() {
  local arquivo=$1 banco=$2
  [ -f "$arquivo" ] || falha "arquivo não encontrado: $arquivo"
  [[ "$banco" =~ ^[a-z_][a-z0-9_]*$ ]] || falha "nome de banco inválido: $banco"
  # ⚠️ Restaura em banco NOVO, nunca por cima do de produção.
  case "$banco" in postgres | template0 | template1 | _supabase) falha "restaure em banco NOVO, nunca em $banco" ;; esac

  msg "criando banco $banco"
  docker exec "$DB" psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 \
    -c "drop database if exists $banco;" -c "create database $banco;"

  # O dump entra por dentro do container: dump binário grande por stdin é onde
  # a restauração costuma truncar em silêncio.
  docker cp "$arquivo" "$DB":/tmp/restore.dump
  docker exec "$DB" pg_restore -U supabase_admin -d "$banco" --no-owner /tmp/restore.dump 2>&1 \
    | grep -viE "warning|already exists" | tail -5 || true
  docker exec "$DB" rm -f /tmp/restore.dump

  msg "conferindo o que voltou:"
  docker exec "$DB" psql -U supabase_admin -d "$banco" -tA -c "
    select '  usuários: ' || count(*) from public.app_users
    union all select '  contatos: ' || count(*) from public.contacts
    union all select '  tickets: '  || count(*) from public.tickets;"
}

case "${1:-backup}" in
  backup)    cmd_backup ;;
  restaurar) cmd_restaurar "${2:?arquivo do dump}" "${3:?nome do banco de teste}" ;;
  *)         falha "uso: $0 {backup|restaurar <arquivo> <banco>}" ;;
esac
