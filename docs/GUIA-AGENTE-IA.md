# Guia de Integração para Agentes de IA

> ⚠️ **Desatualizado desde 2026-09-25 (Fase 1).** As rotas de leads, funil, agenda, follow-ups e métricas usadas nos exemplos foram **removidas**. O guia é reescrito sobre a API v1 (`/api/v1/*`) na Fase 5 de [`docs/PLANO-IMPLANTACAO.md`](PLANO-IMPLANTACAO.md).

Como um **agente de IA** (n8n, Python, LangChain, Agno, Claude, etc.) opera o CRM
de ponta a ponta: **atender pelo WhatsApp, salvar/editar leads, mover no funil,
agendar, dar follow-up, ler métricas e monitorar** — tudo por HTTP, autenticado
por um **token de API**.

> **Base URL — configure por instância, nunca no código.** Neste guia usamos o
> placeholder `https://SEU-CRM`. Cada cópia deste CRM roda num domínio próprio,
> então a URL e o token do CRM devem ser **passados na configuração do agente**
> (variável de ambiente / painel do agente — ex.: `CRM_BASE_URL`, `CRM_TOKEN`),
> **sem nenhum valor embutido ou de fallback**. O mesmo agente-template atende
> várias cópias do CRM em domínios diferentes; amarrar uma URL fixa quebraria as
> outras. Use sempre **HTTPS**.

---

## 1. Autenticação (obrigatório)

Toda chamada de integração usa um **token de API**, gerado no painel do CRM em
**Configurações → Tokens de API** por um usuário **administrador** (aparece
**uma única vez** — copie e guarde). Esse token é uma das credenciais que você
passa na configuração do agente (junto com a base URL); nunca embuta no código.

Envie o token em **um** destes headers:

```
Authorization: Bearer SEU_TOKEN
```
ou
```
x-webhook-secret: SEU_TOKEN
```

- Sem token válido → **`401`**.
- O mesmo token vale para os **webhooks do n8n** (`/api/webhooks/n8n/*`) e para a
  **API de Integração** (`/api/integracao/*`).
- Revogue um token a qualquer momento no painel (para de funcionar na hora).

**Resposta padrão:** `{ "ok": true, ... }` em sucesso; `{ "ok": false, "error": "..." }` em erro.
**Códigos:** `200` ok · `400` JSON inválido · `401` sem token · `404` não achado · `422` payload inválido · `500` erro.

---

## 2. Bot de atendimento (WhatsApp)

O WhatsApp é conectado ao CRM via **uazapi** (tela **Conexão**). O fluxo do bot:

```
Cliente no WhatsApp
      │  (mensagem)
      ▼
uazapi ──► CRM (webhook) ──► repassa o payload cru para o WEBHOOK DO AGENTE
                                     │   enquanto a conversa está em status "bot"
                                     ▼
                          SEU AGENTE decide a resposta
                                     │
                                     ▼
                          responde enviando pela uazapi  (POST {uazapi}/send/text, header token)
                                     │
                                     ▼
      a resposta volta como "fromMe" e o CRM registra sozinho na conversa
```

> **Onde configurar o webhook do agente:** no painel, em **Configurações →
> Automação/Integração** ("Webhook do agente de IA"). Aponte para o endpoint do
> seu agente/n8n/make e salve. **Enquanto esse campo estiver vazio, o CRM não
> repassa as mensagens do bot** (o indicador na própria tela avisa). Sem editar
> `.env` nem redeploy.

Pontos-chave:
- **Receber:** o CRM já repassa cada mensagem que entra para o **webhook do agente**
  configurado na UI (enquanto a conversa está em modo **bot**). Sem polling.
- **Responder:** o agente envia pela **uazapi** (`POST {apiUrl}/send/text`, header `token`);
  a resposta aparece no chat e é gravada automaticamente.
