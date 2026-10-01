# Plano de execução: Fase 5 (API v1 + relay)

> Escrito em 2026-09-29 a partir da leitura do código em `origin/main` (191806f), com as decisões do dono na seção 3. Complementa as seções C, D e E do [`PLANO-IMPLANTACAO.md`](PLANO-IMPLANTACAO.md). As referências `arquivo:linha` são da `main` daquele dia e envelhecem: confira antes de editar.

## 1. Estado atual

- **O relay repassava o token da instância ao agente** (corrigido no PR 1). `src/app/api/chat/webhook/uazapi/route.ts:280-284` faz `void fetch(relayUrl, {body: JSON.stringify(payload)})`. O `payload` é o envelope cru lido em `:53`, e o envelope traz `token` na raiz (`normalizers/uazapi.ts:14`; `.claude/skills/uazapi-integration/SKILL.md:93`). O tipo `UazapiEnvelope` (`normalizers/uazapi.ts:107-114`) não declara `token`, então o TS não avisa. O teste `route.test.ts:207-210` fixa `body === JSON.stringify(inbound)`.
- **O relay tem mais três falhas.**
  - Não tem timeout nem log: só `console.warn`, em `route.ts:284`.
  - Não é idempotente: `upsertMessage` (`upsert-message.ts:114-135`, com `ignoreDuplicates`) não diz se inseriu (PROGRESS.md:62, 157, 792).
  - Cai no env `N8N_WEBHOOK_URL` quando a leitura do banco falha (`get-relay-url.ts:18, 29-45`).

  O `docs/GUIA-AGENTE-IA.md:61, 76` manda a IA responder direto pela uazapi com o header `token`.
- **O banco da API já está pronto e não precisa de migration para autenticar.**
  - `api_tokens` já tem `scopes` (padrão `'{}'`, ou seja, token inerte), `expires_at`, `rate_limit_per_min` (padrão 120), `last_used_at` e `revoked_at`, com checks e grant de UPDATE por coluna (`20260925120200_integracao.sql:336-351, 446-449`).
  - `integration_logs` já tem `api_token_id`, `request_id`, `route`, `http_status` e `latency_ms`. É append-only (`:459-533`).
  - Os índices de cursor `(updated_at, id)` existem em `contacts`, `customers` e `tickets`.
- **Tickets já aceitam um token como ator.** `TicketActor {kind:'token'}` está em `ticket-service.ts:50, 104-107`. `require_ticket_actor` recusa token revogado ou vencido (`tickets.sql:646-653`), mas devolve sempre `'api'` (`:655-656`). `updateTicket`, `transitionTicket`, `assignTicket` e `setActiveTicket` já recebem `expectedVersion` (`tickets.version`), o que encaixa no If-Match. `create_ticket` aceita `p_source`, `p_external_id`, `p_ai_triage` e `p_set_active`, mas `createTicket` repassa só 8 argumentos (`ticket-service.ts:157-167`).
- **Peças prontas para reaproveitar:**
  - `hashApiToken`/`generateApiToken` (`api-token.ts:21-34`);
  - `rateLimit` (`rate-limit.ts:12-37`) com o molde de 429 + Retry-After do login (`api/auth/login/route.ts:26-38`);
  - `signStorageObject` (`chat-media.ts:104`); a rota do webhook já tem `stored.bucket`/`stored.key` em mãos;
  - `getConversationTickets`, `getTicketCatalog`, `allowedTargets`, `getTicketTimeline`, `resolveContactIdentity` (aceita `'api'`), `toCustomerSummary`;
  - dedup do envio por `clientId` (`send/route.ts:39-43, 91-116`, com índice único em `chat.sql:289-294`);
  - `ApiTokensManager`, `AutomationSettings`, `EnvironmentVariablesManager` e `IntegrationLogsTable`, esta última órfã.
- **`verify-webhook.ts` não tem chamador.** O único import é o teste. Tem o ramo de env (`:39-42`), não confere `expires_at` nem escopo, e grava `last_used_at` a cada chamada. Só servem o lookup por hash e o `.then()` obrigatório.
- **O que NÃO existe:**
  - `src/app/api/v1/`, `withApi`, `request_id`, envelope de erro v1, leitura de `Idempotency-Key` e de `If-Match`, ETag;
  - catálogo e matcher de escopos, preset "IA de triagem";
  - `api_idempotency_keys` e qualquer RPC de idempotência genérica;
  - coluna que diga se o token é `ai` ou `api`; `chat_messages.sent_by_token_id`; RPC de handoff (zero ocorrências de "handoff" em `src/` e nas migrations);
  - `send-outbound.ts`: o envio de texto está inline em `send/route.ts:80-232`;
  - `'/api/v1/'` em `PUBLIC_API_PREFIXES` (`route-guard.ts:33-36`) e o teste que varre a v1;
  - helper HMAC; segredo do relay; botão "testar"; rotação do segredo do webhook;
  - query real de logs (`get-integration-logs.ts:3-5` devolve `[]`); aba Saúde; abas em `/app/conexao`;
  - `docs/CONTRATO-RELAY.md`. `docs/API.md` e `docs/GUIA-AGENTE-IA.md` ainda descrevem a API da clínica.

