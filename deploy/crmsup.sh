#!/usr/bin/env bash
# ============================================================================
# Operação de produção do CRM Suporte. Roda NO SERVIDOR, como root, a partir
# da cópia do código (ex.: /opt/crm-suporte/app/deploy/crmsup.sh).
#
#   crmsup.sh segredos           gera segredos e escreve os .env (idempotente:
#                                NUNCA sobrescreve valor já existente)
#   crmsup.sh build <revisão>    constrói a imagem do app a partir DESTA cópia
#   crmsup.sh papeis             senha dos papéis internos, _realtime, publication
#   crmsup.sh migrations         aplica supabase/migrations/ (livro-razão; nunca o seed)
#   crmsup.sh admin              cria o 1º admin (troca de senha no 1º login)
#   crmsup.sh subir              sobe/atualiza o stack e espera ficar healthy
#   crmsup.sh verificar          segurança do banco e portas publicadas
#   crmsup.sh nginx http|https   imprime o vhost do nginx do host
#   crmsup.sh compose <args>     `docker compose` com os --env-file certos
#
# Ordem da 1ª instalação e do deploy seguinte: deploy/README.md.
#
# ⚠️ Nenhum segredo é impresso. A senha inicial do admin vai para um arquivo
# 0600, não para o terminal.
# ============================================================================
set -Eeuo pipefail
umask 077

RAIZ=${CRMSUP_RAIZ:-/opt/crm-suporte}
ENV_DIR="$RAIZ/env"
STACK_ENV="$ENV_DIR/stack.env"
APP_ENV="$ENV_DIR/app.env"
IMAGE_ENV="$ENV_DIR/image.env"
# A cópia do código é a que contém este script: `build` e `migrations` usam
# ESTA versão, nunca outra que esteja no disco.
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="$APP_DIR/deploy/docker-compose.yml"

msg() { printf '  %s\n' "$*"; }
erro() { printf 'ERRO: %s\n' "$*" >&2; exit 1; }

compose() {
  [ -f "$STACK_ENV" ] || erro "$STACK_ENV não existe — rode 'segredos' antes"
  [ -f "$IMAGE_ENV" ] || erro "$IMAGE_ENV não existe — rode 'build' antes"
  # Vira label do gateway: config nova = container recriado no próximo `up`.
  CRMSUP_GATEWAY_CONF_SHA=$(openssl dgst -sha256 -r "$APP_DIR/deploy/gateway.conf" | cut -c1-16)
  export CRMSUP_GATEWAY_CONF_SHA
  # ⚠️ Na interpolação do compose, variável do SHELL vence o --env-file. Numa
  # VPS compartilhada, outras stacks usam os mesmos nomes (POSTGRES_PASSWORD,
  # JWT_SECRET...): um `set -a; . <outra>/.env` esquecido no shell faria este
  # stack subir com a senha da outra. Tiramos do ambiente o que o stack.env define.
  env -u POSTGRES_PASSWORD -u JWT_SECRET -u SECRET_KEY_BASE -u REALTIME_DB_ENC_KEY \
      -u ANON_KEY -u SERVICE_ROLE_KEY -u APP_DOMAIN -u API_DOMAIN -u APP_ENV_FILE \
      -u APP_IMAGE -u CRMSUP_WEB_PORT -u CRMSUP_GATEWAY_PORT -u COMPOSE_PROJECT_NAME \
    docker compose --env-file "$STACK_ENV" --env-file "$IMAGE_ENV" -f "$COMPOSE_FILE" "$@"
}

# `postgres` roda as migrations. Não é superusuário nesta imagem.
psql_db() {
  compose exec -T db psql -q -U postgres -d postgres -v ON_ERROR_STOP=1 "$@"
}

# --- helpers de .env ---------------------------------------------------------
# Só escreve se a chave ainda não tem valor: rodar de novo nunca rotaciona
# segredo por acidente (rotação é ação deliberada, não efeito colateral).
env_set() {
  local arquivo=$1 chave=$2 valor=$3
  touch "$arquivo"
  if grep -qE "^${chave}=.+" "$arquivo"; then
    return 0
  fi
  { grep -vE "^${chave}=" "$arquivo" || true; printf '%s=%s\n' "$chave" "$valor"; } > "$arquivo.tmp"
  mv "$arquivo.tmp" "$arquivo"
  chmod 600 "$arquivo"
}

