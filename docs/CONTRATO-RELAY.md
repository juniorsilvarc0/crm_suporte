# Relay v1: o que o CRM envia ao agente a cada mensagem do cliente

Este documento é para quem constrói o **agente de IA** (ou o fluxo de automação) que atende pelo WhatsApp junto com o CRM Suporte. Ele descreve o pedido que o CRM faz ao agente quando o cliente escreve, como conferir que o pedido veio do CRM, e o que o agente deve fazer com ele.

A referência completa da API citada aqui fica em `GET /api/v1/openapi.json`.

## 1. Quando o CRM chama o agente

O CRM faz um `POST` no endereço do agente quando chega uma **mensagem nova do cliente** pelo WhatsApp e a conversa está com a IA (`bot`).

Não são repassados:

- mensagem de grupo;
- mensagem enviada pela própria empresa (pelo CRM, pela IA ou pelo celular);
- exclusão de mensagem e confirmação de entrega ou de leitura;
- a mesma mensagem reenviada pelo provedor (o CRM repassa cada mensagem uma vez só).

O CRM repassa tudo o que o provedor entrega como mensagem nova do cliente. Isso inclui **reação**, tipos que o CRM não trata (enquete, localização) e, conforme o provedor entregar, a **edição** de uma mensagem como se fosse outra mensagem. Confira `message.messageType` antes de responder.

Mensagens enviadas em sequência chegam ao agente em paralelo, sem ordem garantida. Para ordenar, use `message.messageTimestamp`.

Fora disso, o CRM só chama este endereço no **teste de conexão**, quando um administrador o dispara pela tela. É um pedido sem mensagem de cliente, descrito na seção 10.

> **O agente decide pelo campo `conversation_status`, e não por "se chegou, é minha".** Hoje o CRM só repassa conversa em `bot`. Numa próxima versão ele vai repassar também as que estão com um analista, para a IA acompanhar sem responder. Um agente que responde a tudo o que recebe vai falar por cima do analista.

Dois efeitos do status que convém conhecer:

- depois que a conversa passa para um analista (`human`), o agente deixa de receber as mensagens dela;
- uma conversa encerrada (`resolved`) volta para `bot` quando o cliente escreve de novo, e essa mensagem já é repassada.

## 2. O pedido

`POST` no endereço configurado, com `Content-Type: application/json`.

| Cabeçalho | Conteúdo |
|---|---|
| `User-Agent` | `crm-suporte-relay/1`. |
| `X-CRM-Event` | `conversation.message_received` na mensagem do cliente. No teste de conexão, `webhook.ping` (seção 10). |
| `X-CRM-Event-Id` | Identificador do evento. Na mensagem do cliente, repete o `message_id` do corpo. |
| `X-CRM-Timestamp` | Instante do envio, em segundos (Unix). |
| `X-CRM-Signature` | `v1=` seguido da assinatura (seção 4). Só vem quando o CRM tem uma chave de assinatura configurada. |

O agente tem **10 segundos** para responder. O CRM só olha o status da resposta e ignora o corpo.

- Responda `2xx` assim que receber, e processe depois.
- Qualquer outro status conta como falha. Redirecionamento (`3xx`) **não é seguido**.
- **Não há nova tentativa.** Se o agente estiver fora do ar, aquela mensagem não é repassada de novo. Ela continua no CRM (seção 6).

## 3. O corpo

O corpo é o evento `messages` da uazapi, como o CRM o recebeu, **sem o `token` da instância**, com os campos do CRM acrescentados na raiz. O formato de `message` e de `chat` é o da uazapi.

`contact`, `customer` e `active_ticket` têm o mesmo formato da API v1. `contract` é um resumo próprio do repasse: para o contrato inteiro, chame `GET /api/v1/customers/{id}/contract`.

