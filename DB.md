# DB.md — Modelo de Dados

> Fonte de verdade: [`src/lib/supabase/types.ts`](./src/lib/supabase/types.ts) (mantido manualmente). Existe também `src/lib/supabase/generated-types.ts`, mas está desatualizado/incompleto (não reflete `board_columns` nem os tipos atuais) — **não use esse arquivo como referência**.
>
> Migrations versionadas em `supabase/migrations/`: `20260101000000_core_schema.sql` (schema base reconstruído a partir de `types.ts` para paridade no ambiente local), `20260612180000_disable_rls_enable_realtime.sql` e `20260622_chat_module.sql`. **Atenção**: a migration de schema base foi reconstruída do `types.ts` (fonte de verdade do código) e reflete o que o app usa, mas **pode não ser idêntica byte-a-byte ao banco de produção** — que foi criado direto no Supabase (Studio/Management API). Para paridade exata com produção, gerar um dump com `supabase db dump`. Por isso, as colunas abaixo vêm de `types.ts` (garantido) e dessa migration base; detalhes de constraint/índice específicos de produção que não constem nessa migration seguem marcados como **inferidos** ou **não confirmáveis** sem inspecionar o banco real.

## Visão geral

Banco único Postgres (Supabase), schema `public`, 15 tabelas:

| Domínio | Tabelas |
|---|---|
| Funil / CRM | `leads`, `board_columns`, `tags`, `lead_tags` |
| Agenda | `appointments` |
| Recuperação de lead | `followups` |
| Financeiro | `contracts`, `payments`, `expenses` |
| Feedback de cliente | `feedback_requests` |
| Chat WhatsApp | `chat_integrations`, `chat_conversations`, `chat_messages`, `chat_quick_replies` |
| Observabilidade de integrações | `integration_logs` |

Convenções observadas no código:
- Todas as PKs são `uuid` (`id`), geradas com `gen_random_uuid()` (extensão `pgcrypto`, habilitada explicitamente em `20260622_chat_module.sql`).
- `created_at`/`updated_at` são `timestamptz`.
- Não existe um enum de banco (`create type ... as enum`) confirmado em nenhuma migration versionada; os "enums" abaixo são **tipos TypeScript de união** (`string` literal) definidos em `types.ts`, reforçados por `check` constraints só onde há SQL versionado (tabelas `chat_*`) ou por validação Zod nas rotas.

---

## Tabelas

### `leads`

Lead captado pela IA SDR via WhatsApp (ou cadastro manual/importação). Linha central do CRM — todas as outras tabelas de negócio penduram nela.

| Coluna | Tipo | Nulo | Default | Notas |
|---|---|---|---|---|
| `id` | uuid | não | `gen_random_uuid()` (inferido) | PK |
| `name` | text | sim | — | |
| `phone` | text | sim | — | telefone como recebido/formatado |
| `normalized_phone` | text | **não** | — | só dígitos; chave de deduplicação (ver Uniques) |
| `instagram_user` | text | sim | — | |
| `email` | text | sim | — | |
| `source` | text (`LeadSource`) | sim | — | origem do lead |
| `agencia_nome` | text | sim | — | nome de agência/parceiro, quando aplicável |
| `modelo_nome` | text | sim | — | campo de triagem herdado do domínio original (estúdio de fotografia) |
| `status` | text (`LeadStatus`) | **não** | — | string livre; ver seção "Status do lead" |
| `tipo_ensaio` | text (`TipoEnsaio`) | sim | — | categoria de serviço/atendimento; nome de coluna herdado do domínio original |
| `interesse` | text | sim | — | |
| `valor_estimado` | numeric | sim | — | |
| `is_recorrente` | boolean | sim | — | |
| `historico_compras` | text | sim | — | |
| `imported` | boolean | sim | — | `true` marca lead trazido de importação em massa; `getLeads()` filtra esses fora por padrão |
| `memoria_contexto` | text | sim | — | contexto que a IA SDR mantém sobre a conversa |
| `notes` | text | sim | — | notas internas do operador |
| `last_message_at` | timestamptz | sim | — | |
| `qualificado_at` | timestamptz | sim | — | setado quando `status` vira `qualificado` |
| `agendado_at` | timestamptz | sim | — | setado quando `status` vira `agendado` |
| `compareceu_at` | timestamptz | sim | — | setado quando `status` vira `compareceu` |
| `cliente_at` | timestamptz | sim | — | setado quando `status` vira `cliente` |
| `created_at` | timestamptz | não | `now()` (inferido) | |
| `updated_at` | timestamptz | não | `now()` (inferido) | |

