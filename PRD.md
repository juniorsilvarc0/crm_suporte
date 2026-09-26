# PRD — CRM Suporte

> **O que o produto é e por quê.** Estável: muda quando o escopo muda, não a cada task.
>
> ⚠️ **Produto em conversão (desde 2026-09-25).** Este repositório nasceu de um CRM de clínica feito sobre o mesmo template e está sendo convertido num CRM de suporte técnico. As seções 1–5 descrevem o **produto-alvo**; da seção 6 em diante, o **estado atual** do código: o núcleo herdado que ficou depois da poda da Fase 1 (o banco ainda é o da clínica). As fases de [`docs/PLANO-IMPLANTACAO.md`](docs/PLANO-IMPLANTACAO.md) levam de um ao outro.
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

## 6. Módulos (estado atual, depois da Fase 3)

Telas em `src/app/(dashboard)/app/`, menu em `src/config/navigation.ts`. Os módulos da clínica (leads, funil, pacientes, agenda, follow-ups, financeiro de vendas, métricas comerciais, rastreamento Meta) saíram na Fase 1; o código deles está na tag local `legado-clinica`, de onde as Fases 7 e 8 recuperam telas.

| Módulo | Rota | Papel | O que faz |
|---|---|---|---|
| Início | `/app` | member | Mural de notas do usuário. A fila de tickets entra aqui na Fase 4 |
| WhatsApp | `/app/chat` | member | Conversas ao vivo, texto/áudio/mídia, respostas rápidas compartilhadas, links com preview, telefones/vCards que iniciam conversa após Number Check, ações de arquivar/ler/limpar/apagar com menu e gestos mobile, transcrição, notas internas, etiquetas, takeover bot↔humano, Realtime. O painel do contato mostra a **empresa** e o **selo do contrato** e liga/troca/desliga a empresa (Fase 3) |
| Clientes | `/app/clientes`, `/app/clientes/[id]` | member (ações de admin marcadas) | Empresas (razão social, fantasia, CNPJ alfanumérico opcional), busca e filtro por situação do contrato. Na ficha: contatos da empresa, contrato vigente e histórico. Member cria e edita empresa; **admin** arquiva/reativa e cria, edita, suspende, reativa e encerra contrato. **Valor e vencimento só para admin** |
| Contatos | `/app/contatos` | member | Contatos do WhatsApp, busca por nome ou telefone, filtro com/sem empresa, vincular/trocar/desvincular empresa |
| Conexão | `/app/conexao` | **admin** | QR e estado da instância de WhatsApp (uazapi) |
| Equipe | `/app/equipe` | **admin** | Usuários, papéis (`admin`/`member`), avatar, reset de senha |
| Configurações | `/app/configuracoes` | **admin** | Variáveis (cofre), tokens de API, agente de IA (relay e assinatura do bot) |
| Perfil | `/app/perfil` | member | Dados e senha do próprio usuário |

**Sem API pública hoje:** a API de integração antiga (`/api/integracao/*`) e os webhooks do n8n saíram na Fase 1. A API v1 para a IA e para outros sistemas entra na Fase 5.

**Tickets (Fase 4, em andamento):** o banco e as rotas de sessão já existem:
- `/api/tickets`: abrir e listar por conversa;
- `/api/tickets/[id]`: editar, transicionar, atribuir, assumir, timeline;
- `/api/tickets/catalog`;
- `/api/chat/conversations/[id]/active-ticket`: ticket em foco.

O back completa-se com:
- `/api/tickets/[id]/comments`: nota interna; só o autor edita ou apaga;
- `/api/tickets/[id]/attachments`: bucket privado, download por URL assinada de 10 min;
- as rotas de admin dos catálogos: `/api/products/[id]`, `/api/ticket-categories`, `/api/sla-policies/[priority]`, `/api/ticket-statuses/[key]`.

Com ticket, **limpar a conversa** e **desconectar apagando o chat** respondem 409, e a instância segue conectada.

