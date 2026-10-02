# Guia do agente de triagem — CRM Suporte

Este guia é para quem implementa o **agente de triagem**: uma IA externa, um fluxo no n8n ou código próprio que atende o cliente pelo WhatsApp junto com o CRM. Ele descreve o ciclo completo, as regras que evitam os erros mais comuns e exemplos prontos.

Documentos de apoio:

- [`CONTRATO-RELAY.md`](CONTRATO-RELAY.md): o pedido que o CRM envia ao agente a cada mensagem do cliente, e como conferir a assinatura. Este guia não repete o contrato.
- [`API.md`](API.md): as regras gerais da API v1 (autenticação, escopos, erros, idempotência, paginação).
- `GET /api/v1/openapi.json`: a referência completa de cada rota, campo e resposta.

Nos exemplos, `BASE` é o endereço do CRM (sem barra no fim) e `TOKEN` é o token de API do agente. Nenhum dos dois vai escrito no código do agente: guarde-os na configuração segura dele.

## 1. Antes de começar

1. **Token.** Um administrador cria o token em **Integrações › API do CRM** (`/app/conexao?aba=api`), com o acesso **IA de triagem**. O preset grava o tipo `ai`, 300 requisições por minuto e os escopos de que o agente precisa. O token aparece uma vez só: copie na hora.
2. **Endereço do agente.** Em **Integrações › Agente de IA** (`/app/conexao?aba=agente`), campo *Webhook do agente de IA*. É para onde o CRM repassa as mensagens.
3. **Chave de assinatura.** No mesmo lugar, **Gerar chave**. Ela aparece uma vez só. Configure-a no agente e recuse todo pedido sem assinatura válida.
4. **Teste.** O botão **Testar conexão** envia um `webhook.ping` ao endereço salvo. O agente responde `2xx` e não faz mais nada.

Confira o token assim que o receber:

```bash
curl -sS "$BASE/api/v1/me" -H "Authorization: Bearer $TOKEN"
```

A resposta traz `data.token.scopes`, `data.token.actor_type` (deve ser `ai`) e `data.token.rate_limit_per_min`. Guarde o `data.token.id`: é o `sent_by_token_id` das mensagens que o agente enviar.

## 2. O ciclo completo

```
cliente escreve no WhatsApp
        │
        ▼
CRM grava a mensagem ──► POST no agente (repasse assinado)
                               │
                               ├─ 1. confere a assinatura e responde 2xx
                               ├─ 2. separa teste (webhook.ping) de mensagem
                               ├─ 3. confere conversation_status == "bot"
                               ├─ 4. GET /context?phone=
                               ├─ 5. decide
                               ├─ 6. abre ou atualiza o ticket
                               ├─ 7. escolhe o ticket em foco, se precisar
                               ├─ 8. responde: POST /conversations/{id}/messages
                               └─ 9. ou passa para um humano: POST /conversations/{id}/handoff
```

### 2.1 Receber o repasse

O formato do pedido está em [`CONTRATO-RELAY.md`](CONTRATO-RELAY.md). O essencial:

- **Confira a assinatura antes de tudo** (seção 4 do contrato): `X-CRM-Signature` é `v1=` mais o HMAC-SHA256 em hexadecimal de `<X-CRM-Timestamp>.<corpo cru>`, com a chave como texto. Recuse se o instante estiver a mais de 5 minutos do relógio do agente, se o cabeçalho faltar ou se a chave estiver vazia. Use os bytes recebidos, nunca o JSON reconvertido. O contrato traz código em Node.js e Python e um exemplo para conferir a conta.
- **Responda `2xx` logo.** O CRM espera no máximo 10 segundos e não tenta de novo. Processe depois de responder.
- **Separe o teste da mensagem pelo corpo.** O teste tem `"event": "webhook.ping"`. A mensagem do cliente nunca tem o campo `event`. Não confie no cabeçalho `X-CRM-Event` para isso: a assinatura não o cobre.
- **Descarte repetição pelo `message_id`** do corpo.
- **Ordene pelo `message.messageTimestamp`.** Mensagens em sequência chegam em paralelo, sem ordem garantida.
- **Confira `message.messageType`.** O CRM repassa também reação, enquete, localização e, conforme o provedor, a edição de uma mensagem como se fosse outra.

