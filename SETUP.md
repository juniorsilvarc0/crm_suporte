# Setup do ambiente local

Stack **100% `docker compose`**, sem o CLI da Supabase. Funciona em Linux, macOS e
Windows (via WSL2).

O que você terá no fim:

- App em **http://localhost:3000**
- Postgres local com a API que o app consome: gateway na porta **54321** e banco
  na **54322** (psql direto)

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
docker compose up -d --build        # crm-suporte-db + rest + gateway + web
./scripts/db-local-apply.sh         # aplica migrations + seed
# http://localhost:3000 — login: admin@local / 123456
```

> ⚠️ **O `supabase/seed.sql` herdado está quebrado.** Desde a migration de funis
> personalizáveis (`20260818180000`), ele insere etapas sem `pipeline_id` e com
> `on conflict (key)`. O `db-local-apply.sh` para no seed, e o `admin@local` **não é
> criado**. O seed novo vem na Fase 2 de [`docs/PLANO-IMPLANTACAO.md`](docs/PLANO-IMPLANTACAO.md).

> ⚠️ O `db-local-apply.sh` reaplica **todas** as migrations a cada execução (ainda não
> tem livro-razão). Use só contra o banco local.

Limitações do stack local hoje: **sem Realtime** (o chat não atualiza ao vivo) e
**sem Storage** (upload de mídia não funciona). Os dois entram na Fase 2.

---

## 3. Depois de um `git pull`

```bash
./scripts/db-local-apply.sh          # migrations novas
docker compose up -d --build web     # rebuilda o app, se o código mudou
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

- **O app abre mas o login falha** → é o seed quebrado (seção 2).

- **`pnpm` falha com "packages field missing or empty"** → o `pnpm` global é antigo
  para este `pnpm-workspace.yaml`. Use `npx -y pnpm@10.33.0 <script>`.

- **Typecheck com dezenas de erros estranhos depois de copiar o repositório** →
  a cópia achatou os links simbólicos do `node_modules`. Rode
  `rm -rf node_modules && npx -y pnpm@10.33.0 install --frozen-lockfile`.

- **Mudou o `.env.local` e não refletiu** → `docker compose restart web`.

Mais sobre branches e PRs em [`CONTRIBUTING.md`](CONTRIBUTING.md).
