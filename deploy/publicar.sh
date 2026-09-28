#!/usr/bin/env bash
# ============================================================================
# Publica uma versão NOVA na VPS. Roda na SUA máquina, dentro do repositório.
#
#   CRMSUP_HOST=<alias ssh da VPS> deploy/publicar.sh
#
# O deploy sai SEMPRE de origin/main (AGENTS §10), nunca da árvore de
# trabalho: o que não está mergeado não vai para produção.
#
# Passos: git archive → app.novo → build da imagem a partir dela → troca de
# diretório (a versão anterior fica em app.anterior) → migrations novas →
# subir → verificar. Pressupõe a 1ª instalação feita (deploy/README.md).
# ============================================================================
set -Eeuo pipefail

HOST=${CRMSUP_HOST:?defina CRMSUP_HOST (alias ssh da VPS)}
RAIZ=/opt/crm-suporte

git fetch --quiet origin main
REV=$(git rev-parse --short=12 origin/main)
echo "▶ origin/main @ $REV → $HOST:$RAIZ"

git archive --format=tar origin/main \
  | ssh "$HOST" "set -e; rm -rf $RAIZ/app.novo; mkdir -p $RAIZ/app.novo; tar -x -C $RAIZ/app.novo; echo $REV > $RAIZ/app.novo/REVISION"

# Build ANTES da troca: se falhar, o que está no ar segue intacto.
ssh "$HOST" "$RAIZ/app.novo/deploy/crmsup.sh build $REV"

ssh "$HOST" "set -e; cd $RAIZ; rm -rf app.anterior; if [ -d app ]; then mv app app.anterior; fi; mv app.novo app"

# Migration roda ANTES de a imagem nova entrar (CONTRIBUTING §Migrations).
ssh "$HOST" "set -e; $RAIZ/app/deploy/crmsup.sh migrations; $RAIZ/app/deploy/crmsup.sh subir; $RAIZ/app/deploy/crmsup.sh verificar"

echo "✅ $REV no ar. Se algo der errado: deploy/README.md §Rollback"