- **PK**: `id`.
- **Unique (inferida)**: `normalized_phone`. Não há migration que crie essa constraint, mas `upsertLeadFromWebhook()` (`src/features/leads/queries/webhook-mutations.ts`) faz `.upsert(..., { onConflict: "normalized_phone" })` — isso só funciona no Postgres se existir constraint/índice único nessa coluna, então ela existe no banco real ainda que não versionada.
- **Referenciada por**: `appointments.lead_id`, `followups.lead_id`, `contracts.lead_id`, `lead_tags.lead_id`, e logicamente por `payments.lead_id` (a coluna existe, mas `types.ts` declara `Relationships: []` para `payments` — sem FK confirmada no tipo).
- **Índices**: não confirmáveis pelo repositório (prováveis em `created_at`, `status`, `normalized_phone` dado o volume de queries ordenadas/filtradas por esses campos, mas não há evidência versionada).

### `appointments`

Agendamento (visita, aula, consulta — o rótulo exato depende do cliente do template) vinculado a um lead.

| Coluna | Tipo | Nulo | Default | Notas |
|---|---|---|---|---|
| `id` | uuid | não | `gen_random_uuid()` (inferido) | PK |
| `lead_id` | uuid | sim | — | FK → `leads.id` |
| `scheduled_at` | timestamptz | **não** | — | |
| `duration_min` | integer | sim | — | |
| `tipo_ensaio` | text | sim | — | replica a categoria do lead no momento do agendamento |
| `status` | text (`AppointmentStatus`) | **não** | — | `agendado \| confirmado \| compareceu \| faltou \| cancelado` |
| `google_event_id` | text | sim | — | placeholder para sync com Google Calendar; **nenhum código no repo lê/escreve essa coluna hoje** além do tipo — integração ainda não implementada |
| `reminder_d3_sent` | boolean | **não** | — | idem: coluna existe, sem lógica de lembrete implementada no código atual |
| `reminder_d0_sent` | boolean | **não** | — | idem |
| `notes` | text | sim | — | |
| `created_at` | timestamptz | não | `now()` (inferido) | |
| `updated_at` | timestamptz | não | `now()` (inferido) | |

- **PK**: `id`. **FK**: `appointments_lead_id_fkey` → `leads.id` (declarada em `types.ts`).
- `POST /api/webhooks/n8n/appointment` e `POST /api/appointments` fazem `insert` simples (não upsert) — reenvio do mesmo webhook do n8n pode criar agendamento duplicado; o schema aceita `idempotency_key` opcional mas **não é usado** na mutação (`upsertAppointmentFromWebhook`, apesar do nome, é um insert puro).
- `POST /api/appointments/[id]/attended` além de marcar `status = "compareceu"`, também atualiza `leads.status` e `leads.compareceu_at` do lead associado — é a única rotina de sincronização bidirecional lead↔agendamento hoje.

### `followups`

Follow-up de recuperação de lead silencioso, disparado pela IA/n8n.

| Coluna | Tipo | Nulo | Default | Notas |
|---|---|---|---|---|
| `id` | uuid | não | `gen_random_uuid()` (inferido) | PK |
| `lead_id` | uuid | sim | — | FK → `leads.id` |
| `scheduled_for` | timestamptz | **não** | — | |
| `status` | text (`FollowupStatus`) | **não** | — | `pendente \| enviado \| cancelado` |
| `message` | text | sim | — | no webhook do n8n, concentra `step`/`reason`/flags `replied`/`recovered` que não têm coluna dedicada (ver nota) |
| `created_at` | timestamptz | não | `now()` (inferido) | |
| `sent_at` | timestamptz | sim | — | |

