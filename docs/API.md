# Referência de API — CRM Suporte

Este documento descreve as rotas HTTP do CRM Suporte como estão no código. Ele serve a dois públicos:

- **Quem integra outro sistema ou um agente de IA:** leia as seções 1 a 3. O guia prático do agente de triagem está em [`GUIA-AGENTE-IA.md`](GUIA-AGENTE-IA.md).
- **Quem desenvolve o próprio CRM:** as seções 4 e 5 listam as rotas da tela e o webhook do WhatsApp.

**Referência completa da API v1:** `GET /api/v1/openapi.json`. É o contrato publicado (OpenAPI 3.1), gerado de `src/lib/api/v1/openapi.ts`, com todos os campos, tipos e respostas. Este documento não repete cada schema: ele explica as regras que valem para todas as rotas.

## 1. Como a API se organiza

Há três famílias de rotas. Cada uma tem a sua autenticação.

| Família | Caminho | Quem chama | Autenticação |
|---|---|---|---|
| API v1 | `/api/v1/*` | integradores e o agente de IA | `Authorization: Bearer <token>`, com escopos |
| Rotas da tela | `/api/*` (fora das outras duas) | o próprio app, no navegador | cookie de sessão `crm-suporte-session` |
| Webhook do WhatsApp | `/api/chat/webhook/uazapi` | o provedor de WhatsApp (uazapi) | segredo próprio na query (`?s=`) |

Só a API v1 é contrato para quem está fora do CRM. As rotas da tela mudam junto com a tela e não têm compromisso de compatibilidade.

O caminho inverso, do CRM para o agente (o repasse de cada mensagem do cliente), está em [`CONTRATO-RELAY.md`](CONTRATO-RELAY.md).

Os eventos de ticket que o CRM envia a sistemas de fora (webhooks de saída, assinados com HMAC) estão em [`CONTRATO-WEBHOOKS.md`](CONTRATO-WEBHOOKS.md).

## 2. API v1: regras gerais

### 2.1 Autenticação

- Envie `Authorization: Bearer <token>` em toda chamada.
- O token é criado por um administrador em **Integrações › API do CRM** (`/app/conexao?aba=api`). Ele aparece **uma vez só**, na criação: o CRM guarda apenas o hash.
- Cada token tem nome, escopos, tipo (`ai` para o agente de IA, `api` para outra integração), limite por minuto e, se quiser, validade.
- Sem o cabeçalho, ou com token inválido ou revogado: `401 unauthorized`. Token vencido: `401 token_expired`.
- Token válido sem o escopo da rota: `403 insufficient_scope`, com a lista do que faltou em `error.required`.
- Numa escrita, se o token for revogado ou vencer durante a chamada, a resposta é `403 forbidden`.

O tipo do token decide a autoria:

- ticket aberto por token `ai` tem origem `ai`; por token `api`, origem `api`;
- mensagem enviada por token `ai` fica com `sender_type: "ai"`; por token `api`, com `sender_type: "system"`.

### 2.2 Escopos

O formato é `recurso:acao`. `recurso:*` no token cobre todas as ações do recurso, as de hoje e as que vierem.

| Escopo | O que libera |
|---|---|
| `context:read` | `GET /context` |
| `contacts:read` | ler contatos (`GET /contacts`, `GET /contacts/{id}`) |
| `contacts:write` | achar ou criar contato (`POST /contacts`) e editar (`PATCH /contacts/{id}`) |
| `customers:read` | ler empresas e o contrato atual |
| `customers:write` | existe no catálogo; nenhuma rota da v1 o exige hoje |
| `catalog:read` | filas, categorias, status, políticas de SLA e equipe |
| `tickets:read` | ler tickets e a timeline do ticket (trilha e anexos) |
| `tickets:write` | abrir, alterar, mudar status, atribuir e escolher o ticket em foco da conversa |
| `comments:read` | ver comentários internos na timeline e notas internas nas mensagens da conversa |
| `comments:write` | comentar no ticket (comentário interno) |
| `attachments:read` | pegar o link de um anexo |
| `attachments:write` | anexar arquivo ao ticket |
| `conversations:read` | ler a conversa e as mensagens dela; ver as mensagens na timeline do ticket |
| `conversations:handoff` | passar a conversa da IA para um humano |
| `messages:send` | enviar texto ao cliente pelo WhatsApp |
| `notices:claim` | reservado para a Fase 6; nenhuma rota o exige hoje |