| Campo do CRM | Tipo | O que é |
|---|---|---|
| `relay_version` | número | Versão deste contrato. Hoje `1`. |
| `conversation_id` | texto | A conversa no CRM. É o id usado em `/api/v1/conversations/{id}`. |
| `conversation_status` | `bot`, `human` ou `resolved` | Quem conduz: a IA, um analista, ou ninguém (encerrada). **Só `bot` autoriza a IA a responder.** É lido na hora em que o envelope é montado. |
| `message_id` | texto | A mensagem no CRM (a mesma de `GET /api/v1/conversations/{id}/messages`). É o identificador para descartar repetição. |
| `contact` | objeto | Quem escreveu, no formato de `GET /api/v1/contacts/{id}`. |
| `customer` | objeto ou `null` | A empresa do contato, no formato de `GET /api/v1/customers/{id}`. `null` = contato sem empresa. |
| `contract` | objeto | `status`: `ativo`, `suspenso`, `encerrado` ou `null` (sem empresa, ou a empresa nunca teve contrato). `alert`: `null` com contrato ativo; senão o motivo: `sem_empresa`, `sem_contrato`, `suspenso` ou `encerrado`. |
| `active_ticket` | objeto ou `null` | O ticket em foco da conversa, no formato de `GET /api/v1/tickets/{ref}` (sem `description` e `category`). `null` = nenhum. Para alterar o ticket, envie `If-Match: W/"<version>"`. |
| `media_url` | texto ou `null` | Endereço para baixar a mídia da mensagem (seção 5). |

Os campos do CRM vêm sempre, todos. Se o CRM não consegue ler algum deles, o repasse não sai (seção 7).

`active_ticket.contact_id` e `active_ticket.customer_id` são os do ticket, gravados quando ele foi aberto. Podem diferir de `contact` e `customer`, que são os de agora.

<!-- exemplo:envelope -->
```json
{
  "BaseUrl": "https://sua-instancia.uazapi.com",
  "EventType": "messages",
  "instanceName": "suporte",
  "owner": "5511900000000",
  "chat": { "name": "Maria" },
  "message": {
    "messageid": "3EB0A1B2C3D4E5F6",
    "chatid": "5527999990000@s.whatsapp.net",
    "sender_pn": "5527999990000@s.whatsapp.net",
    "senderName": "Maria",
    "fromMe": false,
    "isGroup": false,
    "messageType": "Conversation",
    "text": "O sistema voltou a travar"
  },
  "relay_version": 1,
  "conversation_id": "2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e",
  "conversation_status": "bot",
  "message_id": "3c4d5e6f-7a8b-4c9d-8e1f-2a3b4c5d6e7f",
  "contact": {
    "id": "0f8e7d6c-5b4a-4938-8271-605f4e3d2c1b",
    "name": "Maria",
    "phone": "5527999990000",
    "normalized_phone": "27999990000",
    "email": null,
    "notes": null,
    "source": "whatsapp",
    "customer_id": "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
    "last_message_at": "2026-10-01T12:00:00+00:00",
    "archived_at": null,
    "created_at": "2026-09-01T09:00:00+00:00",
    "updated_at": "2026-10-01T12:00:00+00:00"
  },
  "customer": {
    "id": "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
    "legal_name": "Padaria Exemplo LTDA",
    "trade_name": "Padaria Exemplo",
    "cnpj": null,
    "contract_status": "ativo",
    "notes": null,
    "archived_at": null,
    "created_at": "2026-09-01T09:00:00+00:00",
    "updated_at": "2026-09-01T09:00:00+00:00"
  },
  "contract": { "status": "ativo", "alert": null },
  "active_ticket": {
    "id": "4d5e6f7a-8b9c-4d0e-9f2a-3b4c5d6e7f80",
    "number": 101,
    "title": "Nota fiscal não sai",
    "status": "em_atendimento",
    "priority": "alta",
    "source": "ai",
    "version": 3,
    "conversation_id": "2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e",
    "contact_id": "0f8e7d6c-5b4a-4938-8271-605f4e3d2c1b",
    "customer_id": "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
    "is_terminal": false,
    "product": { "id": "5e6f7a8b-9c0d-4e1f-8a3b-4c5d6e7f8091", "name": "ERP" },
    "assignee": null,
    "sla": {
      "breached": false,
      "at_risk": false,
      "next_due_at": "2026-10-01T16:00:00+00:00",
      "first_response_due_at": "2026-10-01T12:30:00+00:00",
      "resolution_due_at": "2026-10-01T16:00:00+00:00",
      "first_responded_at": "2026-10-01T12:05:00+00:00"
    },
    "resolved_at": null,
    "closed_at": null,
    "created_at": "2026-10-01T12:00:00+00:00",
    "updated_at": "2026-10-01T12:05:00+00:00"
  },
  "media_url": null
}
```