- **PK**: `id`. **FK**: `followups_lead_id_fkey` → `leads.id`.
- O payload do webhook n8n (`src/features/followups/schemas/webhook.ts`) aceita `step`, `reason`, `replied`, `recovered`, mas a tabela não tem colunas para isso — `createFollowupFromWebhook()` compacta tudo dentro de `message` como texto (`"[step] mensagem (respondeu) (recuperado)"`). Métricas de "recuperação por follow-up" citadas em `PRD.md` hoje dependem de parsear esse texto ou de uma migration futura que adicione colunas dedicadas.
- Não há ação de criar/reagendar/cancelar follow-up pela UI do dashboard — só leitura.

### `integration_logs`

Log de cada chamada de integração (inbound/outbound) para diagnosticar falha de webhook.

| Coluna | Tipo | Nulo | Default | Notas |
|---|---|---|---|---|
| `id` | uuid | não | `gen_random_uuid()` (inferido) | PK |
| `provider` | text | **não** | — | ex.: `"n8n"` |
| `direction` | text (`"inbound" \| "outbound"`) | sim | — | |
| `action` | text | sim | — | ex.: `"lead"`, `"event"`, `"appointment"`, `"followup"` |
| `status` | text (`IntegrationStatus`) | sim | — | `ok \| error` |
| `payload` | jsonb | sim | — | |
| `error` | text | sim | — | |
| `created_at` | timestamptz | não | `now()` (inferido) | |

- **PK**: `id`. Sem FK (log solto, sem vínculo com `leads`).
- Escrito por `recordIntegrationLog()` em toda rota `POST /api/webhooks/n8n/*`, sempre em par (uma tentativa de log de sucesso, um de erro no `catch`).

### `contracts`

Contrato/pacote fechado com um lead que virou cliente.

| Coluna | Tipo | Nulo | Default | Notas |
|---|---|---|---|---|
| `id` | uuid | não | `gen_random_uuid()` (inferido) | PK |
| `lead_id` | uuid | sim | — | FK → `leads.id` |
| `package_name` | text | sim | — | |
| `total_amount` | numeric | **não** | — | |
| `signal_amount` | numeric | **não** | — | valor de sinal/entrada |
| `discount` | numeric | **não** | — | |
| `status` | text (`ContractStatus`) | **não** | — | `aberto \| quitado \| cancelado` |
| `notes` | text | sim | — | |
| `created_at` | timestamptz | não | `now()` (inferido) | |
| `updated_at` | timestamptz | não | `now()` (inferido) | |

- **PK**: `id`. **FK**: `contracts_lead_id_fkey` → `leads.id`.
- `status` é recalculado automaticamente por `recomputeContractStatus()` (`src/features/financeiro/queries/recompute-contract-status.ts`): soma os `payments` com `status = "pago"` do contrato, compara com `total_amount - discount`; se cobrir o valor líquido, marca `quitado`, senão `aberto` — mas nunca mexe em `cancelado` (contrato cancelado fica congelado). Essa é a única regra de negócio automática do módulo Financeiro.

### `payments`

Pagamento (parcela, sinal, avulso) ligado a um contrato e/ou lead.

| Coluna | Tipo | Nulo | Default | Notas |
|---|---|---|---|---|
| `id` | uuid | não | `gen_random_uuid()` (inferido) | PK |
| `lead_id` | uuid | sim | — | sem FK declarada em `types.ts` (`Relationships: []`) apesar do nome sugerir `leads.id` |
| `contract_id` | uuid | sim | — | idem — sem FK declarada em `types.ts`, embora `recomputeContractStatus()` filtre por `contract_id = contracts.id` |
| `amount` | numeric | **não** | — | |
| `method` | text (`PaymentMethod`) | sim | — | `pix \| credito \| debito \| dinheiro \| link \| parcelado` |
| `installments` | integer | **não** | — | |
| `is_signal` | boolean | **não** | — | marca pagamento de sinal/entrada |
| `status` | text (`PaymentStatus`) | **não** | — | `pago \| pendente \| estornado` |
| `due_at` | timestamptz | sim | — | |
| `paid_at` | timestamptz | sim | — | |
| `notes` | text | sim | — | |
| `created_at` | timestamptz | não | `now()` (inferido) | |