**Preset "IA de triagem".** Na criação do token, é a opção de acesso "IA de triagem"; na edição, o botão "Aplicar IA de triagem". O preset grava o tipo `ai`, o limite de 300 por minuto e estes escopos: `context:read`, `contacts:read`, `contacts:write`, `customers:read`, `catalog:read`, `tickets:read`, `tickets:write`, `comments:write`, `attachments:write`, `conversations:read`, `messages:send` e `conversations:handoff`.

Ficam fora do preset, de propósito:

- `customers:write`: cadastro de empresa é tarefa do analista;
- `comments:read`: a IA escreve comentário interno, mas não lê comentário nem nota interna do time, para não ter como repeti-los ao cliente;
- `attachments:read`: a IA anexa, mas não baixa anexo;
- `notices:claim`: é da Fase 6.

Dois casos em que um escopo depende de outro:

- `GET /tickets` com `q` também procura no nome do contato e na empresa, e por isso exige `contacts:read` e `customers:read` além de `tickets:read`. Sem eles: `403 insufficient_scope`.
- Na timeline do ticket e nas mensagens da conversa, item de outro recurso só aparece com o escopo dele. Sem o escopo, o item some da lista (não é erro).

### 2.3 Limite de requisições

- **Por token:** o "limite por minuto" do token. O padrão é 120; o preset da IA grava 300.
- **Por IP:** 1.200 por minuto, conferido antes de olhar o token.
- **Envio de mensagem:** além dos dois, cada token tem um teto por conversa de 20 envios por minuto e 100 por hora.
- Acima do limite: `429 rate_limited`, com `Retry-After` em segundos.
- Os contadores ficam na memória de cada processo do servidor. Com mais de uma instância, o limite é aproximado.

### 2.4 Respostas e envelope de erro

Sucesso:

```json
{ "ok": true, "data": { } }
```

Lista com cursor:

```json
{ "ok": true, "data": [ ], "meta": { "next_cursor": "..." } }
```

Erro:

```json
{
  "ok": false,
  "error": { "code": "validation_error", "message": "Revise os campos.", "fields": { "title": "Use ao menos 3 caracteres." } },
  "request_id": "5f0c2a8e-..."
}
```

- `error.code` é estável, em inglês. Decida pelo código, nunca pela mensagem.
- `error.message` é para gente ler, em português.
- Campos extras, quando o erro pede: `fields` (campo → mensagem), `allowed` (valores permitidos), `required` (escopos que faltaram), `current` (o estado que decidiu o erro) e `current_version` (versão atual do ticket, no 412).
- Toda resposta da v1, de sucesso ou de erro, traz o cabeçalho `X-Request-Id`. Guarde-o no seu log e informe-o ao suporte: é por ele que o CRM acha a chamada no registro de integrações.
- 404 de recurso inexistente vem no envelope (`not_found`). Id que não é UUID também é `not_found`. Caminho que não existe e método não aceito (404 e 405) vêm do servidor, sem o envelope.

Códigos comuns a várias rotas:

| Status | Código | Quando |
|---|---|---|
| 400 | `validation_error` | parâmetro ou campo inválido, campo desconhecido no corpo, ou nada para alterar |
| 400 | `invalid_json` | corpo que não é JSON válido |
| 400 | `idempotency_key_required`, `invalid_idempotency_key` | falta a `Idempotency-Key`, ou o formato está errado |
| 400 | `invalid_if_match` | `If-Match` em formato que não é o ETag do ticket |
| 400 | `invalid_multipart` | multipart que o servidor não conseguiu ler (anexo) |
| 401 | `unauthorized`, `token_expired` | ver 2.1 |
| 403 | `insufficient_scope`, `forbidden` | ver 2.1 |
| 404 | `not_found` | o recurso não existe |
| 409 | `idempotency_in_progress` | a mesma chave ainda está em andamento |
| 412 | `version_conflict` | o ticket mudou desde a versão do `If-Match` |
| 413 | `payload_too_large` | corpo acima do limite |
| 415 | `unsupported_media_type` | tipo de corpo errado numa rota com `Idempotency-Key` |
| 422 | `idempotency_key_reused` | a chave já foi usada com outra requisição |
| 428 | `precondition_required` | falta o `If-Match` |
| 429 | `rate_limited` | ver 2.3 |
| 500 | `internal_error` | falha do CRM; informe o `request_id` |
| 503 | `unavailable` | o CRM não conseguiu ler agora; vem com `Retry-After` |