As telas (lista, detalhe, quadro, chat, Início, Configurações › Atendimento) entram nos PRs seguintes.

## 7. Fluxos centrais

### 7.1 Entrada de mensagem pelo WhatsApp

1. A uazapi entrega em `/api/chat/webhook/uazapi?s=<segredo>`. O segredo é da integração, gerado ao conectar e guardado no Vault; sem ele, 401.
2. O payload é normalizado (`src/features/chat/lib/normalizers/uazapi.ts`). A mídia é re-hospedada no bucket privado `chat-media`.
3. `resolveContactIdentity` (RPC `resolve_contact_identity`, com lock por telefone) acha ou cria o contato **pelo telefone normalizado**.
4. `upsertMessage` grava conversa e mensagem (`sender_type` `contact` na entrada, `device` no eco do celular da empresa); triggers atualizam não lidas e prévia.
5. Supabase Realtime leva para a UI ao vivo.
6. Se a conversa está em `bot`, a mensagem é repassada ao agente externo (URL configurada na tela).

### 7.2 Atendimento humano (takeover)

Conversa tem status `bot` / `human` / `resolved`. Assumir muda para `human`, avisa o agente e para o relay. Liberar devolve para `bot`.

### 7.3 Ticket (Fase 4)

1. **Nasce de uma conversa.** Quem abre é o analista (no chat) ou, na Fase 5, a IA pela API. A abertura é idempotente por ator e chave. O inbound **nunca** cria ticket.
2. **Na abertura:**
   - o ticket recebe o protocolo `SUP-<número>` (a partir de 1000);
   - a empresa e o contrato vigente saem do contato;
   - as mensagens soltas das últimas 24 h entram no ticket;
   - ele vira o **ticket em foco** da conversa (`chat_conversations.active_ticket_id`).

   "Abrir e assumir" faz também o take-over na mesma transação.
3. **Mensagem nova nasce no ticket em foco:** o banco carimba `chat_messages.ticket_id` e ignora o valor que o app manda. Ticket encerrado sai do foco, e as mensagens seguintes ficam soltas.
4. **Status só anda pela matriz** (RPC `ticket_transition`). Transição inválida responde 409 com os destinos permitidos. Não existe "forçar".
5. **SLA 24/7 por prioridade**, com snapshot dos minutos na abertura:
   - **1ª resposta:** é a do analista humano, contada quando o provedor **aceita** a mensagem. Uma resposta entregue antes da abertura conta na abertura. A da IA fica à parte;
   - **solução:** pausa em `aguardando_*` e em `resolvido`, e reabrir retoma o que restava.

   O prazo é calculado na leitura (view `ticket_queue`).
6. **Cliente responde com o ticket em `aguardando_cliente`:** o ticket volta sozinho para `em_atendimento`. Em `resolvido` ele não reabre, só aparece o sinal "Respondeu após resolver".
7. **"Assumir"** (`ticket_take_over`):
   - põe a conversa em `human`, o ticket em foco e o analista como responsável;
   - leva `novo`/`em_triagem` a `em_atendimento`;
   - avisa a IA.

   Tomar o ticket de outro analista exige confirmação.
8. **Nesta fase nenhum aviso sai ao cliente** na troca de status. O evento assinado entra na Fase 6.

## 8. Banco de dados

**Projeto Supabase:** `crm-suporte` (`supabase/config.toml`) — **produção ainda não definida**; por enquanto só Docker local (ver [`docs/PLANO-IMPLANTACAO.md`](docs/PLANO-IMPLANTACAO.md)); o banco nasce aplicando `supabase/migrations/` do zero.

**Inventário do schema (depois do banco da Fase 4, medido no banco local em 2026-09-25):** 30 tabelas públicas · 1 view · 2 policies · 62 funções.
- A Fase 3 somou `products`, `support_plans`, `customers`, `support_contracts` e `support_contract_products`.
- A Fase 4 somou as tabelas de tickets e a view `ticket_queue`.

As 45 migrations da clínica ficam só como referência em `supabase/legado-clinica/`.