- **PK**: `id`. **FK**: nenhuma declarada em `types.ts` — atenção, pode ser uma lacuna real no schema (sem integridade referencial) ou apenas ausência no tipo hand-maintained; confirmar via Management API antes de assumir qualquer um dos dois.

### `expenses`

Despesa da operação (fixa ou variável).

| Coluna | Tipo | Nulo | Default | Notas |
|---|---|---|---|---|
| `id` | uuid | não | `gen_random_uuid()` (inferido) | PK |
| `category` | text (`ExpenseCategory`) | **não** | — | lista fechada de 18 categorias + `outro` (ver enum abaixo) |
| `kind` | text (`"fixa" \| "variavel"`) | **não** | — | |
| `description` | text | sim | — | |
| `amount` | numeric | **não** | — | |
| `status` | text (`"pago" \| "pendente"`) | **não** | — | |
| `due_at` | timestamptz | sim | — | |
| `paid_at` | timestamptz | sim | — | |
| `recurring` | boolean | **não** | — | |
| `vendor` | text | sim | — | |
| `notes` | text | sim | — | |
| `created_at` | timestamptz | não | `now()` (inferido) | |

- **PK**: `id`. Sem FK (não se relaciona com lead/contrato).

### `board_columns`

Colunas dinâmicas do funil (kanban). Cada linha é uma etapa configurável pelo operador.

| Coluna | Tipo | Nulo | Default | Notas |
|---|---|---|---|---|
| `id` | uuid | não | `gen_random_uuid()` (inferido) | PK |
| `key` | text | **não** | — | slug estável referenciado por `leads.status` (ver "Status do lead") |
| `label` | text | **não** | — | rótulo exibido na UI |
| `color` | text | **não** | — | nome de cor do design system (`ColorName`) |
| `position` | integer | **não** | — | ordem de exibição no kanban |
| `created_at` | timestamptz | não | `now()` (inferido) | |

- **PK**: `id`. **Unique (aplicação, não confirmado no banco)**: `key` — `POST /api/board-columns` gera a `key` a partir de um slug do `label` e verifica em memória se já existe antes de inserir (não depende de constraint de banco para isso).
- Se a tabela estiver vazia/inacessível, `getBoardColumns()` cai em um fallback fixo de 8 etapas em memória (`fallbackBoardColumns`, `src/features/board/queries/get-board-columns.ts`) — **atenção**: esse fallback usa um campo `is_default` que não existe na definição de `BoardColumn` (`Database["public"]["Tables"]["board_columns"]["Row"]` em `types.ts`); é uma inconsistência de tipos a investigar, não necessariamente uma coluna real do banco.

### `tags`

Etiqueta livre aplicável a leads.

| Coluna | Tipo | Nulo | Default | Notas |
|---|---|---|---|---|
| `id` | uuid | não | `gen_random_uuid()` (inferido) | PK |
| `name` | text | **não** | — | único (ver abaixo) |
| `color` | text | **não** | — | |
| `created_at` | timestamptz | não | `now()` (inferido) | |

- **PK**: `id`. **Unique (confirmada por comportamento)**: `name` — `POST /api/tags` trata `error.code === "23505"` (violação de unique constraint do Postgres) como "já existe uma tag com esse nome", confirmando constraint única real no banco.

### `lead_tags`

Tabela de junção N:N entre `leads` e `tags`.

| Coluna | Tipo | Nulo | Default | Notas |
|---|---|---|---|---|
| `lead_id` | uuid | **não** | — | FK → `leads.id` |
| `tag_id` | uuid | **não** | — | FK → `tags.id` |
| `created_at` | timestamptz | **não** (tem default no Insert) | `now()` (inferido) | |

