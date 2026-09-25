# Plano de implantação — CRM de Suporte Técnico

## Contexto

Uma software house com softwares de vários nichos precisa de um CRM de **atendimento de suporte técnico**:
- os clientes abrem chamados pelo WhatsApp;
- uma **IA externa** (fora deste repo) faz a triagem e alimenta o CRM **via API**;
- o CRM guarda e gerencia tudo: tickets, empresas, contatos, contratos, histórico e SLA.

Todo integrador fala com o CRM só por API. **Nenhuma credencial de integração mora no código ou em env**: tudo é configurado no menu **Conexão**. No env fica só o núcleo de bootstrap, que não tem como vir do banco: `SUPABASE_URL`/`SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET`, `AUTH_JWT_SECRET`, `NEXT_PUBLIC_SUPABASE_*` e os segredos da stack.

**Base:** este repo, derivado de um CRM de clínica feito sobre o mesmo template (Next 16, React 19, Supabase self-hosted, JWT próprio, Vitest, Docker). De um projeto irmão do mesmo template vem o contrato IA↔CRM: relay com `conversation_status`, handoff, recusa 409/503 e claim/finalize de avisos.

**Evidência.** O plano foi feito em duas etapas:
- 10 agentes leram banco, chat, API, telas, infra e o projeto irmão;
- 3 arquitetos independentes desenharam planos, e um juiz consolidou. Os mapas estão no scratchpad da sessão.

## Decisões fechadas com o dono (2026-09-25)

| # | Decisão |
|---|---|
| 1 | Saem **Pacientes** e **Rastreamento Meta** (CTWA/CAPI, papel `paid_traffic`, webhook Meta Cloud). Ficam, reinterpretados: **Follow-ups** (retornos ligados a ticket), **Agenda** (visita técnica, treinamento, implantação, acesso remoto) e **Financeiro** |
| 2 | Cliente = **Empresa (CNPJ) + N contatos (WhatsApp) + contrato de suporte** |
| 3 | SLA por **prioridade**, 24/7, com **pausa em `aguardando_cliente`**. A 1ª resposta é a do **analista humano**; a da IA é registrada à parte |
| 4 | **Um número** de WhatsApp (uazapi) para todos os produtos. A IA identifica o produto |
| 5 | Repo novo `github.com/juniorsilvarc0/crm_suporte`, **público e com histórico zerado**. O histórico da origem fica no repositório privado dela |
| 6 | Mudança de status → o CRM **emite evento assinado**; a IA/n8n envia a mensagem ao cliente |
| 7 | **Filas = produtos**, mais o responsável. Papéis `admin`/`member` |
| 8 | Marca provisória "CRM Suporte", num lugar só (`src/config/site.ts`) |
| 9 | Banco nasce de um **baseline novo** (customers, contacts, tickets…), portando o SQL já testado |
| 10 | Quem abre ticket é a **IA via API** (idempotente) ou o **analista** na tela. O CRM não abre sozinho |
| 11 | Status **fixos**; rótulo e cor editáveis; transição inválida responde 409 com as permitidas |
| 12 | Financeiro = **contratos de suporte + mensalidades + despesas** |
| 13 | **Vários tickets abertos por conversa**, com um **"em foco"** (`chat_conversations.active_ticket_id`) |
| 14 | A IA envia mensagens **só pela API do CRM**; o token da uazapi sai do relay |
| 15 | Hospedagem **decidida depois**. Por enquanto, só **Docker em localhost** |

## Descobertas que moldam o plano

- **Repositório separado (feito em 2026-09-25).** A cópia apontava para o repositório da origem, cujo merge na `main` faz deploy. O WIP de Financeiro que estava no working tree foi preservado numa branch do repositório de origem, e o repo novo nasceu sem histórico.
- **Segredos pela UI ainda não funcionam.** O cofre de variáveis (Vault + `app_environment_variables`, lido por `get-runtime-environment.ts`) só é consultado para `OPENAI_*`. `UAZAPI_WEBHOOK_SECRET`, `N8N_WEBHOOK_*`, `TAKEOVER_AGENT_URL`, `BOT_SIGNATURE_AGENT_*` e `R2_*` vêm de `process.env`. O token da uazapi fica em texto puro em `chat_integrations.config`.
- **Falhas de autenticação herdadas:**
  - `N8N_WEBHOOK_SECRET` é uma chave-mestra de env (`verify-webhook.ts:60`);
  - os tokens de API não têm escopo nem validade;
  - o webhook Evolution não tem autenticação nenhuma;
  - o webhook uazapi aceita qualquer chamada se o segredo estiver vazio (`uazapi/route.ts:56`);
  - o relay manda o envelope cru com o token da instância.