Cada rota tem também os códigos de negócio dela (por exemplo `invalid_transition`, `ticket_terminal`, `conversation_not_owned_by_ai`, `whatsapp_unavailable`). A lista de cada uma está no OpenAPI.

Uma leitura que falha no banco responde `503 unavailable`, nunca uma lista vazia: vazio seria lido como "não há nada".

### 2.5 Idempotência (`Idempotency-Key`)

Toda rota `POST` que cria algo exige o cabeçalho `Idempotency-Key`:

- `POST /contacts`
- `POST /tickets`
- `POST /tickets/{ref}/comments`
- `POST /tickets/{ref}/attachments`
- `POST /conversations/{id}/messages`
- `POST /conversations/{id}/handoff`

Regras:

- **Formato:** 8 a 200 caracteres entre letras, dígitos e `. _ : -`. Um UUID novo por operação serve.
- **Escopo da chave:** é por token. Vale para o método e o caminho exatos, sem a query: repita pelo mesmo caminho (o mesmo `ref`, id ou protocolo).
- **Repetição igual:** a mesma chave com a mesma requisição devolve a resposta guardada, com o mesmo status e o cabeçalho `Idempotent-Replayed: true`. Nada é gravado de novo. O `X-Request-Id` da repetição é novo.
- **Corpo comparado:** o JSON é comparado depois de ordenar as chaves; espaço e ordem não contam. No anexo, compara-se cada parte do multipart (nome, tipo, tamanho e o conteúdo do arquivo), e não os bytes crus.
- **Mesma chave, outra requisição:** `422 idempotency_key_reused`.
- **Chave em andamento:** `409 idempotency_in_progress`. A reserva dura 5 minutos; depois disso, outra tentativa assume.
- **O que fica guardado:** só respostas `2xx` e `422`. Outra resposta (`4xx` restantes, `5xx`) libera a chave, e a mesma chave pode tentar de novo.
- **Validade:** 24 horas a partir do primeiro uso. Depois disso a chave vale como nova.

`POST /tickets` e `POST /conversations/{id}/messages` têm uma segunda camada, gravada no próprio registro: ela cobre o servidor que cai entre gravar e responder. Os detalhes estão na descrição de cada rota no OpenAPI.

`PATCH`, `PUT` e os `POST` de transição e de atribuição não usam `Idempotency-Key`: repetir com o mesmo valor é um no-op (`changed: false`).

### 2.6 Concorrência no ticket (`If-Match` e `ETag`)

- `GET /tickets/{ref}` e toda escrita num ticket devolvem `ETag: W/"<version>"`. A versão também está em `data.version` (ou `data.ticket.version`).
- `PATCH /tickets/{ref}`, `POST /tickets/{ref}/transitions` e `POST /tickets/{ref}/assign` exigem `If-Match` com esse valor. `W/"3"` e `"3"` são aceitos. `*` e lista de ETags não são.
- Sem `If-Match`: `428 precondition_required`.
- Versão velha: `412 version_conflict`, com `current_version` e o `ETag` atual. Leia o ticket de novo e repita.
- O mesmo valor de novo é no-op **antes** de conferir a versão: repetir uma escrita que já valeu responde `200` com `changed: false`, e não 412.
- Numa repetição de `POST /tickets` (`Idempotent-Replayed: true`) o `ETag` não vem: use `data.version`.

### 2.7 Listas e paginação por cursor

`GET /contacts`, `GET /customers` e `GET /tickets`:

- ordem de `updated_at` crescente, com desempate por `id`;
- `limit`: 1 a 200, padrão 50;
- `cursor`: o `meta.next_cursor` da página anterior. É opaco: não monte à mão. `null` quer dizer que acabou. Cursor inválido é `400`;
- `updated_since`: só o que mudou a partir deste instante (ISO 8601 com fuso, ex.: `2026-10-01T12:00:00Z`);
- `include_archived=true`: inclui os arquivados. Vale para contatos e empresas. Ticket não se arquiva, e a lista de tickets não aceita o parâmetro.

`updated_at` não é estritamente crescente: a mesma linha pode voltar numa página seguinte. Para sincronizar, deduplique por `id` e repita com `updated_since` igual ao maior `updated_at` visto menos uma folga (ex.: 5 minutos).

Duas listas andam ao contrário, da mais nova para a mais antiga:

- `GET /conversations/{id}/messages`: aceita `cursor` e `limit` (1 a 200, padrão 50);
- `GET /tickets/{ref}/timeline`: aceita só `cursor`; cada página traz cerca de 100 itens.

Nelas, o cursor leva a itens mais antigos. Para ver o que chegou depois, leia de novo sem cursor e deduplique por `id`.

Os catálogos (`/products`, `/ticket-categories`, `/ticket-statuses`, `/sla-policies`, `/users`) voltam inteiros, sem paginação.

Nas listas e em `GET /context`, parâmetro desconhecido na query é `400 validation_error`, com o nome dele em `fields`.

### 2.8 Corpo da requisição

- O corpo é JSON, com `Content-Type: application/json`. A única exceção é o anexo, em `multipart/form-data`.
- Nas rotas com `Idempotency-Key`, um corpo de outro tipo é `415 unsupported_media_type`, recusado sem ler o corpo.
- Campo que a rota não conhece é `400 validation_error`, com o nome dele em `fields` (`"Campo não aceito."`). Um nome errado nunca passa em silêncio.
- **Limite:** 1 MB por padrão; no anexo, 50 MB para o arquivo. Acima disso: `413 payload_too_large`. O servidor web tem um teto próprio maior; acima dele, o 413 vem sem o envelope.
- Texto é aparado nas pontas antes de validar. Os limites de tamanho contam unidades UTF-16, e não caracteres: um emoji comum conta 2.
- Texto com o caractere NUL, ou com metade de um par UTF-16, é recusado.

### 2.9 Rotas públicas

Só duas rotas dispensam token (decisão D14 do plano da Fase 5):

- `GET /api/v1/health`: responde `{ "ok": true, "data": { "status": "ok", "api_version": "v1" } }`. Não consulta o banco nem revela nada.
- `GET /api/v1/openapi.json`: o contrato da API, sem dado nenhum.

As duas têm só o limite por IP. `GET /api/v1/me` exige token, mas aceita qualquer token válido, mesmo sem escopo: é como o integrador confere o token.

### 2.10 O que o contrato publicado garante

- Mudanças na v1 são aditivas: campos novos podem aparecer nas respostas sem mudar a versão. Remover um campo ou mudar o tipo dele só acontece numa versão nova.
- **Os schemas de resposta do OpenAPI são fechados** (`additionalProperties: false`), porque descrevem exatamente o que a versão atual devolve. Não valide a resposta contra eles em modo estrito: um campo novo faria o seu cliente recusar uma resposta válida. Ignore os campos que não conhece.
- O `pattern` de UUID do OpenAPI só tem letras minúsculas. A API aceita UUID em maiúsculas ou minúsculas e sempre devolve em minúsculas.
- Campo que não está no OpenAPI não é contrato, mesmo que apareça numa resposta.

## 3. API v1: rotas

Todos os caminhos começam com `/api/v1`. `{ref}` de ticket é o id (UUID) ou o protocolo, só o número (ex.: `1024`).