- **PK (inferida)**: composta `(lead_id, tag_id)` — não confirmada por migration, mas é o desenho natural de uma tabela de junção; o tipo `Insert` não exige `created_at`, sugerindo default no banco.
- **FKs**: `lead_tags_lead_id_fkey` → `leads.id`; `lead_tags_tag_id_fkey` → `tags.id`.

### `feedback_requests`

Pedido de feedback/depoimento de cliente (ex.: print de conversa pedindo autorização de uso, avaliação).

| Coluna | Tipo | Nulo | Default | Notas |
|---|---|---|---|---|
| `id` | uuid | não | `gen_random_uuid()` (inferido) | PK |
| `image_url` | text | sim | — | screenshot enviado, armazenado no bucket `feedback-screenshots` do Supabase Storage |
| `caption` | text | sim | — | |
| `author_name` | text | sim | — | |
| `status` | text | **não** | — | valores usados no código: `"open" \| "done"` (ver enum abaixo) |
| `resolved_at` | timestamptz | sim | — | |
| `created_at` | timestamptz | não | `now()` (inferido) | |

- **PK**: `id`. Sem FK (não se relaciona com `leads`).

### `chat_integrations`

Uma linha por conexão de WhatsApp/provedor configurada (ex.: uma instância Evolution, uma conta uazapi, um número Meta Cloud API).

| Coluna | Tipo | Nulo | Default | Notas |
|---|---|---|---|---|
| `id` | uuid | não | `gen_random_uuid()` | PK |
| `name` | text | **não** | — | |
| `provider` | text | **não** | — | `check (provider in ('evolution','uazapi','meta'))` |
| `phone_number` | text | sim | — | |
| `config` | jsonb | **não** | `'{}'` | credenciais/endpoint do provedor (ex.: `apiUrl`, `apiKey`, `instance` para Evolution; `apiUrl`, `token` para uazapi; `phoneNumberId`, `accessToken` para Meta) — **guardado no banco, não em variável de ambiente** |
| `is_active` | boolean | **não** | `true` | |
| `created_at` | timestamptz | **não** | `now()` | |
| `updated_at` | timestamptz | **não** | `now()` | |

- **PK**: `id`. Definida em `20260622_chat_module.sql` (migration real, constraints confirmadas).
- **RLS**: habilitado, política `service_role_all_integrations` só para `service_role` (ver seção RLS abaixo).

### `chat_conversations`

Uma conversa por contato único por integração.

| Coluna | Tipo | Nulo | Default | Notas |
|---|---|---|---|---|
| `id` | uuid | não | `gen_random_uuid()` | PK |
| `integration_id` | uuid | sim | — | FK → `chat_integrations.id` `on delete set null` |
| `external_id` | text | **não** | — | id do contato no provedor (ex.: JID da Evolution) |
| `contact_name` | text | sim | — | |
| `contact_phone` | text | sim | — | |
| `contact_avatar_url` | text | sim | — | |
| `status` | text | **não** | `'bot'` | `check in ('bot','human','resolved')` |
| `unread_count` | integer | **não** | `0` | |
| `last_message_at` | timestamptz | sim | — | |
| `last_message_preview` | text | sim | — | |
| `metadata` | jsonb | **não** | `'{}'` | |
| `created_at` | timestamptz | **não** | `now()` | |
| `updated_at` | timestamptz | **não** | `now()` | |

- **PK**: `id`. **FK**: `integration_id` → `chat_integrations.id`. **Unique**: `(integration_id, external_id)`.
- **Índices**: `idx_chat_conversations_integration(integration_id)`, `idx_chat_conversations_status(status)`, `idx_chat_conversations_last_message_at(last_message_at desc)`.
- Adicionada à publicação `supabase_realtime` (evento `UPDATE` consumido pelo hook `useChatRealtime`).

### `chat_messages`

Mensagem individual (inbound do lead ou outbound do operador/IA).

