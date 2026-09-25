# Handoff para número e/ou grupo — contrato (agente ↔ uazapi)

Contexto: hoje o handoff do agente vai para **um número específico**. Queremos
adicionar a opção de handoff para um **grupo de WhatsApp** (para mandar
notificações), **mantendo** o número. Os dois canais são **independentes**.

Tudo isto é do lado do **agente** (plataforma spincode) + **uazapi** — o CRM não
entra. O agente já tem a `apiUrl` e o `token` da instância (usa pra enviar), então
lista os grupos e envia direto pela uazapi.

## 1. Config (dois campos, ambos opcionais)

- **`handoff_number`** — telefone (DDI + dígitos, sem `+`) que recebe o handoff.
- **`handoff_group`** — **JID do grupo** (ex.: `120363000000000000@g.us`) que recebe
  o handoff, escolhido num **select** (ver seção 2).

**Regra:** envia o handoff para **cada canal que estiver preenchido**.

| `handoff_number` | `handoff_group` | Resultado |
|---|---|---|
| preenchido | vazio | handoff só pro número |
| vazio | preenchido | handoff só pro grupo |
| preenchido | preenchido | handoff **pros dois** |
| vazio | vazio | **sem handoff** |

## 2. O select de grupos — listar via uazapi (VALIDADO)

Popular o select com os grupos em que a instância está. Endpoint confirmado contra
a instância real (`exemplo.uazapi.com`, conectada):

```
GET  {apiUrl}/group/list
Header:  token: <token da instância>

→ 200  { "groups": [
    { "JID": "120363000000000000@g.us", "Name": "Grupo de handoff (exemplo)", ... },
    { "JID": "120363000000000001@g.us", "Name": "Handoff do suporte (exemplo)", ... }
] }
```

- Use **`JID`** como *value* e **`Name`** como *label* do select.
- Opcional **`?force=true`** refresca a lista direto do WhatsApp (mais lento; sem
  `force` vem do cache da uazapi, mais rápido). Bom usar `force=true` num botão
  "atualizar" do select.
- Só lista quando a instância está **conectada** (`GET /instance/status` →
  `instance.status: "connected"`). Desconectada, retorne o select vazio com um aviso.
- `/groups` e `/group/listall` **não existem** (404) — é só `/group/list`.

## 3. Enviar o handoff pro grupo

Mesmo endpoint de envio de texto que o agente já usa, passando o **JID do grupo** no
campo `number`:

```
POST  {apiUrl}/send/text
Header:  token: <token>
{ "number": "120363000000000001@g.us", "text": "<mensagem de handoff>" }
```

(A uazapi aceita o JID do grupo — `...@g.us` — no campo `number`, igual a um número
normal.)

## 4. Resumo

- **Mantém** o handoff por número; **adiciona** por grupo; cada canal é
  independente (preenchido → recebe; vazio → não recebe).
- **Select** populado por `GET {apiUrl}/group/list` → `{ groups: [{ JID, Name }] }`
  (value = `JID`, label = `Name`).
- **Envio ao grupo** via `POST {apiUrl}/send/text` com `number` = `JID` do grupo.
- Usa a **mesma `apiUrl` + `token`** da instância que o agente já tem — sem
  dependência do CRM.
