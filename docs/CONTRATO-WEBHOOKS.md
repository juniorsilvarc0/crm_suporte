# Webhooks de saída: o que o CRM envia quando um ticket muda

Para quem recebe os eventos de ticket num sistema próprio (ERP, n8n, painel, outro agente). O CRM avisa **que** algo mudou e manda o ticket como está agora; quem precisa de mais lê pela API v1 ([`API.md`](API.md)).

O caminho do agente de triagem, que recebe cada mensagem do cliente, é outro: [`CONTRATO-RELAY.md`](CONTRATO-RELAY.md).

## 1. Destinos e eventos

Um **destino** é uma URL com uma lista de eventos assinados e um segredo próprio. Cada evento que acontece gera **uma entrega por destino** que o assina. Destino pausado não recebe; o que acontecer enquanto ele estiver pausado não é guardado para depois.

| Evento | Quando sai | `data` |
|---|---|---|
| `ticket.created` | ticket aberto (pela tela, pela API ou pela IA) | `ticket_id`, `actor_type`, `metadata` |
| `ticket.updated` | campo do ticket alterado | `ticket_id`, `actor_type`, `metadata` (com `changes`) |
| `ticket.priority_changed` | a alteração incluiu a prioridade (sai junto com `ticket.updated`) | igual ao `ticket.updated` |
| `ticket.assigned` | responsável trocado | `ticket_id`, `actor_type`, `metadata` |
| `ticket.status_changed` | toda transição de status (a abertura não conta: ela é `ticket.created`) | `ticket_id`, `from`, `to`, `actor_type`, `reason` |
| `ticket.reopened` | saiu de `resolvido` de volta para atendimento (sai junto com `ticket.status_changed`) | igual ao `ticket.status_changed` |
| `ticket.comment_added` | nota interna adicionada. **Sem o texto**: quem precisa lê pela API v1, com o escopo próprio | `ticket_id`, `comment_id`, `author_type` (`agent` ou `api`) |
| `ticket.attachment_added` | anexo adicionado | `ticket_id`, `attachment_id`, `file_name`, `mime`, `size_bytes` |
| `ticket.sla_breached` | um prazo de SLA estourou; sai uma vez por ticket e por prazo | `ticket_id`, `deadline` (`first_response` ou `resolution`) |

`webhook.ping` não se assina: é o teste de conexão (seção 6).

## 2. O pedido

`POST` na URL do destino, corpo JSON (`Content-Type: application/json`), com estes cabeçalhos:

| Cabeçalho | Valor |
|---|---|
| `X-CRM-Event` | o nome do evento (ex.: `ticket.status_changed`) |
| `X-CRM-Event-Id` | o mesmo `id` do corpo |
| `X-CRM-Timestamp` | segundos Unix do envio (muda a cada tentativa) |
| `X-CRM-Signature` | `v1=<HMAC-SHA256 em hexadecimal>` (seção 4) |
| `User-Agent` | `crm-suporte-webhooks/1` |

O CRM espera até **10 segundos** pela resposta e **não segue redirecionamento**: um `3xx` conta como falha. Qualquer `2xx` é entrega feita; o corpo da resposta é ignorado.

## 3. O corpo

```json
{
  "id": "4b0c…",
  "event": "ticket.status_changed",
  "occurred_at": "2026-10-09T12:00:00.000Z",
  "data": { "ticket_id": "7c1f…", "from": "em_triagem", "to": "em_atendimento", "actor_type": "agent", "reason": null },
  "ticket": { "id": "7c1f…", "number": 42, "status": "em_atendimento", "version": 3, "…": "…" }
}
```

- **`id`** identifica o evento. É texto opaco (nem sempre um UUID) e se repete nas novas tentativas: use-o para descartar repetição (seção 5).
- **`occurred_at`** é quando o fato aconteceu no CRM, não quando o pedido saiu.
- **`data`** é o fato, como na tabela da seção 1. `actor_type` diz quem fez: `agent` (atendente), `ai`, `api` (token da API v1) ou `system` (o próprio CRM, como no fechamento automático). `from` e `to` são as chaves de status da API v1.
- **`ticket`** é o ticket **como está no envio**, no formato do `GET /api/v1/tickets/{ref}` (schema `Ticket` do `GET /api/v1/openapi.json`). Numa nova tentativa ele pode estar mais novo que o fato. Para ordenar, use `ticket.version`, que só cresce. Ticket que não existe mais vai como `null`.

## 4. Como conferir que o pedido veio do CRM

A conta é a mesma do relay ([`CONTRATO-RELAY.md`](CONTRATO-RELAY.md), seção 4), com o segredo do destino:

1. Recuse se `X-CRM-Timestamp` estiver a mais de **5 minutos** do seu relógio.
2. Calcule o HMAC-SHA256, em hexadecimal, de `<timestamp>.<corpo>`, usando o segredo como texto (UTF-8), exatamente como o CRM o mostrou: são 64 caracteres.
3. Compare `v1=<resultado>` com o cabeçalho, em tempo constante.