## 2. Sequência de PRs

Os PRs sem dependência entre si podem ficar abertos em paralelo, cada um saído da `main`. Quando há dependência, o PR sai da `main` depois do merge do anterior.

**PR 1 + 2 (juntos, `fix/relay-sem-token`): relay sem o token da uazapi, só mensagem nova, com timeout** · back · P · D1 respondida: a IA tem credencial própria

**PR 1: `fix(chat)`, relay sem o token da uazapi** · back · P
- **Objetivo:** o envelope repassado à IA deixa de levar `token`, e o resto fica idêntico. É compatível com a IA atual, a menos que ela leia o token do envelope.
- **Arquivos:**
  - `src/app/api/chat/webhook/uazapi/route.ts:283`: o corpo passa a ser o objeto cru sem a chave `token` na raiz, e o que era o `JSON.stringify(payload)` vira o do objeto filtrado;
  - `route.test.ts:207-210`: o fixture ganha `token`, e o teste afirma que ele não sai e que o resto é igual;
  - nota em `docs/API.md:380` e PROGRESS.
- **Pronto quando:** o teste falha se o `token` voltar ao corpo, e typecheck, lint, test e build passam. O deploy em produção só acontece com autorização literal.

**PR 2: `fix(chat)`, relay só de mensagem nova, com timeout** · back · P · depende do PR 1 (mesmo hotspot)
- **Objetivo:** um retry da uazapi deixa de gerar uma segunda resposta da IA.
- **Arquivos:**
  - `upsert-message.ts`: devolve `{…conv, messageId, inserted}` via `.select('id')` no upsert. O único chamador é `route.ts:273`;
  - `route.ts`: o relay só sai quando `inserted`, e o fetch ganha `AbortSignal.timeout(10_000)`;
  - `route.test.ts`.
- **Pronto quando:** o mesmo inbound postado 2× gera 1 fetch.

**PR 3: `feat(banco)`, fundação da API v1** · banco · M · depende das decisões D5, D6 e D9; pode correr em paralelo com os PRs 1 e 2
- **Arquivos:** migration nova `supabase/migrations/AAAAMMDDHHMMSS_api_v1_fundacao.sql`, com:
  - `api_idempotency_keys`: token, chave com o mesmo regex de tickets, método, rota, `request_hash` sha256, estado `in_progress|completed`, `locked_until`, status e corpo da resposta com teto, `expires_at`; único `(api_token_id, idempotency_key)`;
  - RPCs `api_idempotency_begin/finish/release/purge`, todas SECURITY DEFINER com `revoke … from public, anon, authenticated`;
  - `api_tokens.actor_type text not null default 'api' check in ('ai','api')`, com grant por coluna;
  - `create or replace require_ticket_actor`, que passa a ler essa coluna;
  - `purge_integration_logs(interval)`, se D9 aprovar;
  - no fim, `assert_security_baseline()`.

  Também entram `supabase/tests/api.sql` e o `pnpm db:types` (`database.types.ts`).
- **Pronto quando:** o banco vazio aplica tudo, reaplicar dá 0, e o teste SQL cobre begin → replay, reused, in_progress e lease vencida.

> **Contrato da idempotência (feito no PR 3, para o PR 4 seguir):** `begin(token, chave, método, caminho CONCRETO sem query string, sha256 do corpo canônico)` devolve `started` + `attempt_id`, `replay` (status + corpo), `reused` (422) ou `in_progress` (409). Só a tentativa dona (`attempt_id`) chama `finish` (apenas 2xx ou 422) ou `release` (5xx e erros que não se guardam). Se ela perdeu a lease, o `finish` responde P0002: devolva a resposta ao cliente sem guardar. O `route` de `integration_logs` continua sendo o template.

**PR 4: `feat(api)`, `withApi` e o esqueleto da v1** · back · G · depende do PR 3
- **Arquivos (novos):**
  - `src/lib/api/v1/with-api.ts`, com a ordem request_id → limite por IP → Bearer → 1 SELECT por hash com `revoked_at is null` → `expires_at` → escopo → limite por token → `last_used_at` condicional (>60 s) → handler → log;
  - `errors.ts` (envelope `{ok:false,error:{code,message,fields?,allowed?},request_id}`), `scopes.ts` (catálogo, curinga e preset), `idempotency.ts`, `cursor.ts` e `if-match.ts`;
  - `record-integration-log.ts`, estendido com as colunas v1, sem payload e com `route` igual ao template;
  - `api/v1/health`, `me` e `openapi.json` (`z.toJSONSchema`, zod ^4.4.3 já instalado);
  - `src/app/api/v1/api-v1-guards.test.ts`, com uma parte estática (só `export const X = withApi(`) e uma dinâmica (sem Authorization → 401 e banco intocado).