- **Nada roda em segundo plano.** O `meta-dispatcher` nunca rodou em produção. SLA e webhooks de saída precisam de um worker novo.
- **Toda mídia é pública e permanente**, e não existe URL assinada.
- **Acoplamento legado:** triggers criam `deal` a cada inbound; `chat_conversations.lead_id` é NOT NULL restrict; `@/features/leads` é importado por 84 arquivos. O `supabase/seed.sql` está quebrado desde a migration de funis.

---

## A. Princípios de arquitetura

1. **Dois eixos independentes.** Quem atende a conversa fica em `chat_conversations.status` (`bot|human|resolved`). O status do ticket é outra coisa. Um nunca é mapeado no outro.
2. **O inbound nunca cria ticket.** Ele só carimba `chat_messages.ticket_id` com o ticket em foco da conversa.
3. **Status só muda pela RPC `ticket_transition`**, com máquina de estados no banco. Transição inválida gera 409 `invalid_transition` com a lista `allowed`. Não existe `force`.
4. **Fail-closed em todo lugar:**
   - a IA só responde com `conversation_status === 'bot'`; campo ausente significa não responder. O `?? "bot"` do projeto irmão **não** é portado;
   - o CRM responde 409 `conversation_not_owned_by_ai` se a IA tentar enviar numa conversa que não está em `bot`;
   - segredo de integração só vem do Vault, com cache de 60 s invalidado na escrita e sem cair para o env; se não der para ler, 503;
   - webhook uazapi sem segredo responde 401.
5. **Saída de eventos por outbox transacional** (`event_outbox` → `webhook_deliveries`), com lease, backoff e dead-letter. O molde é `features/meta/outbox.ts` + `20260729120000_fix_claim_meta_conversion_outbox.sql`.
6. **SLA calculado na leitura** (`*_due_at` comparado com `now()`). O job só carimba a violação e emite o evento, então a tela fica certa mesmo com o worker parado.
7. **Segurança do banco como função.** `assert_security_baseline()` roda no fim de toda migration:
   - default privileges fechados **antes** de criar qualquer objeto;
   - `revoke execute … from public, anon, authenticated` em toda função;
   - publication e buckets conferidos.
8. **Marca num lugar só.** `site.ts` define `{name, shortName, slug, ticketPrefix}`. Dele derivam o cookie `${slug}-session`, o `TOKEN_PREFIX`, o `TRACK_SOURCE` da uazapi e o cache do SW.
9. **Resposta única.**
   - Sucesso: `{ok:true,data,meta?}`.
   - Erro: `{ok:false,error:{code,message,fields?,allowed?},request_id}`.
   - OpenAPI 3.1 gerado com o `z.toJSONSchema` do zod 4 já instalado. **Nenhuma dependência npm nova no plano.**

## B. Modelo de dados — baseline novo

As 45 migrations da clínica vão para `supabase/legado-clinica/`, fora do glob de `scripts/db-local-apply.sh`, e ficam como referência. Todo arquivo novo:
- tem timestamp de 14 dígitos e é idempotente;
- termina com `select public.assert_security_baseline();`.

**Núcleo (Fase 2).** Cada migration porta SQL já testado:

| Migration | Conteúdo | Porta de |
|---|---|---|
| `_fundacao` | default privileges fechados; `pgcrypto`, `supabase_vault`, `pg_trgm`; `set_updated_at`; `assert_security_baseline()` | `20260819120000_blindagem_anon.sql` |
| `_usuarios` | `app_users` (`admin\|member`), RPCs bcrypt, trava de último admin, `must_change_password`, apelido e assinatura | `20260703*`, `20260706000000`, `20260713150000`, `20260714*` |
| `_integracao` | `app_settings`; cofre com prefixo novo e leitura em lote `get_app_environment_variables(text[])`; `api_tokens` + `scopes text[]`, `expires_at`, `rate_limit_per_min`; `integration_logs` + `api_token_id`, `request_id`, `route`, `http_status`, `latency_ms`; `user_notes` | `20260706170000`, `20260811140000`, `20260818000000` |
| `_contatos` | `contacts` (com `search_name` + GIN trgm, `archived_at`, `anonymized_at`); `contact_phone_identities`; `contact_events` (append-only); `resolve_contact_identity` com advisory lock e **sem o ramo de deal**; telefone imutável; `tags`, `contact_tags` | `20260809110000_identidade_persistente_de_lead.sql` e, do projeto irmão, `20260824180000_profissionalizar_dominio_leads.sql` |
| `_chat` | `chat_integrations` com `token_secret_id` e `webhook_secret_id` no Vault; `chat_conversations` (`contact_id` NOT NULL); `chat_messages` + `sender_type contact\|agent\|ai\|system\|device`, `media_bucket`, `media_key`; dedup `(conversation_id, external_id)`; trigger de não lidas; `conversation_tags`; `chat_quick_replies` | `20260622_chat_module.sql`, `20260807*`, `20260808*`, `20260809111000:314-368` |
| `_storage_realtime` | `chat-media` **privado**; `profile-avatars` público; publication só com o chat; policy por `app_role` | `20260706150000`, blindagem |

