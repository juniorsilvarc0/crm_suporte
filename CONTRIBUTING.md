# Contribuindo

Guia rápido para contribuir com este repositório.

## Convenção de branch

Prefixo em inglês (padrão Conventional) + descrição curta em kebab-case, **em português**:

- `feat/` — nova funcionalidade (ex: `feat/paginacao-de-leads`)
- `fix/` — correção de bug (ex: `fix/erro-login-chat`)
- `chore/` — manutenção, build, CI, dependências (ex: `chore/ci-github-actions`)
- `refactor/` — refatoração sem mudança de comportamento (ex: `refactor/hooks-leads`)
- `docs/` — documentação (ex: `docs/contributing`)
- `test/` — apenas testes (ex: `test/cobertura-webhooks`)

## Conventional Commits (tipo em inglês, descrição em pt-BR)

O tipo do commit é em inglês; a descrição, em português. **Todo commit deve ter um corpo descrevendo o que foi feito.**

```
feat(leads): adiciona paginação
fix(chat): corrige envio duplicado de mensagem
chore(ci): configura pipeline de qualidade
refactor(dashboard): extrai hook de filtros
docs: atualiza guia de contribuição
test: adiciona testes dos webhooks
```

- `feat` — nova funcionalidade
- `fix` — correção de bug
- `chore` — manutenção, build, CI, dependências
- `refactor` — mudança de código sem alterar comportamento
- `docs` — mudanças de documentação
- `test` — adição ou ajuste de testes

## Escopo: uma branch = uma intenção

**Uma branch resolve uma coisa só.** Se você consegue descrever o PR sem usar a
palavra "e", ótimo. Se precisa de "e", provavelmente são dois PRs.

O título e a descrição do PR têm que contar a verdade sobre o que mudou. Um PR
chamado "navbar" que também traz uma migration de banco não pode ser revisado
como front — e quem lê o título não revisa o que não sabe que está lá.

### Separe por camada — front, back, banco

Quando a tarefa encosta em mais de uma camada, **divida em PRs por camada**,
nesta ordem (de baixo para cima — cada um depende do anterior):

```
1. banco   (migration)          → PR próprio, revisado e aplicado primeiro
2. back    (rotas de API / RPC)  → depende do banco
3. front   (telas / componentes) → depende do back
```

A ordem importa de verdade: uma migration que troca a assinatura de uma função
usada pela produção pode quebrar o app se rodar fora de ordem. Isolada num PR
próprio, isso fica visível e planejável; escondida no meio de dezenas de `.tsx`,
passa batido.

### Precisa mesmo ser fullstack numa tarefa só?

Pode — às vezes a feature é vertical e faz sentido entregar junta. Nesse caso:

- **Avise antes de começar** que a tarefa terá banco/API além do front, para o
  review já se preparar.
- **Separe os commits por camada**, mesmo dentro do mesmo PR — assim cada camada
  pode ser revisada e revertida isolada:
  ```
  feat(equipe): migration de papéis e avatar     ← só SQL
  feat(equipe): rotas de gestão de usuário        ← só API
  feat(equipe): tela de equipe e navbar           ← só front
  ```
- No corpo do PR, resuma o que tocou por camada e a ordem de subida. Ex.:
  *"front: 3 telas · back: 4 rotas · banco: 1 migration (rodar ANTES do deploy)."*

### Banco: regras que não se quebram

- **Toda migration é um arquivo novo.** Nunca edite uma migration já aplicada
  (`supabase/migrations/YYYYMMDDHHMMSS_descricao.sql`).
- Migration deve ser **idempotente** (`create table if not exists`,
  `create or replace function`, `add column if not exists`) e **não destrutiva**
  sem aviso explícito no PR.
- Se a mudança de dados **afeta a produção** (ex.: renomear um rótulo que vive no
  banco, não no código), diga no PR **qual SQL rodar e quando**. Uma tela meio em
  "Paciente" e meio em "Cliente" nasce de um PR que esqueceu esse aviso.

### Não empilhe branch sobre branch informalmente

O padrão é **sair sempre da `main` atualizada**. Empilhar uma branch sobre outra
ainda não mergeada faz a de baixo viajar junto — revisar uma vira revisar as
duas, e alterar a de baixo no review reabre a de cima. Se uma tarefa realmente
depende de outra pendente, combine o stack explicitamente com o time antes.

## Fluxo de PR

1. Crie a branch a partir da `main` **atualizada** (`git pull` antes).
2. Faça os commits seguindo a convenção acima, **separados por camada** quando o
   PR tocar mais de uma.
3. Abra o Pull Request manualmente (sem merge/push automático). Na descrição,
   diga o que mudou por camada e a ordem de subida.
4. Aguarde o review.
5. Faça o merge somente após aprovação.

**NUNCA** faça commit, push ou merge direto na `main`. Recomenda-se habilitar branch protection na `main` (exigindo PR e checks de CI passando).

## Como rodar local

Guia completo (pré-requisitos por SO) em [`SETUP.md`](SETUP.md). Resumo:

```bash
cp .env.local.example .env.local   # já vem pronto p/ o stack local
docker compose up -d --build        # banco + API + app em http://localhost:3200
./scripts/db-local-apply.sh         # aplica migrations + seed
# login: admin@local / 123456
```

O stack local é 100% `docker compose` (sem o CLI da Supabase) — detalhes no
cabeçalho do próprio `docker-compose.yml`. Migration nova? Rode
`./scripts/db-local-apply.sh` de novo (livro-razão: aplica só o que falta),
`./scripts/db-local-test.sh` (testes de SQL) e `pnpm db:types` (regenera
`src/lib/supabase/database.types.ts`; o CI falha se ficar diferente do banco).

Para rodar os testes:

```bash
docker exec crm-suporte-web pnpm test
# ou, fora do container:
pnpm test
```

## Checks antes de abrir PR

Rode localmente antes de abrir o PR:

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

## Estrutura de pastas

- `src/app` — rotas (App Router)
- `src/features/*` — feature-slices (lógica e UI por domínio)
- `src/lib` — libs e utilitários compartilhados
- `src/components` — componentes de UI compartilhados
- `supabase/` — migrations e seed do banco