- **Arquivos (alterados):** `route-guard.ts:33-36` ganha `'/api/v1/'`, e `route-guard.test.ts` ganha o caso novo. O prefixo e o varredor entram no mesmo PR.
- **Arquivo de deploy:** `deploy/nginx-host.conf` ganha `location /api/v1/` sem log de query (D8), para aplicar só com autorização.
- **Pronto quando:** os testes unitários do `withApi` passam: desconhecido, revogado e expirado dão 401; sem escopo dá 403; `tickets:*` cobre `tickets:read`; o estouro dá 429 com Retry-After; `last_used_at` recente não gera UPDATE; o log sai sem corpo.

> **Feito no PR 4 e adiado dele:** `withApi`/`withPublicApi`, escopos, erros, idempotência (só corpo JSON), OpenAPI, `health`/`me`/`openapi.json` e o varredor das rotas. Ficaram para quando houver quem use:
> - `cursor.ts` → PR 6;
> - `if-match.ts` → PR 8;
> - `access_log off` do `/api/v1` no vhost → PR 6, que traz `?cnpj=`;
> - o hash de corpo multipart (o boundary muda a cada envio) → PR 8.

**PR 5: `feat(api)`, tokens com escopo pela sessão** · back · P · depende do PR 3; pode correr em paralelo com o PR 4
- **Arquivos:**
  - `api-token-actions.ts`: schema com `scopes`, `expires_at`, `rate_limit_per_min` e `actor_type`;
  - `api/api-tokens/route.ts:12-13, 72-81`;
  - `PATCH api/api-tokens/[id]`, novo;
  - `settings/types.ts:38-45` e `get-api-tokens.ts`.
- **Pronto quando:** o admin cria e edita os escopos, e o token criado passa no `withApi` local.

> **Feito no PR 5, além do back:** um front mínimo. Gerar token pede "Acesso" ("Sem acesso" ou "IA de triagem"), e a lista mostra o acesso e o status Vencido. Sem isso, todo token da tela nasceria inerte até o PR 13, e a IA não teria como usar a API antes. A edição fina de escopos continua no PR 13.

> **PR 6 dividido em dois** (2026-09-29), para caber numa revisão:
> - **6a, feito:** catálogos (`products`, `ticket-categories`, `ticket-statuses` com as transições, `sla-policies`, `users`), escopo `catalog:read`, 503 `unavailable` quando a leitura falha (nunca `[]`).
> - **6b, feito (2026-09-30):** empresas e contatos, com cursor, `updated_since`, `?cnpj=`, o contrato sem valor, o POST idempotente e o PATCH do contato. O D8 também fechou o log de erro do appgw, que grava a URL quando uma réplica cai, e o redirect da porta 80 da v1 é 308. No POST, o contato arquivado volta sem desarquivar, e o nome só preenche nome vazio (decisões do dono, 2026-09-29).

**PR 6: `feat(api)`, leitura de catálogos, clientes e contatos** · back · M · depende do PR 4
- **Rotas:** `/api/v1/products`, `ticket-categories`, `ticket-statuses`, `sla-policies`, `users`, `customers` (com `?cnpj=`) e `customers/{id}/contract`, `contacts` (GET/POST/PATCH).
- **Reaproveita:** `getTicketCatalog`, `getAssignableUsers` (sem e-mail), `resolveContactIdentity` com `'api'`, o ramo 422 do telefone (`contacts/[id]/route.ts:50-62`) e os `CONTRACT_SELECT`/`toContractView` extraídos de `get-customer-detail.ts`.
- **Novo:** cursor `(updated_at, id)` decodificado e validado antes do `.or()`.
- **Pronto quando:** a paginação atravessa N páginas sem repetir, e o POST de contato é idempotente.

**PR 7: `feat(api)`, `GET /api/v1/context?phone=`** · back · M · depende do PR 6
- **Arquivos:** `src/features/integrations/server/triage-context.ts`, um builder único que o relay v1 também vai usar.
- **O que monta:** contato por alias exato, sem criar; empresa e selo; conversa mais recente; `getConversationTickets` + `allowedTargets`; últimas 20 mensagens em keyset, com colunas explícitas e sem zerar `unread`; `ai_may_reply`.
- **Pronto quando:** telefone desconhecido segue D11, e um catálogo nulo aparece como indisponível, não como `[]`.