| Domínio | Tabelas |
|---|---|
| Contatos | `contacts` (+ `customer_id` → empresa), `contact_phone_identities`, `contact_events` (append-only; inclui ligar/trocar/desligar empresa), `tags`, `contact_tags` |
| Cadastros | `customers` (empresa; `contract_status` é o selo, derivado por trigger), `products` (a fila), `support_plans`, `support_contracts` (no máximo 1 vigente por empresa; escrita só por RPC de admin; **`monthly_amount` ilegível para o service_role**, sai só por `get_support_contract_amounts`), `support_contract_products` |
| Atendimento | `chat_conversations` (+ `active_ticket_id`, o ticket em foco), `chat_messages` (+ `ticket_id`, carimbado no INSERT), `chat_integrations`, `chat_quick_replies`, `conversation_tags` |
| Tickets | `tickets` (escrita **só por RPC**; o service_role só lê), `ticket_statuses` (8 fixos; rótulo e cor editáveis), `ticket_status_transitions` (a matriz), `sla_policies`, `ticket_categories`, `ticket_status_history` e `ticket_events` (append-only, ordem por `seq`), `ticket_comments`, `ticket_attachments` (bucket privado `ticket-attachments`); view `ticket_queue` (SLA na leitura) |
| Plataforma | `app_users`, `api_tokens`, `app_settings`, `app_environment_variables`, `integration_logs`, `user_notes` |

Tipos TypeScript do banco: **gerados** em `src/lib/supabase/database.types.ts` (`pnpm db:types`); o CI falha se divergirem do schema.

### 8.1 Segurança do banco — 🟢 fechado por padrão

- **RLS habilitada em todas as tabelas**; default privileges fechados antes de criar qualquer objeto.
- **`anon` não alcança nada.** `authenticated` só tem `SELECT` em `chat_conversations` e `chat_messages`, com policy que exige `app_role` `admin`/`member` no JWT curto emitido pelo app: é o Realtime do chat.
- **`service_role` com grant mínimo**, por coluna onde importa (ex.: `contacts` sem UPDATE no telefone; `app_users` sem SELECT de `password_hash`; `contact_events` e `integration_logs` sem UPDATE/DELETE).
- Segredos (token da uazapi, segredo do webhook, chaves do cofre) ficam no **Vault**; a tabela guarda só o id.
- `assert_security_baseline()` roda no fim de toda migration e falha se algo disso regredir.
- Todo acesso real usa **service role no servidor** (`src/lib/supabase/server.ts`, `admin.ts`).

Consequência para quem desenvolve: **consulta nova é server-side.** Ligar Realtime numa tabela nova exige grant e policy para `authenticated` filtrando por `app_role` — decisão de segurança, não detalhe de implementação. Assinatura no navegador: sempre por `subscribeAuthenticated` (`src/lib/supabase/client.ts`).

## 9. Autenticação e autorização

Não é Supabase Auth. É **JWT HS256 próprio** (`jose`) em cookie `crm-suporte-session`, 7 dias, assinado com `AUTH_JWT_SECRET`.

- Decisão de acesso: `src/lib/auth/route-guard.ts` (isolada do runtime do Next para ser testável).
- Aplicação: `src/proxy.ts` (o middleware do Next 16).
- Papéis: `admin` | `member`. O middleware redireciona pelo papel do JWT; **a página confirma com o papel fresco do banco**, cobrindo o caso do admin recém-rebaixado com cookie antigo.
- Rota nova de admin exige atualizar **os dois lugares**: `ADMIN_PAGE_PREFIXES` e `allowedRoles` em `navigation.ts`.
- **Cadastros (Fase 3):** Clientes e Contatos são páginas de member; o que é de admin são **ações**, e a fronteira é a rota (`requireDashboardAdmin`) mais o banco (as RPCs de contrato conferem admin ativo de novo). A ficha decide o papel no servidor: o payload do member não leva valor nem vencimento.

## 10. Integrações externas