- **Humano assume:** quando um atendente clica em **Assumir** no painel, a conversa
  vira **human** e o CRM **para** de repassar (o bot silencia). Ao **Devolver à IA**,
  volta a repassar.
- **Lead automático:** toda mensagem que entra já **cria/atualiza um lead** (nome + telefone).

> Detalhes do formato do webhook de entrada e do envio pela uazapi estão em
> [`API.md`](API.md) (seção "Chat e Conexão").

---

## 3. O que o agente consegue fazer (mapa rápido)

| Quero… | Como |
|---|---|
| **Criar/atualizar um lead** | `POST /api/integracao/leads` |
| **Buscar/listar leads** | `GET /api/integracao/leads?q=&status=&source=` |
| **Ver um lead (com agenda e follow-ups)** | `GET /api/integracao/leads/{telefone}` |
| **Editar um lead** | `PATCH /api/integracao/leads/{telefone}` |
| **Mudar a etapa geral do contato** | `PATCH /api/integracao/leads/{telefone}` com `{ "status": "qualificado" }` |
| **Excluir um lead** | `DELETE /api/integracao/leads/{telefone}` |
| **Ver o funil (colunas + nº de cards)** | `GET /api/integracao/board` |
| **Criar um card no funil** | `POST /api/integracao/deals` |
| **Mover um card de etapa** | `PATCH /api/integracao/deals/{id}` com `{ "stage": "agendado" }` |
| **Listar cards do funil** | `GET /api/integracao/deals?phone=&stage=` |
| **Excluir um card** | `DELETE /api/integracao/deals/{id}` |
| **Criar/atualizar agendamento** (também cria card) | `POST /api/integracao/appointments` |
| **Listar agendamentos** | `GET /api/integracao/appointments?from=&to=&status=&phone=` |
| **Reagendar / cancelar agendamento** | `PATCH` / `DELETE /api/integracao/appointments/{id}` |
| **Criar/agendar follow-up** | `POST /api/integracao/followups` |
| **Listar / concluir / cancelar follow-up** | `GET` / `PATCH` / `DELETE /api/integracao/followups/{id}` |
| **Coletar métricas / monitorar** | `GET /api/integracao/metrics?period=30d` |
| **Listar tags** | `GET /api/integracao/tags` |

**Lead × card:** o **lead é o contato único** (dono do telefone/chat, upsert que
nunca duplica). O **card do funil é um `deal`** (agendamento/oportunidade), e há
**N deals por lead** — cada agendamento é um card próprio. Assim um cliente
recorrente aparece com **vários cards** sem duplicar o contato. "Criar card" =
`POST /deals`; "mover o card" = `PATCH /deals/{id}` com `stage`; "ver o quadro" =
`GET /board`.

---

## 4. Leads

### Criar ou atualizar (upsert pelo telefone — nunca duplica)
`POST /api/integracao/leads`
```json
{
  "phone": "5511987654321",
  "name": "Maria Silva",
  "source": "anuncio",
  "status": "novo",
  "valor_estimado": 1200,
  "notes": "Veio pelo anúncio do Instagram"
}
```
Campos: `phone`* (DDI+DDD), `name`, `instagram_user`, `email`, `source`
(`agencia|anuncio|particular|indicacao|whatsapp|importado|outro`), `status`
(etapas do funil — ver §5), `tipo_ensaio`, `agencia_nome`, `modelo_nome`,
`interesse`, `valor_estimado`, `is_recorrente`, `memoria_contexto`, `notes`.
→ `200 { ok, lead }`.

> **`tipo_ensaio` é texto livre** — o nome da coluna é legado, mas o valor é
> definido por cada instância (ex.: `"consulta"`, `"reuniao"`, `"orçamento"`).
> `agencia_nome`/`modelo_nome` também são campos livres e opcionais. Não há
> lista fixa: use os rótulos que fizerem sentido para o CRM que você está
> operando.

