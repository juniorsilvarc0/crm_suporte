# CRM Suporte

CRM de atendimento de suporte técnico para software house. Os clientes abrem
chamados pelo WhatsApp; uma IA externa faz a triagem e alimenta o CRM por API; o
CRM guarda e gerencia tickets, empresas, contatos, contratos e SLA.

> ⚠️ **Em conversão.** O código nasceu de um CRM de clínica feito sobre o mesmo
> template. Os módulos herdados (leads, funil, pacientes, agenda, financeiro de
> vendas, métricas, rastreamento Meta) saíram na Fase 1; hoje o app é o núcleo
> de chat, conexão, equipe e configurações. O caminho até o produto-alvo está em
> **[`docs/PLANO-IMPLANTACAO.md`](docs/PLANO-IMPLANTACAO.md)**.

> **Agente de IA lendo isto:** comece por **[`AGENTS.md`](AGENTS.md)**. Ele é normativo
> e bloqueia edição de arquivo antes da leitura de contexto.

## Rodar localmente

Guia completo em **[`SETUP.md`](SETUP.md)**. Resumo:

```bash
git clone https://github.com/juniorsilvarc0/crm_suporte.git && cd crm_suporte
cp .env.local.example .env.local     # já vem pronto para o stack local
docker compose up -d --build --wait   # banco + API + app em http://localhost:3000
./scripts/db-local-apply.sh           # aplica migrations + seed (login admin@local / 123456)
```

O stack local é 100% `docker compose`: `crm-suporte-db` (Postgres da Supabase),
`crm-suporte-rest` (PostgREST), `realtime` (chat ao vivo), `crm-suporte-storage`
(mídia privada), `crm-suporte-gateway` (porta 54321) e `crm-suporte-web`.
Credenciais de integração (uazapi, OpenAI) não vão no `.env.local`: são gravadas
pelas telas Conexão e Configurações, no Vault do banco.

## Checks

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

Se o `pnpm` global falhar com "packages field missing or empty", use
`npx -y pnpm@10.33.0 <script>`.

## Documentação

**Contexto obrigatório para quem (ou o que) vai codificar aqui:**

| Documento | O que é |
|---|---|
| [`AGENTS.md`](AGENTS.md) | **Regras operacionais normativas.** Enquadramento de task, regras invioláveis, mapa de código, definição de concluído. Leia primeiro. |
| [`SKILLS.md`](SKILLS.md) | Stack real, quatro modelos de autenticação, quais skills servem e **quais quebram** a stack. |
| [`UI.md`](UI.md) | Sistema visual: tokens, primitivos, padrões de tela, estados, anti-padrões. Consulte antes de criar UI. |
| [`PROGRESS.md`](PROGRESS.md) | Histórico append-only: o que foi feito, decidido e **quais armadilhas já custaram caro**. |
| [`PRD.md`](PRD.md) | O que o produto é, para quem, escopo, decisões arquiteturais, glossário. |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | Branch, commit, PR, separação por camada, regras de migration. |
| [`docs/PLANO-IMPLANTACAO.md`](docs/PLANO-IMPLANTACAO.md) | Plano aprovado de conversão em CRM de suporte: decisões, fases e verificação. |

**Referência técnica:**

- [`docs/API.md`](docs/API.md) — referência da API herdada; a integração antiga saiu na Fase 1 e a API v1 vem na Fase 5
- [`docs/GUIA-AGENTE-IA.md`](docs/GUIA-AGENTE-IA.md) — guia para agentes de IA externos (desatualizado; reescrito na Fase 5)
- [`DB.md`](DB.md) — modelo de dados herdado (reescrito na Fase 2)
- [`SETUP.md`](SETUP.md) — setup do ambiente local

## Ambientes / credenciais

- **Local:** use `.env.local.example` (já vem pronto — chaves padrão do Supabase local). Ver [`SETUP.md`](SETUP.md).
- **Produção:** ainda não definida (Fase 10 do plano). **Nunca** versionar `.env.local` (é gitignored).
