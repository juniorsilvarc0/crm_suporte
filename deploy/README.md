# Produção — CRM Suporte

Stack Docker **isolado** (projeto `crmsup`) numa VPS **compartilhada** com outras aplicações, atrás do **nginx do host**, com TLS pelo certbot.

- App: `https://ticbox.spincode.com.br`
- Gateway do Supabase (REST, Realtime, Storage): `https://api.ticbox.spincode.com.br`

> **Regras desta VPS.** Ela roda outras stacks de produção, e **nada delas se toca**.
>
> - Tudo do CRM é nosso por nome: `/opt/crm-suporte`, o projeto `crmsup`, os containers `crmsup-*`, as redes e volumes `crmsup_*`, e **um** vhost.
> - **Proibido na VPS:**
>   - `docker system|image|builder|volume prune`, porque apaga imagem e cache das outras stacks;
>   - `docker compose` fora do `crmsup.sh`;
>   - editar o vhost de outro site;
>   - `systemctl restart nginx|docker`. No nginx, só `reload`, e só depois de `nginx -t` passar.
> - Mexer em produção exige **autorização literal do dono** ([AGENTS.md](../AGENTS.md) §3.9).

## Topologia

```
internet ─► nginx do HOST :443 (TLS, certbot)
             ├─ APP_DOMAIN ─► 127.0.0.1:3200 ─► crmsup-web ─────────┐
             └─ API_DOMAIN ─► 127.0.0.1:3201 ─► crmsup-gateway      │ SUPABASE_URL=http://gateway
                                                  ├─ /rest/v1/      ─► crmsup-rest
                                                  ├─ /realtime/v1/  ─► realtime-dev.crmsup-realtime
                                                  └─ /storage/v1/   ─► crmsup-storage
                                                                    └─► crmsup-db
rede crmsup_interna (internal: sem internet): db, rest, realtime, storage, gateway, web
rede crmsup_borda: só gateway e web (porta no loopback; o web sai para uazapi/OpenAI/n8n)
```

**Por que dois hosts:** a mídia do WhatsApp é servida pelo Storage. Se ela saísse da mesma origem do app, um HTML enviado por qualquer pessoa rodaria com a sessão do operador. O gateway ainda responde com `Content-Security-Policy: sandbox`.

## Layout no servidor

```
/opt/crm-suporte/
  app/            código: git archive de origin/main (+ REVISION)
  app.anterior/   a versão anterior, até o próximo deploy
  env/            0700 — FORA do código, sobrevive a qualquer deploy
    stack.env       segredos do Supabase, domínios e portas (o compose interpola)
    app.env         ambiente do container web
    image.env       APP_IMAGE=crmsup-web:<revisão>
  backups/        0700 — dump, mídia e chave raiz do Vault
```

## 1ª instalação

A ordem importa: o Storage cria o schema `storage`, as migrations gravam nele, e o Realtime e o Storage só conectam depois de `papeis`.

**Na sua máquina** (código de `origin/main`, nunca da árvore de trabalho):

```bash
git fetch origin main && REV=$(git rev-parse --short=12 origin/main)
git archive --format=tar origin/main \
  | ssh <vps> "mkdir -p /opt/crm-suporte/app && tar -x -C /opt/crm-suporte/app && echo $REV > /opt/crm-suporte/app/REVISION"
```

**No servidor:**

```bash
cd /opt/crm-suporte/app/deploy
CRMSUP_APP_DOMAIN=ticbox.spincode.com.br CRMSUP_API_DOMAIN=api.ticbox.spincode.com.br ./crmsup.sh segredos
./crmsup.sh build "$(cat ../REVISION)"
./crmsup.sh compose up -d --wait db
./crmsup.sh papeis
./crmsup.sh compose up -d --wait rest realtime storage gateway
./crmsup.sh migrations                     # NUNCA o supabase/seed.sql (admin@local/123456)
CRMSUP_ADMIN_EMAIL=<email> CRMSUP_ADMIN_NOME="<nome>" ./crmsup.sh admin
./crmsup.sh subir
./crmsup.sh verificar                      # anon = 0, nenhuma porta fora do loopback
```