**Cadastros (Fase 3):**
- `products` é a **fila**: nome único enquanto não arquivado, `niche`, `color`, `archived_at`;
- `support_plans`;
- `customers`: `legal_name`, `trade_name`, `cnpj` com único parcial, `search_name`;
- `contacts.customer_id`: N:1;
- `support_contracts`: `status ativo|suspenso|encerrado`, vigência, `monthly_amount numeric(12,2)`, `billing_day`; único parcial de 1 contrato ativo por empresa;
- `support_contract_products`.

**Tickets (Fase 4):**
- `ticket_statuses`: 8 chaves fixas (`novo, em_triagem, em_atendimento, aguardando_cliente, aguardando_interno, resolvido, fechado, cancelado`). `label`, `color` e `position` são editáveis; `sla_mode running|paused|stopped` e `is_terminal` são fixos.
- `ticket_status_transitions`, somente leitura. Regras:
  - `resolvido→em_atendimento` é reabertura;
  - `resolvido→fechado` acontece sozinho depois de 72 h;
  - `fechado` e `cancelado` são terminais.
- `sla_policies(priority, first_response_minutes, resolution_minutes, warn_pct)`, com prioridades `baixa|media|alta|critica`.
- `ticket_categories`: `product_id?`, `parent_id?`.
- **`tickets`:**
  - identificação e vínculos: `number` identity (protocolo), `title`, `description`, `status`, `priority`, `product_id?`, `category_id?`, `customer_id?`, `contact_id?`, `conversation_id` (restrict), `contract_id?`, `assigned_to_user_id?`;
  - origem e integração: `source ai|agent|api`, `created_by_user_id`/`created_by_token_id`, `idempotency_key` (único **não** parcial, por causa do `onConflict`), único `(created_by_token_id, external_id)`, `ai_triage jsonb`;
  - SLA e ciclo: `sla_policy` (snapshot), `first_response_due_at`, `resolution_due_at`, `first_responded_at`, `first_ai_response_at`, `resolved_at`, `closed_at`, `sla_paused_at`, `sla_paused_seconds`, `*_breached_at`, `reopened_count`;
  - controle: `version`.
- `ticket_status_history` e `ticket_events` (append-only, com `actor_type ai|agent|system|api`, `event_key` idempotente), `ticket_comments` (nota interna), `ticket_tags`.
- `ticket_attachments`: **sem URL**, só `bucket`, `object_key`, `mime`, `size` e `sha256`, no bucket privado `ticket-attachments`.
- `chat_conversations.active_ticket_id`: set null.
- `chat_messages.ticket_id`: restrict.
- Triggers:
  - `stamp_ticket`: BEFORE INSERT em mensagem;
  - `first_response`: pela 1ª mensagem `agent`;
  - `reopen_on_inbound`: inbound em conversa `resolved` volta para `bot`; ticket em foco que chega a estado terminal zera o ponteiro.
- Escrita só por RPC SECURITY DEFINER: `create_ticket` (trava a conversa, idempotência, vincula as mensagens soltas das últimas 24 h, move o foco), `ticket_update`, `ticket_transition(p_expected_version)`, `ticket_assign`, `ticket_set_active`, `ticket_take_over`. O `service_role` fica só com SELECT em `tickets`.

**Regras de SLA.** Na abertura, cada prazo = `created_at` + os minutos da prioridade. Quando o status é `paused`, a pausa acumula e o prazo de solução é empurrado. Trocar a prioridade recalcula.

**Fases seguintes:**
- Fase 5: `api_idempotency_keys`.
- Fase 6: `event_outbox`, `webhook_subscriptions` (`kind webhook|relay`, segredo no Vault), `webhook_deliveries` com claim `skip locked` e backoff 30s→24h→`dead_letter`, `ticket_notices` com claim/finalize (porte de `20260825143000` do projeto irmão) e `sla_sweep`.
- Fase 7: `appointments` (`kind`, `ticket_id?`, `customer_id`, técnico), `agenda_blocks` e `followups(ticket_id, due_at, kind)`.
- Fase 8: `payments` (único `(contract_id, competence)`), `expenses` e `generate_monthly_payments`, que é idempotente.

## C. API v1 (contrato com a IA e com qualquer integrador)

**Guard.** `PUBLIC_API_PREFIXES` passa a ser `['/api/v1/', '/api/chat/webhook/', '/api/auth/']`.