| Método | Caminho | Escopo | O que faz |
|---|---|---|---|
| GET | `/health` | público | diz que a API responde |
| GET | `/openapi.json` | público | o contrato OpenAPI 3.1 |
| GET | `/me` | qualquer token | o token da chamada: nome, prefixo, escopos, tipo, limite e validade |
| GET | `/products` | `catalog:read` | filas (produtos) ativas, por nome |
| GET | `/ticket-categories` | `catalog:read` | categorias que um ticket novo pode receber |
| GET | `/ticket-statuses` | `catalog:read` | status na ordem do quadro, com os destinos permitidos de cada um |
| GET | `/sla-policies` | `catalog:read` | prioridades com os prazos de SLA |
| GET | `/users` | `catalog:read` | quem pode receber ticket (ativos), só id e nome |
| GET | `/context?phone=` | `context:read` | tudo o que a IA precisa para triar, pelo telefone |
| GET | `/contacts` | `contacts:read` | contatos, com cursor; filtros `q`, `phone`, `customer_id` |
| POST | `/contacts` | `contacts:write` | acha a pessoa pelo telefone ou a cria (201 criado, 200 já existia) |
| GET | `/contacts/{id}` | `contacts:read` | um contato, arquivado inclusive |
| PATCH | `/contacts/{id}` | `contacts:write` | altera nome, e-mail, observações e empresa; o telefone é imutável |
| GET | `/customers` | `customers:read` | empresas, com cursor; filtros `q` e `cnpj` |
| GET | `/customers/{id}` | `customers:read` | uma empresa, arquivada inclusive |
| GET | `/customers/{id}/contract` | `customers:read` | o contrato atual, sem valor nem dia de vencimento; `data: null` se nunca teve |
| GET | `/tickets` | `tickets:read` | tickets, com cursor e filtros (`q` exige também `contacts:read` e `customers:read`) |
| POST | `/tickets` | `tickets:write` | abre um ticket na conversa; ele vira o foco da conversa |
| GET | `/tickets/{ref}` | `tickets:read` | um ticket, com o `ETag` da versão |
| PATCH | `/tickets/{ref}` | `tickets:write` | altera título, descrição, prioridade, fila, categoria e empresa (exige `If-Match`) |
| POST | `/tickets/{ref}/transitions` | `tickets:write` | muda o status pela matriz (exige `If-Match`) |
| POST | `/tickets/{ref}/assign` | `tickets:write` | troca ou tira o responsável (exige `If-Match`) |
| POST | `/tickets/{ref}/comments` | `comments:write` | comentário interno, com o token como autor |
| POST | `/tickets/{ref}/attachments` | `attachments:write` | anexa um arquivo (multipart, campo `file`, até 50 MB) |
| GET | `/tickets/{ref}/attachments/{attachment_id}` | `attachments:read` | link assinado do arquivo, válido por 10 minutos |
| GET | `/tickets/{ref}/timeline` | `tickets:read` | a timeline do ticket, da mais nova para a mais antiga |
| POST | `/tickets/{ref}/notices/{step}/claim` | `notices:claim` | reivindica um aviso ao cliente antes de mandá-lo; só `claimed: true` autoriza o envio |
| POST | `/tickets/{ref}/notices/{step}/finalize` | `notices:claim` | fecha a reivindicação: `sent` (não sai de novo) ou `failed` (volta a ser reivindicável) |
| GET | `/conversations/{id}` | `conversations:read` | a conversa: quem conduz, o ticket em foco e o contato |
| GET | `/conversations/{id}/messages` | `conversations:read` | as mensagens, da mais nova para a mais antiga |
| POST | `/conversations/{id}/messages` | `messages:send` | envia um texto ao cliente pelo WhatsApp |
| POST | `/conversations/{id}/handoff` | `conversations:handoff` | passa a conversa da IA para um humano |
| PUT | `/conversations/{id}/active-ticket` | `tickets:write` | escolhe o ticket em foco da conversa (`null` tira o foco) |

Pontos que costumam surpreender:

- **`POST /conversations/{id}/messages`** só aceita texto (`text`, até 4.096 unidades). O CRM não acrescenta assinatura nem altera o texto. Token `ai` só envia com a conversa em `bot`; fora disso, `409 conversation_not_owned_by_ai`. `502 whatsapp_unavailable` quer dizer que a mensagem não saiu, e a mesma chave tenta de novo. `504 delivery_unknown` quer dizer que ela pode ter saído: repita com a mesma chave só para saber o desfecho.
- **`POST /conversations/{id}/handoff`** em conversa que já está com um humano responde `200` com `changed: false`, e aí `ticket_id` e `note_id` vêm `null`. Em conversa encerrada (`resolved`): `409 conversation_not_owned_by_ai`.
- **`PUT /conversations/{id}/active-ticket`** e o handoff devolvem o resultado da operação, e não a conversa. Para lê-la, `GET /conversations/{id}`.
- **`POST /tickets/{ref}/transitions`** fora da matriz: `409 invalid_transition`, com `allowed` e `current`. Cancelar exige `reason`. A matriz é fixa; `GET /ticket-statuses` a mostra.
- **Avisos ao cliente (`/notices/{step}/claim` e `/finalize`):** o claim responde `200` também quando recusa (`claimed: false`, com `reason`: `already_sent` ou `in_progress`). Ele não aceita `Idempotency-Key` de propósito: repetir a resposta daria `claimed: true` a duas entregas do mesmo evento. Se a resposta do claim se perder, a lease (2 min por padrão) segura o passo, e depois ele volta a ser reivindicável: o aviso atrasa, mas não duplica. No finalize, `409 notice_claim_lost` quer dizer que outra reivindicação assumiu o passo (a sua lease venceu): não reenvie. O passo a passo está em [`GUIA-AGENTE-IA.md`](GUIA-AGENTE-IA.md), seção 2.9.
- **Mensagens e timeline não trazem mídia por URL.** A mensagem traz só `media_mime_type`. O anexo do ticket sai por `GET /tickets/{ref}/attachments/{attachment_id}`.
- **`POST /tickets/{ref}/attachments`:** no `Content-Disposition` da parte, `name="file"` e `filename="..."` vão entre aspas, sem `filename*`. É o padrão do curl, do `requests` do Python e do n8n. O `HttpClient` do .NET, no padrão, manda sem aspas e com `filename*`, e recebe `400 invalid_multipart`: monte o cabeçalho da parte à mão.