A senha inicial do admin fica em `env/admin-inicial.txt` (0600) e **não** aparece no terminal. No 1º login o app obriga a troca; depois disso, apague o arquivo.

### Borda (o único ponto compartilhado)

O vhost é um arquivo **novo**. O certificado sai por `certonly --webroot`, que não reescreve configuração nenhuma. Os blocos 443 só entram depois que o certificado existe: antes disso, o `nginx -t` reprovaria o arquivo.

```bash
V=/etc/nginx/sites-available/ticbox.spincode.com.br
mkdir -p /var/www/crmsup-acme
./crmsup.sh nginx http > "$V"
ln -s "$V" /etc/nginx/sites-enabled/ticbox.spincode.com.br
nginx -t && systemctl reload nginx      # se o -t falhar: rm do link em sites-enabled NA HORA

certbot certonly --webroot -w /var/www/crmsup-acme \
  -d ticbox.spincode.com.br -d api.ticbox.spincode.com.br \
  --deploy-hook 'systemctl reload nginx'

./crmsup.sh nginx https > "$V"
nginx -t && systemctl reload nginx      # se o -t falhar: volte o arquivo para o modo http NA HORA
```

⚠️ Um `nginx -t` reprovado não derruba nada por si só. Mas, enquanto o arquivo quebrado estiver em `sites-enabled`, **nenhum** site da VPS consegue recarregar configuração, inclusive a renovação de certificado dos outros.

### Backup diário

```bash
systemctl is-active cron                # precisa responder "active"
/opt/crm-suporte/app/deploy/backup.sh   # 1ª execução na mão: vê passar e cria a pasta do log
cat > /etc/cron.d/crmsup-backup <<'EOF'
# CRM Suporte — backup diário (deploy/backup.sh). 03:30 UTC = 00:30 em Brasília.
# Local: NÃO protege de perder a VPS (a cópia externa ainda é pendência).
30 3 * * * root /opt/crm-suporte/app/deploy/backup.sh >> /opt/crm-suporte/backups/backup.log 2>&1
EOF
```

- **Retenção:** banco e chave do Vault ficam 30 dias. A mídia, que é cópia **cheia** a cada dia, fica 7 dias: a mais recente já contém tudo. A retenção roda **antes** do backup, então um disco cheio não trava a limpeza, e **sempre preserva os 3 mais novos de cada tipo**: dias seguidos de falha nunca apagam o último backup bom.
- **Folga de disco:** o backup se recusa a gravar se sobrarem menos de 10% do disco (`CRMSUP_BACKUP_RESERVA_PCT`). A VPS é compartilhada: encher o disco derrubaria o Postgres das outras stacks.
- **Falha no meio:** os arquivos daquele backup são apagados. Nunca sobra um `.dump` truncado com cara de bom.
- **Conferir um backup** sem tocar no banco de produção: `backup.sh restaurar <arquivo.dump> conferencia`. Ele restaura num banco **novo**.

## Deploy seguinte

```bash
CRMSUP_HOST=<vps> deploy/publicar.sh
```

O script faz, nesta ordem:
1. `git archive origin/main`;
2. migrations novas, a partir da cópia nova. Se falharem, nada mais mudou;
3. build da imagem, antes de trocar qualquer coisa;
4. troca `app` por `app.novo`;
5. `subir`: recria só o que mudou, normalmente só o web;
6. `verificar`.

Se a migration ou o build falharem, o que está no ar continua intacto. As migrations são aditivas, então a versão no ar convive com o schema novo durante o build.

### Atualizar o vhost

Mudou `deploy/nginx-host.conf`? O deploy **não** mexe no nginx sozinho. Depois do `publicar.sh`:

```bash
V=/etc/nginx/sites-available/ticbox.spincode.com.br
cp -p "$V" "$V.bak-$(date +%Y%m%d-%H%M%S)"
/opt/crm-suporte/app/deploy/crmsup.sh nginx https > "$V.novo" && mv "$V.novo" "$V"
nginx -t && systemctl reload nginx   # se o -t falhar: volte o .bak NA HORA
```

## Rollback