**Autenticação.** Todo handler de `/api/v1` usa `withApi({scopes}, fn)` (novo), que generaliza `verify-webhook.ts:44-99` **sem** o ramo de env. O wrapper cuida de:
- hash, revogação e validade do token;
- rate limit por token (`rate-limit.ts`), com 429 + `Retry-After`;
- `last_used_at` atualizado no máximo 1×/min;
- log sem o corpo da requisição.

Um teste Vitest varre `src/app/api/v1/**/route.ts` e falha se algum método responder sem token.

**Escopos.** `context:read`, `contacts:*`, `customers:*`, `catalog:read`, `tickets:*`, `comments:write`, `attachments:*`, `conversations:read`, `messages:send`, `conversations:handoff`, `notices:claim`. A UI oferece o preset "IA de triagem".

| Recurso | Endpoints |
|---|---|
| Diagnóstico | `GET /health`, `GET /me`, `GET /openapi.json` |
| Contexto da triagem | `GET /context?phone=` → contato, empresa, contrato (status/alerta, sem valor), conversa (`status`, `active_ticket_id`), tickets abertos com `allowed_transitions`, últimos tickets, últimas 20 mensagens, `ai_may_reply` |
| Contatos / Clientes | `GET` (q, cursor, `updated_since`), `POST` (upsert por telefone), `GET/PATCH /{id}` (telefone imutável → 422); `GET /customers?cnpj=` e `/{id}/contract` |
| Catálogos | `/products`, `/ticket-categories`, `/ticket-statuses` (com transições), `/sla-policies`, `/users` |
| Tickets | `GET` (filtros + `sla_breached`); `POST`; `GET /{id\|number}`; `PATCH` (`If-Match` → 412); `POST /{id}/transitions`; `/assign`; `/comments`; `/attachments` (multipart ou `source_url` com `assertSafeUrl`); `/timeline` |
| Conversas | `GET /{id}`, `/{id}/messages`; `POST /{id}/messages {client_id,text}` (`sender_type='ai'`); `POST /{id}/handoff {reason,summary,ticket_id?}`; `PUT /{id}/active-ticket` |
| Avisos (F6) | `POST /tickets/{id}/notices/{step}/claim` e `/finalize` (só `claimed:true` autoriza o envio ao cliente) |

**Idempotência.**
- `Idempotency-Key` é obrigatório em todo POST de criação.
- Mesma chave com o mesmo corpo repete a resposta, com `Idempotent-Replayed`.
- Mesma chave com corpo diferente responde 422 `idempotency_key_reused`.
- Requisição original ainda em andamento responde 409 `idempotency_in_progress`.

**Paginação.** Cursor opaco `(updated_at,id)`.

**Relay v1** (porte de `relay-envelope.ts` do projeto irmão, sem o fallback): todo inbound segue para a IA como payload uazapi **sem `token`**, mais os campos na raiz:
- `relay_version`, `conversation_status`, `conversation_id`;
- `contact`, `customer`, `contract{status,alert}`;
- `active_ticket{id,number,status,priority,product_id,assigned_to}`;
- `media_url` assinada por 10 min.

Um teste falha se o filtro `status==='bot'` voltar ao relay. O contrato fica documentado em `docs/CONTRATO-RELAY.md`.

**Eventos de saída.**
- Headers: `X-CRM-Event`, `X-CRM-Event-Id`, `X-CRM-Timestamp` e `X-CRM-Signature: v1=hmac_sha256(segredo, ts+"."+corpo)`. A assinatura usa `features/meta/signature.ts`, movido para `src/lib/security/hmac.ts`.
- Entrega pelo menos uma vez: o consumidor deduplica pelo `id` do evento e usa `ticket_version`.
- Catálogo:
  - ticket: `ticket.created|updated|status_changed|assigned|priority_changed|comment_added|attachment_added|reopened|sla_warning|sla_breached`. O `status_changed` é o gatilho do aviso ao cliente e leva protocolo, rótulo, telefone e conversa;
  - conversa: `conversation.message_received` (o relay), `conversation.owner_changed`, `conversation.handoff_requested`;
  - cadastros: `contact.created|updated`, `customer.contract_status_changed`;
  - configuração e teste: `settings.bot_signature_changed`, `webhook.ping`;
  - da Fase 7: `appointment.*` e `followup.due`.

## D. Menu Conexão (`/app/conexao`, só admin) — nenhum segredo em env

| Aba | Base reaproveitada |
|---|---|
| **WhatsApp** — token e segredo do webhook no Vault, segredo gerado por integração, comparação em tempo constante, rotação | `features/connection/components/connection-panel.tsx`, `api/connection/*` |
| **API do CRM** — tokens com escopos, validade e limite | `features/settings/components/api-tokens-manager.tsx` |
| **Agente de IA** — URL do relay, segredo exibido uma vez, "testar", assinatura do bot | `automation-settings.tsx`, `bot-signature-settings.tsx` |
| **Webhooks de saída** — eventos, ping, entregas, dead letter, reenvio | novo |
| **Cofre** — só um catálogo de chaves conhecidas; nome desconhecido é recusado | `environment-variables-manager.tsx` |
| **Logs** e **Saúde** (atraso do worker, fila, dead letters) | `features/integrations/components/integration-logs-table.tsx` (hoje órfão) |