## 4. Rotas da tela (sessão)

Estas rotas existem para o app. Não são contrato de integração: o formato muda com a tela, e a resposta segue o envelope de cada rota (em geral `{ "ok": ..., "message": ... }`).

### 4.1 Regras que valem para todas

- **Sessão:** cookie `crm-suporte-session`, um JWT assinado pelo próprio CRM (não é Supabase Auth). Sem cookie válido, o proxy responde `401`.
- **Usuário confirmado no banco:** cada rota confere, antes de ler o corpo, se o usuário ainda está ativo (e, nas de administrador, se ainda é `admin`). Um cookie de usuário desativado não passa.
- **Escrita só da própria origem:** todo `POST`, `PUT`, `PATCH` e `DELETE` vindo de outra origem é recusado com `403` e `error: "cross_origin"`, antes de chegar à rota. O webhook do WhatsApp e a API v1 ficam fora dessa trava, porque não usam o cookie.
- **Rota que muda estado nunca é `GET`.** A trava de origem só cobre escrita.
- Papéis: `admin` e `member`. "Admin" na lista abaixo quer dizer que a rota recusa `member` com `403`.

### 4.2 Lista por área

**Autenticação**

| Método | Caminho | O que faz |
|---|---|---|
| POST | `/api/auth/login` | confere e-mail e senha e grava o cookie de sessão |
| POST | `/api/auth/logout` | apaga o cookie |
| GET | `/api/auth/logout` | apaga o cookie e redireciona para `/login` (usado quando o usuário da sessão não vale mais) |
| POST | `/api/auth/definir-senha` | define a senha no primeiro acesso ou depois de um reset |
| GET | `/api/auth/supabase-token` | emite o JWT curto (15 min) que o navegador usa no Realtime do chat |

**Chat**

| Método | Caminho | O que faz |
|---|---|---|
| GET | `/api/chat/conversations` | lista de conversas |
| POST | `/api/chat/conversations/start` | inicia uma conversa por telefone |
| GET | `/api/chat/conversations/tags` | etiquetas do chat e seus vínculos |
| GET, PATCH, DELETE | `/api/chat/conversations/[id]` | mensagens da conversa; status (`bot`, `human`, `resolved`) e ações (lida, arquivar, fixar); apagar ou limpar a conversa |
| GET | `/api/chat/conversations/[id]/contact` | cadastro da pessoa da conversa, com a empresa |
| PUT | `/api/chat/conversations/[id]/active-ticket` | escolhe o ticket em foco |
| POST | `/api/chat/conversations/[id]/send` | envia texto |
| POST | `/api/chat/conversations/[id]/send-file` | envia arquivo |
| POST | `/api/chat/conversations/[id]/send-audio` | envia áudio |
| POST | `/api/chat/conversations/[id]/forward` | encaminha uma mensagem |
| GET | `/api/chat/conversations/[id]/search` | busca dentro da conversa |
| PATCH, DELETE | `/api/chat/conversations/[id]/messages/[messageId]` | edita ou apaga uma mensagem enviada |
| POST, DELETE | `/api/chat/conversations/[id]/tags` | põe ou tira etiqueta da conversa |
| GET | `/api/chat/media/[id]` | mídia de uma mensagem, por URL assinada curta |
| POST | `/api/chat/transcribe` | transcreve um áudio |

**Integrações (admin)**