### 2.2 Só responda em conversa `bot`

O campo `conversation_status` do repasse diz quem conduz a conversa:

| Valor | Significado | O que o agente faz |
|---|---|---|
| `bot` | a IA conduz | pode responder |
| `human` | um analista assumiu | não responde |
| `resolved` | encerrada | não responde |

Campo ausente ou valor desconhecido é o mesmo que "não é minha".

Hoje o CRM só repassa conversa em `bot`. Numa próxima versão ele vai repassar também as que estão com um analista, para a IA acompanhar sem responder. Um agente que responde a tudo o que recebe vai falar por cima do analista. Por isso a regra é decidir pelo campo, e não por "se chegou, é minha".

O `GET /context` traz a mesma regra pronta: `ai_may_reply` é `true` só com a conversa em `bot`.

### 2.3 Consultar o contexto

```bash
curl -sS "$BASE/api/v1/context?phone=5527999990000" \
  -H "Authorization: Bearer $TOKEN"
```

- `phone`: com DDD, com ou sem o 55, com ou sem máscara. A busca é por igualdade exata (números antigos da pessoa inclusos), sem tolerância ao nono dígito.
- Telefone desconhecido também é `200`, com `contact: null` e o resto vazio. O `GET` nunca cria nada.
- Falha de leitura é `503 unavailable` com `Retry-After`. O contexto nunca vem pela metade.

O que vem em `data`:

| Campo | O que é |
|---|---|
| `contact`, `customer` | quem escreveu e a empresa dele |
| `contract` | o contrato atual, sem valor nem dia de vencimento |
| `contract_alert` | `null` com contrato ativo; senão `sem_empresa`, `sem_contrato`, `suspenso` ou `encerrado` |
| `conversation` | a conversa mais recente do contato; confira se `conversation.id` é o `conversation_id` do repasse |
| `open_tickets` | tickets não encerrados da conversa (até 20), cada um com `allowed_transitions` |
| `open_tickets_truncated` | `true` se havia mais |
| `recent_tickets` | os últimos 5 tickets encerrados do contato |
| `messages` | as últimas mensagens da conversa, da mais antiga para a mais nova, sem notas internas |
| `ai_may_reply` | `true` só com a conversa em `bot` |

`allowed_transitions: null` quer dizer que a matriz de status não pôde ser lida agora, e não que não há destino.

### 2.4 Abrir um ticket

```bash
curl -sS -X POST "$BASE/api/v1/tickets" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: $(uuidgen)" \
  -d '{
    "conversation_id": "<conversation_id do repasse>",
    "title": "Nota fiscal não sai",
    "priority": "alta",
    "status": "em_triagem",
    "description": "Cliente relata erro ao emitir nota desde hoje cedo.",
    "ai_triage": { "categoria_sugerida": "fiscal", "confianca": 0.8 }
  }'
```

- Obrigatórios: `conversation_id` e `title` (3 a 200).
- `priority`: `baixa`, `media` (padrão), `alta` ou `critica`.
- `status` inicial: `novo` (padrão) ou `em_triagem`.
- Opcionais: `description` (até 10.000), `product_id`, `category_id`, `assignee_id` (ids de `GET /products`, `/ticket-categories` e `/users`), `external_id` (o id do ticket no seu sistema, único por token) e `ai_triage` (objeto livre, até 16 KB).
- `201` aberto; `200` já existia (o ticket como está). O ticket novo vira o foco da conversa.
- A resposta traz `ETag: W/"<version>"`. Guarde-o para alterar o ticket depois.
- Repetir com a mesma `Idempotency-Key` devolve a mesma resposta, com `Idempotent-Replayed: true` e sem `ETag` (a versão está em `data.version`).

### 2.5 Atualizar o ticket

Toda alteração num ticket existente exige `If-Match` com o `ETag` mais recente.