`build` marca a imagem **do container que está no ar** como `crmsup-web:prd-rollback`, antes de trocar o `image.env`, e só se ele estiver **healthy**: um deploy que falhou não vira alvo de rollback. O `publicar.sh` se recusa a rodar enquanto o web no ar não estiver healthy — **faça o rollback antes de publicar de novo**, senão o `app.anterior` bom seria descartado. O código anterior fica em `app.anterior`. Volte **os dois**: o `docker-compose.yml` e o `gateway.conf` da versão nova podem não servir para a imagem antiga.

```bash
cd /opt/crm-suporte
mv app app.falho && mv app.anterior app
printf 'APP_IMAGE=crmsup-web:prd-rollback\n' > env/image.env
/opt/crm-suporte/app/deploy/crmsup.sh subir
/opt/crm-suporte/app/deploy/crmsup.sh verificar
```

Migration não volta: elas são aditivas, e a versão anterior do app convive com o schema novo. Se não conviver, isso é bug da migration.

## Operação do dia a dia

Sempre pelo **caminho absoluto**, nunca com `cd` para dentro de `app/deploy`: uma sessão parada ali durante um deploy passaria a rodar o script e o compose da versão anterior (`app.anterior`).

```bash
C=/opt/crm-suporte/app/deploy/crmsup.sh
$C compose ps
$C compose logs -f --tail 200 web
$C compose exec db psql -U postgres
$C compose up -d web     # mudou o app.env? `restart` NÃO relê env_file; `up -d` recria
```

## Armadilhas

- **`NEXT_PUBLIC_*` vão embutidos no build.** Trocar o domínio da API exige `build`, não restart.
- **A chave raiz do Vault mora no volume `crmsup_db-config`** (`/etc/postgresql-custom`). Sem o volume, recriar o `db` deixaria ilegíveis os segredos do Vault: o token da uazapi e a chave da OpenAI.
- **O nginx do gateway só lê a config ao iniciar.** O `crmsup.sh` põe o hash do `gateway.conf` num label, e o `up` recria o gateway quando o arquivo muda. Um `docker compose` cru, sem o script, nem sobe: o label é obrigatório.
- **A borda sobrescreve o `X-Forwarded-For`.** O rate limit do login usa a 1ª entrada desse cabeçalho; se a borda só acrescentasse ao valor recebido, um IP inventado pelo cliente escaparia do limite.
- **O tenant do Realtime é `realtime-dev`**, tirado do Host que o gateway envia. Não renomeie o container `realtime-dev.crmsup-realtime`.
- **`SUPABASE_JWT_SECRET` ≠ `AUTH_JWT_SECRET`.** Com os dois iguais, o cookie de sessão valeria como credencial de banco.
- **`SUPABASE_URL=http://gateway`, sem `:80`.** O supabase-js tira a porta padrão ao montar as URLs. Em 2026-09-28, com `:80`, nenhuma mídia do chat abria: o navegador recebia o host interno. Hoje o `toPublicOrigin` normaliza os dois lados, mas o valor certo é sem a porta.
- **O segredo do webhook da uazapi vai na query (`?s=`).** A rota do webhook não tem log de acesso no vhost, porque o `access.log` do host é compartilhado.
- ⚠️ **Desconectar e reconectar o WhatsApp NÃO troca o segredo.** O `/api/connection/persist` reaproveita o que já existe (`ensure_chat_integration_secret`). Para **rotacionar** (ex.: o segredo vazou em log), faça os dois passos em seguida, num horário calmo: entre eles o webhook responde 401, e mensagens que chegarem nesse intervalo não entram no CRM (continuam no celular).
  1. No servidor, com o valor gerado **dentro** do banco (nunca na linha de comando):
     ```bash
     /opt/crm-suporte/app/deploy/crmsup.sh compose exec -T db psql -U postgres -c \
       "select public.set_chat_integration_secret(id, 'webhook_secret', encode(extensions.gen_random_bytes(32), 'hex')) from public.chat_integrations where provider = 'uazapi';"
     ```
  2. Em **Conexão › Trocar credenciais**, salve de novo a URL e o token da uazapi: o persist registra na uazapi o webhook com o segredo novo.
- **Variável do shell vence o `--env-file` no compose.** O `crmsup.sh` limpa do ambiente os nomes do `stack.env` antes do `docker compose`. Não o contorne com `docker compose` cru.