| Integração | Uso | Código |
|---|---|---|
| **uazapi** | WhatsApp — único provedor suportado | `src/features/chat/lib/{senders,normalizers,connection}/uazapi.ts` |
| **Agente de IA externo** | Recebe o relay das mensagens em modo `bot` e o aviso de takeover | `src/features/settings/lib/get-relay-url.ts`, `src/features/chat/lib/push-takeover.ts` |
| **OpenAI** | Transcrição de áudio no chat; chave e modelo só no cofre (Vault), nunca no env | `src/app/api/chat/transcribe`, `src/features/settings/lib/get-runtime-environment.ts` |
| **Supabase Storage** | Mídia do chat e foto do contato no bucket **privado** `chat-media` (servidos por URL assinada via `/api/chat/media/[id]` e `/api/contacts/[id]/avatar`); avatar da equipe no público `profile-avatars` | `src/lib/storage/chat-media.ts`, `src/lib/storage/put-media.ts` |

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
- A API v1 (`/api/v1/*`, Fase 5) é contrato público consumido pela IA e por outros sistemas: mudança só aditiva ou versionada.
- Interface e documentação em **português do Brasil**.

## 14. Riscos abertos

| Risco | Impacto | Onde |
|---|---|---|
| Configuração do agente ainda lida de env (`TAKEOVER_AGENT_URL`, `BOT_SIGNATURE_AGENT_*`, `N8N_WEBHOOK_URL`) | Contraria "nenhuma credencial no código". O token e o segredo do webhook da uazapi e a chave da OpenAI já estão no Vault (Fase 2) | Fases 5 e 6 do plano |
| Relay repassa o envelope cru com o token da instância | URL de relay errada vaza a credencial do WhatsApp | Fase 5 |
| Dependência de um único provedor de WhatsApp (uazapi) | Sessão WhatsApp Web cai e o atendimento para | `SKILLS.md` §Armadilhas |

## 15. Glossário de domínio

- **Contato** — a pessoa do outro lado do WhatsApp, única por telefone normalizado (tabela `contacts`; o telefone é imutável). Nasce só por `resolve_contact_identity`.
- **Conversa** — thread de WhatsApp com um contato. Status `bot` | `human` | `resolved`.
- **Takeover** — humano assume a conversa; o relay ao agente para.
- **Etiqueta** — marcação livre de conversa, do vocabulário único `tags`.
- **Token de API** — credencial gerada na tela, para integradores. O banco guarda **hash**, nunca o valor. Volta a ter uso com a API v1 (Fase 5).
- **Empresa (cliente)** — pessoa jurídica atendida (`customers`), com N contatos e no máximo 1 contrato vigente. Arquiva, nunca apaga.
- **Fila (produto)** — cada software da casa (`products`); os tickets da Fase 4 entram numa fila.
- **Contrato de suporte** — `ativo` | `suspenso` | `encerrado` (terminal), com vigência, plano, filas cobertas, valor mensal e dia de vencimento (1..28). **Vigente** = ativo ou suspenso.
- **Selo** — a situação do contrato mostrada para quem atende ("Contrato suspenso"), sem valor.
- **Ticket** — o chamado. Nasce de uma conversa, tem protocolo `SUP-<número>`, status fixo, prioridade, fila, categoria, responsável e SLA.
- **Ticket em foco** — o ticket da conversa que recebe as mensagens novas (`active_ticket_id`). Uma conversa pode ter vários tickets abertos; só um fica em foco.
- **Status do ticket** — `novo`, `em_triagem`, `em_atendimento`, `aguardando_cliente`, `aguardando_interno`, `resolvido`, `fechado`, `cancelado`. Os dois últimos são terminais. É independente do status da conversa.
- **SLA** — prazos de 1ª resposta e de solução por prioridade (`baixa|media|alta|critica`), 24/7. O prazo de solução pausa fora de atendimento; a 1ª resposta não pausa.
- **Assumir (ticket)** — take-over centrado no ticket: conversa em `human`, ticket em foco, analista responsável e `em_atendimento`.
