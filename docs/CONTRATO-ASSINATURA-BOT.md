# Assinatura das mensagens da IA — contrato CRM ↔ agente

> ⚠️ **Parcialmente desatualizado (Fase 1).** O push da assinatura ao agente continua; a leitura por `GET /api/integracao/bot-signature` foi removida junto com a API antiga e volta na API v1 (Fase 5).

Contexto: as respostas da **IA saem pelo agente direto no WhatsApp (uazapi)** — o
CRM **não** envia essas mensagens, só faz o relay do inbound e registra o echo.
Por isso a assinatura (prefixar um apelido antes do texto) **tem que ser aplicada
no agente**, no momento em que ele monta a resposta.

O CRM é a **fonte de verdade da config** (a tela em *Configurações → Automação /
Integração*: check "assinar" + campo "apelido"). O agente recebe essa config e a
aplica. Duas vias, complementares:

- **Push (CRM → agente):** ao salvar na tela, o CRM faz `POST` no endpoint do
  agente com o valor novo. Caminho rápido/normal.
- **Reconciliação (agente → CRM):** o agente pode ler o valor atual a qualquer
  momento via `GET`. Rede de segurança contra um push perdido (agente fora do ar
  no instante do save) e para o boot do agente.

O que o admin vê e usa no dia a dia é só o **check + apelido + Salvar**.
Regra do produto: **com o check ligado, o apelido é obrigatório** (o CRM não deixa
salvar sem nome; desligado, o campo apelido fica desabilitado).

---

## 1. O que o AGENTE precisa implementar

### 1.1. Receber o push (endpoint no agente) — **obrigatório para o push**

Um endpoint HTTP que o CRM chama ao salvar:

```
POST  <BOT_SIGNATURE_AGENT_URL>
Authorization: Bearer <BOT_SIGNATURE_AGENT_SECRET>     (enviado só se o segredo estiver configurado no CRM)
Content-Type: application/json

{ "enabled": true, "apelido": "Dra. Ana", "updated_at": "2026-07-25T13:00:00.000Z" }
```

O agente deve:
1. Validar o `Authorization: Bearer` contra o segredo combinado (401 se não bater).
2. Fazer **upsert** de um único registro com `{ enabled, apelido }` (idempotente —
   o CRM pode reenviar; sempre reflita o último valor).
3. Responder **2xx** (o corpo é ignorado pelo CRM). Qualquer não-2xx faz o CRM
   avisar na tela que não conseguiu notificar (mas o save no CRM permanece).

O CRM aborta o push após **5s** de timeout — responda rápido (só persista).

### 1.2. Aplicar a assinatura no envio — **sempre**

Ao montar a resposta da IA, se `enabled` e `apelido` preenchido, **prefixe** com o
mesmo formato do atendente humano (negrito padrão WhatsApp):

```
*Dra. Ana:*
<texto da resposta>
```

Ou seja: `` `*${apelido}:*\n${texto}` ``. Se `enabled=false` (ou apelido vazio),
envie o texto **sem** prefixo. Como o WhatsApp devolve o echo, o CRM vai registrar
a mensagem já assinada no histórico — nada a fazer do lado do CRM.

### 1.3. Reconciliação (recomendado)

No boot e/ou periodicamente, o agente busca o valor atual e atualiza o banco dele:

```
GET  https://SEU-CRM/api/integracao/bot-signature
Authorization: Bearer <TOKEN DE API do CRM>        (ou header  x-webhook-secret: <token>)

→ 200  { "ok": true, "enabled": true, "apelido": "Dra. Ana" }
```

É o **mesmo token de API** que o agente já usa nos webhooks do CRM (lead,
appointment, followup). Sem token válido → 401.

---

## 2. O que já está pronto no CRM

- **Tela**: *Configurações → Automação / Integração → "Assinatura das mensagens da
  IA"* (check + apelido com disable/obrigatório + botão Salvar).
- **Storage**: `app_settings.key = 'bot_signature'`, `value = { enabled, apelido }`.
- **Push on save**: ao salvar, o CRM faz o `POST` da seção 1.1 (best-effort, com
  retry manual pela própria tela se falhar).
- **Reconciliação**: `GET /api/integracao/bot-signature` (seção 1.3).

### Config de ambiente do CRM (setup único, feito por nós)

Para o push funcionar, o CRM precisa saber o endereço e o segredo do agente. São
variáveis de **runtime** (`docker compose up -d --force-recreate`, sem rebuild):

| Env | Obrigatória | Descrição |
|---|---|---|
| `BOT_SIGNATURE_AGENT_URL` | para o push | URL do endpoint do agente (seção 1.1). Vazio = CRM não faz push; o agente só reconcilia via GET. |
| `BOT_SIGNATURE_AGENT_SECRET` | recomendada | Segredo enviado no `Authorization: Bearer` do push. Se vazio, o push vai sem header de auth. |

**Me passe a URL do endpoint do agente e um segredo** que eu configuro no `.env` do
CRM. (Se preferir não fazer push agora, é só implementar o GET de reconciliação —
o CRM funciona sem a URL configurada.)

---

## 3. Resumo

- **Obrigatório no agente:** aplicar o prefixo `*apelido:*\n` no envio quando
  `enabled`. A config vem do CRM.
- **Como a config chega:** push (endpoint no agente, seção 1.1) e/ou GET de
  reconciliação (seção 1.3). Recomendo os dois.
- **Do lado do CRM:** já está tudo pronto (tela, storage, push, GET). Falta só você
  me passar a URL + segredo do endpoint do agente para eu ligar o push.
- **Formato da assinatura:** idêntico ao do atendente — `*Nome:*` + quebra de linha
  + mensagem.