### Buscar / listar
`GET /api/integracao/leads?q=maria&status=qualificado&source=anuncio&limit=50&page=1`
→ `{ ok, leads: [...], page, pageSize, total }`. `q` busca por nome ou telefone.

### Detalhe (com agenda + follow-ups)
`GET /api/integracao/leads/5511987654321`
→ `{ ok, lead: {..., tags}, appointments: [...], followups: [...] }`. `404` se não existir.

### Editar / mover de etapa
`PATCH /api/integracao/leads/5511987654321`
```json
{ "status": "agendado", "valor_estimado": 1500 }
```
Só os campos enviados são alterados. Mudar `status` já **carimba o timestamp**
da etapa (qualificado/agendado/compareceu/cliente). → `{ ok, lead }`.

### Excluir
`DELETE /api/integracao/leads/5511987654321` → `{ ok, deleted: true }`.
(Tags e follow-ups do lead saem junto; agenda/financeiro são desvinculados.)

---

## 5. Funil (etapas e cards = deals)

O funil é feito de **cards**, e cada card é um **`deal`** (agendamento/oportunidade),
não um lead. Há **N deals por lead** → um cliente recorrente tem vários cards sem
duplicar o contato. Todo lead novo já nasce com **1 deal** na etapa atual (para
nada sumir do funil); os cards extras você cria por agendamento.

### Ver o quadro
`GET /api/integracao/board`
```json
{
  "ok": true,
  "totalDeals": 168,
  "stages": [
    { "key": "novo", "label": "Novo", "color": "violet", "position": 0,
      "stage_type": "open", "probability": 10, "deals": 26 },
    { "key": "qualificado", "label": "Qualificado", "deals": 16, "probability": 40, "...": "..." }
  ]
}
```
As **etapas** (colunas) vêm em ordem, com a contagem de **cards (deals)** em cada.
Etapas padrão: `novo`, `em_atendimento`, `qualificado`, `agendado`, `compareceu`,
`cliente`, `recorrente`, `perdido`.

### Criar um card (deal)
`POST /api/integracao/deals`
```json
{
  "phone": "5511987654321",
  "stage": "agendado",
  "tipo_ensaio": "consulta",
  "valor": 1200,
  "scheduled_at": "2026-07-20T13:00:00.000Z",
  "idempotency_key": "deal-5511987654321-2026-07-20"
}
```
`phone`* resolve o cliente (o lead precisa existir → `404 lead_not_found`).
`stage` é opcional (default `novo`; precisa existir em board_columns). **Cada
chamada cria um card novo** — é assim que o recorrente ganha vários cards. Use
`idempotency_key` para não duplicar em retry. → `{ ok, deal }`.

### Mover / editar um card
`PATCH /api/integracao/deals/{id}`
```json
{ "stage": "compareceu", "valor": 1500 }
```
Move de etapa (`stage` = `key` da coluna) e/ou edita `tipo_ensaio`, `valor`,
`scheduled_at`, `notes`. Ao cair numa etapa de situação **ganho/perdido**, o card
carimba `won_at`/`lost_at`. → `{ ok, deal }`.

### Listar / excluir cards
- `GET /api/integracao/deals?phone=5511987654321` (ou `?stage=agendado`) → `{ ok, deals: [...] }`
- `DELETE /api/integracao/deals/{id}` → `{ ok, deleted: true }`

> **Não confunda** `PATCH /leads/{telefone}` `{ status }` (muda a etapa **geral do
> contato**, para filtros/métricas) com `PATCH /deals/{id}` `{ stage }` (move um
> **card** no quadro). Para o funil visual, é sempre **deal**.

---

## 6. Agendamentos (calendário)

### Criar / atualizar
`POST /api/integracao/appointments`
```json
{
  "phone": "5511987654321",
  "scheduled_at": "2026-07-20T13:00:00.000Z",
  "duration_min": 60,
  "status": "agendado",
  "idempotency_key": "appt-5511987654321-2026-07-20"
}
```
`status`: `agendado|confirmado|compareceu|faltou|cancelado`. Use `idempotency_key`
para não duplicar em retries. → `{ ok, appointment, deal }`.

