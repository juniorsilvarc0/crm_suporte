---
name: uazapi-integration
description: Use para mexer na integração de WhatsApp via uazapi neste CRM — conectar/desconectar instância (QR), enviar/receber em tempo real, status (ticks), áudio/ptt, anexos (imagem/vídeo/documento com compressão), contato automático no inbound, relay ao n8n e depuração. Gatilhos - "uazapi", "conectar/desconectar whatsapp", "QR code", "instância", "não recebe/não envia mensagem", "ticks/entregue/lido", "webhook whatsapp", "áudio/ptt", "anexo/vídeo/imagem", "contato do whatsapp", "n8n whatsapp", "chat em tempo real", "limpar chat".
---

# Integração WhatsApp via uazapi

Guia completo e autossuficiente da integração uazapi deste CRM (Next.js 16 + React 19 + Supabase). **Validado contra a instância real `spincode.uazapi.com`** — o formato do webhook aqui é o REAL, não especulativo.

> **Regra de ouro:** tudo pende da linha `chat_integrations` (provider `uazapi`, `is_active`). Se envio/recebimento "não funciona", **verifique essa linha primeiro** (`/app/conexao` a cria/atualiza; a id é estável entre reconexões → conversas não duplicam).

## 1. Arquitetura em camadas

```
INBOUND  (WhatsApp → nós)
  uazapi → POST /api/chat/webhook/uazapi?s=<secret>
    ├─ EventType "messages"        → normalizeUazapiWebhook → upsertMessage
    │                              → resolveContactIdentity (acha/cria o contato pelo telefone)
    │                              → relay ao n8n (SÓ inbound e conversa.status='bot')
    └─ EventType "messages_update" → event.Type:
         ├─ Delivered/Read/Played/Sent → atualiza delivery_status (ticks, MONÓTONO)
         └─ FileDownloaded            → re-hospeda FileURL no chat-media (PRIVADO) +
                                         anexa à mensagem (a mídia chega AQUI, não na msg)
  → Supabase Realtime (postgres_changes: INSERT+UPDATE) → UI ao vivo

OUTBOUND (nós → WhatsApp)
  UI → POST /api/chat/conversations/[id]/send | send-audio | send-file
     → insere chat_messages 'pending' (o id vira o track_id)
     → senders/uazapi (POST /send/text|/send/media, header token lido do Vault)
     → grava external_id=messageid, delivery_status='sent'
     → o echo fromMe volta pelo webhook e é RECONCILIADO (não duplica)
```

| Camada | Arquivo | Papel |
|---|---|---|
| Conexão | `connection/uazapi.ts` | `connectUazapi`(QR) · `getUazapiStatus` · `registerUazapiWebhook` · **`disconnectUazapi`** |
| Conexão | `connection/ssrf-guard.ts` | `assertSafeUrl`/`safeBaseUrl` — bloqueia URL interna/ofuscada |
| Conexão | `connection/integration.ts` | `getUazapiIntegration` / `getIntegrationCredentials` — a linha uazapi com o token lido do **Vault**; `get/setChatIntegrationSecret` |
| Envio | `senders/uazapi.ts` | `sendUazapiText` · `sendUazapiMedia` · `sendUazapiAudio` · `toUazapiNumber` · **`deleteUazapiMessage`** · **`editUazapiMessage`** |
| Ações | `lib/message-actions.ts` | `canEdit/canDelete/canForwardMessage` · `buildForwardPayload` — regras puras, compartilhadas por UI e rota |
| Entrada | `normalizers/uazapi.ts` | envelope real → `NormalizedMessage` · `extractUazapiStatuses` · **`extractUazapiMedia`** |
| Persistência | `upsert-message.ts` | grava conversa+mensagem, dedup `(conversation_id, external_id)`, avatar/nome sem sobrescrever com null |
| Contato | `features/contacts/queries/resolve-contact-identity.ts` + `lib/formatters/clean-name.ts` | contato no inbound (RPC com lock por telefone); `cleanContactName` tira emoji/`~` |
| Status | `delivery-status.ts` | `overridableFrom` — ticks monótonos (nunca regridem) |
| Mídia | `media/persist-inbound.ts` · `media/stored-media.ts` · `lib/storage/{put-media,chat-media}.ts` · `media/compress-video.ts` | baixa (SSRF) e re-hospeda no bucket privado · colunas/metadata da mídia · URL assinada · comprime vídeo (ffmpeg) |
| Rotas conexão | `api/connection/{persist,qr,state,disconnect}/route.ts` | onboarding / status / logout+wipe+excluir instância |
| Rota webhook | `api/chat/webhook/uazapi/route.ts` | recebe eventos (secret do Vault, status, mídia, **apagada**, echo, inbound, contato, relay) |
| Rotas de mídia | `api/chat/media/[id]` · `api/contacts/[id]/avatar` | sessão + 302 para URL assinada de 10 min |
| Rotas envio | `api/chat/conversations/[id]/{send,send-audio,send-file}/route.ts` | texto / áudio / anexo |
| Rotas mensagem | `api/chat/conversations/[id]/messages/[messageId]/route.ts` | `PATCH` edita · `DELETE` apaga para todos |
| Rota encaminhar | `api/chat/conversations/[id]/forward/route.ts` | reenvia com `forward:true` (máx. 5 destinos) |
| Realtime | `hooks/use-chat-realtime.ts` | INSERT+UPDATE de mensagens; INSERT+UPDATE de conversas |
| UI composer | `components/chat-footer.tsx` · `emoji-picker.tsx` | texto/áudio/anexo + menu "+" + emojis |