| Método | Caminho | O que faz |
|---|---|---|
| POST | `/api/connection/persist` | grava as credenciais da instância do WhatsApp e registra o webhook |
| POST | `/api/connection/qr` | pede o QR code de conexão |
| GET | `/api/connection/state` | estado da conexão, sem pedir QR |
| POST | `/api/connection/disconnect` | desconecta; opcionalmente apaga o histórico ou a instância |
| GET | `/api/connection/logs` | registros de integração (API v1, repasse e a trilha dos webhooks), com filtros na URL e cursor |
| GET | `/api/connection/health` | saúde das integrações: WhatsApp, última mensagem recebida e contagens das últimas 24 h |
| POST | `/api/connection/agent/test` | envia um `webhook.ping` ao endereço salvo do agente |
| POST, DELETE | `/api/connection/agent/signing-secret` | gera (mostra uma vez) ou remove a chave de assinatura do repasse |
| GET, PATCH | `/api/settings/automation` | endereço do agente (repasse); vazio desliga |
| GET, PATCH | `/api/settings/bot-signature` | configuração da assinatura das mensagens da IA |
| POST, DELETE | `/api/settings/environment-variables` | variáveis do cofre (aba Variáveis) |
| GET, POST | `/api/webhooks` | destinos de webhook; cadastrar gera o segredo e o mostra uma vez |
| PATCH, DELETE | `/api/webhooks/[id]` | altera (nome, URL, eventos, pausa) ou exclui o destino |
| POST | `/api/webhooks/[id]/secret` | troca o segredo do destino (o novo aparece uma vez) |
| POST | `/api/webhooks/[id]/ping` | envia um `webhook.ping` assinado ao destino, na hora |
| GET | `/api/webhooks/deliveries` | entregas mais recentes, por destino e status |
| POST | `/api/webhooks/deliveries/[id]/requeue` | devolve à fila uma entrega que esgotou as tentativas |

**Tokens da API v1 (admin)**

| Método | Caminho | O que faz |
|---|---|---|
| GET | `/api/api-tokens` | lista os tokens (nunca o token nem o hash) |
| POST | `/api/api-tokens` | cria um token e devolve o texto dele uma única vez |
| PATCH | `/api/api-tokens/[id]` | altera nome, escopos, tipo, limite ou validade |
| DELETE | `/api/api-tokens/[id]` | revoga o token |

**Tickets**

| Método | Caminho | O que faz |
|---|---|---|
| GET, POST | `/api/tickets` | tickets abertos da conversa e o foco; abre ticket |
| GET | `/api/tickets/catalog` | catálogo para a tela: status, matriz de transições, prioridades com SLA, filas e categorias |
| PATCH | `/api/tickets/[id]` | altera o ticket |
| POST | `/api/tickets/[id]/transition` | muda o status |
| POST | `/api/tickets/[id]/assign` | troca o responsável |
| POST | `/api/tickets/[id]/take-over` | "Assumir": conversa com humano, ticket em foco e responsável de uma vez |
| GET | `/api/tickets/[id]/timeline` | timeline do ticket |
| POST | `/api/tickets/[id]/comments` | comentário interno |
| PATCH, DELETE | `/api/tickets/[id]/comments/[commentId]` | edita ou apaga um comentário |
| POST | `/api/tickets/[id]/attachments` | anexa arquivo |
| GET | `/api/tickets/[id]/attachments/[attachmentId]` | link do anexo |

**Configurações de atendimento (admin)**

| Método | Caminho | O que faz |
|---|---|---|
| POST | `/api/products` | cria fila (produto) |
| PATCH | `/api/products/[id]` | altera fila |
| POST | `/api/ticket-categories` | cria categoria |
| PATCH | `/api/ticket-categories/[id]` | altera categoria |
| PATCH | `/api/ticket-statuses/[key]` | altera rótulo e cor de um status |
| PATCH | `/api/sla-policies/[priority]` | altera os prazos de uma prioridade |

**Clientes, contatos e contratos**

| Método | Caminho | O que faz | Papel |
|---|---|---|---|
| GET, POST | `/api/customers` | opções do seletor de empresa; cria empresa | todos |
| PATCH | `/api/customers/[id]` | edita empresa | todos |
| DELETE | `/api/customers/[id]` | arquiva empresa | admin |
| POST | `/api/customers/[id]/restore` | reativa empresa | admin |
| POST | `/api/contacts` | cria contato | todos |
| PATCH, DELETE | `/api/contacts/[id]` | edita ou arquiva contato (o telefone é imutável) | todos |
| GET | `/api/contacts/[id]/avatar` | foto do contato | todos |
| POST | `/api/contracts` | cria contrato | admin |
| PATCH | `/api/contracts/[id]` | edita contrato | admin |
| POST | `/api/contracts/[id]/status` | ativa, suspende ou encerra contrato | admin |
| POST | `/api/support-plans` | cria plano (rótulo do contrato) | admin |

