# Setup do ambiente local

Stack **100% `docker compose`**, sem o CLI da Supabase. Funciona em Linux, macOS e
Windows (via WSL2).

O que você terá no fim:

- App em **http://localhost:3000**
- Postgres local com o que o app consome, atrás de um gateway na porta **54321**:
  PostgREST (`/rest/v1`), Realtime (`/realtime/v1`, chat ao vivo) e Storage
  (`/storage/v1`, mídia privada do chat). Banco na **54322** (psql direto).

> Você **não precisa editar credenciais** para rodar local: o `.env.local.example`
> já vem com as chaves públicas de demonstração do Supabase. Só copie e suba.

---

## 1. Pré-requisitos

| Ferramenta | Para quê | Obrigatório |
|---|---|---|
| **Docker** (Desktop ou Engine) com Compose | banco, API e app | sim |
| **Node 22 + pnpm 10.33** | checks e testes fora do Docker | opcional |

- **macOS:** Docker Desktop. Node via `brew install node@22` ou nvm.
- **Linux:** Docker Engine com o plugin `compose`.
- **Windows:** WSL2 (Ubuntu) e Docker Desktop com a integração WSL ligada.

O projeto fixa `pnpm@10.33.0` em `packageManager`. Se o `pnpm` da máquina for outra
versão, rode os scripts com `npx -y pnpm@10.33.0 <script>`.

---

## 2. Subir o ambiente

```bash
git clone https://github.com/juniorsilvarc0/crm_suporte.git
cd crm_suporte

cp .env.local.example .env.local
docker compose up -d --build --wait # db + rest + realtime + storage + gateway + web
./scripts/db-local-apply.sh         # aplica migrations + seed
./scripts/db-local-test.sh          # opcional: testes de SQL do baseline
# http://localhost:3000 — login: admin@local / 123456
```

- O `db-local-apply.sh` tem **livro-razão** (`supabase_migrations.schema_migrations`):
  cada migration roda uma vez, numa transação só; rodar de novo aplica só o que é
  novo. O seed é idempotente. Ele **recusa rodar** antes de o `storage` estar
  healthy, porque as migrations gravam os buckets. Use só contra o banco local.
- **Credenciais de integração não vão no `.env.local`.** Token e segredo do
  webhook da uazapi são gravados pela tela **Conexão**; a chave da OpenAI
  (transcrição), pela tela **Configurações** (cofre). Tudo fica no Vault do banco.
- A **1ª conexão ao Realtime** depois de subir o stack pode falhar (`Tenant
  realtime-dev is initializing` no log); recarregue a tela.
- WhatsApp **real** em localhost exige túnel HTTPS (a uazapi precisa alcançar o
  webhook). Sem túnel, teste com payloads de fixture postados no webhook local.

---

## 3. Depois de um `git pull`

```bash
./scripts/db-local-apply.sh          # migrations novas (só as que faltam)
docker compose up -d --build web     # rebuilda o app, se o código mudou
```

Mudou uma migration? Aplique e **regenere os tipos** do banco
(`src/lib/supabase/database.types.ts` é gerado; não edite à mão):

```bash
./scripts/db-local-apply.sh && npx -y pnpm@10.33.0 db:types
```

---

## 4. Comandos úteis

```bash
docker compose logs -f web           # logs do app
docker compose restart web           # aplicar mudança no .env.local
docker compose down                  # derrubar tudo (o volume do banco fica)
docker compose down -v               # ⚠️ derrubar e APAGAR o banco local

# checks (no host com Node 22, ou dentro do container):
npx -y pnpm@10.33.0 typecheck
npx -y pnpm@10.33.0 lint
npx -y pnpm@10.33.0 test
docker exec crm-suporte-web pnpm test
```

---

## 5. Problemas comuns

- **"Cannot connect to the Docker daemon"** → o Docker não está rodando. Abra o
  Docker Desktop (macOS/Windows) ou `sudo systemctl start docker` (Linux).

- **O Postgres não sobe / "No space left on device"** → **disco do Docker cheio.**
  O Docker Desktop tem um disco virtual de tamanho fixo, separado do disco da
  máquina.

  ```bash
  docker system df            # ver o que está ocupando
  docker builder prune -af    # limpa o cache de build (seguro)
  docker image prune -af      # remove imagens sem container
  ```

  Dá para aumentar em **Docker Desktop → Settings → Resources → Virtual disk limit**.

- **Porta 3000 / 54321 / 54322 ocupada** → derrube o que está usando ou ajuste as
  portas em `docker-compose.yml`.

- **O app abre mas o login falha** → rode `./scripts/db-local-apply.sh` (cria o
  `admin@local`). Se ele recusar por falta de `storage.buckets`, espere o
  `crm-suporte-storage` ficar healthy (`docker compose up -d --wait`).

- **O chat não atualiza ao vivo** → confira as assinaturas no banco:
  `docker exec crm-suporte-db psql -U postgres -c "select claims_role from realtime.subscription"`.
  Deve aparecer `authenticated`; `anon` quer dizer que o canal foi assinado antes
  do token (use sempre `subscribeAuthenticated`).

- **`pnpm` falha com "packages field missing or empty"** → o `pnpm` global é antigo
  para este `pnpm-workspace.yaml`. Use `npx -y pnpm@10.33.0 <script>`.

- **Typecheck com dezenas de erros estranhos depois de copiar o repositório** →
  a cópia achatou os links simbólicos do `node_modules`. Rode
  `rm -rf node_modules && npx -y pnpm@10.33.0 install --frozen-lockfile`.

- **Mudou o `.env.local` e não refletiu** → `docker compose restart web`.

Mais sobre branches e PRs em [`CONTRIBUTING.md`](CONTRIBUTING.md).