Alterar campos:

```bash
curl -sS -X PATCH "$BASE/api/v1/tickets/<ref>" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H 'If-Match: W/"3"' \
  -d '{ "priority": "critica", "description": "Atinge todas as filiais." }'
```

Mudar o status:

```bash
curl -sS -X POST "$BASE/api/v1/tickets/<ref>/transitions" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H 'If-Match: W/"4"' \
  -d '{ "to": "aguardando_cliente" }'
```

Comentário interno (nunca vai ao cliente):

```bash
curl -sS -X POST "$BASE/api/v1/tickets/<ref>/comments" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: $(uuidgen)" \
  -d '{ "body": "Cliente informou o número da nota: 1234." }'
```

Anexo (só o campo `file`, até 50 MB):

```bash
curl -sS -X POST "$BASE/api/v1/tickets/<ref>/attachments" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Idempotency-Key: $(uuidgen)" \
  -F "file=@print-do-erro.png"
```

- `<ref>` é o `id` do ticket ou o protocolo (`number`), só o número.
- `PATCH` altera `title`, `description`, `priority`, `product_id`, `category_id` e `customer_id`. Ausente não mexe; `null` tira.
- `GET /ticket-statuses` mostra a matriz. Destino fora dela: `409 invalid_transition`, com `allowed` e `current`. Cancelar exige `reason`.
- A resposta de `PATCH`, `transitions` e `assign` é `{ "ticket": {...}, "changed": true|false }` (mais `from` e `to` na transição), com o `ETag` novo.
- `412 version_conflict`: alguém alterou o ticket. Leia de novo (`GET /tickets/<ref>`) e decida se ainda faz sentido repetir.
- O mesmo valor de novo é no-op: `200` com `changed: false`, mesmo com versão velha.

### 2.6 Escolher o ticket em foco

A conversa tem um ticket em foco: é ele que recebe as mensagens novas. Abrir um ticket já o põe em foco. Para trocar:

```bash
curl -sS -X PUT "$BASE/api/v1/conversations/<conversation_id>/active-ticket" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "ticket_id": "<id do ticket>" }'
```

- `ticket_id: null` tira o foco.
- A resposta é `{ "conversation_id", "active_ticket_id", "changed" }`, e não a conversa.
- Ticket de outra conversa, ou que não existe: `422 ticket_not_in_conversation`. Ticket encerrado: `409 ticket_terminal`.

### 2.7 Responder ao cliente

Sempre pelo CRM, nunca direto no provedor de WhatsApp:

```bash
curl -sS -X POST "$BASE/api/v1/conversations/<conversation_id>/messages" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: $(uuidgen)" \
  -d '{ "text": "Olá! Já registrei o seu chamado. Pode me mandar um print do erro?" }'
```

- Só texto, até 4.096 unidades. O CRM não acrescenta assinatura nem altera o texto, só tira o espaço das pontas. Se a empresa quer o nome da IA na mensagem, o agente o escreve.
- Evite `{{...}}` no texto: o provedor do WhatsApp troca marcadores como `{{name}}` antes de entregar, e o cliente receberia um texto diferente do gravado.
- `201`: a mensagem saiu, gravada com `sender_type: "ai"` e o token como autor.
- `200`: esta `Idempotency-Key` já tinha enviado esta mensagem. Nada foi reenviado.
- `409 conversation_not_owned_by_ai`: a conversa não está mais com a IA (`error.current` diz o status). O CRM confere isso na hora do envio, então um analista que assumiu um segundo antes já barra a mensagem.
- `409 channel_unavailable`: a conversa não tem canal de WhatsApp ativo.
- `429 rate_limited`: além do limite do token, há um teto de 20 envios por minuto e 100 por hora por conversa.
- `502 whatsapp_unavailable`: a mensagem **não saiu**. Repita com a **mesma** chave, que tenta de novo sem duplicar.
- `504 delivery_unknown`: o WhatsApp não confirmou, e a mensagem **pode ter saído**. Repita com a **mesma** chave para saber o desfecho: nada é reenviado enquanto não se souber. Uma chave nova pode fazer o cliente receber em dobro.