> **Cria também um card no funil** (etapa `agendado`), vinculado ao agendamento —
> por isso a resposta traz `deal`. Se você já cria o card por `POST /deals`, **não**
> chame os dois para o mesmo ato (evita 2 cards). Escolha **um** caminho por
> agendamento.

### Listar
`GET /api/integracao/appointments?from=2026-07-01T00:00:00Z&to=2026-07-31T23:59:59Z&status=agendado`
(ou `?phone=` para os de um cliente) → `{ ok, appointments: [...] }`.

### Reagendar / editar / cancelar
- `PATCH /api/integracao/appointments/{id}` → `{ "scheduled_at": "...", "status": "confirmado" }`
- `DELETE /api/integracao/appointments/{id}` → remove.

---

## 7. Follow-ups

- **Agendar/registrar:** `POST /api/integracao/followups`
  ```json
  { "phone": "5511987654321", "scheduled_for": "2026-07-22T14:00:00Z", "message": "Retornar sobre o orçamento", "status": "pendente" }
  ```
- **Listar:** `GET /api/integracao/followups?status=pendente&phone=...`
- **Concluir/cancelar/reagendar:** `PATCH /api/integracao/followups/{id}` com
  `{ "status": "enviado" }` (ou `cancelado`, ou novo `scheduled_for`). `DELETE` remove.

---

## 8. Métricas e monitoramento

`GET /api/integracao/metrics?period=30d`  (`7d | 30d | 90d | all`)
→ `{ ok, dashboard: { kpis, pipeline, daily, where, funnel, salesByWeekday, ltv, bySource, byState, ... } }`.

Traz **tudo do dashboard em JSON**: KPIs (total de leads, receita, conversão,
ticket médio — com variação % vs período anterior), pipeline atual, série por dia,
"onde estão os leads", funil, vendas por dia da semana, LTV & recompra, por origem
e por estado. Ideal para o agente **monitorar** (ex.: alertar se a conversão cair).

> **Métricas são por CONTATO (lead), não por card.** O dashboard (inclusive o
> "funil" daqui) conta **leads** por `status`, enquanto o board visual conta
> **cards (deals)** — por isso os números podem divergir (um recorrente é 1 lead,
> mas vários cards). Para contagem de cards por etapa use `GET /board` (§5).

---

## 9. Exemplos por ferramenta

### 9.1 curl
```bash
# criar/atualizar lead
curl -X POST https://SEU-CRM/api/integracao/leads \
  -H "Authorization: Bearer SEU_TOKEN" -H "Content-Type: application/json" \
  -d '{"phone":"5511987654321","name":"Maria","status":"novo","source":"anuncio"}'

# mover para "qualificado"
curl -X PATCH https://SEU-CRM/api/integracao/leads/5511987654321 \
  -H "Authorization: Bearer SEU_TOKEN" -H "Content-Type: application/json" \
  -d '{"status":"qualificado"}'

# métricas dos últimos 30 dias
curl "https://SEU-CRM/api/integracao/metrics?period=30d" -H "Authorization: Bearer SEU_TOKEN"
```

### 9.2 n8n (nó **HTTP Request**)
- **Method/URL:** conforme a tabela (§3).
- **Authentication:** `Generic Credential Type → Header Auth` → Name `Authorization`, Value `Bearer SEU_TOKEN`.
  (ou header `x-webhook-secret` = `SEU_TOKEN`.)
- **Send Body:** JSON (para POST/PATCH).
- Guarde o token como **credencial** do n8n, nunca escrito no nó.