env_get() { { grep -E "^$2=" "$1" 2>/dev/null || true; } | head -1 | cut -d= -f2-; }

# JWT HS256 em shell puro — igual ao script oficial do self-host da Supabase.
b64url() { openssl enc -base64 -A | tr '+/' '-_' | tr -d '='; }

gen_jwt() {
  local papel=$1 segredo=$2 iat exp header payload assinado sig
  iat=$(date +%s)
  exp=$((iat + 60 * 60 * 24 * 365 * 5))   # 5 anos
  header=$(printf '%s' '{"alg":"HS256","typ":"JWT"}' | b64url)
  payload=$(printf '{"role":"%s","iss":"supabase","iat":%s,"exp":%s}' "$papel" "$iat" "$exp" | b64url)
  assinado="${header}.${payload}"
  sig=$(printf '%s' "$assinado" | openssl dgst -binary -sha256 -hmac "$segredo" | b64url)
  printf '%s.%s' "$assinado" "$sig"
}

# ----------------------------------------------------------------------------
cmd_segredos() {
  mkdir -p "$ENV_DIR"
  chmod 700 "$ENV_DIR"

  local app_domain api_domain jwt
  app_domain=$(env_get "$STACK_ENV" APP_DOMAIN)
  api_domain=$(env_get "$STACK_ENV" API_DOMAIN)
  app_domain=${app_domain:-${CRMSUP_APP_DOMAIN:?defina CRMSUP_APP_DOMAIN na 1ª execução}}
  api_domain=${api_domain:-${CRMSUP_API_DOMAIN:?defina CRMSUP_API_DOMAIN na 1ª execução}}

  # --- stack.env: o que o compose interpola ---
  env_set "$STACK_ENV" POSTGRES_PASSWORD "$(openssl rand -hex 32)"
  env_set "$STACK_ENV" JWT_SECRET "$(openssl rand -hex 32)"
  env_set "$STACK_ENV" SECRET_KEY_BASE "$(openssl rand -hex 48)"
  env_set "$STACK_ENV" REALTIME_DB_ENC_KEY "$(openssl rand -hex 8)"   # exatos 16
  env_set "$STACK_ENV" APP_DOMAIN "$app_domain"
  env_set "$STACK_ENV" API_DOMAIN "$api_domain"
  env_set "$STACK_ENV" CRMSUP_WEB_PORT "${CRMSUP_WEB_PORT:-3200}"
  env_set "$STACK_ENV" CRMSUP_GATEWAY_PORT "${CRMSUP_GATEWAY_PORT:-3201}"
  env_set "$STACK_ENV" APP_ENV_FILE "$APP_ENV"

  # As chaves derivam do JWT_SECRET JÁ GRAVADO: se o segredo veio de uma
  # execução anterior, as chaves precisam derivar DELE.
  jwt=$(env_get "$STACK_ENV" JWT_SECRET)
  env_set "$STACK_ENV" ANON_KEY "$(gen_jwt anon "$jwt")"
  env_set "$STACK_ENV" SERVICE_ROLE_KEY "$(gen_jwt service_role "$jwt")"

  # --- app.env: o ambiente do container web ---
  env_set "$APP_ENV" AUTH_JWT_SECRET "$(openssl rand -hex 48)"
  # ⚠️ SUPABASE_JWT_SECRET é o segredo do SUPABASE, não o do cookie de sessão.
  # Com os dois iguais, um cookie de sessão valeria como credencial de banco.
  env_set "$APP_ENV" SUPABASE_JWT_SECRET "$jwt"
  # O servidor fala com o gateway por dentro da rede interna.
  # ⚠️ SEM `:80`. O supabase-js tira a porta padrão ao montar as URLs; com ela
  # aqui, a troca pela origem pública falhava e nenhuma mídia abria (produção,
  # 2026-09-28 — o toPublicOrigin hoje normaliza, mas o valor certo é este).
  env_set "$APP_ENV" SUPABASE_URL "http://gateway"
  env_set "$APP_ENV" SUPABASE_ANON_KEY "$(env_get "$STACK_ENV" ANON_KEY)"
  env_set "$APP_ENV" SUPABASE_SERVICE_ROLE_KEY "$(env_get "$STACK_ENV" SERVICE_ROLE_KEY)"
  # NEXT_PUBLIC_* aqui por completude; quem vale é o build-arg de `build`.
  env_set "$APP_ENV" NEXT_PUBLIC_SUPABASE_URL "https://$api_domain"
  env_set "$APP_ENV" NEXT_PUBLIC_SUPABASE_ANON_KEY "$(env_get "$STACK_ENV" ANON_KEY)"
  env_set "$APP_ENV" APP_PUBLIC_URL "https://$app_domain"

  msg "segredos em $STACK_ENV e $APP_ENV (0600). Nenhum valor impresso."
}