`NormalizedMessage` (em `normalizers/types.ts`) é o tipo comum; mantenha provedores convergindo a ele.

## 2. Contrato uazapi — REAL (confirmado)

> 📗 **Doc oficial: `https://docs.uazapi.com/openapi-bundled.json`** (uazapiGO 2.1.1, 132 rotas).
> `docs.uazapi.com` é um SPA e não serve nada útil para `curl`/WebFetch — ele **carrega** esse JSON, cujo caminho está no bundle JS. Baixe o arquivo e leia o spec; **não** deduza contrato por tentativa e erro, e **não** chame endpoint destrutivo para descobrir formato.

Auth: **header `token: <token>`** (NÃO Bearer). Base URL por-integração em `chat_integrations.config.apiUrl`.

**Envio / conexão:**

| Método | Rota | Body | Resposta |
|---|---|---|---|
| POST | `/instance/connect` | `{}` ou `{phone}` | `{connected, qrcode/base64, paircode?}` |
| GET | `/instance/status` | — | `{status:{connected}, instance:{status, owner}}` |
| POST | `/instance/disconnect` | `{}` | logout (credenciais seguem válidas) |
| POST | `/send/text` | `{number, text, replyid?, forward?, track_id, track_source}` | `{id, messageid, status}` |
| POST | `/send/media` | `{number, type, file, text?, docName?, replyid?, forward?, track_id}` | `{id, messageid}` |
| POST | `/message/download` | `{id}` | `{fileURL, mimetype}` |
| POST | `/message/delete` | `{id}` | apaga **para todos** |
| POST | `/message/edit` | `{id, text}` | `{id, messageid, content, ...}` |
| POST | `/webhook` | `{enabled, url, events:["messages","messages_update"]}` | ok |

- **`number`**: DDI+dígitos sem `+`. Use `toUazapiNumber()`.
- **`type` (mídia)**: `image,video,document,audio,myaudio,ptt,ptv,sticker`. **Voz = `ptt`**. `file` = URL pública **ou** base64. Áudio de saída vai como **base64**; anexos (send-file) e encaminhamentos vão como **URL assinada de 10 min** do bucket privado (a uazapi baixa; `signStorageObject` reescreve para a origem pública).
- **`track_id`** = id da NOSSA `chat_messages` (casa status + reconcilia echo fromMe).
- **`replyid`** = `messageid` da uazapi (nosso `external_id`) a citar. É **oficial**, está no spec — já esteve marcado como palpite no código, não é.
- **`forward: true`** marca a mensagem como "Encaminhada". ⚠️ **Não existe endpoint de encaminhar**: encaminhar é reenviar o conteúdo com essa bandeira ligada (é o que a rota `.../forward` faz).

**⚠️ Editar e apagar — armadilhas (`.../messages/[messageId]/route.ts`):**

- **`/message/edit` só aceita mensagem enviada pela PRÓPRIA instância**, e dentro da janela do WhatsApp (15 min). `/message/delete` é "para todos", então também só faz sentido nas nossas.
- **Editar gera um `messageid` NOVO.** Grave-o no `external_id`. Sem isso os ticks congelam (o `messages_update` chega com o id novo e não casa com nada) **e** o eco entra duplicado — a chave de dedup é `(conversation_id, external_id)`.
- **Só grave no banco depois do 200.** Gravar antes deixa o CRM afirmando uma coisa e o celular do paciente mostrando outra.
- Os predicados de quem pode ser editado/apagado/encaminhado vivem em **`features/chat/lib/message-actions.ts`** e são usados pela UI **e** pela rota. Não duplique a regra.

