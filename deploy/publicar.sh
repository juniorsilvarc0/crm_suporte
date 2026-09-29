#!/usr/bin/env bash
# ============================================================================
# Publica uma versão NOVA na VPS. Roda na SUA máquina, dentro do repositório.
#
#   CRMSUP_HOST=<alias ssh da VPS> deploy/publicar.sh
#
# O deploy sai SEMPRE de origin/main (AGENTS §10), nunca da árvore de
# trabalho: o que não está mergeado não vai para produção.
#
# Passos: git archive → app.novo → migrations novas (a partir dela) → build
# da imagem → troca de diretório (a versão anterior fica em app.anterior) →
# subir → verificar. Pressupõe a 1ª instalação feita (deploy/README.md).
#
# Migration primeiro: se ela falhar, nada mais mudou (nem imagem, nem
# image.env, nem código). Elas são aditivas — a versão no ar convive com o
# schema novo enquanto o build roda (CONTRIBUTING §Migrations).
# ============================================================================
set -Eeuo pipefail

HOST=${CRMSUP_HOST:?defina CRMSUP_HOST (alias ssh da VPS)}
RAIZ=/opt/crm-suporte

# Web no ar precisa estar healthy. Depois de um deploy que falhou, publicar de
# novo descartaria o app.anterior bom e marcaria a versão quebrada como
# rollback: faça o rollback (deploy/README.md) antes.
# As duas réplicas precisam existir e estar healthy. Réplica ausente = a
# migração de uma para duas réplicas ainda não foi feita (README §Migração).
# O deploy anterior precisa ter TERMINADO: com o image.env apontando uma
# imagem que as réplicas não rodam (o `subir` recusou por causa do apoio, ou
# caiu depois do build), publicar de novo giraria app → app.anterior e apagaria
# a única cópia do código que está no ar.
alvo=$(ssh "$HOST" "sed -n 's/^APP_IMAGE=//p' $RAIZ/env/image.env" </dev/null | tr -d '[:space:]' || true)
for replica in crmsup-web crmsup-web-2; do
  existe=$(ssh "$HOST" "docker ps -aq --filter name=^${replica}\$" </dev/null || true)
  [ -n "$existe" ] || { echo "ERRO: $replica não existe. Migração para duas réplicas pendente: siga deploy/README.md §Migração." >&2; exit 1; }
  saude=$(ssh "$HOST" "docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{end}}' $replica" </dev/null | tr -d '[:space:]' || true)
  [ "$saude" = "healthy" ] || { echo "ERRO: $replica no ar está '${saude:-sem status}'. Faça o rollback antes de publicar de novo." >&2; exit 1; }
  imagem=$(ssh "$HOST" "docker inspect -f '{{.Config.Image}}' $replica" </dev/null | tr -d '[:space:]' || true)
  [ "$imagem" = "$alvo" ] || { echo "ERRO: $replica roda '$imagem', mas o image.env aponta '$alvo': o deploy anterior não terminou. Conclua-o com $RAIZ/app/deploy/crmsup.sh subir (leia a mensagem dele) ou faça o rollback. Nada foi mudado." >&2; exit 1; }
done
# Migração pela metade: as duas existem e estão healthy, mas a web antiga
# ainda tem a porta na configuração. O `subir` recusaria só DEPOIS de o
# app.anterior (código de uma réplica) ser apagado.
portas=$(ssh "$HOST" "docker inspect -f '{{len .HostConfig.PortBindings}}' crmsup-web" </dev/null | tr -d '[:space:]' || true)
[ "$portas" = 0 ] || { echo "ERRO: crmsup-web ainda publica porta: migração para duas réplicas pela metade. Termine-a (deploy/README.md §Migração). Nada foi mudado." >&2; exit 1; }

git fetch --quiet origin main
REV=$(git rev-parse --short=12 origin/main)
echo "▶ origin/main @ $REV → $HOST:$RAIZ"

git archive --format=tar origin/main \
  | ssh "$HOST" "set -e; rm -rf $RAIZ/app.novo; mkdir -p $RAIZ/app.novo; tar -x -C $RAIZ/app.novo; echo $REV > $RAIZ/app.novo/REVISION"

ssh "$HOST" "$RAIZ/app.novo/deploy/crmsup.sh migrations" </dev/null

# Build ANTES da troca: se falhar, o que está no ar segue intacto.
ssh "$HOST" "$RAIZ/app.novo/deploy/crmsup.sh build $REV" </dev/null

ssh "$HOST" "set -e; cd $RAIZ; rm -rf app.anterior; if [ -d app ]; then mv app app.anterior; fi; mv app.novo app" </dev/null

ssh "$HOST" "set -e; $RAIZ/app/deploy/crmsup.sh subir; $RAIZ/app/deploy/crmsup.sh verificar" </dev/null

echo "✅ $REV no ar. Se algo der errado: deploy/README.md §Rollback"