# ----------------------------------------------------------------------------
cmd_build() {
  local rev=${1:?uso: crmsup.sh build <revisão>}
  local tag="crmsup-web:$rev" api_domain anon atual
  api_domain=$(env_get "$STACK_ENV" API_DOMAIN)
  anon=$(env_get "$STACK_ENV" ANON_KEY)
  { [ -n "$api_domain" ] && [ -n "$anon" ]; } || erro "rode 'segredos' antes"

  msg "construindo $tag a partir de $APP_DIR"
  # NEXT_PUBLIC_* são embutidos no bundle no BUILD: trocar o domínio da API
  # exige imagem nova, não só restart.
  docker build -f "$APP_DIR/Dockerfile.production" \
    --build-arg NEXT_PUBLIC_SUPABASE_URL="https://$api_domain" \
    --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY="$anon" \
    -t "$tag" "$APP_DIR"

  # Rollback: a imagem que está NO AR (a do container, não a do image.env —
  # um deploy interrompido deixaria o image.env apontando para uma imagem que
  # nunca rodou) vira :prd-rollback ANTES de o image.env mudar.
  # Só vira rollback se estiver HEALTHY: depois de um `subir` que falhou, o
  # container no ar é a versão quebrada, e marcá-la apagaria a última boa.
  atual=$(docker inspect -f '{{.Config.Image}}' crmsup-web 2>/dev/null || env_get "$IMAGE_ENV" APP_IMAGE)
  saude=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{end}}' crmsup-web 2>/dev/null || true)
  if [ -n "$atual" ] && [ "$atual" != "$tag" ] && [ "$saude" = "healthy" ] && docker image inspect "$atual" >/dev/null 2>&1; then
    docker tag "$atual" crmsup-web:prd-rollback
    msg "imagem no ar ($atual) marcada como crmsup-web:prd-rollback"
  elif [ -n "$atual" ] && [ "$saude" != "healthy" ]; then
    msg "web no ar não está healthy ($saude): prd-rollback mantido como estava"
  fi
  printf 'APP_IMAGE=%s\n' "$tag" > "$IMAGE_ENV"
  msg "image.env → $tag (entra no ar no próximo 'subir')"

  # Limpeza SÓ das imagens do CRM: ficam a nova, a do ar, a de rollback e as 3
  # mais recentes (margem para voltar mais de uma versão). Nunca
  # `docker image prune` — apagaria imagem das outras stacks da VPS.
  docker image ls crmsup-web --format '{{.Repository}}:{{.Tag}}' \
    | grep -vxF -e "crmsup-web:prd-rollback" \
    | tail -n +4 \
    | grep -vxF -e "$tag" -e "${atual:-crmsup-web:<nenhuma>}" \
    | xargs -r docker image rm >/dev/null 2>&1 || true
}