> **Feito (2026-09-30).** Além do previsto:
> - `open_tickets_truncated` avisa quando a conversa tem mais de 20 tickets não terminais;
> - `contract_alert` sai separado do `contract`, que tem o formato de `/customers/{id}/contract`;
> - as notas internas ficam fora das mensagens;
> - a matriz de transições é lida sozinha, sem o catálogo inteiro.
>
> O builder mora em `src/features/integrations/server/triage-context.ts`, pronto para o PR 11.

**PR 8: `feat(api)`, tickets v1** · back · G · depende do PR 4
- **Rotas:** `GET` (cursor + `sla_breached`), `POST` (Idempotency-Key + `p_idempotency_key` como 2ª camada), `GET /{id|number}`, `PATCH` (If-Match → 412), `transitions`, `assign`, `comments`, `attachments` (multipart), `timeline`.
- **Arquivos:**
  - `ticket-service.ts`: `createTicket` passa a repassar os argumentos de integração;
  - `server/ticket-comment.ts` e `server/ticket-attachment.ts`: extraídos de `tickets/[id]/comments/route.ts:60-83` e `attachments/route.ts:67-155`, com o ator vindo de fora;
  - schema v1 próprio: o de sessão tem `take_over default(true)`, que dá FORBIDDEN para token (`schemas/ticket.ts:80`).
- **Pronto quando:** repetir o POST cria 0 linhas e responde com `Idempotent-Replayed`; corpo diferente dá 422; transição inválida dá 409 com `allowed`.

> **PR 8 dividido em dois** (2026-09-30), para caber numa revisão:
> - **8a, feito:** `GET /tickets` (cursor, filtros, `sla_breached`); `GET`/`PATCH /tickets/{id ou protocolo}`; `POST /tickets` idempotente em duas camadas (a `Idempotency-Key` também vai como `p_idempotency_key`, e o `external_id` é a 3ª chave); `transitions` e `assign`. O If-Match é obrigatório nas escritas: 428 sem ele, 412 com a versão velha, e a atual volta no ETag. As escritas relêem o ticket e devolvem o DTO inteiro. O Supabase falso dos testes da v1 virou helper (`src/app/api/v1/test-harness.ts`).
> - **8b, feito (2026-10-01):**
>   - `POST comments` e `POST attachments` (multipart, só o campo `file`), os dois com Idempotency-Key; `GET attachments/{attachment_id}`, que devolve uma URL assinada de 10 min; e `GET timeline` com cursor.
>   - O hash de corpo que o PR 4 adiou é das PARTES do multipart (nome, e do arquivo nome, tipo, tamanho e sha256), porque o boundary muda a cada envio. O `withApi` passou a ter o tipo de corpo por rota (`body: "json" | "multipart"`; o outro é 415 sem ler) e um teto conferido pelo Content-Length antes de ler (1 MB; 50 MB no anexo).
>   - A escrita de comentário e de anexo saiu das rotas de sessão para `server/ticket-comment.ts` e `server/ticket-attachment.ts`, com o ator vindo de fora.
>   - **Escopo novo, `comments:read`, fora do preset da IA.** Na timeline, `tickets:read` dá a trilha e os anexos; as mensagens exigem `conversations:read`, os comentários internos `comments:read`, e a nota interna no chat os dois. É a regra do `/context` (a IA não lê o que é só do time) aplicada por escopo.
>   - `source_url` continua fora, até o endurecimento do SSRF (§4).
>   - **Em aberto para o dono:** o parser de multipart do Node só aceita `name` e `filename` entre aspas, e o padrão do `HttpClient` do .NET não é assim. Hoje a API documenta e avisa no erro; tolerar exige normalizar o cabeçalho antes do parse (ou aceitar o arquivo cru).

**PR 9: `feat(banco)`, conversas da IA** · banco · P · depende das decisões D10 e D12; pode entrar no PR 3 se as decisões saírem antes
- **Arquivos:** `chat_messages.sent_by_token_id`; RPC `conversation_handoff(token, conversation, reason, summary, ticket_id)`, que muda bot→human com trava e grava `ticket_event` quando houver ticket; testes SQL e `db:types`.