**⚠️ Webhook de ENTRADA — o formato REAL (diferente do que a doc de envio sugere):**

Envelope: `{ EventType, message?, event?, chat?, owner, instanceName, token }`.

- **`EventType: "messages"`** → mensagem nova em **`payload.message`**:
  ```
  { messageid, id, chatid:"5511...@s.whatsapp.net" | "...@g.us",
    sender_pn, senderName, isGroup, fromMe,
    messageType:"Conversation"|"AudioMessage"|"ImageMessage"|...   (CamelCase!),
    text, content, messageTimestamp, track_id }
  ```
  - **A conversa é chaveada por `chatid`** (o CONTRAPARTE), NUNCA por `sender_pn`. Em `fromMe`, `sender_pn`/`senderName` são o DONO — usar `chatid` (senão a msg do próprio celular vira uma conversa com o número do dono).
  - **Mídia**: o `content` de mídia é um objeto com **URL criptografada** (`.enc`) — inútil. A mídia real chega DEPOIS (ver FileDownloaded).
  - Grupos (`@g.us` / `isGroup`) são **ignorados**.
- **`EventType: "messages_update"`** → dados em **`payload.event`** (NÃO em `message`):
  ```
  { Type:"Delivered"|"Read"|"Played"|"Sent"|"Error"|"FileDownloaded"|"Deleted",
    MessageIDs:["<messageid>"], Chat, chatid, IsFromMe, IsGroup,
    FileURL?, MimeType? }
  ```
  - **Apagada** (`extractUazapiDeletion`): `Type==="Deleted"` chega tanto quando NÓS chamamos `/message/delete` quanto quando **o contato apaga no celular dele**. Marca `is_deleted` e zera `content`/`media_url`. **Não é status** — `mapEventType` devolve null para ele.
  - **Status** (`extractUazapiStatuses`): `event.Type` → delivery_status, casando por `event.MessageIDs` (= `external_id` da nossa mensagem). Mapa: `Delivered→delivered`, `Read`/`Played→read`, `Sent`/`ServerAck→sent`, `Error→failed`. **`FileDownloaded` NÃO é status.**
  - **Mídia** (`extractUazapiMedia`): quando `Type==="FileDownloaded"`, o `event.FileURL` (+`MimeType`) é a mídia baixada — re-hospeda no `chat-media` e faz UPDATE na(s) mensagem(ns) (`MessageIDs`). **É assim que áudio/imagem ganham `media_url`.**
- **Ticks são MONÓTONOS** (`overridableFrom`): só avançam (`pending<sent<delivered<read`). Webhook fora de ordem não regride.

## 3. Modelo de dados (Supabase)

- **`chat_integrations`** — `provider='uazapi'` (único aceito), `config={apiUrl}` (**o check do banco recusa token ali**), `token_secret_id`/`webhook_secret_id` (Vault), `phone_number` (dono, preenchido ao conectar), `is_active`. **Single-tenant: `unique(provider)`**, id estável (reconectar não duplica conversas). Apagar a linha apaga os segredos no Vault (trigger).
- **`chat_conversations`** — 1 por contato; `external_id`=telefone; `contact_avatar_url` (do `chat.imagePreview`); `status ∈ {bot,human,resolved}`; `unique(integration_id, external_id)`.
- **`chat_messages`** — `external_id`(messageid), `direction`, `sender_type` (`contact` entrada · `device` fromMe do celular · `agent` enviado pelo CRM · `ai`/`system` depois; check casa com `direction`), `type`, `content`, `media_bucket`/`media_key` + `media_url` = `/api/chat/media/<id>`, `delivery_status`, `metadata.uazapiId`/`thumbKey`/`thumbUrl`; `unique(conversation_id, external_id)` (dedup do echo).
- **`contacts`** — criado no inbound (`resolve_contact_identity`), dedup por `normalized_phone` (sem o DDI 55); telefone imutável; foto em `avatar_bucket`/`avatar_key`.
- **Bucket `chat-media`** (**privado**, 50 MB, lista de MIME literal sem parâmetros) — mídia re-hospedada e foto do contato. Nada grava URL do storage: a rota do app assina na hora.