### 9.3 Python (`requests`) — client reutilizável
```python
import requests

class CRM:
    def __init__(self, base, token):
        self.base = base.rstrip("/")
        self.s = requests.Session()
        self.s.headers["Authorization"] = f"Bearer {token}"

    def salvar_lead(self, phone, **campos):
        return self.s.post(f"{self.base}/api/integracao/leads",
                           json={"phone": phone, **campos}).json()

    def buscar_leads(self, **q):
        return self.s.get(f"{self.base}/api/integracao/leads", params=q).json()

    def mover_etapa_contato(self, phone, status):
        """Muda a etapa GERAL do contato (leads.status) — não move card do funil."""
        return self.s.patch(f"{self.base}/api/integracao/leads/{phone}",
                            json={"status": status}).json()

    # --- Funil = cards (deals): N por lead, cada agendamento é um card ---
    def criar_card(self, phone, stage="novo", **kw):
        """Cria um card no funil (deal) para o cliente. Cada chamada = card novo."""
        return self.s.post(f"{self.base}/api/integracao/deals",
                           json={"phone": phone, "stage": stage, **kw}).json()

    def mover_card(self, deal_id, stage):
        """Move um card do funil para outra etapa (pelo id do deal)."""
        return self.s.patch(f"{self.base}/api/integracao/deals/{deal_id}",
                            json={"stage": stage}).json()

    def listar_cards(self, **q):
        return self.s.get(f"{self.base}/api/integracao/deals", params=q).json()

    def agendar(self, phone, scheduled_at, **kw):
        """Cria um agendamento (e também um card no funil, etapa 'agendado')."""
        return self.s.post(f"{self.base}/api/integracao/appointments",
                           json={"phone": phone, "scheduled_at": scheduled_at, **kw}).json()

    def metricas(self, period="30d"):
        return self.s.get(f"{self.base}/api/integracao/metrics",
                          params={"period": period}).json()

crm = CRM("https://SEU-CRM", "SEU_TOKEN")
crm.salvar_lead("5511987654321", name="Maria", status="novo", source="anuncio")
card = crm.criar_card("5511987654321", stage="agendado", tipo_ensaio="consulta", valor=1200)
crm.mover_card(card["deal"]["id"], "compareceu")
print(crm.metricas("30d")["dashboard"]["kpis"])
```

### 9.4 LangChain / Agno (tools)
Cada capacidade vira uma **tool** que chama o HTTP acima. Exemplo (LangChain):
```python
from langchain_core.tools import tool

@tool
def salvar_lead(phone: str, name: str = "", status: str = "novo", source: str = "whatsapp") -> dict:
    """Cria ou atualiza o CONTATO (lead) no CRM pelo telefone (não duplica)."""
    return crm.salvar_lead(phone, name=name, status=status, source=source)

@tool
def criar_card_no_funil(phone: str, stage: str = "novo", tipo_ensaio: str = "", valor: float = 0) -> dict:
    """Cria um CARD (deal) no funil para o cliente. Cada agendamento vira um card
    próprio — um cliente recorrente tem vários cards, sem duplicar o contato."""
    extra = {k: v for k, v in {"tipo_ensaio": tipo_ensaio, "valor": valor}.items() if v}
    return crm.criar_card(phone, stage=stage, **extra)

@tool
def mover_card_no_funil(deal_id: str, stage: str) -> dict:
    """Move um card do funil para outra etapa (novo, qualificado, agendado,
    compareceu, cliente, perdido...), pelo id do deal."""
    return crm.mover_card(deal_id, stage)

@tool
def agendar_visita(phone: str, scheduled_at_iso: str, duration_min: int = 60) -> dict:
    """Agenda um compromisso para o cliente (ISO 8601) — cria também um card no funil."""
    return crm.agendar(phone, scheduled_at_iso, duration_min=duration_min)
```
No **Agno** é o mesmo: registre funções que chamam esses endpoints como `tools` do agente.

