# PRD — CRM Suporte

> **O que o produto é e por quê.** Estável: muda quando o escopo muda, não a cada task.
>
> ⚠️ **Produto em conversão (desde 2026-09-25).** Este repositório nasceu de um CRM de clínica feito sobre o mesmo template e está sendo convertido num CRM de suporte técnico. As seções 1–5 descrevem o **produto-alvo**; da seção 6 em diante o documento ainda descreve o **código herdado**, que as fases de [`docs/PLANO-IMPLANTACAO.md`](docs/PLANO-IMPLANTACAO.md) substituem.
>
> Documentos irmãos: [`AGENTS.md`](AGENTS.md) (regras de trabalho) · [`UI.md`](UI.md) (sistema visual) · [`PROGRESS.md`](PROGRESS.md) (histórico) · [`SKILLS.md`](SKILLS.md) (skills por stack) · [`DB.md`](DB.md) (modelo de dados herdado) · [`docs/GUIA-AGENTE-IA.md`](docs/GUIA-AGENTE-IA.md) (API de integração herdada) · [`docs/PLANO-IMPLANTACAO.md`](docs/PLANO-IMPLANTACAO.md) (plano aprovado).

---

## 1. Problema

Uma software house com softwares de vários nichos atende os clientes pelo WhatsApp. Os chamados chegam soltos na conversa: ninguém tem uma tela única com o que está aberto, de qual cliente e produto, quem está cuidando, quanto falta para estourar o prazo e o que a IA de triagem já fez.

O **CRM Suporte** é essa tela. Ele guarda e gerencia todos os dados das demandas: tickets, empresas, contatos, contratos, histórico e SLA. Uma **IA externa** (fora deste repositório) faz a triagem no WhatsApp e alimenta o CRM **via API**.

## 2. Objetivo

Responder rápido, para analista e gestor:

- O que está aberto agora, de qual cliente e produto, e com quem.
- O que está perto de estourar o SLA (1ª resposta e solução).
- O que a IA triou, o que escalou para humano e o que resolveu sozinha.
- Qual é a situação do contrato de suporte de cada cliente.
- Se as integrações (WhatsApp, IA, webhooks) estão entregando ou falhando em silêncio.

## 3. Usuários e casos de uso

| Perfil | Entrada | Uso principal |
|---|---|---|
| **Analista** (`member`) | `/app` | Trabalha a fila do seu produto, assume a conversa quando a IA escala, comenta e resolve |
| **Administrador** (`admin`) | `/app` completo | Tudo do analista, mais Conexão (credenciais e integrações), equipe, configurações e financeiro |
| **Gestor** | `/app` (métricas) | Backlog, SLA, volume por produto, cliente e analista |
| **IA de triagem** | `/api/v1/*`, com token criado no menu Conexão | Não usa a UI. Consulta contexto, abre e classifica ticket, envia mensagem pelo CRM, pede handoff |
| **Outros sistemas** | `/api/v1/*` e webhooks de saída assinados | Integram só por API; nenhuma credencial em código |
| **Provedor de WhatsApp** | `/api/chat/webhook/uazapi` | Entrega mensagem recebida e status de entrega (um número único) |

## 4. Escopo (produto-alvo)

- **Tickets:** protocolo, status fixos (rótulo e cor editáveis), prioridade, produto (é a fila), categoria, responsável e SLA 24/7 com pausa em "aguardando cliente".
- **Clientes:** empresas (CNPJ), contatos (WhatsApp) e contrato de suporte.
- **Chat ao vivo de WhatsApp (uazapi):** IA e humano na mesma caixa de entrada, com takeover.
- **API v1 para qualquer integrador:** tokens com escopo, idempotência e webhooks de saída assinados.
- **Menu Conexão:** reúne todas as credenciais e integrações.
- **Agenda** (visita técnica, treinamento, implantação, acesso remoto), **follow-ups** ligados a ticket e **financeiro** de contratos, mensalidades e despesas.
- **Métricas de suporte.**

## 5. Fora de escopo

- **Não é a IA de triagem.** Ela vive fora deste repositório.
- **Não é central de disparo em massa.**
- **Não é ERP contábil nem gateway de pagamento.**
- **Não é multi-tenant.** É um deploy por empresa.
- **Fora da v1:** expediente e feriados no SLA, CSAT, base de conhecimento, portal do cliente, e-mail e mais de um número de WhatsApp. A lista completa está no plano.

## 6. Módulos