## 4. Conectar / desconectar

**Conectar** — `/app/conexao` (`ConnectionPanel`): sem integração → form de credenciais → `POST /api/connection/persist` (upsert integração + `registerUazapiWebhook` p/ `${APP_PUBLIC_URL}/api/chat/webhook/uazapi?s=<secret>`) → poll `state` (3s) + `qr` (~25s) → escaneia → "Conectado".

**Desconectar** — botão no bloco conectado → diálogo com opção **"limpar todo o chat"** (exige digitar `excluir`) → `POST /api/connection/disconnect { wipe? }`: faz logout; com `wipe`, apaga conversas+mensagens (cascade; **contatos intactos**), mantendo a instância. Após desconectar, o painel NÃO vai direto ao QR: mostra a **tela de escolha** (`flow: "auto"|"qr"|"choice"` em `ConnectionPanel`) → **Reconectar** (mesma instância, gera QR, **conversas preservadas** — integração é a mesma linha) ou **Excluir instância**.

**Excluir instância** — `POST /api/connection/disconnect { deleteIntegration: true }` (exige digitar `excluir`): logout + apaga conversas (a FK `chat_conversations.integration_id` é `ON DELETE SET NULL`, então **apaga conversas ANTES** de remover a linha, senão ficam órfãs) + deleta `chat_integrations`. `state` passa a `configured:false` → volta ao form de credenciais para conectar uma instância **nova**. **Contatos nunca são tocados.** O segredo do webhook e o token saem do Vault junto com a linha (trigger).

> O QR só vincula um **celular** à instância existente (mesmo `apiUrl`+`token`) — não troca de instância. Para conectar OUTRA instância uazapi, é preciso **excluir** a atual e informar URL+token novos.

Credenciais NÃO ficam em env nem em tabela: o `persist` grava o token no **Vault** e obtém o segredo do webhook por `ensure_chat_integration_secret` (atômico: devolve o existente ou grava o candidato de 32 bytes), registrando na uazapi o valor **devolvido** — duas conexões simultâneas nunca divergem. Envs que ainda existem: `APP_PUBLIC_URL` (base do webhook registrado) e `N8N_WEBHOOK_URL` (relay, sai na Fase 5). A chave da OpenAI fica no cofre (Configurações).

> **Dev local:** a uazapi é remota → precisa alcançar nosso webhook. `localhost` não serve — túnel (`ngrok`) em `APP_PUBLIC_URL`.

## 5. Anexos + compressão de vídeo (send-file)

`POST /api/chat/conversations/[id]/send-file` recebe **`multipart/form-data`** (campo `file`, binário puro — **NÃO base64**). Classifica por mimetype: imagem→`image`, vídeo→`video`, resto→`document`. Sobe no bucket privado `chat-media` (`media_url` = `/api/chat/media/<id>`, id gerado antes do INSERT) e envia via `/send/media` com uma **URL assinada** de 10 min. Upload até 64 MB; depois de comprimido, até 50 MB (teto do bucket) — acima disso, 413.

- **Vídeo > 10MB é comprimido com ffmpeg** (`compress-video.ts`: 720p, H.264/AAC, `+faststart`) — como o WhatsApp faz — pra caber no limite (~16MB). Cai de volta ao original se o ffmpeg falhar. **A imagem de produção precisa do ffmpeg** (instalado no `Dockerfile.production`).
- **⚠️ Limite de body do Next 16:** o default é **10MB** (`experimental.proxyClientMaxBodySize`) — subido p/ `"64mb"` no `next.config.ts`. Sem isso, upload grande é truncado e `request.formData()` quebra. Se anexo grande "carrega e não vai", suspeite disso.

## 6. Relay ao agente + contato automático

- **Relay:** o webhook repassa o **payload cru** ao `N8N_WEBHOOK_URL` (fire-and-forget) **só p/ inbound e enquanto `conversation.status='bot'`**. A IA "Valquíria" responde enviando **direto pela uazapi** (`/send/text`), e o echo volta como fromMe. Ao **Assumir** (status `human`), o relay para.
- **Contato:** todo evento de mensagem chama `resolveContactIdentity` (sem reativar; quem reativa e toca `last_message_at` é o trigger do INSERT real da mensagem, uma vez só) — cria o contato (`source=whatsapp`) ou acha o existente pelo telefone normalizado. O nome do provedor **só preenche nome vazio**; nunca sobrescreve o editado. `cleanContactName` remove emojis, bandeiras e o `~` de auto-update do pushname.
- ⚠️ O relay ainda manda o **envelope cru**, com o `token` da instância. Sai na Fase 5 (relay v1).