> **PR 9, feito (2026-10-01)**, na migration `20261001120000_conversas_ia.sql`:
> - **Autoria.** `chat_messages.sent_by_token_id` (FK restrict, fora do UPDATE do app). O remetente da mensagem de um token é o tipo do token, por trigger: `ai` escreve como `ai`; `api`, como `system`. Fora disso é `INVALID_SENDER`. Um token nunca passa por analista, e uma integração não carimba a 1ª resposta da IA.
> - **Handoff.** `conversation_handoff(conversa, token, motivo, resumo?, ticket?)` trava a conversa e passa de `bot` para `human`. Conversa já `human` devolve `changed=false` sem gravar nada; `resolved` é `CONVERSATION_NOT_OWNED_BY_AI`, com o status no HINT. O ticket informado tem de ser da conversa e não terminal; sem ele, vale o ticket em foco.
> - **Onde ficam o motivo e o resumo (mudou em relação ao texto acima).** A trilha do ticket é append-only e sai inteira para quem tem `tickets:read`; texto longo vindo da conversa não cabe nela. Por isso:
>   - o evento `ticket.handoff_requested` guarda só o motivo (até 500 caracteres, como o motivo de uma mudança de status) e o id da nota;
>   - o motivo e o resumo (até 4.000) vão para uma **nota interna no chat**, assinada pelo token e marcada com `metadata.handoff`. O analista a lê ao assumir, com ou sem ticket. Nota não vai ao cliente, não vira prévia, e o banco permite apagá-la (a trilha, não);
>   - a nota e o evento ficam no mesmo ticket (o informado, ou o em foco).
> - **Caixa de entrada.** O handoff desarquiva e restaura a conversa: o pedido de um humano não pode ficar na caixa "Arquivadas".
> - **`create_ticket`** deixou de contar nota da IA como 1ª resposta da IA ao vincular as mensagens soltas.
> - **Para o PR 10:**
>   - mapear `CONVERSATION_NOT_OWNED_BY_AI` (409, com o status do HINT) e `INVALID_HANDOFF` (400) em `mapTicketError`; `INVALID_SENDER` é bug do app (500);
>   - o serviço remonta a resposta campo a campo: `conversation_external_id` é só para avisar o agente e nunca sai na API;
>   - a rota deriva o `sender_type` do tipo do token (`ai` → `ai`; `api` → `system`);
>   - rótulo de `ticket.handoff_requested` na timeline e assinatura na nota sem autor usuário (hoje aparece "Atividade registrada" e "Nota interna" sem nome);
>   - `sent_by_token_id` nos DTOs de mensagem, e nota em `GET /messages` só com `comments:read`, como na timeline;
>   - decidir quem apaga a nota da IA pela tela (proposta: admin apaga, ninguém edita).

**PR 10: `feat(api)`, envio pela IA, handoff e active-ticket** · back · G · depende dos PRs 4 e 9
- **Arquivos:**
  - `src/features/chat/lib/send-outbound.ts`: extraído de `send/route.ts:80-232`, com `sender_type` agent|ai, `clientId` e checagem condicional de `status='bot'` para o 409 `conversation_not_owned_by_ai`. A rota de sessão passa a chamá-lo;
  - `api/v1/conversations/[id]` (GET), `messages` (GET/POST), `handoff` e `active-ticket` (via `setActiveTicket`).
- **Pronto quando:** a mensagem da IA aparece como "IA", preenche `first_ai_response_at` e é conciliada no eco; numa conversa `human`, o POST responde 409.

> **PR 10 dividido em dois** (2026-10-01), para caber numa revisão:
> - **10a, feito:** o que não envia nada ao WhatsApp.
>   - `GET /conversations/{id}` e `GET /conversations/{id}/messages` (`conversations:read`). As mensagens vêm da mais nova para a mais antiga, com cursor próprio; a nota interna só entra com `comments:read`.
>   - `POST /conversations/{id}/handoff` (`conversations:handoff`, com Idempotency-Key): chama `conversation_handoff` e devolve o resultado do pedido (`conversation_id`, `status`, `changed`, `ticket_id`, `note_id`). Conversa resolvida é 409 `conversation_not_owned_by_ai`, com `current`.
>   - `PUT /conversations/{id}/active-ticket` (`tickets:write`, sem Idempotency-Key: PUT já é idempotente), via `setActiveTicket`. Devolve o foco que ficou.
>   - As escritas devolvem o resultado da operação, não a conversa: o escopo de escrita não dá a leitura. O telefone do canal nunca sai.
> - **10b, feito:** o envio de texto pela API, sem nada de tela.
>   - `send-outbound.ts`, extraído da rota de envio da tela, que passa a chamá-lo. Para o analista o comportamento é o de antes.
>   - `POST /conversations/{id}/messages` (`messages:send`, com Idempotency-Key). O corpo é só `{text}`: a chave do envio sai da Idempotency-Key e do token, e não de um `client_id` no corpo. O token de IA grava `ai`; o de integração, `system`.
>   - A IA só envia em conversa `bot` (409 `conversation_not_owned_by_ai`). O status é relido na hora do envio, e não na leitura inicial: é a "checagem condicional" deste plano.
>   - **No máximo uma vez.** 502 `whatsapp_unavailable` = não saiu, e a mesma chave tenta de novo. 504 `delivery_unknown` = o provedor não confirmou; a linha fica `pending`, e enquanto estiver assim a mesma chave não reenvia. A chave vale para um texto só (422).
>   - Tetos por conversa, por token: 20 envios por minuto e 100 por hora.
> - **10c, a fazer (tela):**
>   - "IA" ou "Automático" na mensagem de token, e a assinatura da nota sem autor usuário;
>   - rótulo de `ticket.handoff_requested` na timeline;
>   - `sent_by_token_id` nos itens de mensagem da timeline;
>   - sem "Tentar novamente" na mensagem de token (o servidor já recusa);
>   - quem apaga e quem edita a mensagem e a nota da IA (proposta: admin apaga, ninguém edita).
> - **Fora deles, em PRs próprios:**
>   - o teto do corpo nas escritas sem Idempotency-Key (o `withApi` só confere o Content-Length);
>   - conciliar o envio de desfecho desconhecido pelo `track_id` (`POST /message/find` da uazapi), e levar o "no máximo uma vez" também para a tela;
>   - `redirect: "error"` no `fetch` do provedor (hoje um redirecionamento levaria o cabeçalho `token` a outro host);
>   - o que fazer com `{{...}}` no texto (a uazapi troca os placeholders antes de entregar).