Telas em `src/app/(dashboard)/app/`, menu em `src/config/navigation.ts`.

| Módulo | Rota | Papel | O que faz |
|---|---|---|---|
| Dashboard | `/app` | member | KPIs, funil resumido, gráficos (recharts), origem/tag, LTV, recuperação, "quem agendou", filtro de período com comparação |
| Leads | `/app/leads` | member | Tabela com busca global por coluna e paginação server-side, ações em massa, criação manual sincronizada com o funil, conversa via Number Check, detalhe/edição, tags, **exportação CSV** |
| Funil | `/app/funil` | member | Kanban dnd-kit com colunas dinâmicas (`board_columns`), filtros, densidade persistida, registrar venda, **campanha de origem no card** |
| Agenda | `/app/agendamentos` | member | Agendamentos por lead, "agendado por", marcar presença (sincroniza status do lead) |
| WhatsApp | `/app/chat` | member | Conversas ao vivo, texto/áudio/mídia, respostas rápidas compartilhadas, links com preview, telefones/vCards que iniciam conversa após Number Check, ações de arquivar/ler/limpar/apagar com menu e gestos mobile, transcrição, notas internas, takeover bot↔humano, Realtime |
| Rastreamento | `/app/rastreamento` | **admin** | Relatório por campanha, indicadores, saúde do CAPI, dead-letters, exportação |
| Follow-ups | `/app/follow-ups` | member | Lista do que o n8n agendou/enviou |
| Conexão | `/app/conexao` | **admin** | QR e estado da instância de WhatsApp |
| Equipe | `/app/equipe` | **admin** | Usuários, papéis, avatar, reset de senha |
| Configurações | `/app/configuracoes` | **admin** | Respostas rápidas da equipe, tokens de API, automação, assinatura do bot |
| Perfil | `/app/perfil` | member | Dados e senha do próprio usuário |

**Sem tela própria hoje:** `expenses` e `feedback_requests` (só API).

**Venda:** o diálogo "Registrar venda", no menu do card do funil, grava `contracts` + `payments` numa transação (RPC `register_sale`), move o card para a etapa de ganho e alimenta todas as métricas de dinheiro do dashboard. O que foi vendido sai de `procedures`, um catálogo que o próprio usuário mantém dentro do combobox. A venda aparece no bloco "Vendas" do modal do lead. **Ainda não existe UI para editar, cancelar ou estornar** — ver `PROGRESS.md`.

## 7. Fluxos centrais

### 7.1 Entrada de lead pelo WhatsApp

1. Provedor entrega em `/api/chat/webhook/{provider}` — **cada um com sua própria autenticação**.
2. O payload é normalizado (`src/features/chat/lib/normalizers/`).
3. `upsertLeadFromInbound` cria ou atualiza o lead **deduplicando pelo telefone normalizado**.
4. `upsertMessage` grava a mensagem e atualiza a conversa.
5. Supabase Realtime leva para a UI ao vivo.
6. Se a conversa está em `bot`, a mensagem é repassada ao n8n.

### 7.2 Atribuição de anúncio (CTWA → CAPI)

Cadeia completa — ao depurar, **descubra em qual elo parou antes de mudar código**:

```
clique no anúncio → mensagem com `referral` no webhook da Meta
  → ingest_meta_webhook_message  → leads.source = 'anuncio'
                                 → meta_attributions (ctwa_clid, source_id)
                                 → meta_ad_assets (pending)
  → worker enrichPendingAssets   → Graph API → snapshots de campanha/conjunto/anúncio
  → meta_conversion_outbox       → dispatcher (30s) → Conversions API
```

Regra de exibição: **primeiro toque**. O card responde "de onde esse lead veio", não "qual anúncio ele tocou por último".

### 7.3 Funil e conversão

Lead entra em `novo`. Mover card (arraste ou menu) grava a etapa e registra em `deal_stage_history`. Mudança de status carimba `qualificado_at` / `agendado_at` / `compareceu_at` / `cliente_at`. Um lead pode ter **N deals** — cada oportunidade é um card.

### 7.4 Atendimento humano (takeover)

Conversa tem status `bot` / `human` / `resolved`. Assumir muda para `human`, avisa o agente e para o relay ao n8n. Liberar devolve para `bot`.

## 8. Banco de dados

**Projeto Supabase:** `crm-suporte` (`supabase/config.toml`) — **produção ainda não definida**; por enquanto só Docker local (ver [`docs/PLANO-IMPLANTACAO.md`](docs/PLANO-IMPLANTACAO.md)); o banco nasce aplicando `supabase/migrations/` do zero.