| Coluna | Tipo | Nulo | Default | Notas |
|---|---|---|---|---|
| `id` | uuid | não | `gen_random_uuid()` | PK |
| `conversation_id` | uuid | **não** | — | FK → `chat_conversations.id` `on delete cascade` |
| `external_id` | text | sim | — | id da mensagem no provedor |
| `direction` | text | **não** | — | `check in ('inbound','outbound')` |
| `type` | text | **não** | `'text'` | `check in ('text','image','audio','video','document','sticker','contact','template','note')` |
| `content` | text | sim | — | |
| `media_url` | text | sim | — | |
| `media_mime_type` | text | sim | — | |
| `quoted_message_id` | uuid | sim | — | FK → `chat_messages.id` `on delete set null` (auto-referência, para reply/citação) |
| `delivery_status` | text | **não** | `'pending'` | `check in ('pending','sent','delivered','read','failed')` |
| `sent_by_user_id` | uuid | sim | — | sem FK para uma tabela de usuários (não existe tabela de usuários no schema — consistente com o débito C2 de auth) |
| `is_deleted` | boolean | **não** | `false` | |
| `metadata` | jsonb | **não** | `'{}'` | |
| `created_at` | timestamptz | **não** | `now()` | |

- **PK**: `id`. **FKs**: `conversation_id` → `chat_conversations.id`; `quoted_message_id` → `chat_messages.id`. **Unique**: `(conversation_id, external_id)` (evita duplicar mensagem reentregue pelo webhook do provedor).
- **Índices**: `idx_chat_messages_conversation_id`, `idx_chat_messages_created_at`.
- Adicionada à publicação `supabase_realtime` (evento `INSERT` consumido pelo hook `useChatRealtime`, filtrado por `conversation_id`).

### `chat_quick_replies`

Respostas rápidas pré-cadastradas para o operador usar no atendimento manual.

| Coluna | Tipo | Nulo | Default | Notas |
|---|---|---|---|---|
| `id` | uuid | não | `gen_random_uuid()` | PK |
| `shortcut` | text | **não** | — | único |
| `content` | text | **não** | — | |
| `created_at` | timestamptz | **não** | `now()` | |

- **PK**: `id`. **Unique**: `shortcut`.
- **Tabela sem UI hoje** — existe no banco e no tipo, mas nenhum componente do Chat lê ou escreve nela.

---

## Enums lógicos (tipos de união em `types.ts`)

Nenhum é um `enum` de banco real (exceto onde há `check constraint` explícita nas tabelas `chat_*`, indicado abaixo). São tipos TypeScript que restringem o valor esperado da coluna `text`.