**PR 11: `feat(chat)`, relay v1** · back · M · depende dos PRs 2, 4 e 7, e das decisões D2 e D3
- **O que muda:**
  - o envelope sai sem `token`, com `relay_version`, `conversation_status`, `conversation_id`, `contact`, `customer`, `contract{status,alert}` e `active_ticket` na raiz, montados pelo builder do PR 7;
  - `media_url` assinada por `signStorageObject(…, 600)`;
  - log em `integration_logs` (provider `relay`);
  - `get-relay-url.ts` sem o fallback de env;
  - URL validada com `assertSafeUrl`;
  - assinatura conforme D3;
  - `docs/CONTRATO-RELAY.md` novo.
- **Repasse "no máximo uma vez":** desde o PR 1, um reenvio da uazapi não repassa. Se a 1ª entrega falhou depois do commit, a mensagem não chega à IA (fica o log `inbound repetido, sem relay`). O relay v1 grava uma marca de repasse (ou já sai pelo outbox da Fase 6) e reenvia quando a mensagem existe sem marca e é recente.
- **O filtro `bot` sai só no PR 11b**, com o teste que falha se o filtro voltar, depois que o dono confirmar que a IA é fail-closed.
- **Pronto quando:** existe teste de contrato do envelope, e o log registra status e latência.

**PR 12: `feat(conexao)`, back das abas** · back · M · depende dos PRs 4 e 11
- **Rotas:**
  - `POST /api/connection/agent/test` (evento `webhook.ping`);
  - leitura real de `get-integration-logs.ts` com filtros;
  - Saúde, composta do estado da uazapi, do último inbound e da taxa de erro em `integration_logs`;
  - Cofre restrito ao `RUNTIME_ENVIRONMENT_CATALOG` (`environment-variable.ts:15-22`);
  - rotação do segredo do webhook conforme D13, testada só no ambiente local;
  - `revalidatePath` passa a apontar para `/app/conexao`.

**PR 13: `feat(conexao)`, front das abas** · front · G · depende dos PRs 5 e 12
- **Abas com a aba na URL:** é o 3º uso, então `service-settings-tabs.tsx` vira um componente em `src/components/layout`.
- **Conteúdo das abas:** WhatsApp (`ConnectionPanel` intacto + rotação), API (escopos, preset, validade, limite, edição, "sem escopo" e "Expirado"), Agente (`AutomationSettings` + `BotSignatureSettings` + testar), Cofre (select do catálogo), Logs (`IntegrationLogsTable` com as colunas novas) e Saúde.
- **Também:** `configuracoes/page.tsx` e `navigation.ts`, conforme D14, e `UI.md`.

**PR 14: `docs`, API e guia do agente** · docs · M · depende dos PRs 6 a 11
- **Arquivos:** reescrita de `docs/API.md` e `docs/GUIA-AGENTE-IA.md`; roteiro curl do PLANO:357-365 executado contra o app local.
- **Pronto quando:** os 8 passos do roteiro curl passam, com a saída anotada no PROGRESS.

## 3. Decisões do dono

Respondidas em 2026-09-29:
- **D1:** a IA tem credencial própria da uazapi. O PR 1 entra direto.
- **D2:** mudança **compatível**, no mesmo endpoint. O filtro `bot` sai num PR separado (11b), combinado com o dono.
- **Token da instância repassado:** **não trocar por ora**.
- **D4 a D14:** recomendações **aceitas** como estão. Qualquer uma pode ser revista no PR correspondente.
- **D3** (onde ficam a URL e o segredo do agente): **em aberto**. Perguntar antes do PR 11.