**Inventário do schema (herdado do template, verificado em 2026-08-06):** 23 tabelas públicas · 6 policies · 17 funções · 5 triggers.

| Domínio | Tabelas |
|---|---|
| Lead e funil | `leads`, `deals`, `deal_stage_history`, `board_columns`, `tags`, `lead_tags` |
| Atendimento | `chat_conversations`, `chat_messages`, `chat_integrations`, `chat_quick_replies` |
| Agenda e retomada | `appointments`, `followups`, `feedback_requests` |
| Financeiro | `contracts`, `payments`, `expenses`, `procedures` |
| Rastreamento Meta | `meta_attributions`, `meta_ad_assets`, `meta_conversion_outbox` |
| Plataforma | `app_users`, `api_tokens`, `app_settings`, `integration_logs` |

### 8.1 Segurança do banco — 🟢 fechado por padrão

- **RLS habilitada nas 23 tabelas.**
- Apenas **6 policies**; quatro são `service_role ALL`.
- As duas exceções são `SELECT` para `anon`/`authenticated` em `chat_conversations` e `chat_messages`, **necessárias para o Realtime do chat**.
- `anon`/`authenticated` têm grants amplos no catálogo, mas **a RLS bloqueia antes** — grant sem policy não lê nada.
- Todo acesso real usa **service role no servidor** (`src/lib/supabase/server.ts`, `admin.ts`).

Consequência para quem desenvolve: **consulta nova é server-side.** Ligar Realtime numa tabela nova exige policy de `SELECT` para `anon` — isso é decisão de segurança, não detalhe de implementação.

## 9. Autenticação e autorização

Não é Supabase Auth. É **JWT HS256 próprio** (`jose`) em cookie `crm-suporte-session`, 7 dias, assinado com `AUTH_JWT_SECRET`.

- Decisão de acesso: `src/lib/auth/route-guard.ts` (isolada do runtime do Next para ser testável).
- Aplicação: `src/proxy.ts` (o middleware do Next 16).
- Papéis: `admin` | `member`. O middleware redireciona pelo papel do JWT; **a página confirma com o papel fresco do banco**, cobrindo o caso do admin recém-rebaixado com cookie antigo.
- Rota nova de admin exige atualizar **os dois lugares**: `ADMIN_PAGE_PREFIXES` e `adminOnly` em `navigation.ts`.

## 10. Integrações externas

| Integração | Uso | Código |
|---|---|---|
| **uazapi** | WhatsApp — provedor em produção hoje | `src/features/chat/lib/{senders,normalizers,connection}/uazapi.ts` |
| **Evolution API** | WhatsApp — provedor alternativo | `src/features/chat/lib/*/evolution.ts` |
| **Meta WhatsApp Cloud API** | WhatsApp + **referral de anúncio (CTWA)** | `src/app/api/chat/webhook/meta`, `src/features/meta/` |
| **Meta Graph / Conversions API** | Enriquecimento de campanha e envio de conversão | `src/features/meta/{outbox,report,health}.ts` |
| **n8n** | Orquestra a IA SDR; envia e consome eventos | `src/app/api/webhooks/n8n/*`, `/api/integracao/*` |
| **OpenAI** | Transcrição de áudio no chat | `src/app/api/chat/transcribe` |
| **Supabase Storage** | Mídia do chat e avatar | buckets `chat-media`, `feedback-screenshots` |

## 11. Stack e decisões arquiteturais

| Decisão | Escolha | Por quê | Confirmada |
|---|---|---|---|
| Framework | Next.js 16 App Router + React 19 | Server Components reduzem JS no cliente e mantêm o acesso ao banco no servidor | 2026-08-06 |
| Acesso a dados | Supabase **service role no servidor**; anon só para Realtime | RLS fechada + service role no servidor = superfície mínima | 2026-08-06 |
| Autenticação | JWT HS256 próprio, guard testável | Papéis simples; sem acoplar o produto ao Supabase Auth | 2026-08-06 |
| Estado do cliente | React local + server components + `router.refresh()` | Sem Redux/Zustand/TanStack — a revalidação vem do servidor | 2026-08-06 |
| Estilo | Tailwind v4 CSS-first, tokens em `@theme` | Sem `tailwind.config.js`; token semântico é a fonte da cor | 2026-08-06 |
| Primitivos de UI | Base UI (`@base-ui/react`) em `src/components/ui` | Acessibilidade sem herdar a API do Radix | 2026-08-06 |
| Formulários | react-hook-form + zod | Validação compartilhada entre form e rota | 2026-08-06 |
| Testes | Vitest + Testing Library; **sem teste de browser** | Verificação por typecheck + lint + unidade + build | 2026-08-06 |
| Entrega | VPS + Docker Compose atrás do Traefik | Controle de custo e de dado; **não é Vercel** | 2026-08-06 |
| Rastreamento | Outbox persistente + worker com lease | Evento de conversão não se perde nem duplica | 2026-08-06 |