Destino de cada variável de env:
- `N8N_WEBHOOK_SECRET`: eliminado;
- `N8N_WEBHOOK_URL`: vira assinatura `kind=relay`;
- `UAZAPI_WEBHOOK_SECRET` e o token da instância: Vault, por integração;
- `TAKEOVER_AGENT_URL` e `BOT_SIGNATURE_AGENT_*`: viram eventos assinados;
- `APP_PUBLIC_URL`: `app_settings`;
- `META_*` e `MANYCHAT_*`: removidos.

Um teste falha se aparecer `process.env` fora da lista de bootstrap mais `RUN_JOBS`.

## E. Fases

Regras de toda fase:
- termina com `pnpm typecheck && pnpm lint && pnpm test && pnpm build` verdes;
- atualiza PROGRESS/PRD/UI/SKILLS;
- PRs na ordem banco → back → front, com commits separados por camada (CONTRIBUTING);
- cada task abre com o bloco `TASK ENQUADRADA` e fecha com `CONCLUÍDO` (AGENTS §0/§8).

Os prazos são ordem de grandeza.

| Fase | Entregas | Pronto quando | ~dias |
|---|---|---|---|
| **0 · Separar o repositório** (cada comando git de escrita **com autorização literal do dono**) | **Feito em 2026-09-25:** WIP de Financeiro preservado numa branch do repositório de origem; remote da origem renomeado para `clinica` e sem push; commit inicial **sem histórico** no repo novo, sem a infra de produção da origem (`DEPLOY.md`, `deploy/`, `deploy.yml`), sem o staging herdado, sem o PROGRESS antigo e sem dados pessoais nos testes; tag local `legado-clinica` apontando para a última versão da origem (**não** vai para o repo público). Também no commit inicial: marca trocada, com `site.ts` como fonte única (nome, cookie `crm-suporte-session`, prefixo `crmsuporte_`, logos neutros), containers locais `crm-suporte-*`, e fora do repo o MCP antigo, `setup-local.*`, `META-LEAD-TRACKING.md`, `SPEC.md` e `ROADMAP.md`. **Falta:** portas locais novas (3100 / 55321 / 55322); `DB.md` é reescrito na Fase 2 | repo novo sem histórico da origem; CI verde no repo novo; login local mostra "CRM Suporte" | 1–2 |
| **1 · Poda do TS legado** (banco ainda intacto) | **Feito em 2026-09-25**, branch `refactor/poda-legado-clinica`: um PR com um commit por passo da seção F (não nove PRs, para não empilhar branch sobre branch sem merge). Desvios registrados no PROGRESS | `rg "features/(meta\|patients\|deals\|board\|pipelines\|appointments\|followups\|financeiro\|dashboard)" src` vazio; o chat uazapi recebe e envia | 4–5 |
| **2 · Baseline + renome + stack local completo** (PR único, commits por camada) | Migrations do núcleo (seção B); `seed.sql` novo (`admin@local`); `db-local-apply.sh` com livro-razão; `features/leads` → `features/contacts` (~46 arquivos do chat); `sender_type` nos senders; Vault para a uazapi; `get-runtime-environment` com catálogo, cache e fail-closed; `put-media` privado + `/api/chat/media/[id]` (302 para URL assinada, então os componentes do chat não mudam); saem os logs `[uazapi-dbg]`; limpar chat e disconnect recusam conversa com ticket; **`docker-compose.yml` local ganha `realtime` e `storage`** (porte do compose de produção); testes SQL em `supabase/tests/` | Banco vazio aplica tudo com "baseline ok" e reaplicar não muda nada; payload uazapi de fixture postado no webhook local cria contato, conversa e mensagem, e a mídia abre por URL assinada; o Realtime atualiza a lista sem recarregar | 7–9 |
| **3 · Cadastros** | Rotas `/api/{customers,contacts,products,contracts}` (escrita de contrato só admin); `/app/clientes` e `/app/clientes/[id]` (a partir de `patients/components/patient-form-dialog.tsx`, com CNPJ validado no molde de `patients/lib/documents.ts`); `/app/contatos`; combobox de produto (de `financeiro/components/procedure-combobox.tsx`); empresa e selo do contrato em `chat/components/contact-info-sheet.tsx` | O analista liga um contato do WhatsApp a uma empresa e vê "Contrato suspenso" | 4–5 |
| **4 · Tickets** (banco → back → front 4a–4f) | Migration e RPCs; serviço único `src/features/tickets/server/*` (usado pela UI e pela API, com uma regra só); `lib/state-machine.ts` e `lib/sla.ts` puros (reusa `humanizeUntil` de `home/lib/person-status.ts`); rotas de sessão `/api/tickets/*`. Front: **4a** lista `/app/tickets` (anatomia de `leads/components/leads-table.tsx` + `DataToolbar`, selo de SLA derivado de `followups-table.tsx`); **4b** `/app/tickets/[id]` com URL própria (blocos e timeline de `lead-detail-dialog.tsx` + `lib/lead-history.ts`, comentários com a regra de `chat/lib/note-actions.ts`, anexos com `document-message-card`/`image-lightbox`); **4c** `/app/tickets/quadro` sobre `kibo-ui/kanban` com "Mover para", véu e 409 desfazendo com toast; **4d** Início com "Minha fila / Não atribuídos" + `NotesPanel`; **4e** chat com chip do ticket em foco, "Abrir ticket", troca de foco e botão "Assumir" (dono + responsável + `em_atendimento` numa RPC); **4f** Configurações: produtos, categorias, SLA, rótulos de status | Ticket aberto a partir da conversa recebe as mensagens seguintes na timeline; movimento inválido volta listando os permitidos; o selo mostra "vence em 2 horas" e pausa em aguardando cliente | 11–14 |
| **5 · API v1 + relay** (paralela à 4a–4f) | `withApi`, erros, idempotência, OpenAPI, rotas da seção C, `chat/lib/send-outbound.ts` (extraído de `api/chat/conversations/[id]/send/route.ts`), handoff, relay v1 direto e logado; abas WhatsApp, API, Agente, Cofre, Logs e Saúde; `docs/API.md`, `docs/GUIA-AGENTE-IA.md` e `docs/CONTRATO-RELAY.md` reescritos | Roteiro curl ponta a ponta verde (seção Verificação) | 6–8 |
| **6 · Eventos, worker e SLA ativo** | `src/instrumentation.ts` (flag `RUN_JOBS`, guarda em `globalThis`, lease `skip locked`) + tentativa imediata com `after()`; `features/webhooks` (claim, HMAC, envio, finalização); relay migrado para o outbox (`kind=relay`, `max_age` 120 s); `sla_sweep` + fechamento sozinho depois de 72 h; avisos com claim/finalize; aba Webhooks; saem `push-takeover.ts` e `push-bot-signature` via env | Assinatura válida no receptor; falha → backoff → `dead_letter` depois de 8 tentativas; lease vencida é reivindicada de novo; `sla_breached` sai uma vez por ticket; reenvio manual funciona | 4–5 |
| **7 · Agenda + Follow-ups** | Telas recuperadas da tag local `legado-clinica` (`agenda-month-view`, `agenda-time-grid`, `agenda-list-view`, `appointment-dialog`, `followups-table`, `novo-followup-dialog`), sem modo venda, sem promoção a paciente, com cor por tipo e vínculo ao ticket | Do ticket se agenda uma visita e um retorno; os dois aparecem na timeline, e o retorno vencido fica destacado | 5–6 |
| **8 · Financeiro** (paralela à 7) | Contratos (admin), mensalidades e despesas a partir do WIP (`finance-overview-cards`, `finance-entries-list`, `expense-form-dialog`), **com `requireAdminPage` + `requireDashboardAdmin`** (o WIP deixa um member gravar pela API) | Gerar a mesma competência 2× cria 0 linhas; um member recebe 403 na API | 4–5 |
| **9 · Métricas de suporte** | `dashboard/components/kpi-band.tsx`, `daily-chart` (abertos × resolvidos), `period-links`; backlog, SLA estourado, 1ª resposta, resolução, reabertos, IA × humano, por produto/cliente/analista | Todo número vem de consulta e tem lastro (UI.md) | 3–4 |
| **10 · Produção** — **bloqueada** até você decidir hospedagem e domínio | Seção G + **política de privacidade definitiva** (revisão jurídica; hoje a página é um aviso provisório) | — | 3–4 |