## 7. Realtime

`use-chat-realtime.ts` assina `postgres_changes`:
- **chat_messages**: INSERT (msg nova) **+ UPDATE** (mídia via FileDownloaded e ticks chegam por UPDATE — sem isso o áudio fica vazio e os ticks não evoluem ao vivo). Callbacks em **refs** (senão a closure captura o filtro do 1º render).
- **chat_conversations**: INSERT (conversa nova ao vivo) + UPDATE (preview/status). `addConversation` respeita filtro+busca.

A UI mostra "🎤 Áudio · carregando…" enquanto `media_url` não chega (evita bolha vazia).

## 8. Playbook de depuração

**"Não recebe / payload não reconhecido"** → `docker logs` do container; o webhook loga `[webhook/uazapi] não reconhecido: {eventType, messageType}` (nunca o envelope: ele traz o `token` e o texto). 401 = segredo: a integração existe, tem token **e** segredo no Vault, e o `?s=` registrado na uazapi é o de agora? Reconectar pelo menu Conexão re-registra. Confira também: integração ativa? webhook registrado (`GET {base}/webhook`)? O `message.chatid`/`messageType` batem com o normalizer?

**"Áudio/imagem não aparece"** → a mídia vem no `messages_update` **FileDownloaded** (separado da msg). Cheque: (a) o FileDownloaded chegou? (b) `extractUazapiMedia` casou por `MessageIDs`? (c) a UI assina **UPDATE** em chat_messages? (d) num reload aparece? (se sim, é realtime UPDATE).

**"Msg do meu celular virou conversa 'Junior' (o dono)"** → chaveamento por `sender_pn` em vez de `chatid`. O normalizer usa `chatid`.

**"Ticks não evoluem"** → status vem em `event.Type` (não ack). `extractUazapiStatuses` só dispara p/ `EventType==="messages_update"`. Casa por `external_id` (=MessageIDs). Monótono (não regride).

**"Vídeo carrega e não envia"** → tamanho > 64MB (limite) OU `proxyClientMaxBodySize` não configurado OU o WhatsApp rejeitou (>16MB sem compressão → confira que o ffmpeg está na imagem e o vídeo foi comprimido: log `[send-file] vídeo comprimido: X -> Y`).

**"IA responde após eu assumir"** → relay é só com `status='bot'`. Confira o status da conversa.

## 9. Segurança

- **Secret do webhook via `?s=`** (a uazapi não manda headers custom): gerado por integração no `persist`, guardado no Vault, comparado em tempo constante (`safeEqual`) **antes** de ler o corpo. Sem integração, sem segredo ou errado → a mesma 401 (não revela se há instância).
- **SSRF guard** (`assertSafeUrl`) em toda URL externa (apiUrl, URL de mídia): exige http(s), bloqueia loopback/privados (inclui IPv4-mapped IPv6 `::ffff:` e decimal/hex ofuscado); produção exige HTTPS. Download de mídia: `redirect:"error"` + `token` só p/ o mesmo host da instância (não vaza a credencial).
- Conexão (`/api/connection/*`) sob sessão; webhook público com secret próprio.
- **Realtime:** `anon` não lê nada; `authenticated` lê só as tabelas de chat, com policy por `app_role`. O navegador assina **só por `subscribeAuthenticated`** — assinar antes de o token chegar grava a assinatura como `anon` e todo evento vem vazio com 401.
- **Mídia:** bucket privado; `/api/chat/media/<id>` confere a sessão e redireciona para URL assinada curta. A transcrição baixa pelo `service_role`.

## 10. Deploy

Produção ainda não definida (Fase 10 de `docs/PLANO-IMPLANTACAO.md`); por enquanto só Docker local. Em produção, HTTPS é obrigatório (cookie de sessão `Secure`).

## Comandos úteis

```bash
docker exec -w /app crm-suporte-web pnpm exec tsc --noEmit
docker exec -w /app crm-suporte-web pnpm exec vitest run src/features/chat
# estado no banco:
docker exec crm-suporte-db psql -U postgres -d postgres \
  -c "select id, provider, is_active, phone_number from chat_integrations;"
```
