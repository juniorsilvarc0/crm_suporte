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
             ├─ APP_DOMAIN ─► 127.0.0.1:3203 ─► crmsup-appgw ─► web / web2  (2 réplicas, sem porta;
             │                                                    o deploy drena e troca uma por vez)
             └─ API_DOMAIN ─► 127.0.0.1:3201 ─► crmsup-gateway ◄── web/web2 (SUPABASE_URL=http://gateway)
                                                  ├─ /rest/v1/      ─► crmsup-rest
                                                  ├─ /realtime/v1/  ─► realtime-dev.crmsup-realtime
                                                  └─ /storage/v1/   ─► crmsup-storage
                                                                    └─► crmsup-db
rede crmsup_interna (internal: sem internet): db, rest, realtime, storage, gateway, appgw, web, web2
rede crmsup_borda: gateway e appgw (porta no loopback); web e web2 (saída para uazapi/OpenAI/n8n)
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

## Duas réplicas: deploy sem interrupção

O app roda em **duas réplicas** (`crmsup-web` e `crmsup-web-2`), **sem porta publicada**. O nginx do host manda o app para `127.0.0.1:3203` (`CRMSUP_APP_PORT`), publicado pelo **appgw** (`crmsup-appgw`, `deploy/app-gateway.conf`), que reparte entre as réplicas container a container, pela rede do Docker, sem docker-proxy no caminho.

O **gateway da API** (`crmsup-gateway`) é outro container. Ele continua sendo o caminho do app até o banco (`SUPABASE_URL=http://gateway`), e **o deploy do app nunca o recria**.

O `subir` troca **uma réplica de cada vez**, e só as que mudaram (`crmsup.sh trocar`):
1. a réplica sai do rodízio (` down` na config do appgw + reload), e requisição nova vai à outra;
2. espera **drenar** o que ela já está atendendo (`CRMSUP_DRENO_SEGUNDOS`, padrão 40 s, acima de um webhook com mídia e do relay à IA que ele dispara depois de responder);
3. recria a réplica com **parada graciosa** de até 160 s (`stop_grace_period`: o Next termina o que ainda está em curso e sai) e espera ficar healthy;
4. ela volta ao rodízio. **Se não ficar healthy, fica fora**, a outra segue atendendo e o deploy para.

O deploy passa a levar ~2 min. Requisição de até ~200 s (dreno + parada) termina: cabem o webhook e o envio de vídeo pelo chat (ffmpeg até 120 s + uazapi até 60 s). Com uma réplica só, cada deploy deixava o webhook da uazapi **sem resposta por ~20 s**, e mensagem recebida nesse intervalo não entrava no CRM.

- `hash` pelo IP real (`X-Real-IP`) prende cada cliente numa réplica. O rate limit do login é por processo.
- ⚠️ **Só o deploy tira réplica do rodízio** (`max_fails=0`). Com `max_fails=1`, um único reset transitório tirou a réplica saudável por 2 s enquanto a outra estava em troca, e o appgw ficou sem destino (216 falhas no teste). Réplica que recusa conexão continua contornada por `proxy_next_upstream`, requisição a requisição.
- **O deploy olha a saúde.** Réplica que não está healthy fica **fora** do rodízio e é trocada **primeiro**, mesmo sem mudança. O `trocar` se recusa a tirar a única réplica boa. Assim, rodar o `subir` de novo depois de um deploy que falhou nunca devolve a réplica quebrada ao tráfego.
- **Queda fora do roteiro** (o node cai, `docker restart`): a réplica que some da rede não recusa conexão. Cada requisição para ela espera o `proxy_connect_timeout` (500 ms) e vai à outra, mas a que estiver esperando quando o resolver atualizar a lista (≤ 3 s) volta 502. É limite do nginx com `resolve`. No webhook, esse 502 não aparece em log nenhum.
- ⚠️ **POST nunca é repetido depois de chegar à réplica** (`non_idempotent` proibido): o webhook repassa a mensagem à IA a cada processamento, e ela responderia duas vezes.
- **Versões misturadas:** durante a troca, as duas versões convivem por ~1 min. O app não usa Server Actions, então isso é seguro. **Ressalva:** cada processo guarda em cache (até 60 s) os segredos do cofre, como a chave da OpenAI. Ao apagar ou trocar a chave, a outra réplica pode usar a antiga por até 1 min: revogue a chave antiga na OpenAI primeiro.
- A config do appgw mora num caminho estável (`APPGW_CONF_FILE`, fora do código). O script grava **no mesmo arquivo** e aplica com `nginx -t` + reload; se reprovar, a anterior volta. **Não recrie o appgw**: todo o app passa por ele.
- O `subir` **se recusa a rodar** enquanto o `crmsup-web` ainda tem porta na configuração (migração pendente), rodando ou não.
- O `publicar.sh` recusa **antes de mexer em qualquer coisa** em três casos: alguma réplica não existe ou não está healthy; uma réplica roda imagem diferente da do `image.env`, sinal de que o deploy anterior não terminou; ou a migração está pela metade. Publicar de novo nesses estados apagaria o `app.anterior` bom.
- **Uma operação de rodízio por vez.** `subir`, `trocar` e `rodizio` pegam uma trava (`/opt/crm-suporte/.rodizio.lock`, com o PID). Uma 2ª operação ao mesmo tempo desfaria o dreno da 1ª, então ela recusa. A trava de um processo que já morreu é retomada sozinha.
- **Se a outra réplica cair durante o dreno**, a réplica em troca, que era a boa, volta ao rodízio **sem** ser recriada, e o deploy para com erro.
- O `subir` também **se recusa a recriar serviço de apoio** (db, rest, realtime, storage, gateway da API, appgw): ele pergunta ao compose com `--dry-run` antes. Se recusar, **nada mudou no ar**. Veja §Armadilhas para quando isso acontece e como fazer numa janela.

### Migração de uma para duas réplicas (uma vez, sem interrupção)

Pré-checagem: a porta 3203 precisa estar livre (`ss -Hltn 'sport = :3203'` sem saída).

A ordem garante que o tráfego nunca fique sem destino e que **o gateway da API nunca seja recriado**:

```bash
R=/opt/crm-suporte
# 1) Código novo em app.novo e a imagem, SEM subir (não use o publicar.sh aqui):
#    na sua máquina, git archive origin/main | ssh <vps> "... tar -x -C $R/app.novo ..." (como no publicar.sh)
$R/app.novo/deploy/crmsup.sh segredos        # só ACRESCENTA CRMSUP_APP_PORT=3203 e APPGW_CONF_FILE
$R/app.novo/deploy/crmsup.sh migrations
$R/app.novo/deploy/crmsup.sh build <revisão>
cd $R && rm -rf app.anterior && mv app app.anterior && mv app.novo app
C=$R/app/deploy/crmsup.sh
# 2) appgw e 2ª réplica: containers NOVOS, nada do que está no ar muda.
$C compose up -d --wait --no-deps appgw
$C compose up -d --wait --no-deps web2       # o appgw já atende por web (antigo) e web2
# 3) vhost do host → 127.0.0.1:3203 (§Atualizar o vhost): nginx -t + reload
# 4) a réplica antiga perde a porta 3200 e entra no rodízio, drenada antes:
$C trocar web
$C verificar
```

## Deploy seguinte

```bash
CRMSUP_HOST=<vps> deploy/publicar.sh
```

O script faz, nesta ordem:
1. `git archive origin/main`;
2. migrations novas, a partir da cópia nova. Se falharem, nada mais mudou;
3. build da imagem, antes de trocar qualquer coisa;
4. troca `app` por `app.novo`;
5. `subir`: troca as réplicas que mudaram, uma de cada vez, drenando antes;
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

`build` marca a imagem **do container que está no ar** como `crmsup-web:prd-rollback`, antes de trocar o `image.env`, e só se ele estiver **healthy**: um deploy que falhou não vira alvo de rollback.

**Rollback do app (o normal): só a imagem, sem interrupção.** Mantém o código de deploy atual e troca as réplicas uma por vez, drenando:

```bash
cd /opt/crm-suporte
printf 'APP_IMAGE=crmsup-web:prd-rollback\n' > env/image.env
/opt/crm-suporte/app/deploy/crmsup.sh subir
/opt/crm-suporte/app/deploy/crmsup.sh verificar
```

**O `subir` recusou por causa dos serviços de apoio** (§Armadilhas)? Não espere a janela para um rollback urgente. Com `C=/opt/crm-suporte/app/deploy/crmsup.sh`, `$C trocar web2 && $C trocar web` troca só as réplicas, drenando e sem tocar no apoio. Se uma réplica não estiver healthy, troque essa primeiro; o `trocar` recusa a outra ordem. Isso só vale para imagem que já rodou com o apoio atual, como a `prd-rollback`.

**Rollback do código de deploy** (só se o próprio `deploy/` novo estiver quebrado). Primeiro, qual é o caso:

```bash
R=/opt/crm-suporte
grep -q '^  appgw:' $R/app.anterior/deploy/docker-compose.yml && echo 'duas réplicas' || echo 'uma réplica'
```

**Duas réplicas** (o normal depois da migração): volte o código e a imagem. O `subir` troca as réplicas uma por vez, drenando, e a borda continua na 3203:

```bash
cd $R && mv app app.falho && mv app.anterior app
printf 'APP_IMAGE=crmsup-web:prd-rollback\n' > env/image.env
$R/app/deploy/crmsup.sh subir
$R/app/deploy/crmsup.sh verificar
```

**Uma réplica** (o `app.anterior` é de antes da migração): o compose antigo não conhece o appgw nem a porta 3203. Faça a migração ao contrário, que também drena e só aponta a borda para destino healthy:

```bash
R=/opt/crm-suporte
# 1) Com o código NOVO ainda em app: a web sai do rodízio e drena (a web2 atende).
$R/app/deploy/crmsup.sh rodizio web && sleep 40
# 2) Código e imagem anteriores.
cd $R && mv app app.falho && mv app.anterior app
printf 'APP_IMAGE=crmsup-web:prd-rollback\n' > env/image.env
# 3) A web volta COM a porta antiga, e espera ficar healthy. Se não ficar, PARE:
#    a borda segue na 3203 e o appgw atende pela web2.
$R/app/deploy/crmsup.sh compose up -d --wait --wait-timeout 300 --no-deps web
# 4) Vhost de volta à porta do web (CRMSUP_WEB_PORT), como em §Atualizar o vhost,
#    com o `crmsup.sh nginx https` antigo: backup, nginx -t, reload.
# 5) Os workers antigos do nginx do host terminam o que mandaram à 3203; só
#    então sai o appgw (parada graciosa) e, por último, a web2. Nunca `rm -f`.
sleep 40
docker stop -t 160 crmsup-appgw && docker stop -t 160 crmsup-web-2
docker rm crmsup-appgw crmsup-web-2
```

No caso de uma réplica, nunca rode o `subir` antigo com o vhost apontando para a 3203.

Migration não volta: elas são aditivas, e a versão anterior do app convive com o schema novo. Se não conviver, isso é bug da migration.

## Operação do dia a dia

Sempre pelo **caminho absoluto**, nunca com `cd` para dentro de `app/deploy`: uma sessão parada ali durante um deploy passaria a rodar o script e o compose da versão anterior (`app.anterior`).

```bash
C=/opt/crm-suporte/app/deploy/crmsup.sh
$C compose ps
$C compose logs -f --tail 200 web web2
$C compose exec db psql -U postgres
$C subir                 # mudou o app.env? o subir troca as duas réplicas, uma por vez (`restart` NÃO relê env_file)
$C rodizio web           # tira uma réplica do rodízio à mão; recusa tirar a única boa. `nenhuma` devolve as duas, sem conferir saúde (avisa)
```

## Armadilhas

- **`NEXT_PUBLIC_*` vão embutidos no build.** Trocar o domínio da API exige `build`, não restart.
- **A chave raiz do Vault mora no volume `crmsup_db-config`** (`/etc/postgresql-custom`). Sem o volume, recriar o `db` deixaria ilegíveis os segredos do Vault: o token da uazapi e a chave da OpenAI.
- **O nginx do gateway da API só lê a config ao iniciar.** O `crmsup.sh` põe o hash do `gateway.conf` num label, e o `up` recria o gateway quando o arquivo muda. Um `docker compose` cru, sem o script, nem sobe: o label é obrigatório.
- ⚠️ **Recriar o gateway da API interrompe o app inteiro, webhook incluído.** O app fala com o banco por ele (`SUPABASE_URL=http://gateway`): enquanto ele recria, o webhook responde 500 e a mensagem da uazapi não entra. Com WebSockets do Realtime abertos, o nginx espera até o SIGKILL (10 s). Mudança no `gateway.conf` só em janela sem conversa, com `compose up -d -t 1 ... gateway`.
- ⚠️ **O nginx 1.29 mudou o padrão do keepalive com o upstream.** Ele guarda a conexão ociosa por 60 s e não manda mais `Connection: close`. O Node 22 fecha a conexão ociosa aos ~6 s. Sem o `keepalive_timeout 4s` no upstream do appgw, uma requisição que reaproveita a conexão no instante em que ela fecha leva RST, e o POST vira 502: medido, 2 em ~17 mil. O gateway da API não é afetado, porque `proxy_pass` com variável não guarda conexão (também medido).
- ⚠️ **O upstream do appgw usa o nome do container** (`crmsup-web`), nunca o do serviço (`web`). Enquanto a réplica é recriada, o DNS do Docker não a acha e manda a pergunta para fora. `web` é um domínio de topo de verdade, e a resposta foi `127.0.53.53` (colisão de nome da ICANN).
- **O appgw é o contrário:** a config dele é aplicada com reload (`crmsup.sh subir`/`trocar`/`rodizio`) e o container nunca é recriado no deploy. Recriá-lo derrubaria o app.
- ⚠️ **O `subir` recusou porque "recriaria" um serviço de apoio.** O compose recria sozinho quando:
  - o `gateway.conf` muda;
  - a imagem de um serviço muda, inclusive por um `docker pull nginx:1.29-alpine` feito por **outra stack** da VPS, que move a tag compartilhada;
  - o **Docker Compose da VPS é atualizado**, porque o hash de configuração muda com a versão. Medido: a 5.5 julga **todos** os containers criados pela 2.39 como "Recreate", db incluído.

  O deploy parou antes de mexer em qualquer container, e a versão anterior segue no ar. Se veio do `publicar.sh`, o código novo já está em `app/` e o `image.env` já aponta a imagem nova, e publicar de novo é recusado. Conclua numa janela sem conversa com `CRMSUP_RECRIAR_APOIO=sim /opt/crm-suporte/app/deploy/crmsup.sh subir`. O app fica fora durante a recriação, uns segundos com o db. Para um rollback urgente antes da janela, veja §Rollback.
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