### 2.8 Passar para um humano (handoff)

```bash
curl -sS -X POST "$BASE/api/v1/conversations/<conversation_id>/handoff" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: $(uuidgen)" \
  -d '{
    "reason": "Cliente pediu para falar com um analista.",
    "summary": "Erro na emissão de nota fiscal desde hoje cedo. Já enviou print.",
    "ticket_id": "<id do ticket>"
  }'
```

- `reason` é obrigatório (até 500). Vai para a trilha do ticket e para uma nota interna no chat.
- `summary` é opcional (até 4.000). Vai só para a nota interna, que o analista lê ao assumir e que nunca vai ao cliente.
- `ticket_id` é opcional. Sem ele, vale o ticket em foco.
- A conversa passa de `bot` para `human`. Se estava arquivada, volta para a caixa de entrada.
- A resposta é `{ "conversation_id", "status": "human", "changed", "ticket_id", "note_id" }`, e não a conversa.
- A volta para `bot` é só pela tela.

**Despeça-se do cliente antes do handoff.** Depois dele a conversa é `human`, e todo envio da IA responde `409 conversation_not_owned_by_ai`. A ordem certa é: enviar a mensagem de despedida ("vou transferir você para um analista"), conferir o `201`, e só então chamar o handoff.

## 3. Regras que pegam quem começa

- **`changed: false` no handoff não traz o ticket.** Se a conversa já estava com um humano, o handoff responde `200` com `changed: false`, não grava nada, e `ticket_id` e `note_id` vêm `null`. Não leia o ticket de lá: use o `ticket_id` que você enviou, ou `GET /conversations/{id}` para ver o foco.
- **Ticket errado é erro mesmo com a conversa já humana.** Um `ticket_id` de outra conversa (`422`) ou encerrado (`409`) falha no handoff mesmo quando nada mudaria.
- **Conversa encerrada não aceita handoff:** `409 conversation_not_owned_by_ai`. Quem a devolve à IA é uma mensagem nova do cliente.
- **Uma `Idempotency-Key` nova a cada pedido.** A mesma chave repete a resposta guardada por 24 horas, inclusive um `changed: false`. Uma chave derivada da conversa (por exemplo, `handoff-<conversation_id>`) faria o segundo handoff do dia, depois de a conversa voltar para `bot`, receber a resposta antiga e não fazer nada.
- **A IA não lê o que é só do time.** O preset não tem `comments:read`: comentários internos não aparecem na timeline do ticket, e notas internas não aparecem nas mensagens da conversa nem no `/context`. É de propósito, para a IA não repetir ao cliente o que o time escreveu para o time. O motivo do handoff fica visível na trilha do ticket; o resumo, não.
- **Mídia.** A API não entrega mídia de mensagem por URL; ela traz só `media_mime_type`. A mídia da mensagem que acabou de chegar vem no `media_url` do repasse, válido por 10 minutos: baixe ao receber. `media_url` nulo numa mensagem de mídia quer dizer que o CRM não tem o arquivo; peça o texto ao cliente ou passe para um analista.
- **Limites de texto contam unidades UTF-16,** e não caracteres. Um emoji comum conta 2. Um motivo de handoff com 251 emojis passa de 500 e é recusado. Os limites:

  | Campo | Limite |
  |---|---|
  | `title` do ticket | 3 a 200 |
  | `description` do ticket | até 10.000 |
  | `reason` de transição e de handoff | até 500 |
  | `summary` do handoff | até 4.000 |
  | `body` do comentário | 1 a 5.000 |
  | `text` da mensagem | 1 a 4.096 |
  | `external_id` do ticket | 1 a 200 |
  | `ai_triage` | 16 KB, medidos como o banco guarda o JSON |

  Texto com o caractere NUL, ou com metade de um par UTF-16, é recusado.