Para o resto do contexto (as últimas mensagens, os outros tickets abertos, os últimos encerrados), chame `GET /api/v1/context?phone=<telefone>`. Ele devolve a conversa mais recente do contato: confira se `conversation.id` é o `conversation_id` do repasse.

## 4. Como conferir que o pedido veio do CRM

Com uma chave de assinatura configurada no CRM, todo pedido traz `X-CRM-Signature`. Confira antes de processar:

1. Recuse se `X-CRM-Timestamp` estiver a mais de **5 minutos** do relógio do agente. Sem isso, um pedido capturado poderia ser reenviado depois.
2. Calcule o HMAC-SHA256, em hexadecimal, de `<timestamp>.<corpo>`, usando a chave como segredo. A chave é usada como texto (UTF-8), exatamente como o CRM a mostrou: são 64 caracteres, e não 32 bytes a decodificar do hexadecimal.
3. Compare `v1=<resultado>` com o cabeçalho, em tempo constante.

Três cuidados:

- **O `<corpo>` são os bytes recebidos**, sem alteração. Não use o JSON já interpretado e convertido de volta em texto: a ordem das chaves ou um espaço muda a conta. No n8n, ligue a opção de corpo cru (*Raw Body*) do nó Webhook.
- **A assinatura cobre o instante e o corpo, e não os outros cabeçalhos.** Para descartar repetição, use o `message_id` do corpo, e não o `X-CRM-Event-Id`: dentro dos 5 minutos, quem capturou um pedido poderia reenviá-lo com outro cabeçalho.
- **Pedido sem `X-CRM-Signature`, ou agente sem a chave carregada, é pedido recusado.** Nunca aceite por falta do cabeçalho ou por chave vazia.

Para testar a conta (os passos 2 e 3), este exemplo tem de dar o mesmo resultado. O instante dele é antigo de propósito: a função inteira o recusa pelo passo 1.

| | |
|---|---|
| Chave | `segredo-de-exemplo` |
| `X-CRM-Timestamp` | `1790000000` |
| Corpo | `{"relay_version":1}` |
| `X-CRM-Signature` | `v1=a4c609d90ff44bf07040388f9ebe306a937dbcc7cd8622f0221b6f9ad96a0694` |

Em Node.js (`corpoCru` é um `Buffer` ou um texto com os bytes recebidos):

```js
import { createHmac, timingSafeEqual } from "node:crypto";

function assinar(chave, timestamp, corpoCru) {
  return "v1=" + createHmac("sha256", chave).update(timestamp + ".").update(corpoCru).digest("hex");
}

function assinaturaValida(chave, cabecalhos, corpoCru) {
  const timestamp = cabecalhos["x-crm-timestamp"] ?? "";
  const recebida = cabecalhos["x-crm-signature"] ?? "";
  if (!chave || !/^\d{1,12}$/.test(timestamp)) return false;
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;
  const a = Buffer.from(recebida);
  const b = Buffer.from(assinar(chave, timestamp, corpoCru));
  return a.length === b.length && timingSafeEqual(a, b);
}
```

Em Python (`corpo_cru` são os bytes recebidos):