| Tipo | Valores | Onde é usado | Garantido por `check` no banco? |
|---|---|---|---|
| `LeadStatus` | `string` livre | `leads.status` | Não — referencia `board_columns.key` só por convenção da aplicação, sem FK. `CanonicalLeadStatus` (`novo \| em_atendimento \| qualificado \| agendado \| compareceu \| cliente \| recorrente \| perdido`) é o conjunto padrão usado no seed/fallback do funil, mas como o funil é dinâmico (colunas configuráveis), qualquer `key` de `board_columns` é um `status` válido. |
| `LeadSource` | `agencia \| anuncio \| particular \| indicacao \| whatsapp \| importado \| outro` | `leads.source` | Não confirmado (sem migration); reforçado só por Zod nas rotas de escrita. |
| `TipoEnsaio` | `crianca \| gestante \| casal \| quinze_anos \| senhora \| book_agencia \| sensual \| profissional \| outro` | `leads.tipo_ensaio` | Não confirmado. Nome e valores herdados do domínio original (estúdio de fotografia); a camada de exibição (`src/features/leads/schemas/status.ts`) já usa rótulos genéricos (`Reunião`, `Consulta`, `Demonstração`...) para o template, mas os valores de banco/enum ainda são os de fotografia — reconciliar é trabalho de dado, não só de código. |
| `AppointmentStatus` | `agendado \| confirmado \| compareceu \| faltou \| cancelado` | `appointments.status` | Não confirmado. |
| `FollowupStatus` | `pendente \| enviado \| cancelado` | `followups.status` | Não confirmado. |
| `ContractStatus` | `aberto \| quitado \| cancelado` | `contracts.status` | Não confirmado. Recalculado por `recomputeContractStatus()`. |
| `PaymentMethod` | `pix \| credito \| debito \| dinheiro \| link \| parcelado` | `payments.method` | Não confirmado. |
| `PaymentStatus` | `pago \| pendente \| estornado` | `payments.status` | Não confirmado. |
| `ExpenseCategory` | `luz \| agua \| aluguel \| internet \| limpeza \| equipamento \| manutencao \| fornecedor \| operacional \| cartao_credito \| cartao_debito \| marketing \| software \| alimentacao \| combustivel \| seguro \| imposto \| salario \| outro` (+ `string` aberto via `(string & {})`) | `expenses.category` | Não confirmado. O tipo é deliberadamente "aberto" (`string & {}`) para aceitar categorias novas sem quebrar o TS. |
| `IntegrationStatus` | `ok \| error` | `integration_logs.status` | Não confirmado. |
| `ConversationStatus` (chat) | `bot \| human \| resolved` | `chat_conversations.status` | **Sim** — `check` em `20260622_chat_module.sql`. |
| `MessageDirection` (chat) | `inbound \| outbound` | `chat_messages.direction` | **Sim**. |
| `MessageType` (chat) | `text \| image \| audio \| video \| document \| sticker \| contact \| template \| note` | `chat_messages.type` | **Sim**. |
| `MessageDeliveryStatus` (chat) | `pending \| sent \| delivered \| read \| failed` | `chat_messages.delivery_status` | **Sim**. |
| provider (chat) | `evolution \| uazapi \| meta` | `chat_integrations.provider` | **Sim**. |
| `feedback_requests.status` | `open \| done` (uso observado no código; não há union type dedicado em `types.ts`, coluna é `string` solto) | `feedback_requests.status` | Não confirmado. |

---

## Relacionamentos

```
leads (1) ──< appointments        (appointments.lead_id → leads.id)
leads (1) ──< followups           (followups.lead_id → leads.id)
leads (1) ──< contracts           (contracts.lead_id → leads.id)
leads (1) ──< lead_tags >── (1) tags     (N:N via lead_tags)
leads (1) ··< payments            (payments.lead_id — sem FK declarada em types.ts)
contracts (1) ··< payments        (payments.contract_id — sem FK declarada em types.ts)
board_columns.key ~~ leads.status (convenção lógica, não FK)

chat_integrations (1) ──< chat_conversations   (chat_conversations.integration_id → chat_integrations.id, ON DELETE SET NULL)
chat_conversations (1) ──< chat_messages       (chat_messages.conversation_id → chat_conversations.id, ON DELETE CASCADE)
chat_messages (1) ──< chat_messages            (chat_messages.quoted_message_id → chat_messages.id, auto-referência, ON DELETE SET NULL)

expenses, integration_logs, feedback_requests, chat_quick_replies: tabelas isoladas, sem FK de saída.
```

Legenda: `──<` = FK confirmada (declarada em `types.ts` ou em migration SQL); `··<` = relação lógica sugerida pelo nome da coluna e pelo uso no código, sem FK declarada; `~~` = referência de valor, não de chave estrangeira.

---

## RLS e grants

**Estado atual (confirmado por migration):**

1. `20260612180000_disable_rls_enable_realtime.sql` percorre **todas** as tabelas do schema `public` existentes na época e, para cada uma, executa `alter table ... disable row level security` e tenta adicioná-la à publicação `supabase_realtime`. Isso cobre as 11 tabelas do schema base: `leads`, `appointments`, `followups`, `integration_logs`, `contracts`, `payments`, `expenses`, `board_columns`, `tags`, `lead_tags`, `feedback_requests`.
   - **Efeito**: com RLS desligado, qualquer requisição autenticada com a `anon key` (que é pública por natureza — vai para o bundle do browser) tem acesso de leitura/escrita irrestrito a essas tabelas via API REST do Supabase (`PostgREST`), **sem passar pelo Next.js**. Isso é o débito **A4**.