- **UUID em qualquer caixa.** A API aceita UUID em maiúsculas ou minúsculas e sempre devolve em minúsculas. O `pattern` de UUID do OpenAPI só tem minúsculas: se você gera validação a partir dele, normalize para minúsculas antes de enviar.
- **Campos novos podem aparecer.** As respostas da v1 só mudam de forma aditiva, mas os schemas de resposta do OpenAPI saem com `additionalProperties: false`. Não valide a resposta contra eles em modo estrito, ou o agente vai recusar uma resposta válida no dia em que um campo novo entrar. Ignore o que não conhece.
- **Anexo a partir de .NET.** O CRM lê o multipart pelo parser do Node, que exige, no `Content-Disposition` da parte, `name="file"` e `filename="..."` entre aspas, sem `filename*`. O `HttpClient` do .NET, no padrão, manda sem aspas e acrescenta `filename*`, e recebe `400 invalid_multipart`. Monte o cabeçalho da parte à mão, com as aspas e sem `filename*`. curl, `requests` do Python e n8n já mandam no formato certo.
- **O telefone do contato é imutável.** `PATCH /contacts/{id}` com `phone` é `422 phone_immutable`.

## 4. Boas práticas

- **`Idempotency-Key` sempre** que a rota pedir, gerada uma vez por operação (um UUID novo) e guardada até a resposta definitiva. Numa falha de rede, repita com a **mesma** chave.
- **Trate `429` e `503` com espera.** Os dois trazem `Retry-After` em segundos: espere pelo menos isso antes de repetir. Não repita em laço apertado.
- **Logue o `X-Request-Id`** de toda resposta. É por ele que o suporte acha a chamada no registro do CRM.
- **Decida pelo `error.code`**, nunca pela `error.message`.
- **Não confie em campo não documentado.** O que não está no OpenAPI pode mudar sem aviso.
- **Releia antes de alterar** quando o `ETag` guardado for antigo. Num `412`, leia de novo em vez de forçar.
- **Não guarde URL assinada** (mídia do repasse, link de anexo). Peça outra quando precisar.
- **Não repita ao cliente** o conteúdo de comentário ou nota interna, mesmo que um token com mais escopos os leia.

## 5. Avisos fora da API v1

Dois avisos antigos do CRM ao agente ainda existem, configurados por variável de ambiente do servidor, e saem na Fase 6:

- **Assumir e liberar:** quando um analista assume a conversa (ou a IA faz o handoff), e quando a conversa volta para `bot`, o CRM pode fazer um `POST` com `{ "phone", "assumed" }` num endereço definido em `TAKEOVER_AGENT_URL`. Sem a variável, nada sai. O agente não deve depender dele: `conversation_status` no repasse e `ai_may_reply` no `/context` já dizem quem conduz.
- **Assinatura da IA:** a configuração "assinar mensagens da IA" da tela é enviada ao agente por um aviso próprio ([`CONTRATO-ASSINATURA-BOT.md`](CONTRATO-ASSINATURA-BOT.md), parcialmente desatualizado). Quem aplica a assinatura no texto é o agente.

## 6. Roteiro de verificação local (Fase 5)

Este roteiro cobre o "pronto quando" da Fase 5 ([`PLANO-IMPLANTACAO.md`](PLANO-IMPLANTACAO.md), seção Verificação, "Roteiro curl da API v1"). Ele roda contra o app **local** e não toca em nada real: o WhatsApp é um servidor de mentira em `127.0.0.1`.

### 6.1 Preparação

Pré-requisitos:

- o banco local de pé, com as migrations aplicadas: `docker compose up -d db rest realtime storage gateway` e `./scripts/db-local-apply.sh` (ver o topo do `docker-compose.yml`);
- o app rodando **na máquina**, em modo de desenvolvimento: `pnpm dev`, em `http://localhost:3000`;
- um administrador no banco local;
- a integração local do WhatsApp (a de [`PROXIMOS-PASSOS.md`](PROXIMOS-PASSOS.md) §9.2), com token e segredo de webhook no cofre do banco local;
- `curl`, `jq`, `python3` e `uuidgen`, e os comandos rodados da raiz do repositório.