**O `<corpo>` são os bytes recebidos**, sem reinterpretar o JSON. No n8n, ligue a opção de corpo cru (*Raw Body*) do nó Webhook. Pedido sem `X-CRM-Signature`, ou com o segredo vazio do seu lado, é pedido recusado.

Para testar a conta (passos 2 e 3), este exemplo tem de dar o mesmo resultado:

| | |
|---|---|
| Segredo | `segredo-de-exemplo` |
| `X-CRM-Timestamp` | `1790000000` |
| Corpo | `{"id":"evt-exemplo","event":"webhook.ping","occurred_at":"2026-10-09T12:00:00.000Z","data":{},"ticket":null}` |
| `X-CRM-Signature` | `v1=91fd8d4f962862bedfd8c23953ddcbb5ddd0d4ff918d5b1266550c7b11ef36e6` |

Código pronto, em Node.js e em Python: [`CONTRATO-RELAY.md`](CONTRATO-RELAY.md), seção 4.

## 5. Entrega: pelo menos uma vez

- **Pode chegar repetido.** Uma resposta perdida no caminho faz o CRM tentar de novo. Descarte pelo `id` do corpo, que a assinatura cobre (o cabeçalho `X-CRM-Event-Id` não é coberto).
- **Pode chegar fora de ordem.** Cada evento é entregue por si. Ordene por `ticket.version` ou por `occurred_at`.
- **Novas tentativas:** depois de uma falha (não `2xx`, prazo estourado ou erro de rede), o CRM tenta de novo em 30 s, 2 min, 8 min, 32 min, ~2 h, ~8,5 h e 24 h. Depois de **8 tentativas**, ou de **3 dias** desde o fato, a entrega para (`dead_letter`). Um administrador pode reenviá-la, e ela volta com as tentativas zeradas.
- **Destino pausado ou excluído** no meio do caminho: as entregas que estavam na fila não saem.
- **Segredo trocado:** vale a partir do envio seguinte. Até o destino conhecer o segredo novo, ele recusa a assinatura, e as entregas entram em nova tentativa: atualize o segredo do seu lado logo depois de trocá-lo no CRM.

**Avisar o cliente sem duplicar.** Quem manda mensagem ao cliente a partir de um evento (ex.: "seu chamado foi resolvido") reivindica o aviso antes, na API v1 (`POST /api/v1/tickets/{ref}/notices/{step}/claim`), e o fecha depois (`/finalize`). Assim, uma entrega repetida não vira mensagem repetida. Passo a passo: [`GUIA-AGENTE-IA.md`](GUIA-AGENTE-IA.md), seção 2.9.

Responda rápido (bem antes dos 10 s) e processe depois: o CRM entrega poucos eventos por vez, e um destino lento atrasa a fila inteira.

## 6. Teste de conexão (`webhook.ping`)

Um administrador pode mandar um `webhook.ping` a qualquer momento. Ele sai na hora, com os mesmos cabeçalhos e a mesma assinatura das entregas, e não entra na fila:

```json
{ "id": "<uuid>", "event": "webhook.ping", "occurred_at": "…", "data": { "subscription_id": "…", "name": "…" }, "ticket": null }
```

Responda `2xx` a um ping com assinatura válida. O desfecho (HTTP e tempo de resposta) aparece para quem testou e fica em **Integrações › Registros**.

## 7. Configuração no CRM

Só administrador, em **Integrações › Webhooks**: cadastrar, editar, testar, trocar o segredo, pausar, excluir, e ver as entregas recentes (com reenvio das esgotadas). As rotas por trás da tela estão em [`API.md`](API.md), seção 4.2.

- **URL:** em produção, só `https`, e nunca um endereço de rede interna.
- **Segredo:** o CRM gera (32 bytes aleatórios, 64 caracteres hexadecimais) e mostra **uma vez**, ao cadastrar e a cada troca. Depois disso ele só existe no cofre do banco e do seu lado.
- **Registro:** cadastro, alteração (os campos, nunca a URL), exclusão, troca de segredo, teste e reenvio ficam em **Integrações › Registros**, na integração *Webhooks*, com quem fez.
- **Histórico de entregas:** as entregas encerradas (entregues, descartadas ou esgotadas) ficam na fila por 30 dias depois da última mudança e então são apagadas. Uma esgotada pode ser reenviada enquanto estiver lá.

## 8. O que pode mudar sem aviso, e o que não

**Não muda sem aviso:** os nomes dos eventos, os cabeçalhos, a conta da assinatura, os campos documentados de `data` e o formato de `ticket` (é o da API v1, com as mesmas garantias de compatibilidade).

**Pode crescer sem aviso:** eventos novos (só chegam a quem os assinar), campos novos em `data`, em `metadata` e em `ticket`. Ignore o que você não conhece.