> **Regra de ouro para o agente:** o funil é feito de **deals (cards)**. Para mexer
> no quadro, use `criar_card_no_funil` / `mover_card_no_funil`. `mover_etapa_contato`
> (`PATCH /leads`) só muda a etapa "geral" do contato (filtros/métricas), **não** o card.

---

## 10. MCP — ferramentas nativas (recomendado para Claude/agentes)

**MCP (Model Context Protocol)** é o jeito padrão de dar *tools* a um agente
(Claude Desktop, Claude Code, etc.). Em vez de o agente montar HTTP na mão, ele
"enxerga" ferramentas como `lead_salvar`, `deal_criar`, `funil_quadro`, `agendamento_criar`.

> O servidor MCP que existia neste repositório (tools de lead, funil e agendamento
> do CRM de origem) foi **removido**. Um MCP novo, sobre a API v1 de tickets, está
> previsto para a v1.1 — ver [`docs/PLANO-IMPLANTACAO.md`](PLANO-IMPLANTACAO.md).
> Os princípios abaixo continuam valendo.
### Como criar um MCP **da melhor forma** (princípios)
1. **Tools finas sobre uma API estável.** Não reimplemente regra de negócio no MCP —
   cada tool só chama um endpoint `/api/integracao/*`. Assim o MCP nunca fica
   "desalinhado" do CRM.
2. **Agrupe por módulo e nomeie `modulo_acao`.** `lead_buscar`, `lead_mover_etapa`,
   `funil_quadro`, `agendamento_criar`. Nomes previsíveis ajudam o LLM a escolher.
3. **Descrições ricas** — o modelo escolhe a tool **pela descrição**. Descreva o que
   faz e **quando usar**, e use `.describe()` em cada parâmetro (ex.: formato do telefone).
4. **Valide com zod** e use **enums** onde houver domínio fechado (etapas do funil,
   status de agendamento) — o agente erra menos.
5. **Exponha só o necessário.** Menos tools, mais certeiras = melhor escolha do LLM.
   Aqui: lead, funil e agendamento (não jogue 30 tools no agente).
6. **Erros estruturados.** Devolva `isError: true` + o corpo do CRM, para o agente se
   auto-corrigir (ex.: `422` → ajustar o payload).
7. **Config por env + transporte certo.** `CRM_BASE_URL` + `CRM_TOKEN` por env; **stdio**
   para uso local (Desktop/Code). Para um MCP remoto/compartilhado, use transporte
   **HTTP/SSE** (mesmo código de tools, só troca o transporte).
8. **Segurança:** um **token por integração**, revogável no painel; HTTPS sempre.

### Esqueleto de uma tool (referência)
```js
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({ name: "crm-suporte", version: "1.0.0" });

server.tool(
  "lead_mover_etapa",
  "Move o lead para outra etapa do funil.",
  { phone: z.string(), status: z.enum(["novo","qualificado","agendado","cliente","perdido"]) },
  async ({ phone, status }) => {
    const r = await fetch(`${process.env.CRM_BASE_URL}/api/integracao/leads/${phone}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${process.env.CRM_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    return { content: [{ type: "text", text: await r.text() }], isError: r.status >= 400 };
  }
);

await server.connect(new StdioServerTransport());
```

---

## 11. Boas práticas

- **Telefone:** sempre com DDI+DDD, só dígitos (ex.: `5511987654321`). O CRM
  normaliza (WhatsApp `5511…` e cadastro `11…` viram o mesmo lead).
- **Idempotência:** use `idempotency_key` em agendamentos para não duplicar em retries.
- **Segurança:** um **token por integração** (dá para revogar individualmente);
  nunca exponha o token em logs/repos; use HTTPS.
- **Não duplica leads:** `POST /leads` é upsert pelo telefone — pode reenviar à vontade.
- **Rate/erros:** trate `429`/`5xx` com retry exponencial; o `POST /leads` é seguro para repetir.

> Referência técnica completa de todos os endpoints (inclusive os webhooks do n8n
> e o chat) em [`API.md`](API.md).