Total: ~55–70 dias de desenvolvimento. As Fases 4 e 5 correm em paralelo, e as Fases 7 e 8 também.

**Navegação-alvo** (`src/config/navigation.ts` + `ADMIN_PAGE_PREFIXES` + os dois testes):
- Operação: Início, Tickets, Quadro, WhatsApp, Clientes, Contatos, Agenda, Follow-ups.
- Análise: Métricas, Financeiro (admin).
- Administração: Conexão, Equipe, Configurações.
- Abas mobile: `/app`, `/app/tickets`, `/app/chat`, `/app/clientes`, `/app/agendamentos`.

## F. Remoção do legado (Fase 1, um PR por passo, sem quebrar o build)

Agenda, Follow-ups e Financeiro saem na Fase 1 e voltam nas Fases 7 e 8. Motivo: as tabelas deles mudam de forma (hoje presas a lead, deal e paciente). Os componentes são recuperados da tag local `legado-clinica` (ou do repositório de origem), não reescritos.

1. **Extrair antes de apagar:**
   - o tipo `Tag` e `leads/schemas/colors.ts` vão para `src/features/tags/`;
   - a identidade vai para `src/features/contacts/`;
   - `meta/signature.ts` vai para `src/lib/security/hmac.ts`;
   - `chat/lib/connection/ssrf-guard.ts` vai para `src/lib/security/`.