O texto abaixo é o da análise, com as opções que foram consideradas.

1. **D1. Quem mantém a IA/n8n do Ticbox, e ela usa o `token` do envelope para enviar pela uazapi?** Bloqueia o PR 1.
   - (a) A IA tem credencial própria da uazapi: o PR 1 entra direto.
   - (b) A IA lê o token do envelope: primeiro configurar a credencial no n8n, e depois o PR 1.
   - **Recomendação:** (b) como transição, com a meta da decisão 14 (a IA só envia pela API) no PR 10.
   - Confirmar também, por leitura de `app_settings.automation` em produção, se o relay está ativo e se a URL vem da tela ou do env (`source` `ui`/`env`/`none`).
2. **D2. Como mudar o contrato do relay.**
   - (a) Mudança compatível no mesmo endpoint: só acrescenta campos, e o filtro `bot` fica até a IA ser fail-closed.
   - (b) Versão nova em URL nova, com data de corte.
   - **Recomendação:** (a) em dois tempos, PR 11 e depois PR 11b, com janela combinada.
3. **D3. Onde ficam a URL e o segredo do agente.** A URL continua em `app_settings.automation.relay_url`, sem fallback de env.
   - Segredo, (a): RPCs próprias no Vault (migration).
   - Segredo, (b): chave do catálogo do Cofre, gerada pelo CRM e exibida uma vez, sem migration.
   - Segredo, (c): nenhum até a Fase 6.
   - **Recomendação:** (b) com `X-CRM-Signature: v1=hmac(ts+"."+corpo)` do PLANO §C, em `src/lib/security/hmac.ts` com `node:crypto` e sem dependência nova. Na Fase 6 o segredo migra para `webhook_subscriptions`.
4. **D4. Escopos e o preset "IA de triagem".**
   - **Recomendação de semântica:** `recurso:*` cobre as ações atuais e futuras do recurso. As ações são `read` e `write`, e em tickets `write` cobre criar, PATCH, transition e assign.
   - **Preset:** `context:read`, `contacts:read`, `contacts:write`, `customers:read`, `catalog:read`, `tickets:read`, `tickets:write`, `comments:write`, `attachments:write`, `conversations:read`, `messages:send`, `conversations:handoff`, com `actor_type='ai'`.
   - **Fora do preset:** `customers:write`. `notices:claim` fica para a Fase 6.
   - **Acrescentado no PR 8b:** `comments:read`, também fora do preset (a IA escreve comentário interno, mas não lê comentário nem nota do time).
5. **D5. Rate limit com 2 réplicas.** `rate-limit.ts:1-4` é por processo, e o appgw faz hash por IP (`app-gateway.conf:44`).
   - (a) Aceitar o limite aproximado e documentar.
   - (b) Contador no banco (tabela UNLOGGED + RPC).
   - **Recomendação:** (a), com padrão de 120/min, preset IA de 300/min e um limite por IP antes do lookup, contra Bearer inválido martelando o banco.
6. **D6. Idempotência.** **Recomendação:**
   - tabela genérica com corpo da resposta guardado por 24 h, só para 2xx e 422, e 5xx liberando a chave;
   - lease de 5 min;
   - obrigatória em tickets, contacts, comments, attachments e handoff;
   - em `messages`, `client_id` é a chave;
   - **Como ficou (PR 10b, 2026-10-01):** em `messages` a Idempotency-Key é obrigatória como nas outras escritas, e é dela (com o id do token) que sai a chave gravada na linha; não existe `client_id` no corpo. E o 422 `idempotency_key_reused` que vem do handler **não** é guardado: ele libera a chave, para a recusa não tomar o lugar do pedido dono.
   - `idempotency_key_reused` vira 422 só no envelope v1: a sessão continua com 409 (`map-ticket-error.ts:91-96`).
7. **D7. If-Match.** **Recomendação:** obrigatório em PATCH, transitions e assign (428 se ausente, 412 no conflito), com ETag `W/"<version>"`. Documentar que o mesmo valor com versão velha dá `changed:false`, porque o no-op vem antes da checagem (`tickets.sql:1497-1501`).
8. **D8. PII na query string.** `?phone=` e `?cnpj=` entram no `access.log` compartilhado (`nginx-host.conf:63-66`).
   - (a) `location /api/v1/` com `access_log off`; a auditoria fica em `integration_logs`.
   - (b) Passar esses parâmetros para header ou POST.
   - **Recomendação:** (a), aplicada em produção só com autorização.