```python
import hashlib
import hmac
import re
import time

def assinar(chave: str, timestamp: str, corpo_cru: bytes) -> str:
    conta = hmac.new(chave.encode(), timestamp.encode() + b"." + corpo_cru, hashlib.sha256)
    return "v1=" + conta.hexdigest()

def assinatura_valida(chave: str, cabecalhos, corpo_cru: bytes) -> bool:
    timestamp = cabecalhos.get("X-CRM-Timestamp", "")
    recebida = cabecalhos.get("X-CRM-Signature", "")
    if not chave or not re.fullmatch(r"[0-9]{1,12}", timestamp):
        return False
    if abs(time.time() - int(timestamp)) > 300:
        return False
    return hmac.compare_digest(recebida.encode(), assinar(chave, timestamp, corpo_cru).encode())
```

## 5. Mídia

Quando a mensagem tem imagem, áudio, vídeo, documento ou figurinha, `media_url` traz um endereço para baixar o arquivo. Ele vale por **10 minutos** e dispensa credencial: baixe ao receber, e não guarde o endereço.

- O arquivo é o que o CRM guardou. Imagem e áudio podem ter sido recomprimidos. O tipo vem no `Content-Type` da resposta do download; um tipo fora da lista do CRM vem como `application/octet-stream`.
- `media_url` nulo numa mensagem de mídia quer dizer que o CRM não tem o arquivo. **Não haverá um segundo repasse** quando ele chegar, e a API não entrega mídia. Trate como mídia indisponível: peça o texto ao cliente, ou passe para um analista.

## 6. O que o agente faz com a mensagem

1. **Confira `conversation_status`.** Só responda com `bot`. Campo ausente ou valor desconhecido é o mesmo que "não é minha".
2. **Descarte repetição** pelo `message_id`.
3. **Responda pelo CRM**, nunca direto no WhatsApp: `POST /api/v1/conversations/{conversation_id}/messages`, com o token de API do agente e uma `Idempotency-Key`.
   - Com um token do tipo **IA**, o CRM confere de novo, na hora do envio, se a conversa ainda está com a IA: se um analista assumiu nesse meio-tempo, a resposta é `409` e a mensagem não sai. Um token do tipo integração não tem essa trava.
   - Há um teto por conversa: 20 envios por minuto e 100 por hora.
4. **Passe para um analista** quando for o caso: `POST /api/v1/conversations/{conversation_id}/handoff`, com uma `Idempotency-Key` e o motivo em `reason`.

O token do agente precisa dos escopos `messages:send`, `conversations:handoff`, `conversations:read` e `context:read`. O acesso "IA de triagem" do CRM já traz os quatro.

Uma mensagem que não chegou ao agente continua no CRM: `GET /api/v1/conversations/{conversation_id}/messages` lista as mensagens da conversa, em páginas.

## 7. Quando o repasse não sai

| Situação | O que acontece |
|---|---|
| Nenhum endereço configurado | O CRM não repassa nada. |
| Endereço recusado: sem HTTPS em produção, endereço de rede interna (IP privado ou reservado, `localhost`, nome sem domínio), ou com usuário e senha | Nada é enviado, e o motivo fica no registro e na tela de configuração. |
| O CRM não consegue ler os dados do envelope, ou a chave de assinatura | O CRM tenta de novo uma vez, 1 segundo depois. Se falhar de novo, nada é enviado e fica no registro. Ele não manda um envelope pela metade, nem sem assinatura quando não sabe se há chave. |
| O agente não responde em 10 s, ou responde fora de `2xx` | Fica no registro como erro, com o status e o tempo. O CRM não envia de novo. |

Cada tentativa fica registrada no CRM (integração `relay`) com o resultado, o status HTTP e o tempo de resposta. O registro não guarda o corpo nem o endereço do agente. Para localizar um evento, informe o `X-CRM-Event-Id`.

Um registro `ok` quer dizer que o endereço respondeu `2xx`, e não que o agente processou a mensagem. Um registro de erro por tempo esgotado ou por conexão cortada não garante que o agente não recebeu.

## 8. O que pode mudar sem aviso, e o que não