2. `20260622_chat_module.sql` (posterior) cria as 4 tabelas `chat_*` já com `enable row level security` e, para cada uma, uma única policy: `for all to service_role using (true) with check (true)`.
   - **Efeito colateral não resolvido**: como só existe policy para `service_role`, a role `anon`/`authenticated` (usada pelo client do browser, `createSupabaseBrowserClient()`, que só tem a `anon key`) **não tem nenhuma policy que libere acesso** às tabelas `chat_*`. Isso é relevante porque `useChatRealtime()` (`src/features/chat/hooks/use-chat-realtime.ts`) assina mudanças em `chat_messages`/`chat_conversations` diretamente do browser com esse client. Ou o Realtime do Supabase está configurado para não aplicar RLS nesse projeto, ou o recurso pode estar silenciosamente não entregando eventos ao browser — **precisa ser validado no projeto real** (Management API / Studio), não é algo que dá para confirmar só lendo o código.

**Grants**: não há arquivo de grants explícito no repo; o acesso hoje é inteiramente definido por qual client é usado em cada camada:

| Client | Arquivo | Key | Uso |
|---|---|---|---|
| Browser | `src/lib/supabase/client.ts` | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Só usado hoje para Realtime no Chat (`useChatRealtime`) |
| Server (anon) | `src/lib/supabase/server.ts` | `SUPABASE_ANON_KEY` | Queries de leitura em Server Components (`getLeads`, `getBoardColumns`, `getFinanceOverview` etc.) |
| Admin | `src/lib/supabase/admin.ts` | `SUPABASE_SERVICE_ROLE_KEY` | Todas as rotas `/api` que escrevem, e os webhooks — **service_role ignora RLS por definição**, então mesmo reativar RLS não protege essas rotas: a proteção dessas rotas depende de autenticação de sessão (débito C1) ou de segredo de webhook, não de RLS |

**Recomendação para produção**:
1. Reativar RLS nas 11 tabelas do schema base.
2. Política padrão: negar tudo para `anon`/`authenticated`; liberar `service_role` (mantém as rotas internas/admin funcionando sem mudança).
3. Se alguma tela realmente precisar de client-side direto ao Supabase (hoje só o Chat, para Realtime), criar policy explícita e mínima para `authenticated` **depois** que existir autenticação real por usuário (débito C2) — do contrário a policy não tem como diferenciar "quem" está pedindo.
4. Resolver a lacuna das tabelas `chat_*`: decidir entre (a) mover o Realtime do browser para um client autenticado real, ou (b) expor Realtime via um canal proxied pelo servidor (ex.: Server-Sent Events a partir de uma rota Next.js que usa o client admin).

---

## Fluxo de migrations

Duas convenções coexistem no projeto (nenhuma delas totalmente seguida até aqui):

1. **Supabase CLI local**: `supabase/.branches/` e `supabase/.temp/` (presentes no repo) indicam que `supabase start`/`supabase db` já foram usados localmente neste projeto. Não há, porém, `supabase/config.toml` versionado — então os parâmetros de porta/serviço do ambiente local (API, Studio, DB) não estão fixados no repositório; confirme com `supabase status` depois de `supabase start` no seu ambiente.
2. **Supabase Management API**: fluxo indicado para produção — aplicar migration via API (`Apply a migration`), validar schema (`Get database metadata` / `List migration history`), e regenerar `src/lib/supabase/types.ts` manualmente depois de qualquer mudança estrutural (não há script de geração automática no `package.json`).

Prática recomendada daqui para frente: toda alteração de schema deveria virar um arquivo novo em `supabase/migrations/` (nome `YYYYMMDDHHmmss_descricao.sql`), aplicado via Management API ou `supabase db push`, e o `types.ts` atualizado na mesma PR — hoje isso não é garantido (o schema base é a prova disso).

---

Ver também: `PRD.md` (o que cada módulo faz com esses dados).
