# Referência de API — CRM Suporte

> ⚠️ **Desatualizado desde 2026-09-25 (Fase 1).** A API de integração (`/api/integracao/*`), os webhooks do n8n e as rotas internas de leads, funil, agenda, follow-ups, financeiro, métricas, pacientes e rastreamento descritos aqui foram **removidos**. A API para a IA e para outros sistemas volta como `/api/v1/*`, com token com escopo, na Fase 5 de [`docs/PLANO-IMPLANTACAO.md`](PLANO-IMPLANTACAO.md), quando este documento é reescrito. As rotas internas de chat, conexão, equipe e configurações continuam valendo.

Guia completo da API HTTP do CRM, **escrito a partir do código real** (rotas + validações Zod). Serve dois públicos:

- **🤖 Integradores (n8n / automações):** comece pelo **[Guia de integração com o n8n](#-guia-de-integração-com-o-n8n)** — é o que você precisa para enviar leads, agendamentos e follow-ups ao CRM.
- **💻 Desenvolvedores do dashboard:** veja a **[Referência de endpoints](#referência-de-endpoints)** para as rotas internas.

> **Base URL:** a origem do deploy. Em produção, o domínio do cliente (ex.: `https://crm.seudominio.com.br`); em desenvolvimento, `http://localhost:3000`. Nos exemplos abaixo usamos `https://SEU-CRM` como espaço reservado — troque pelo domínio real.

---

## Como a API se organiza

O CRM é alimentado de três formas:

```
   WhatsApp  ⇄  uazapi  ⇄  CRM (chat ao vivo)  ──relay──▶  n8n (+ IA "Valquíria")
                              ⇅                                    │
                           Dashboard  ◀────POST /api/webhooks/n8n/*┘
                           (Supabase)
```

1. **Webhooks (`/api/webhooks/n8n/*`)** — o n8n **empurra** eventos para o CRM (lead novo, agendamento, follow-up). É por aqui que as automações entram. Autenticam por um **segredo compartilhado** (header `x-webhook-secret`).
2. **WhatsApp em tempo real (uazapi)** — o CRM conecta **direto** a uma instância uazapi (tela `/app/conexao`) e traz o chat para o painel. Toda mensagem que **entra** é repassada ao n8n (a IA "Valquíria" responde enquanto a conversa está em `bot`) e vira um **lead**. Ver **[Chat e Conexão](#chat-e-conexão-whatsapp-via-uazapi)**.
3. **API interna (`/api/*`)** — usada pelo **dashboard** (o painel web). Exige uma **sessão** de usuário logado (cookie `crm-suporte-session`). Um integrador normalmente **não** usa essas rotas.

Salvo o export de CSV (que devolve um arquivo), todas as respostas são **JSON**.

---

## 🤖 Guia de integração com o n8n

Esta seção é um passo a passo para conectar suas automações do n8n ao CRM. Nenhum conhecimento prévio da API é necessário.

### 1. O que você vai precisar

| Item | O que é | Onde conseguir |
|---|---|---|
| **URL base do CRM** | O endereço do CRM em produção | Com quem fez o deploy (ex.: `https://crm.seudominio.com.br`) |
| **Credencial de acesso** | Autentica as chamadas. Pode ser o segredo compartilhado (`N8N_WEBHOOK_SECRET`, env) **ou** um **token de API** gerado no painel | Segredo: com quem fez o deploy · Token: **Configurações → Tokens de API** (gera na hora) |

> 🔐 A credencial vai no header `x-webhook-secret` (ou `Authorization: Bearer <credencial>`). Se não bater, o CRM responde `401`.
>
> 💡 Prefira **tokens de API** para dar acesso a terceiros: cada um tem nome, pode ser **revogado** individualmente sem mexer no CRM, e você acompanha o **último uso**. O segredo do ambiente continua válido (retrocompatível).

### 2. Montando a chamada no n8n (nó **HTTP Request**)

Para cada webhook, adicione um nó **HTTP Request** no seu fluxo e configure assim:

| Campo do nó | Valor |
|---|---|
| **Method** | `POST` |
| **URL** | `https://SEU-CRM/api/webhooks/n8n/lead` *(troque `lead` pelo tipo de evento)* |
| **Authentication** | `None` *(a autenticação é feita pelo header, não pelo n8n)* |
| **Send Headers** | ✅ ligado |
| → Header 1 | `Content-Type` = `application/json` |
| → Header 2 | `x-webhook-secret` = *o segredo combinado* |
| **Send Body** | ✅ ligado · **Body Content Type:** `JSON` |
| → Body | o payload do evento (veja cada webhook abaixo) |

> 💡 **Dica:** guarde o segredo como uma **credencial/variável** do n8n (ex.: `{{$env.N8N_WEBHOOK_SECRET}}`), nunca escrito direto no nó. Assim ele não vaza no fluxo exportado.

Em caso de sucesso, o CRM sempre responde **`200`** com `{ "ok": true }`.

### 3. Os quatro webhooks — quando usar cada um

| Webhook | Use quando… | O que o CRM faz |
|---|---|---|
| **`/lead`** | um contato novo aparece ou um lead muda de estágio | **Upsert** do lead pelo telefone (não duplica) |
| **`/appointment`** | um ensaio/reunião é marcado, confirmado ou remarcado | Acha o lead pelo telefone e **cria/atualiza o agendamento** |
| **`/followup`** | a cadência de follow-up dispara uma mensagem | Registra o **follow-up** vinculado ao lead |
| **`/event`** | você só quer **registrar** um evento no histórico | Grava o payload como **log de integração** (aceita qualquer JSON) |

Todos identificam o lead pelo campo **`phone`** — envie o número com DDI e DDD (ex.: `5511987654321`). O CRM normaliza automaticamente (WhatsApp `5511…` e cadastro manual `11…` viram a mesma pessoa).

### 4. 🔁 Idempotência — o passo que evita duplicados

O n8n **reenvia** a chamada automaticamente se o CRM demorar a responder ou retornar um erro temporário (timeout / 5xx). Sem proteção, um reenvio criaria um **agendamento ou follow-up duplicado**.

**Solução:** nos webhooks `/appointment` e `/followup`, envie um campo **`idempotency_key`** com um valor **único por evento** (por exemplo, o ID do nó/execução do n8n, ou uma combinação estável como `agendamento-{{leadId}}-{{data}}`). Se a mesma chave chegar duas vezes, o CRM **atualiza** o registro existente em vez de criar outro.

> ✅ **Recomendação:** sempre inclua `idempotency_key` em `/appointment` e `/followup`. O `/lead` não precisa — ele já deduplica pelo telefone.

### 5. 🧪 Testando rapidamente (curl)

Antes de montar o fluxo, dá para testar um webhook direto do terminal:

```bash
curl -X POST https://SEU-CRM/api/webhooks/n8n/lead \
  -H "Content-Type: application/json" \
  -H "x-webhook-secret: SEU_SEGREDO" \
  -d '{
        "phone": "5511987654321",
        "name": "Maria Silva",
        "source": "anuncio",
        "status": "novo"
      }'

# Resposta esperada:
# {"ok":true}
```

### 6. 🩺 Solução de problemas

| Resposta do CRM | O que significa | Como resolver |
|---|---|---|
| `401 unauthorized` | O header `x-webhook-secret` está ausente ou diferente do esperado | Confira se o segredo no n8n é **idêntico** ao `N8N_WEBHOOK_SECRET` do CRM |
| `500 webhook_secret_missing` | O CRM não tem a env `N8N_WEBHOOK_SECRET` configurada | Peça para configurar a variável no deploy |
| `400 invalid_payload` | Um campo obrigatório faltou ou está no formato errado (ex.: `scheduled_at` não é uma data ISO) | Compare o body enviado com o schema do webhook abaixo |
| `400` (JSON inválido) | O corpo não é um JSON válido | Verifique se o **Body Content Type** é `JSON` e o conteúdo está bem-formado |
| `500 webhook_failed` | Erro ao gravar no banco | Veja os logs; pode reenviar com segurança se usar `idempotency_key` |
| `500 supabase_env_missing` | O CRM está sem as variáveis do Supabase | Peça para configurar no deploy |

---

## Detalhe dos webhooks do n8n

Todas as rotas `/api/webhooks/n8n/*` exigem `Content-Type: application/json` e o header `x-webhook-secret`, e passam pela mesma sequência de validação: **segredo → env → JSON → schema → grava + registra log**. Sucesso = `200 { "ok": true }`.

### `POST /api/webhooks/n8n/lead`
Cria ou atualiza um lead (**upsert pelo telefone** — nunca duplica).

| Campo | Tipo | Obrigatório | Observação |
|---|---|:---:|---|
| `phone` | string | ✅ | número com DDI/DDD (mín. 8 dígitos) |
| `name` | string | | nome do lead |
| `instagram_user` | string | | @ do Instagram |
| `email` | string | | |
| `source` | enum | | `agencia`, `anuncio`, `particular`, `indicacao`, `whatsapp`, `importado`, `outro` |
| `status` | enum | | etapa do funil: `novo`, `em_atendimento`, `qualificado`, `agendado`, `compareceu`, `cliente`, `recorrente`, `perdido` |
| `tipo_ensaio` | string | | tipo de serviço/ensaio |
| `agencia_nome` | string | | |
| `modelo_nome` | string | | |
| `interesse` | string | | |
| `valor_estimado` | número | | ≥ 0 |
| `is_recorrente` | boolean | | |
| `memoria_contexto` | string | | contexto da conversa (para a IA) |
| `notes` | string | | anotações |

```json
{
  "phone": "5511987654321",
  "name": "Maria Silva",
  "instagram_user": "mariasilva",
  "source": "anuncio",
  "status": "novo",
  "tipo_ensaio": "gestante",
  "valor_estimado": 1200,
  "notes": "Veio pelo anúncio do Instagram"
}
```

### `POST /api/webhooks/n8n/appointment`
Cria um agendamento e vincula ao lead (encontrado pelo `phone`).

| Campo | Tipo | Obrigatório | Observação |
|---|---|:---:|---|
| `phone` | string | ✅ | usado para achar o lead |
| `scheduled_at` | string (ISO 8601) | ✅ | ex.: `2026-07-20T13:00:00.000Z` |
| `status` | enum | | `agendado` (padrão), `confirmado`, `compareceu`, `faltou`, `cancelado` |
| `tipo_ensaio` | string | | |
| `duration_min` | número | | duração em minutos |
| `notes` | string | | |
| `idempotency_key` | string | | ⭐ **use** para evitar duplicar em retry |

```json
{
  "phone": "5511987654321",
  "scheduled_at": "2026-07-20T13:00:00.000Z",
  "tipo_ensaio": "gestante",
  "duration_min": 60,
  "status": "agendado",
  "idempotency_key": "appt-5511987654321-2026-07-20"
}
```

### `POST /api/webhooks/n8n/followup`
Registra um follow-up (mensagem da cadência) vinculado ao lead.

| Campo | Tipo | Obrigatório | Observação |
|---|---|:---:|---|
| `phone` | string | ✅ | |
| `step` | string | ✅ | etapa da cadência (ex.: `lembrete_24h`) |
| `reason` | string | | motivo (ex.: `sem_resposta`) |
| `message` | string | | texto enviado |
| `sent_at` | string (ISO) | | quando foi enviado |
| `replied` / `recovered` | boolean | | default `false` |
| `payload` | JSON | | dados extras (default `{}`) |
| `idempotency_key` | string | | ⭐ **use** para evitar duplicar em retry |

```json
{
  "phone": "5511987654321",
  "step": "lembrete_24h",
  "reason": "sem_resposta",
  "message": "Oi Maria! Confirmando seu ensaio de amanhã 😊",
  "replied": false,
  "idempotency_key": "fup-5511987654321-lembrete_24h"
}
```

### `POST /api/webhooks/n8n/event`
Registra um evento genérico no log de integração. **Não tem schema** — aceita qualquer JSON. Útil para auditar mensagens recebidas, mudanças de status na IA, etc.

```json
{
  "type": "mensagem_recebida",
  "phone": "5511987654321",
  "channel": "whatsapp",
  "text": "Olá, gostaria de agendar um ensaio"
}
```

---

## Modelo de autenticação

Três formas de acesso:

1. **Sessão (dashboard)** — cookie `crm-suporte-session`, um **JWT** emitido no login e verificado pelo middleware. **Toda rota `/api/*` interna exige esse cookie**; sem ele → `401`. O login é limitado a **10 tentativas/min por IP** (proteção contra força bruta → `429`).
2. **Token de API (webhooks + integração)** — para `/api/webhooks/n8n/*` **e** para a **API de Integração** `/api/integracao/*` (agentes de IA), aceita **duas** credenciais: o segredo do ambiente `N8N_WEBHOOK_SECRET` **ou** qualquer **token de API** ativo (gerado em Configurações → Tokens de API, guardado como hash sha256). Envie no header `x-webhook-secret: <credencial>` **ou** `Authorization: Bearer <credencial>`. Os webhooks de chat (`/api/chat/webhook/*`) usam a verificação própria de cada provedor (`?s=` na URL).
3. **Pública** — apenas `/api/auth/login` e `/api/auth/logout`.

**Padrão de resposta:** `{ ok: boolean, message?: string, errors?: Record<string, string[]> }`.
**Códigos comuns:** `200` sucesso · `400` validação/JSON · `401` sem sessão/segredo · `404` não encontrado · `409` conflito · `422` entrada inválida · `429` excesso de tentativas · `500` erro/serviço não configurado.

---

# Referência de endpoints

Rotas internas do dashboard. Todas exigem **sessão** (cookie `crm-suporte-session`), salvo indicação.

## Autenticação

### `POST /api/auth/login`
- **Auth:** pública (limitada a 10 tentativas/min por IP)
- **Body:** `email` (string, obrigatório) · `password` (string, obrigatório)
- **Sucesso:** `200 { ok: true, message: "Sessão iniciada." }` — define o cookie `crm-suporte-session` (JWT `httpOnly`, `secure` em produção). A senha é verificada no banco via bcrypt.
- **Erros:** `400` (JSON/validação) · `401` (credenciais incorretas) · `429` (muitas tentativas) · `500`

### `POST /api/auth/logout`
- **Auth:** pública · **Body:** — · **Sucesso:** `200 { ok: true, message: "Sessão encerrada." }` (limpa o cookie)

## Leads

### `POST /api/leads/manual`
- **Body:** `phone` (obrigatório, mín. 10 dígitos com DDD) · `name`, `instagram_user`, `email`, `tipo_ensaio`, `agencia_nome`, `modelo_nome`, `notes` (opcionais) · `source` (enum, default `whatsapp`) · `status` (enum, default `novo`). Faz upsert por `normalized_phone`.
- **Sucesso:** `200 { ok: true, message: "Lead salvo." }` · **Erros:** `400` · `500`

### `PATCH` / `DELETE /api/leads/[id]`
- **PATCH body:** todos opcionais (string vazia → `null`; enums vazios = "não alterar"): `name`, `phone`, `instagram_user`, `email`, `source`, `status`, `tipo_ensaio`, `agencia_nome`, `modelo_nome`, `interesse`, `valor_estimado`, `is_recorrente`, `memoria_contexto`, `notes`. → `200 { ok: true, message: "Lead atualizado." }`.
- **DELETE:** exclui o lead. O banco cuida dos vínculos: `lead_tags` e `followups` saem em **cascata**; `appointments`, `contracts` e `payments` são **desvinculados** (`lead_id` → `NULL`, preservando agenda/financeiro). → `200 { ok: true, message: "Lead excluído." }`.
- **Erros:** `400` (id não-UUID/validação) · `404` · `500`

### `PATCH /api/leads/[id]/status`
- **Body:** `status` (string, obrigatório — validado contra as colunas do funil existentes)
- **Sucesso:** `200 { ok: true, message: "Status atualizado." }` · **Erros:** `400` · `404` · `500`

### `POST` / `DELETE /api/leads/[id]/tags`
- **Body:** `tag_id` (UUID, obrigatório). POST vincula, DELETE remove.
- **Sucesso:** `200 { ok: true }` · **Erros:** `400` · `500`

### `GET /api/leads/search`
- **Query:** `q` (opcional; busca em nome/telefone, máx. 20 resultados)
- **Sucesso:** `200 { ok: true, items: [{ id, name, phone }] }` · **Erros:** `401`

### `GET /api/leads/export`
- **Sucesso:** `200` — **arquivo `text/csv`** para download (todos os leads; BOM UTF-8 para Excel). · **Erros:** `401`

## Agenda, Follow-ups e Funil

### `POST /api/appointments`
- **Body:** `client_mode` (`existing`|`new`, default `existing`) · `lead_id` (UUID, obrigatório se `existing`) · para `new`: `new_client_name` + `new_client_phone` (obrigatórios), `new_client_email`, `new_client_instagram_user`, `new_client_source` · `scheduled_at` (obrigatório) · `tipo_ensaio`, `duration_min` (default 60), `notes` · `status` (enum, default `agendado`).
- **Sucesso:** `200 { ok: true, message: "Agendamento criado." }` · **Erros:** `400` · `500`

### `POST /api/appointments/[id]/attended` · `DELETE /api/appointments/[id]`
- **attended:** marca comparecimento (lead → `compareceu`). `200` · `404` · `409` (status `cancelado`/`faltou`) · `500`
- **DELETE:** exclui o agendamento (reverte o lead se necessário). `200` · `404` · `500`

### `POST /api/followups` · `PATCH /api/followups/[id]`
- **POST body:** `lead_id` (UUID, obrigatório) · `scheduled_for` (obrigatório) · `message` (opcional). Status inicial `pendente`.
- **PATCH body:** `scheduled_for`, `message`, `status` (`pendente`|`enviado`|`cancelado`) — ao menos um.
- **Sucesso:** `200 { ok: true, message }` · **Erros:** `400` · `404` (PATCH) · `500`

### `GET` / `POST /api/board-columns` · `PATCH` / `DELETE /api/board-columns/[id]`
- **GET:** `200 { ok: true, columns: [...] }`
- **POST body:** `label` (obrigatório, 1–40) · `color` (default `slate`). A `key` é gerada por `slugify(label)`.
- **PATCH body:** `label`, `color`, `position` (ao menos um).
- **DELETE:** move os leads da coluna para `novo`; não exclui a coluna `novo` (→ `409`).

## Financeiro

### `POST /api/financeiro/contracts` · `PATCH` / `DELETE /api/financeiro/contracts/[id]`
- **POST body:** `package_name` + `total_amount` (obrigatórios) · `lead_id` **ou** `new_client_name` · `signal_amount`, `discount` (default 0) · `sinal_valor` + `sinal_method` (gera pagamento de sinal) · `installments` (1–24) + `installment_method` + `first_due_at` (gera parcelas) · `notes`.
- **PATCH:** idem + `status` (`aberto`|`quitado`|`cancelado`); recalcula o status.
- **DELETE:** remove o contrato e seus pagamentos.
- **Sucesso:** `200 { ok: true[, id] }` · **Erros:** `400` · `401` · `404` · `500`

### `POST /api/financeiro/payments` · `PATCH` / `DELETE /api/financeiro/payments/[id]`
- **POST body:** `contract_id` (UUID, **obrigatório**) · `amount` + `method` (obrigatórios) · `installments` (1–6) · `is_signal` · `status` (`pago`|`pendente`, default `pago`) · `due_at`, `paid_at`, `notes`.
- **PATCH:** `amount` + `status` (`pago`|`pendente`|`estornado`) obrigatórios; recalcula o contrato.
- **Sucesso:** `200 { ok: true }` · **Erros:** `400` · `401` · `404` · `500`

### `POST /api/financeiro/expenses` · `PATCH` / `DELETE /api/financeiro/expenses/[id]`
- **POST body:** `category` + `description` + `amount` (obrigatórios) · `kind` (`fixa`|`variavel`) · `status` (`pago`|`pendente`, default `pendente`) · `recurring` + `recurring_count` (cria N registros) · `vendor`, `notes`, `due_at`, `paid_at`.
- **PATCH:** update completo **ou** ação rápida `{ "action": "mark_paid" }`.
- **Sucesso:** `200 { ok: true[, count] }` · **Erros:** `400` · `401` · `404` · `500`

## Usuários, Tags e Feedbacks

### `POST /api/users` · `PATCH /api/users/[id]` · `POST /api/users/[id]/reset-password`
- **POST body:** `name` · `email` · `password` (mín. 8). → cria usuário do painel.
- **PATCH body:** `name` · `email` · `is_active` (boolean). → edita/ativa/desativa (com travas: não se auto-desativar, não desativar o último ativo).
- **reset-password body:** `password` (mín. 8).
- **Sucesso:** `200 { ok: true, message }` · **Erros:** `400` · `401` · `404` · `409` (email em uso / último ativo) · `422` (senha fraca) · `500`

### `GET` / `POST /api/tags` · `PATCH` / `DELETE /api/tags/[id]`
- **POST/PATCH body:** `name` (1–30) · `color`. → CRUD de tags.
- **Sucesso:** `200 { ok: true[, tag] }` · **Erros:** `400` · `401` · `409` (nome duplicado) · `500`

### `POST /api/feedbacks` · `POST /api/feedbacks/[id]/complete` · `DELETE /api/feedbacks/[id]`
- **POST:** **`multipart/form-data`** — `caption` (texto) + `image` (arquivo: PNG/JPEG/WebP, máx. 10 MB).
- **complete:** marca como concluído (idempotente). **DELETE:** remove imagem + registro.
- **Sucesso:** `200 { ok: true, message[, id] }` · **Erros:** `400` · `401` · `404` · `500`

## Tokens de API

### `GET` / `POST /api/api-tokens` · `DELETE /api/api-tokens/[id]`
- Gerencia os **tokens de API** que autenticam chamadas externas aos webhooks do n8n (UI em **Configurações → Tokens de API**).
- **GET:** lista os tokens (`name`, `token_prefix`, `created_at`, `last_used_at`, `revoked_at`). **Nunca** devolve o token em texto puro nem o hash.
- **POST body:** `name` (1–60). → gera um token novo (`crmsuporte_…`) e o devolve **uma única vez** no campo `token` (só o hash sha256 fica no banco). Copie na hora — não há como recuperá-lo depois.
- **DELETE:** revoga o token (soft-delete via `revoked_at`) — ele para de autenticar imediatamente; o histórico é preservado.
- **Sucesso:** `200 { ok: true[, token, item] }` · **Erros:** `400` (nome inválido) · `401` · `500`

## API de Integração — agentes de IA (`/api/integracao/*`)

Superfície **autenticada por token de API** (header `Authorization: Bearer <token>` ou `x-webhook-secret: <token>`) para um agente de IA operar o CRM por completo. Guia com exemplos (n8n/Python/LangChain/Agno) em [`GUIA-AGENTE-IA.md`](GUIA-AGENTE-IA.md).

| Método · Rota | O que faz |
|---|---|
| `GET /api/integracao/leads` | lista/busca (`?q=&status=&source=&limit=&page=`) |
| `POST /api/integracao/leads` | cria/atualiza (upsert pelo telefone) → `{ lead }` |
| `GET /api/integracao/leads/[phone]` | detalhe do lead + tags + agendamentos + follow-ups |
| `PATCH /api/integracao/leads/[phone]` | edita campos / muda a **etapa geral do contato** (`status`) |
| `DELETE /api/integracao/leads/[phone]` | exclui o lead |
| `GET /api/integracao/board` | etapas do funil + nº de **cards (deals)** em cada → `{ stages, totalDeals }` |
| `GET` / `POST /api/integracao/deals` | lista / **cria card do funil** (deal) para um lead → `{ deal }` |
| `PATCH` / `DELETE /api/integracao/deals/[id]` | **move de etapa** (`stage`) / edita / remove um card |
| `GET /api/integracao/metrics` | métricas do dashboard em JSON (`?period=7d\|30d\|90d\|all`) |
| `GET` / `POST /api/integracao/appointments` | lista / cria-atualiza agendamentos (**o POST também cria um card**) |
| `PATCH` / `DELETE /api/integracao/appointments/[id]` | reagenda-edita / cancela |
| `GET` / `POST /api/integracao/followups` | lista / cria follow-ups |
| `PATCH` / `DELETE /api/integracao/followups/[id]` | conclui-cancela-reagenda / remove |
| `GET /api/integracao/tags` | lista as tags |

- **Card do funil = `deal`, não lead.** O lead é o contato único (upsert pelo telefone); cada agendamento é um **deal** = um card, e há **N deals por lead** (cliente recorrente = vários cards, sem duplicar o contato). Todo lead novo já nasce com 1 deal. Para o funil visual use `/deals` (o `PATCH /leads` só muda a etapa "geral" do contato, para filtros/métricas).
- `POST /deals` — body: `phone`* (resolve o lead; `404 lead_not_found`) · `stage` (default `novo`, precisa existir em board_columns) · `tipo_ensaio`, `valor`, `scheduled_at` (ISO), `title`, `notes` · `idempotency_key` (⭐ evita duplicar em retry). `PATCH /deals/[id]` — `stage` (move; carimba `won_at`/`lost_at` pela situação da coluna), `tipo_ensaio`, `valor`, `scheduled_at`, `notes`.
- **Resposta:** `{ ok: true, ... }` · **Erros:** `401` (sem token) · `404` · `422` (payload) · `500`.
- O **atendimento (bot WhatsApp)** usa o relay de entrada configurável (Configurações → Automação) + envio pela uazapi (ver seção abaixo), não a API de Integração.

## Chat e Conexão (WhatsApp via uazapi)

O CRM conecta a uma instância **uazapi** e traz o chat de WhatsApp para dentro do painel, em tempo real (Supabase Realtime).

### 🔁 Integração com o n8n (a IA "Valquíria")

Toda mensagem que **ENTRA** é repassada (fire-and-forget) para `N8N_WEBHOOK_URL` **enquanto a conversa está em `status='bot'`**. O corpo é o **envelope cru da uazapi**:

```json
{
  "EventType": "messages",
  "message": { "messageid": "...", "chatid": "5511...@s.whatsapp.net",
               "sender_pn": "5511...", "senderName": "Maria", "fromMe": false,
               "messageType": "conversation", "text": "quero agendar" },
  "chat": { "imagePreview": "https://..." },
  "owner": "5511...", "instanceName": "..."
}
```

A IA no n8n gera a resposta e **envia direto pela uazapi** (`POST {apiUrl}/send/text`, header `token`) — a resposta volta como `fromMe` e aparece no chat. Ao **Assumir** o atendimento (status → `human`), o repasse **para** (a IA silencia); ao **Devolver à IA**, volta a `bot`.

> **🧲 Lead automático:** toda mensagem inbound também **cria/atualiza um lead** (nome limpo de emojis, dedup por telefone; **não** sobrescreve o funil de um lead existente).

### Webhook de entrada (uazapi → CRM)

- `POST /api/chat/webhook/uazapi?s=<UAZAPI_WEBHOOK_SECRET>` — recebe `messages` (mensagem nova) e `messages_update` (ticks de entrega + mídia baixada). Autentica pelo `?s=` na URL (a uazapi não envia headers custom). Registrado automaticamente ao conectar.

### Conexão (sessão)

- `POST /api/connection/persist` (`{ apiUrl, token }`) — salva as credenciais da instância e registra o webhook.
- `GET /api/connection/qr` — QR / código de pareamento. · `GET /api/connection/state` — estado da conexão.
- `POST /api/connection/disconnect` (`{ wipe?: boolean, deleteIntegration?: boolean }`) — logout da instância. Com `wipe: true`, **apaga todo o chat** (conversas + mensagens), mantendo a instância. Com `deleteIntegration: true`, **exclui a instância do CRM** (apaga o chat **e** remove as credenciais) para conectar outra. Após desconectar, a tela oferece **reconectar** (mesma instância, conversas preservadas) ou **excluir**. Leads sempre intactos.

### Chat (sessão)

- `GET /api/chat/conversations` · `GET|PATCH /api/chat/conversations/[id]` (ver / mudar status `bot|human|resolved`).
- `POST .../send` (`{ content, kind?: "note"|"text" }`) — texto ou nota interna.
- `POST .../send-audio` (`{ audioBase64, mimeType?, seconds? }`) — mensagem de voz (ptt).
- `POST .../send-file` — **`multipart/form-data`** com o campo `file` (imagem / vídeo / documento; vídeo é **comprimido** com ffmpeg antes de enviar).
- `POST /api/chat/transcribe` (`{ messageId }` → transcrição do áudio via OpenAI) · `GET /api/chat/status/[phone]`.

> As rotas de chat usam `{ conversations | conversation | messages | message | error }` (fora do padrão `{ ok, message }`).

**Provedores legados** (foco atual = uazapi): `POST /api/chat/webhook/evolution` · `GET|POST /api/chat/webhook/meta` (GET = verificação do token da Meta).

---

*Documento gerado a partir das rotas e schemas reais do CRM. Em caso de divergência, o código é a fonte de verdade.*