- **Campos novos podem aparecer** na raiz e dentro dos objetos do CRM sem mudar `relay_version`. Ignore o que não conhecer.
- Remover um campo, mudar o tipo ou o significado dele só acontece com um `relay_version` novo.
- O conteúdo de `message` e `chat` é da uazapi e segue a documentação dela. Uma chave de raiz do provedor com o nome de um campo do CRM, ou com `event`, `event_id` ou `sent_at` (os do teste de conexão, seção 10), não é repassada, em qualquer combinação de maiúsculas.

## 9. Configuração no CRM

Tudo em Configurações → Agente de IA.

- **Endereço do agente:** *Webhook do agente de IA*. Vazio desliga o repasse. Não existe mais endereço por variável de ambiente.
- **Chave de assinatura:** *Chave de assinatura do webhook* → **Gerar chave**.
  - Quem gera é o CRM: 64 caracteres hexadecimais, mostrados **uma única vez**. Copie e configure no agente. A chave não pode ser digitada nem consultada depois: se ela se perder, gere outra.
  - Sem chave, os pedidos saem sem `X-CRM-Signature`.
  - Gerar, trocar ou remover a chave vale a partir do pedido seguinte.
  - Na troca (**Gerar nova chave**), o CRM passa a assinar com a chave nova na hora, e ela só existe a partir daí: não dá para configurar o agente antes. Até a chave nova estar no agente, ele recusa os pedidos, e um pedido recusado não é enviado de novo. Troque num horário sem movimento, configure o agente em seguida e confira com **Testar conexão**.
  - No cofre do CRM ela fica com o nome `RELAY_SIGNING_SECRET`, fora da lista de variáveis.
- **Testar conexão:** o botão ao lado do endereço (seção 10). Ele testa o endereço **salvo**.

## 10. Teste de conexão (`webhook.ping`)

O botão **Testar conexão** envia um evento `webhook.ping` ao endereço salvo, pelo mesmo caminho do repasse: os mesmos cabeçalhos, a mesma assinatura, o mesmo prazo de 10 segundos, e sem seguir redirecionamento.

| Cabeçalho | No teste |
|---|---|
| `X-CRM-Event` | `webhook.ping`. |
| `X-CRM-Event-Id` | Um identificador novo a cada teste. Repete o `event_id` do corpo. |

O corpo não leva dado de cliente:

| Campo | O que é |
|---|---|
| `event` | Sempre `webhook.ping`. É por ele que o agente reconhece o teste. |
| `event_id` | O identificador deste teste. É o mesmo do cabeçalho `X-CRM-Event-Id`. |
| `relay_version` | Versão deste contrato. Hoje `1`. |
| `sent_at` | Instante em que o CRM montou o pedido (ISO 8601, UTC). |

<!-- exemplo:ping -->
```json
{
  "event": "webhook.ping",
  "event_id": "7c1d0c5e-2f4b-4a6d-9e8f-0a1b2c3d4e5f",
  "relay_version": 1,
  "sent_at": "2026-10-01T12:00:00.000Z"
}
```

O que o agente faz com o teste:

1. **Confere a assinatura**, como em qualquer pedido (seção 4).
2. **Reconhece o teste pelo corpo: `event` igual a `webhook.ping`.** A mensagem do cliente (seção 3) nunca tem o campo `event`: o CRM não repassa uma chave de raiz com esse nome, venha de onde vier. O cabeçalho `X-CRM-Event` diz o mesmo, mas a assinatura não o cobre.
3. **Responde `2xx` e não faz mais nada.** O teste não tem `message`, `conversation_id` nem `conversation_status`: não há conversa, e não há a quem responder.

A tela mostra para qual endereço o teste foi (só o host), o status que voltou e se o pedido foi enviado com assinatura; quando o agente confirma, também o tempo. O teste que chegou a sair também fica no registro do CRM (integração `relay`, ação `webhook.ping`), com o `X-CRM-Event-Id`. Quando nada sai (sem endereço, endereço recusado, falha do CRM ao ler o endereço ou a chave, ou mais de 10 testes por minuto), o motivo aparece só na tela.

O teste confere o caminho até o agente e a resposta dele. Ele não prova que o agente confere a assinatura: um agente que responde `2xx` a qualquer pedido passa no teste.