2. **Chat:**
   - tirar os agendamentos de `api/chat/conversations/[id]/contact/route.ts:65-73`;
   - tirar os rótulos de funil de `contact-info-sheet.tsx:29`;
   - tirar o filtro de etapa (`chat/page.tsx`, `chat-filters.ts`, `conversations/route.ts:21,50`);
   - remover webhooks, normalizers e senders de **Meta e Evolution**;
   - remover `api/chat/status/[phone]`.
3. **Início:** fica só o `NotesPanel`.
4. **Pessoas:** saem Leads, Funil e Pacientes, junto com `api/leads/[id]/promote`.
5. **Agenda e Follow-ups:** saem as telas e rotas antigas, e as integrações e o n8n correspondentes.
6. **Métricas:** saem `dashboard`, `pipelines` e `board`.
7. **Vendas:** saem `financeiro` e `procedures`.
8. **Meta e papel `paid_traffic`:** saem de `settings/types.ts`, do guard, da nav, de `require-dashboard-session.ts:102` e de `supabase-token.ts`, além de `scripts/meta-dispatcher.mjs`, `Dockerfile.production:51` e `scripts/{seed,reset}-demo.mjs`.
9. **Resto da integração antiga:** `api/integracao/*`, `api/webhooks/n8n/*`, `api/feedbacks`, `verifyWebhookSecret` e o MCP antigo (já removido no commit inicial; o MCP novo fica para a v1.1).

O SQL legado não é dropado: sai por arquivamento na Fase 2.

## G. Infra

**Agora (localhost, Fase 2):**
- `docker-compose.yml` com `db`, `rest`, `realtime`, `storage`, `gateway` e `web`, portando serviços e healthchecks de `deploy/producao/app/docker-compose.yml`;
- publication `supabase_realtime` e schema `_realtime` criados no init (armadilhas registradas no PROGRESS de 2026-08-19);
- portas e nomes de container próprios, para não colidir com outros projetos;
- o worker roda dentro do `web` (`RUN_JOBS=1`).

Para receber WhatsApp **real** em localhost, a uazapi precisa alcançar o webhook: é preciso um túnel HTTPS (ex.: `cloudflared`, `ngrok`). **Requer aprovação**: é ferramenta fora do repo. Sem túnel, a verificação usa fixtures de payload uazapi postadas no webhook local.

**Depois (Fase 10, bloqueada).** Hospedagem e domínio ainda não foram decididos. Os scripts de deploy da origem não vieram para este repo; a Fase 10 os recupera de lá e parametriza. Se o CRM dividir a borda Traefik com outra stack:
- nomes de **serviço** únicos (`crmsup-*`), não só `container_name`. Na rede compartilhada o nome do serviço vira alias de DNS, e um `http://gateway:80` de outra stack poderia resolver para o gateway novo;
- routers do Traefik `crmsup-*`;
- tenant do Realtime `realtime-dev.crmsup-realtime`;
- não mexer na borda nem no ACME compartilhados;
- workflow de deploy com chave SSH e PAT próprios;
- backup contando `tickets`/`contacts`, com a chave raiz do Vault no backup;
- cópia fora da VPS como requisito de go-live.

Descoberto na Fase 2, e obrigatório no primeiro deploy:
- **Nunca rodar `supabase/seed.sql` em produção**: ele cria `admin@local` com senha `123456`. O 1º admin nasce por `select public.create_app_user(<email>, <nome>, <senha forte>, 'admin', 'slate', true)` via `psql` no servidor (o último `true` força a troca de senha no 1º login).
- **Fechar os default privileges do `supabase_admin`** antes das migrations, como `docker/db-init.sql` faz no local (`alter default privileges for role supabase_admin in schema public revoke all on tables|sequences|functions from anon, authenticated, service_role`). Sem isso, objeto criado por ele nasce aberto, e o `assert_security_baseline()` reprova a migration seguinte.
- **`NEXT_PUBLIC_SUPABASE_URL` tem de ser alcançável pelo navegador E pela uazapi**: as URLs assinadas de mídia são reescritas para essa origem (`signStorageObject`). `SUPABASE_JWT_SECRET` do app tem de ser o mesmo do tenant do Realtime, senão o chat não recebe nada ao vivo.
- **`FILE_SIZE_LIMIT` do storage-api = 50 MB**, o mesmo teto do bucket `chat-media`; o efetivo é o menor dos dois.