Dois motivos para o `pnpm dev` na máquina, e não o serviço `web` do compose: só em desenvolvimento o CRM aceita um provedor em `127.0.0.1`; e, de dentro do container, `127.0.0.1` seria o próprio container, e não o provedor de mentira.

**a) Variáveis do roteiro**

```bash
BASE=http://localhost:3000
PHONE=5527999990000            # número fictício
JAR=$(mktemp)                  # cookies da sessão de administrador
ADMIN_EMAIL='<e-mail do admin local>'
ADMIN_SENHA='<senha do admin local>'
PSQL="docker compose exec -T db psql -U postgres -d postgres -At"
```

**b) Provedor de WhatsApp de mentira**, num terminal à parte. Ele responde `200` a qualquer `POST`, com um id novo por envio:

```bash
python3 - <<'EOF'
import json, uuid
from http.server import BaseHTTPRequestHandler, HTTPServer

class Falso(BaseHTTPRequestHandler):
    def do_POST(self):
        self.rfile.read(int(self.headers.get("Content-Length") or 0))
        print("provedor recebeu:", self.path, flush=True)
        corpo = json.dumps({"id": str(uuid.uuid4()), "messageid": "FALSO" + uuid.uuid4().hex[:16].upper()}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(corpo)))
        self.end_headers()
        self.wfile.write(corpo)

    def log_message(self, *args):
        pass

HTTPServer(("127.0.0.1", 4010), Falso).serve_forever()
EOF
```

**c) Apontar a integração local para ele.** Confira antes que ela aponta para `https://demo.invalid` ([`PROXIMOS-PASSOS.md`](PROXIMOS-PASSOS.md) §9.2); se apontar para outro lugar, pare:

```bash
$PSQL -c "select config->>'apiUrl' from public.chat_integrations where provider = 'uazapi';"
$PSQL -c "update public.chat_integrations set config = jsonb_set(config, '{apiUrl}', '\"http://127.0.0.1:4010\"') where provider = 'uazapi';"
```

Deixe vazio o endereço do agente em Integrações › Agente de IA, ou aponte-o para um receptor de mentira em `127.0.0.1`.

**d) Sessão de administrador e tokens.** Um token de IA (preset), um sem escopo e um que vence em 2 minutos:

```bash
curl -sS -c "$JAR" -X POST "$BASE/api/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_SENHA\"}" | jq .ok

criar_token() {
  curl -sS -b "$JAR" -X POST "$BASE/api/api-tokens" -H "Content-Type: application/json" -d "$1"
}

IA=$(criar_token '{"name":"roteiro-ia","actor_type":"ai","rate_limit_per_min":300,"scopes":["context:read","contacts:read","contacts:write","customers:read","catalog:read","tickets:read","tickets:write","comments:write","attachments:write","conversations:read","messages:send","conversations:handoff"]}')
TOKEN=$(echo "$IA" | jq -r .token);  TOKEN_ID=$(echo "$IA" | jq -r .item.id)

SEM=$(criar_token '{"name":"roteiro-sem-escopo"}')
TOKEN_SEM=$(echo "$SEM" | jq -r .token);  TOKEN_SEM_ID=$(echo "$SEM" | jq -r .item.id)

VENCE=$(criar_token "{\"name\":\"roteiro-vence\",\"scopes\":[\"context:read\"],\"expires_at\":\"$(date -u -d '+2 minutes' +%Y-%m-%dT%H:%M:%SZ)\"}")
TOKEN_VENCE=$(echo "$VENCE" | jq -r .token);  TOKEN_VENCE_ID=$(echo "$VENCE" | jq -r .item.id)
```

Saída esperada: `true` no login, e os três tokens começando por `crmsuporte_`.

**e) Uma mensagem do cliente.** Simula o webhook do provedor, com o segredo da integração local:

```bash
SEGREDO=$($PSQL -c "select public.get_chat_integration_secret(id, 'webhook_secret') from public.chat_integrations where provider = 'uazapi';")

curl -sS -X POST "$BASE/api/chat/webhook/uazapi?s=$SEGREDO" \
  -H "Content-Type: application/json" \
  -d "{\"EventType\":\"messages\",\"chat\":{\"name\":\"Cliente Teste\"},\"message\":{\"messageid\":\"ROTEIRO$(date +%s)\",\"chatid\":\"$PHONE@s.whatsapp.net\",\"sender_pn\":\"$PHONE@s.whatsapp.net\",\"senderName\":\"Cliente Teste\",\"fromMe\":false,\"isGroup\":false,\"messageType\":\"Conversation\",\"text\":\"O sistema voltou a travar\",\"messageTimestamp\":$(date +%s)}}"
```

Saída esperada: `{"ok":true}`. A conversa aparece no chat do CRM. Se `SEGREDO` vier vazio, a resposta é `401`: a integração local não tem segredo de webhook. Grave um só para o roteiro e repita:

```bash
$PSQL -c "select public.set_chat_integration_secret(id, 'webhook_secret', replace(gen_random_uuid()::text, '-', '')) from public.chat_integrations where provider = 'uazapi';"
```

### 6.2 Os oito passos

**Passo 1. Contexto pelo telefone.**

```bash
curl -sS "$BASE/api/v1/context?phone=$PHONE" -H "Authorization: Bearer $TOKEN" \
  | jq '{ok, contato: .data.contact.normalized_phone, conversa: .data.conversation.id, status: .data.conversation.status, ai_may_reply: .data.ai_may_reply}'
CONV=$(curl -sS "$BASE/api/v1/context?phone=$PHONE" -H "Authorization: Bearer $TOKEN" | jq -r .data.conversation.id)
```

Esperado: `200`, `ok: true`, o telefone sem o 55 (`27999990000`), um id de conversa, `status: "bot"` e `ai_may_reply: true`.

**Passo 2. Abrir ticket com `Idempotency-Key`; repetir não cria outro.**

```bash
CHAVE=$(uuidgen)
abrir() {
  curl -sS -D - -X POST "$BASE/api/v1/tickets" \
    -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    -H "Idempotency-Key: $CHAVE" \
    -d "{\"conversation_id\":\"$CONV\",\"title\":\"Sistema travando\",\"priority\":\"alta\"}"
}
abrir                      # 1ª vez
abrir                      # repetição
TICKET=$(curl -sS "$BASE/api/v1/tickets?conversation_id=$CONV" -H "Authorization: Bearer $TOKEN" | jq -r '.data[0].id')
curl -sS "$BASE/api/v1/tickets?conversation_id=$CONV" -H "Authorization: Bearer $TOKEN" | jq '.data | length'
```

Esperado:

- 1ª chamada: `HTTP/1.1 201`, cabeçalho `ETag: W/"<n>"`, `data.status: "novo"`, `data.source: "ai"`;
- repetição: `HTTP/1.1 201`, cabeçalho `Idempotent-Replayed: true`, o mesmo `data.id`, sem `ETag`;
- a contagem final: `1`.

**Passo 3. Transição inválida.**

```bash
ETAG=$(curl -sS -D - -o /dev/null "$BASE/api/v1/tickets/$TICKET" -H "Authorization: Bearer $TOKEN" | grep -i '^etag:' | cut -d' ' -f2- | tr -d '\r')
curl -sS -X POST "$BASE/api/v1/tickets/$TICKET/transitions" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -H "If-Match: $ETAG" \
  -d '{"to":"resolvido"}' | jq .error
```

Esperado: `409`, `code: "invalid_transition"`, `current: "novo"` e `allowed` com `em_triagem`, `em_atendimento`, `aguardando_cliente`, `aguardando_interno` e `cancelado`.

**Passo 4. A IA responde; a mensagem fica como "IA".**

```bash
curl -sS -X POST "$BASE/api/v1/conversations/$CONV/messages" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -H "Idempotency-Key: $(uuidgen)" \
  -d '{"text":"Olá! Registrei o seu chamado e já estou verificando."}' \
  | jq '{ok, sender_type: .data.sender_type, autor: .data.sent_by_token_id, entrega: .data.delivery_status}'
echo "esperado como autor: $TOKEN_ID"
```