# ----------------------------------------------------------------------------
cmd_papeis() {
  local pg
  pg=$(env_get "$STACK_ENV" POSTGRES_PASSWORD)
  [ -n "$pg" ] || erro "POSTGRES_PASSWORD ausente — rode 'segredos' antes"

  # ⚠️ `-U supabase_admin`, não `postgres`: nesta imagem `postgres` NÃO é
  # superusuário e `authenticator` é papel reservado.
  # Os papéis internos precisam da MESMA senha que os serviços usam para
  # conectar: sem isto, Realtime e Storage sobem e falham no primeiro connect.
  # A senha vai pelo stdin, não pela linha de comando (argv aparece no `ps`).
  compose exec -T db psql -q -U supabase_admin -d postgres -v ON_ERROR_STOP=1 <<SQL
alter role authenticator          with login password '$pg';
alter role supabase_admin         with login password '$pg';
alter role supabase_storage_admin with login password '$pg';

-- As migrations rodam como postgres, que não alcança os default privileges do
-- supabase_admin, abertos na imagem para anon, authenticated e service_role.
-- Sem fechar aqui, objeto criado por ele nasce aberto e o
-- assert_security_baseline() reprova a migration seguinte (ver docker/db-init.sql).
alter default privileges for role supabase_admin in schema public revoke all on tables    from anon, authenticated, service_role;
alter default privileges for role supabase_admin in schema public revoke all on sequences from anon, authenticated, service_role;
alter default privileges for role supabase_admin in schema public revoke all on functions from anon, authenticated, service_role;

-- O Realtime roda as próprias migrations em _realtime; sem o schema ele morre
-- em laço com "no schema has been selected to create in".
create schema if not exists _realtime authorization postgres;

-- Sem esta publication o Realtime não emite evento nenhum, em silêncio.
do \$\$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end
\$\$;
SQL
  msg "papéis sincronizados; default privileges, _realtime e publication garantidos"
}