9. **D9. Retenção.** **Recomendação:** 90 dias para `integration_logs` e 24 h para `api_idempotency_keys`. As funções de expurgo entram no PR 3, e quem as executa é o worker da Fase 6. O volume até lá é baixo.
10. **D10. `ai` × `api` e autoria.** **Recomendação:**
    - coluna `api_tokens.actor_type`, sem derivar de escopo;
    - `create_ticket` recusa um `p_source` que contradiga o token;
    - `chat_messages.sent_by_token_id`, em vez de gravar o autor no metadata.
11. **D11. `/context` com telefone desconhecido.** **Recomendação:** 200 com `contact: null`. O GET nunca cria nada, e a busca é só por igualdade exata (sem nono dígito).
    - **Alerta de contrato:** `contract.status ∈ {suspenso, encerrado}` ou empresa sem contrato. O vocabulário é `contract-status.ts:6`.
    - **`ai_may_reply`:** só `conversation.status === 'bot'`.
12. **D12. Handoff.** **Recomendação:** só bot→human (a volta é pela UI, PLANO:343), por RPC nova com `ticket_event`. A IA continua assinando o texto que envia, e o CRM não aplica `bot_signature`.
13. **D13. Rotação do segredo do webhook.** Hoje ela dá 401 entre gravar e registrar, como no incidente de 2026-09-29 (PROGRESS.md:78-82).
    - (a) Ordem registrar → gravar, aceitando uma janela curta de 401.
    - (b) Migration com o segredo anterior válido por N minutos.
    - **Recomendação:** (b), ou adiar a rotação. Nunca testar na produção (PROGRESS.md:74).
14. **D14. `/health` e `/openapi.json` públicos?** **Recomendação:** os dois públicos, sem dado, numa allowlist explícita do varredor; `/me` exige token.
    - **Tokens existentes:** ficam inertes e são reemitidos, sem UPDATE em produção.
    - **O que sobra em `/app/configuracoes`:** decidir antes do PR 13.

## 4. Riscos principais e mitigação

- **Quebrar a IA de produção** ao tirar o `token` (PR 1) ou o filtro `bot` (PR 11b). Mitigação: D1 e D2 antes, deploy só com autorização, rollback por `image.env = crmsup-web:prd-rollback`, e o filtro sai num PR separado.
- **O token da instância foi repassado ao agente até o PR 1.** Fechar o repasse não o invalida. Trocar o token mexe na conexão de produção; o dono decidiu **não trocar por ora** (2026-09-29).
- **Rotas v1 sem teste de autenticação.** Incluir `'/api/v1/'` tira as rotas do `api-guards.test.ts:185`, e o `HANDLER_RE` de `:31` não reconhece `export const GET = withApi(`. Mitigação: prefixo e varredor próprio no mesmo PR 4, com a forma `export function` reprovada.
- **A idempotência de `create_ticket` diverge do plano.** Mesma chave com corpo diferente vira replay (`tickets.sql:1306-1308`), e o `FOR UPDATE` faz a 2ª chamada esperar em vez de responder 409. Mitigação: `api_idempotency_keys` na frente, com hash do corpo, e `p_idempotency_key` só como 2ª camada.
- **Token revogado ou vencido chegando à RPC vira 403**, porque `FORBIDDEN` mapeia para 403 (`map-ticket-error.ts:224-226`), e o plano quer 401. Mitigação: o `withApi` checa `revoked_at` e `expires_at` antes de chamar o handler.
- **PII e crescimento dos logs.** `recordIntegrationLog` grava `payload` e faz await (`record-integration-log.ts:14, 23`). Mitigação: `route` igual ao template, payload nulo, gravação sem await no caminho crítico, D8 e D9.
- **SSRF.** `assertSafeUrl` barra só o host literal, então passam rótulo único da rede Docker (`kong`, `db`) e CGNAT (`ssrf-guard.ts:68-83`), e a URL do relay é validada só por regex (`settings/automation/route.ts:20-22`). Mitigação: endurecer e mover para `src/lib/security` antes de `source_url` e no PR 11; `source_url` fica fora do PR 8 até isso.
- **Corrida no envio da IA:** um take-over entre a leitura e o envio deixa a IA responder numa conversa `human` (`send/route.ts:47-51` vs `:182`). Mitigação: checagem condicional no `send-outbound`, sem inverter a ordem de travas contacts→conversa (`chat.sql:690-693`).
- **Cursor por `updated_at`.** `now()` é o início da transação, e `contacts.updated_at` sobe a cada mensagem (`chat.sql:555`), então o cursor pode pular ou repetir linhas. Mitigação: janela de sobreposição e deduplicação documentadas em `docs/API.md`.
- **Hotspot `route.ts` do webhook** (293 linhas), tocado pelos PRs 1, 2 e 11. Mitigação: estritamente em sequência, cada um saído da `main` depois do merge do anterior.