Esperado: `201`, `sender_type: "ai"`, `autor` igual ao `TOKEN_ID`, `entrega: "sent"`. O terminal do provedor de mentira mostra `provedor recebeu: /send/text`. No chat do CRM a mensagem aparece como da IA.

**Passo 5. Handoff.**

```bash
curl -sS -X POST "$BASE/api/v1/conversations/$CONV/handoff" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -H "Idempotency-Key: $(uuidgen)" \
  -d '{"reason":"Cliente pediu um analista.","summary":"Sistema travando desde hoje cedo."}' | jq .data
```

Esperado: `200`, `status: "human"`, `changed: true`, `ticket_id` igual ao `TICKET` (é o ticket em foco) e um `note_id`. No chat, a conversa passa para "humano" e a nota interna aparece.

**Passo 6. Com a conversa em `human`, o envio da IA é recusado.**

```bash
curl -sS -X POST "$BASE/api/v1/conversations/$CONV/messages" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -H "Idempotency-Key: $(uuidgen)" \
  -d '{"text":"Esta mensagem não pode sair."}' | jq .error
curl -sS "$BASE/api/v1/context?phone=$PHONE" -H "Authorization: Bearer $TOKEN" | jq .data.ai_may_reply
```

Esperado: `409`, `code: "conversation_not_owned_by_ai"`, `current: "human"`. O provedor de mentira não recebe nada. O `/context` responde `ai_may_reply: false`.

**Passo 7. Resolver o ticket.** A matriz não vai de `novo` direto a `resolvido`: passa por `em_atendimento`.

```bash
mover() {
  local etag
  etag=$(curl -sS -D - -o /dev/null "$BASE/api/v1/tickets/$TICKET" -H "Authorization: Bearer $TOKEN" | grep -i '^etag:' | cut -d' ' -f2- | tr -d '\r')
  curl -sS -X POST "$BASE/api/v1/tickets/$TICKET/transitions" \
    -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -H "If-Match: $etag" \
    -d "{\"to\":\"$1\"}" | jq '{ok, from: .data.from, to: .data.to, changed: .data.changed, resolved_at: .data.ticket.resolved_at}'
}
mover em_atendimento
mover resolvido
```

Esperado: `200` nas duas; `novo → em_atendimento` e depois `em_atendimento → resolvido`, `changed: true`, e `resolved_at` preenchido na segunda.

**Passo 8. Falta de escopo e token vencido.**

```bash
curl -sS "$BASE/api/v1/me" -H "Authorization: Bearer $TOKEN_SEM" | jq .data.token.scopes
curl -sS "$BASE/api/v1/context?phone=$PHONE" -H "Authorization: Bearer $TOKEN_SEM" | jq .error
# o token "roteiro-vence" foi criado com 2 minutos de validade; espere passar, se preciso
curl -sS "$BASE/api/v1/me" -H "Authorization: Bearer $TOKEN_VENCE" | jq .error
```

Esperado:

- `/me` com o token sem escopo: `200` e `[]`;
- `/context` com ele: `403`, `code: "insufficient_scope"`, `required: ["context:read"]`;
- `/me` com o token vencido: `401`, `code: "token_expired"`.

### 6.3 Limpeza

```bash
for id in "$TOKEN_ID" "$TOKEN_SEM_ID" "$TOKEN_VENCE_ID"; do
  curl -sS -b "$JAR" -X DELETE "$BASE/api/api-tokens/$id" | jq .ok
done
$PSQL -c "update public.chat_integrations set config = jsonb_set(config, '{apiUrl}', '\"https://demo.invalid\"') where provider = 'uazapi';"
rm -f "$JAR"
```

Depois, pare o provedor de mentira. O ticket e a conversa de teste ficam no banco local: ticket não se apaga, e conversa com ticket também não.

Anote no `PROGRESS.md` a saída de cada passo, como ela saiu.