## H. Riscos e fora da v1

| Risco | Mitigação |
|---|---|
| Deploy cair na produção da origem | Resolvido na Fase 0: repo separado, remote da origem sem push, sem workflow de deploy |
| Regredir invariantes SQL portadas (lock de identidade, dedup, não lidas, blindagem) | Porte literal + testes SQL + `assert_security_baseline()` em toda migration |
| IA responder por cima do humano | 409 no envio, token fora do envelope, `conversation_status` fail-closed, teste de contrato no molde do `ownership-contract.test.ts` do projeto irmão |
| Rota nova em `/api/v1` sem autenticação | Teste que varre todos os handlers |
| Worker parado | SLA calculado na leitura; aba Saúde; `/health` com atraso do worker |
| Aviso duplicado ao cliente | `event.id` estável + `ticket_version` + claim/finalize |

**Fora da v1:**
- expediente e feriados;
- SLA por contrato;
- CSAT;
- base de conhecimento;
- mais de um número de WhatsApp;
- mesclar tickets;
- portal do cliente;
- e-mail;
- supervisor e visibilidade por fila;
- escalonamento N1/N2;
- atribuição automática;
- MCP;
- anonimização LGPD (a coluna já nasce);
- R2;
- Swagger UI.

## Aprovações que este plano pede (AGENTS §3/§7)

- **Padrões novos:**
  - worker em `src/instrumentation.ts` com `after()`;
  - outbox genérico;
  - escrita em `tickets` só por RPC (o `service_role` fica só com SELECT);
  - job de CI com Postgres efêmero para os testes SQL.
- **Segurança:**
  - `chat-media` privado;
  - `tickets` no Realtime para `authenticated`, com policy por `app_role` (amplia a asserção 5.2).
- **Remoção:** `lib/storage/r2.ts` sai do caminho de gravação.
- **Ferramentas:**
  - `npx supabase gen types` (alternativa: `types.ts` escrito à mão);
  - túnel HTTPS local para o webhook uazapi.
- **Git:** cada comando de escrita da Fase 0 e das seguintes (AGENTS §3.1).
- **Dependências npm novas:** nenhuma.

**Decisões que tomei e merecem revisão:**
- prioridades `baixa|media|alta|critica`, com SLA padrão (1ª resposta/solução) de 8h/72h, 4h/24h, 1h/8h e 30min/4h, editável;
- `resolvido→fechado` sozinho depois de 72 h;
- a IA só passa a conversa de `bot` para `human`; a volta é só pela UI;
- contato pertence a 1 empresa;
- o valor do contrato só aparece para admin, e a API nunca expõe valor.

## Verificação

- **Em toda fase:** `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`, mais a leitura do diff. Sem Playwright (AGENTS §3.12).
- **Banco:**
  - `docker compose up -d` + `./scripts/db-local-apply.sh` em banco vazio imprime "baseline ok";
  - reaplicar não muda nada;
  - `supabase/tests/*.sql` via `docker exec … psql` cobrindo: lock de identidade concorrente, dedup de mensagem, não lidas, máquina de estados, pausa de SLA, asserções de grants;
  - anon lendo qualquer tabela recebe 401.
- **Webhook:** fixtures uazapi (texto, mídia, eco com `track_id`, grupo ignorado) postadas em `/api/chat/webhook/uazapi?s=…` criam contato, conversa e mensagem, e a mensagem cai no ticket em foco.
- **Roteiro curl da API v1** (Fase 5), com token criado na aba Conexão:
  1. `GET /context?phone=`;
  2. `POST /tickets` com `Idempotency-Key`; repetir a chamada cria 0 linhas;
  3. transição inválida → 409 com `allowed`;
  4. `POST /conversations/{id}/messages` → a mensagem aparece como "IA" no chat;
  5. com a conversa em `human`, o envio → 409 `conversation_not_owned_by_ai`;
  6. `POST /handoff`;
  7. resolver;
  8. falta de escopo → 403; token expirado → 401.
- **Eventos** (Fase 6): receptor local (`nc`/servidor de teste) confere a assinatura HMAC; parar o receptor gera backoff visível na aba Saúde; o reenvio manual entrega.
- **Ponta a ponta com WhatsApp real** (se o túnel for aprovado): mensagem do celular → aparece ao vivo → a IA de teste abre o ticket pela API → o analista assume → resolve → sai o `ticket.status_changed`.