# ----------------------------------------------------------------------------
cmd_migrations() {
  local dir="$APP_DIR/supabase/migrations" aplicadas=0 f base version
  [ -d "$dir" ] || erro "migrations não encontradas em $dir"

  # As migrations gravam em storage.buckets, e quem cria o schema storage é o
  # storage-api ao subir. Rodar antes dele falharia no meio do baseline.
  [ "$(psql_db -Atc "select to_regclass('storage.buckets') is not null")" = "t" ] \
    || erro "o schema storage ainda não existe — espere o crmsup-storage ficar healthy"

  # Livro-razão, o mesmo de scripts/db-local-apply.sh: cada migration roda UMA
  # vez, na mesma transação do seu registro. Fora de public: o PostgREST não o expõe.
  psql_db <<'SQL'
create schema if not exists supabase_migrations;
revoke all on schema supabase_migrations from public;
create table if not exists supabase_migrations.schema_migrations (
  version    text primary key,
  name       text not null,
  applied_at timestamptz not null default now()
);
SQL

  for f in "$dir"/*.sql; do
    base=$(basename "$f")
    version=${base%%_*}
    if [ "$(psql_db -Atc "select exists (select 1 from supabase_migrations.schema_migrations where version = '$version')")" = "t" ]; then
      continue
    fi
    msg "· $base"
    { cat "$f"; printf "\ninsert into supabase_migrations.schema_migrations (version, name) values ('%s', '%s');\n" "$version" "$base"; } \
      | psql_db --single-transaction
    aplicadas=$((aplicadas + 1))
  done

  # PostgREST cacheia o schema; recarrega sem reiniciar o container.
  psql_db -c "notify pgrst, 'reload schema';" >/dev/null
  # ⚠️ O supabase/seed.sql NUNCA roda aqui: ele cria admin@local com senha 123456.
  msg "$aplicadas migration(s) nova(s) aplicada(s)"
}

# ----------------------------------------------------------------------------
cmd_admin() {
  local email=${CRMSUP_ADMIN_EMAIL:?defina CRMSUP_ADMIN_EMAIL}
  local nome=${CRMSUP_ADMIN_NOME:?defina CRMSUP_ADMIN_NOME}
  local arquivo="$ENV_DIR/admin-inicial.txt" existe senha

  existe=$(psql_db -At -v email="$email" <<'SQL'
select exists (select 1 from public.app_users where lower(email) = lower(:'email'));
SQL
)
  if [ "$existe" = "t" ]; then
    msg "já existe usuário com $email — nada feito"
    return 0
  fi

  # Hex: forte e sem caractere que precise de escape.
  senha=$(openssl rand -hex 10)
  # create_app_user faz o hash com a mesma função do app, e o último `true`
  # obriga a troca de senha no 1º login. A senha entra pelo stdin (\set), não
  # pela linha de comando.
  { printf '%s\n' "\\set senha '$senha'"; cat <<'SQL'
select email, role from public.create_app_user(:'email', :'nome', :'senha', 'admin', 'slate', true);
SQL
  } | psql_db -v email="$email" -v nome="$nome" >/dev/null

  printf 'email: %s\nsenha: %s\n' "$email" "$senha" > "$arquivo"
  chmod 600 "$arquivo"
  msg "admin criado. Credenciais em $arquivo (0600): entre, troque a senha e apague o arquivo."
}

# ----------------------------------------------------------------------------
cmd_subir() {
  # Recria só o que mudou: imagem nova do web, gateway.conf novo (label com o
  # hash, ver compose()) ou config do compose.
  compose up -d --wait --wait-timeout 300
  compose ps
}

# ----------------------------------------------------------------------------
cmd_verificar() {
  psql_db -At <<'SQL'
select 'tabelas c/ grant p/ anon ............ ' || count(distinct table_name)
  from information_schema.role_table_grants where grantee = 'anon' and table_schema = 'public';
select 'funções executáveis por anon ........ ' || count(*)
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'EXECUTE');
select 'tabelas p/ authenticated ............ ' || coalesce(string_agg(distinct table_name, ', '), '(nenhuma)')
  from information_schema.role_table_grants where grantee = 'authenticated' and table_schema = 'public';
select 'tabelas sem RLS ..................... ' || count(*)
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;
select 'publication supabase_realtime ....... ' || count(*) || ' tabela(s)'
  from pg_publication_tables where pubname = 'supabase_realtime';
select 'migrations no livro-razão ........... ' || count(*) from supabase_migrations.schema_migrations;
select 'admins ativos ....................... ' || count(*) from public.app_users where role = 'admin' and is_active;
SQL
  psql_db -c 'select public.assert_security_baseline();' >/dev/null
  msg "assert_security_baseline() ✓"

  # O sharp é o único addon nativo: se a libvips não entrou no standalone, o
  # 1º upload de foto e o webhook com mídia quebram com o resto verde.
  compose exec -T -w /app web node -e "require('sharp')" </dev/null || erro "sharp não carrega na imagem do web"
  msg "sharp carrega na imagem ✓"

  msg "portas publicadas fora do loopback (deve ser vazio):"
  docker ps --filter "label=com.docker.compose.project=crmsup" --format '{{.Names}} {{.Ports}}' \
    | grep -E '0\.0\.0\.0|\[::\]|:::' || msg "  (nenhuma) ✓"
}

# ----------------------------------------------------------------------------
cmd_nginx() {
  local modo=${1:-} src="$APP_DIR/deploy/nginx-host.conf" app api web gw
  app=$(env_get "$STACK_ENV" APP_DOMAIN)
  api=$(env_get "$STACK_ENV" API_DOMAIN)
  web=$(env_get "$STACK_ENV" CRMSUP_WEB_PORT)
  gw=$(env_get "$STACK_ENV" CRMSUP_GATEWAY_PORT)
  { [ -n "$app" ] && [ -n "$api" ] && [ -n "$web" ] && [ -n "$gw" ]; } || erro "stack.env incompleto — rode 'segredos' antes"

  # `http` para até o marcador: os blocos 443 citam o certificado, que ainda
  # não existe na 1ª emissão — e o `nginx -t` reprovaria o arquivo inteiro.
  case "$modo" in
    http)  sed '/^# ==== HTTPS/,$d' "$src" ;;
    https) cat "$src" ;;
    *)     erro "uso: crmsup.sh nginx http|https" ;;
  esac | sed -e "s/__APP_DOMAIN__/$app/g" -e "s/__API_DOMAIN__/$api/g" \
             -e "s/__WEB_PORT__/$web/g" -e "s/__GATEWAY_PORT__/$gw/g"
}

case "${1:-}" in
  segredos)   cmd_segredos ;;
  build)      shift; cmd_build "$@" ;;
  papeis)     cmd_papeis ;;
  migrations) cmd_migrations ;;
  admin)      cmd_admin ;;
  subir)      cmd_subir ;;
  verificar)  cmd_verificar ;;
  nginx)      shift; cmd_nginx "$@" ;;
  compose)    shift; compose "$@" ;;
  *) erro "uso: $0 {segredos|build <revisão>|papeis|migrations|admin|subir|verificar|nginx http|https|compose <args>}" ;;
esac