## 12. Infraestrutura

**Produção ainda não definida** (decisão do dono em 2026-09-25): por enquanto só **Docker em localhost**. Hospedagem, domínio e deploy entram na Fase 10 do [`docs/PLANO-IMPLANTACAO.md`](docs/PLANO-IMPLANTACAO.md).

| Item | Valor |
|---|---|
| Imagem | construída de `Dockerfile.production` (multi-stage, saída standalone) |
| CI | GitHub Actions: `pnpm typecheck` → `lint` → `test` → `build` |

⚠️ **`NEXT_PUBLIC_*` é embutido no build.** Trocar essas variáveis exige **rebuild**, não restart.

## 13. Restrições e não-negociáveis

- Preservar contrato e padrão existentes; nenhuma arquitetura ou dependência nova sem alinhamento.
- Banco administrado pela **Supabase Management API**, com token fornecido na sessão e **nunca persistido**.
- Migration é **arquivo novo**, idempotente e não destrutiva. Nunca editar migration aplicada.
- **Nada de commit, push ou merge direto na `main`.** Branch + PR.
- SQL de escrita, alteração de `.env` de produção, deploy e rotação de token exigem **autorização explícita na sessão**.
- Sem Playwright nem teste de browser.
- Mudar `/api/integracao/*` quebra agentes externos em produção — trate como contrato público.
- Interface e documentação em **português do Brasil**.

## 14. Riscos abertos

| Risco | Impacto | Onde |
|---|---|---|
| `META_WEBHOOK_VERIFY_TOKEN` em texto puro no access log do Traefik | Quem lê o log consegue responder ao handshake de verificação | `PROGRESS.md` 2026-08-06 |
| Token do system user Meta com 13 scopes, quando 5 bastam | Vazamento teria alcance maior que o necessário | `PROGRESS.md` 2026-08-06 |
| Webhooks de agendamento/follow-up sem idempotência real | Reenvio do n8n duplica linha (`idempotency_key` é aceito e não usado) | `DB.md` |
| Deploy de produção manual e não roteirizado | Passo esquecido derruba o app; `deploy.sh production` ainda é `exit 1` | `PROGRESS.md` |
| Schema anterior às migrations versionadas | Não dá para recriar o banco do zero só com o repositório | `DB.md` |
| Nomenclatura amarrada ao domínio original (`tipo_ensaio`) | Confunde quem lê só o schema ao reaplicar o template | `DB.md` |
| Dependência de um único provedor de WhatsApp em produção (uazapi) | Sessão WhatsApp Web cai e o atendimento para | `SKILLS.md` §Armadilhas |

## 15. Glossário de domínio

- **Lead** — contato, único por telefone normalizado. Tem `source` e `status`.
- **Deal** — card do funil. **N por lead**: cada oportunidade é um card próprio.
- **Etapa / coluna** — configurável em `board_columns` (cor, posição, `stage_type`), não fixa no código.
- **Conversa** — thread de WhatsApp com um contato. Status `bot` | `human` | `resolved`.
- **Takeover** — humano assume a conversa; o relay ao n8n para.
- **CTWA** — Click-to-WhatsApp: anúncio da Meta que abre uma conversa. Gera `ctwa_clid`.
- **Atribuição** — linha em `meta_attributions` ligando lead a anúncio/campanha. **Primeiro toque manda.**
- **Enriquecimento** — busca no Graph API dos nomes de campanha/conjunto/anúncio a partir do `source_id`.
- **Outbox** — fila persistente de conversões a enviar ao Meta, com lease, retry e dead-letter.
- **CAPI** — Conversions API. Devolve ao Meta que o lead virou conversa e depois oportunidade qualificada.
- **Follow-up** — tentativa agendada de retomar lead silencioso, disparada pelo n8n.
- **Token de API** — credencial Bearer de `/api/integracao/*`. O banco guarda **hash**, nunca o valor.