**Equipe e usuário**

| Método | Caminho | O que faz | Papel |
|---|---|---|---|
| GET | `/api/app-users` | equipe ativa (id e nome) e o usuário logado | todos |
| POST | `/api/users` | adiciona usuário | admin |
| PATCH | `/api/users/[id]` | altera usuário | admin, ou o próprio usuário no próprio perfil |
| DELETE | `/api/users/[id]` | exclui usuário (nunca a própria conta) | admin |
| POST | `/api/users/[id]/reset-password` | troca a senha do usuário | admin, ou o próprio usuário |
| POST, DELETE | `/api/users/[id]/avatar` | troca ou tira a foto | admin, ou o próprio usuário |

**Etiquetas, respostas rápidas e notas**

| Método | Caminho | O que faz |
|---|---|---|
| GET, POST | `/api/tags` | lista e cria etiquetas |
| PATCH, DELETE | `/api/tags/[id]` | altera ou apaga etiqueta |
| GET, POST | `/api/quick-replies` | lista e cria respostas rápidas |
| PATCH, DELETE | `/api/quick-replies/[id]` | altera ou apaga resposta rápida |
| GET, POST, PUT | `/api/notes` | notas da tela de Início do usuário logado e o lembrete rápido |
| PATCH, DELETE | `/api/notes/[id]` | altera ou apaga nota |
| PUT | `/api/notes/reorder` | grava a ordem das notas |

## 5. Webhook de entrada do WhatsApp

`POST /api/chat/webhook/uazapi?s=<segredo>`

- **Quem chama:** o provedor de WhatsApp (uazapi). O endereço é registrado pelo CRM quando um administrador conecta a instância em **Integrações › WhatsApp**, com os eventos `messages` e `messages_update`.
- **Autenticação:** o segredo vai na query (`?s=`), porque o provedor não envia cabeçalho próprio. Ele é gerado na conexão, guardado no cofre do banco e comparado em tempo constante antes de ler o corpo. Sem integração, sem segredo ou com segredo errado, a resposta é sempre a mesma: `401`.
- **Fora da sessão e da trava de origem:** a rota não lê o cookie.

O que a rota faz com cada evento:

| Evento | Efeito |
|---|---|
| `messages_update` com exclusão | marca a mensagem como apagada e limpa o conteúdo |
| `messages_update` com mídia baixada | guarda o arquivo no armazenamento privado e o liga à mensagem (grupos são ignorados) |
| `messages_update` com status | atualiza entregue e lido, sem nunca regredir |
| `messages` que é eco de mensagem enviada pelo CRM | concilia com a mensagem já gravada, sem duplicar |
| `messages` nova (do cliente ou do celular da empresa) | acha ou cria o contato pelo telefone, grava a mensagem na conversa e guarda a mídia |
| grupo, ou evento que não reconhece | ignora e responde `200` |

**O que repassa ao agente:** só mensagem **nova**, **do cliente** (`inbound`), com a conversa em `bot`. O repasse sai depois da resposta ao provedor, uma vez por mensagem, sem nova tentativa. O formato, a assinatura e as regras estão em [`CONTRATO-RELAY.md`](CONTRATO-RELAY.md).

## 6. Onde está cada coisa no código

| Assunto | Arquivo |
|---|---|
| Porta única da v1 (token, escopo, limites, corpo, idempotência, log) | `src/lib/api/v1/with-api.ts` |
| Catálogo de escopos e preset da IA | `src/lib/api/v1/scopes.ts` |
| Envelope de erro | `src/lib/api/v1/errors.ts`, `src/lib/api/v1/responses.ts` |
| Idempotência | `src/lib/api/v1/idempotency.ts` |
| Cursor e parâmetros de lista | `src/lib/api/v1/cursor.ts` |
| `If-Match` e `ETag` | `src/lib/api/v1/if-match.ts`, `src/lib/api/v1/ticket-write.ts` |
| Contrato OpenAPI | `src/lib/api/v1/openapi.ts` |
| Rotas da v1 | `src/app/api/v1/**/route.ts` |
| Sessão e trava de origem | `src/lib/auth/session.ts`, `src/lib/auth/route-guard.ts`, `src/proxy.ts` |
| Webhook do WhatsApp | `src/app/api/chat/webhook/uazapi/route.ts` |
| Webhooks de saída (catálogo, envio, despachante) | `src/features/webhooks/`, `src/lib/jobs/worker.ts` |
