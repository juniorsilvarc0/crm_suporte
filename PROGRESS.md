# PROGRESS — CRM Suporte

> **Append-only.** Entrada nova **no topo**. **Nunca** reescreva, resuma ou apague entrada antiga — nem a sua.
>
> Este arquivo existe para que um agente novo retome o trabalho sem perguntar nada básico. O campo mais valioso é **Armadilhas descobertas**: é o que impede o próximo agente de repetir o seu erro.
>
> Atualizar aqui é obrigatório antes de declarar uma task concluída ([`AGENTS.md`](AGENTS.md) §8/§9).

## Formato da entrada

```markdown
## [AAAA-MM-DD] Título curto e específico

**Agente/Modelo:** <ex: Claude Fable 5 · Codex GPT-5.6>
**Objetivo:** 1 frase — o resultado, não a implementação.
**Arquivos alterados:** <lista, ou "nenhum (investigação)">
**O que foi feito:** bullets objetivos.
**Decisões tomadas:** e o motivo de cada uma.
**Verificação:** typecheck ✓ · lint ✓ · test ✓ · build ✓ · bug-hunter ✓ (o que falhou, diga)
**Pendências / próximos passos:**
**Armadilhas descobertas:** o que o próximo agente precisa saber para não errar.
```

Regras: data em `AAAA-MM-DD` (absoluta, nunca "ontem"). Investigação sem código também vira entrada. Se você mexeu em produção, diga **o quê**, **quando** e **como reverter**.

---

> **Origem deste repositório.** Nasceu em 2026-09-25 **sem histórico git**, por decisão do dono (o repo é público). O código veio de um CRM de clínica feito sobre o mesmo template. O histórico e o PROGRESS antigos ficam no repositório privado de origem; as armadilhas técnicas que continuam valendo estão resumidas na entrada "Plano de implantação e repositório novo sem histórico".

## [2026-09-26] Fase 4 · PR 2 — back dos tickets: serviço único, consultas e rotas de sessão

**Agente/Modelo:** Claude Opus 5.5 (workflow em 4 ondas: fundação → libs e consultas → serviço → rotas; revisão adversarial em 4 frentes com verificação independente; correções; roteiro ponta a ponta contra o app local)
**Objetivo:** O app abre, edita, transiciona, atribui e assume tickets e troca o ticket em foco da conversa por rotas de sessão, todas passando por um serviço único de escrita (o mesmo que a API v1 usará na Fase 5).

**Arquivos alterados:** branch `feat/fase4-back-nucleo`.
- `src/config/site.ts`: `ticketPrefix: "SUP"`.
- `src/lib/validation/uuid.ts`: `UUID_RE`/`isUuid`, só para os arquivos novos; as cópias antigas ficam.
- `src/lib/formatters/relative-time.ts`: `formatDuration`, `humanizeUntil` e `humanizeSince`, com floor.
- `src/features/tickets/`:
  - `types.ts`: tipos à mão, inclusive os shapes de resposta que a tela vai consumir;
  - `lib/`: `ticket-status`, `ticket-priority`, `protocol`, `state-machine`, `sla`, `map-ticket-error`, `ticket-error-response` e `ticket-timeline`;
  - `schemas/ticket.ts`;
  - `queries/`: `get-ticket-catalog`, `get-tickets-page`, `get-ticket-detail`, `get-ticket-timeline`, `get-conversation-tickets` e `get-ticket-queue`;
  - `server/ticket-service.ts`.
- Rotas:
  - `POST|GET /api/tickets`;
  - `PATCH /api/tickets/[id]`;
  - `POST /api/tickets/[id]/{transition,assign,take-over}`;
  - `GET /api/tickets/[id]/timeline`;
  - `GET /api/tickets/catalog`;
  - `PUT /api/chat/conversations/[id]/active-ticket`.
- Testes de cada lib, consulta, serviço e rota.
- Docs: PRD (§6, §7.3 do ticket, §8 inventário e domínio Tickets, glossário), AGENTS §4.1, este PROGRESS.

**O que foi feito:**
- **Serviço único** (`server/ticket-service.ts`):
  - o client é injetado (o teste passa um `rpc` falso);
  - o ator vem sempre do viewer;
  - todo jsonb volta conferido por zod;
  - o erro de RPC passa por `mapTicketError` (TAG → constraint → code).
  - **O aviso à IA ao assumir mora aqui:** `pushTakeoverToAgent` só dispara com `conversation_changed`, e o `conversation_external_id` (telefone) nunca sai do servidor.
- **Rotas** no molde de `contracts/[id]/status`: guard na 1ª linha, uuid → 400, zod `.strict()` → 400, erro de negócio no formato `{ok:false, code, message, errors?, allowed?, current?, current_version?}`. Os principais:
  - 409 `invalid_transition` com os destinos permitidos;
  - 409 `version_conflict` com a versão atual;
  - 409 `already_assigned` com o id e o nome de quem está com o ticket.
- **Consultas:** lista pela view `ticket_queue`, com select explícito (nunca `description`, `ai_triage` nem a chave idempotente) e embeds com hint pelo nome da FK. O PostgREST local confirmou que não há PGRST201.
- **Timeline:** 5 leituras em paralelo, com cursor só por instante (ver decisões).

**Decisões tomadas:**
- **Emendas à spec que o PR 1 impôs:**
  - a trilha ordena por `(occurred_at, seq)`;
  - a 1ª resposta conta no aceite;
  - a trava de gestão está nas RPCs.
- **Timeline:**
  - o cursor é só `before` (o instante ISO cru, estrito), e o `beforeId` da spec saiu;
  - uma página nunca separa itens do mesmo instante;
  - dentro do mesmo instante, a ordem é mensagem < comentário < anexo < status/evento (por `seq`);
  - uma fonte que bate no limite de 100 define um piso, e nada fica para trás. Um álbum de fotos grava tudo no mesmo segundo, e o caso existe;
  - os instantes são comparados com precisão de microssegundo, **sem `Date`**: o formato do ECMAScript só garante milissegundos.
- **Busca:** "SUP-1024", "#1024" ou "1024" vira busca por protocolo (`number.eq`). Somada ao filtro padrão "ativos", ela não acha um ticket fechado; decidir na tela (PR 4).
- **SLA:** "Resolvido fora do prazo" julga só a solução, e o `sla.test.ts` espelha os casos do T95. Com a 1ª resposta pendente, um ticket pausado mostra "1ª resposta…", não "Pausado", como a view.
- **Erros:**
  - 23514 de entrada vira 400 com o campo; 23514 de invariante (relógio do SLA, carimbos) é 500 com log, porque é bug;
  - `ticketSummarySchema` é `.strict()`: chave nova do banco dá 500 e não vaza em silêncio.
- **Timeline e consultas:** comentário e mensagem apagados aparecem como apagados, sem conteúdo. `getConversationTickets` recebe o client e lança o erro (a rota responde 500); um foco que ficou fora dos 20 primeiros entra no fim da lista.
- **Catálogo:** só dá 500 quando as 5 partes falham.

**Revisão adversarial** (4 frentes, cada achado atacado por um verificador):
- **Segurança:** nenhum achado. Os guards dos 8 handlers vêm antes de tudo, e nenhuma resposta, erro ou replay traz chave proibida.
- **Contrato com o banco:** um achado. As 6 RPCs batem em nome e tipo, e o jsonb real passa nos schemas.
- **Timeline e SLA:** nenhum achado, em 582 cenários gerados (278 mil itens) sem perder nem repetir item.
- **Testes:** três lacunas.

Confirmados e corrigidos (todos de severidade baixa):
1. **Texto com NUL ou surrogate solto** passava no zod, e o banco respondia 22P05 → 500. Agora o zod recusa (`/[\u0000\p{Cs}]/u`, que deixa emoji passar), e 22P05 entrou nos códigos de entrada inválida. **O mesmo buraco existe em `customers`** (schema e `map-cadastro-error`); fica registrado, fora do escopo.
2. **Faltavam testes** de `getConversationTickets` e `getTicketCatalog`: mutações sobreviviam à suíte inteira.
3. **O `sla.test` não cobria frações de tamanho variável.**

Também: o schema do cursor passou a usar `isTimelineInstant` como fonte única; os tipos de resposta foram para `types.ts`; `getTicketQueue` ganhou teste.

**Verificação:**
- **Roteiro ponta a ponta:** `scratchpad/e2e4.mjs` contra o `next dev` na 3201 e o banco local, com um receptor HTTP no lugar da IA. As 41 conferências passaram:
  - a mesma chave duas vezes gera 1 ticket;
  - `novo→resolvido` → 409 com `allowed`;
  - versão velha → 409 com `current_version`;
  - "Assumir" põe a conversa em `human` e o aviso `{phone, assumed:true}` chega ao receptor, sem 2º aviso quando a conversa já era `human`;
  - admin sem `reassign` → 409 com o nome de quem está com o ticket;
  - trocar o foco muda o ticket em que a próxima mensagem do webhook cai;
  - cancelar tira o ticket do foco;
  - a timeline sai na ordem de gravação;
  - nenhuma resposta traz chave proibida nem o telefone.

  Os dados foram apagados depois.
- Depois das correções: typecheck ✓ · lint ✓ (0 erros; os 9 avisos já existiam) · test ✓ (1666) · build ✓. O roteiro ponta a ponta foi rodado de novo e passou.

**Pendências / próximos passos:**
- **PR 3:**
  - `upsert-message`;
  - limpar e desconectar com ticket → 409;
  - comentários (o `body` leva o mesmo filtro de texto inválido) e anexos;
  - rotas de admin da 4f.
- **PR 4:**
  - a tela monta o cursor com `URLSearchParams`/`encodeURIComponent`: o `+` do fuso vira espaço;
  - decidir a busca por protocolo contra o filtro "ativos".
- **Log de 500:** sai duas vezes (serviço com a causa, rota com o contexto). Aceito.
- **Criar ticket não devolve o novo status da conversa.** O chat depende do Realtime de `chat_conversations`. Se o PR 5 precisar, é acrescentar `conversation_changed` ao `data`.

**Armadilhas descobertas:**
- **A porta 3200 é do container `crm-suporte-web`** do compose, quando ele está no ar. Rode o `next dev` de teste em outra porta (3201) e não derrube o container.
- **Finder aberto na pasta do projeto trava o build:** ele recria `.next/.DS_Store` enquanto o Next apaga a pasta, e dá `ENOTEMPTY`. Feche a janela ou repita.
- **`psql -At` com `INSERT … RETURNING` imprime também "INSERT 0 1".** Use `-q` quando o script lê o id.
- **A fração do PostgREST varia de 0 a 6 casas:** compare instantes por microssegundos inteiros, nunca pelo tamanho do texto nem por `Date.parse`.

## [2026-09-25] Fase 4 · PR 1 — banco dos tickets: máquina de estados, SLA e ticket em foco

**Agente/Modelo:** Claude Opus 5.5 (desenho por workflow: leitores → 3 arquitetos → juiz; testes e corridas por subagentes; revisão adversarial da migration com verificação independente)
**Objetivo:** O banco guarda o ticket e garante sozinho as regras da Fase 4: status só pela matriz, SLA com pausa, 1ª resposta humana, mensagem nascendo no ticket em foco. É o 1º dos 7 PRs da Fase 4, só com a camada de banco; o app atual roda em cima dele sem mudança.
**Arquivos alterados:**
- `supabase/migrations/20260925120900_tickets.sql`
- `supabase/tests/tickets.sql` (153 casos)
- `supabase/tests/cadastros.sql` (P01c)
- `src/lib/supabase/database.types.ts` (gerado)
- `PROGRESS.md`

**O que foi feito:**
- **Tabelas:**
  - `ticket_statuses`: 8 chaves fixas; rótulo e cor editáveis.
  - `ticket_status_transitions`: a matriz, só leitura.
  - `sla_policies`: `baixa|media|alta|critica` = 8h/72h, 4h/24h, 1h/8h, 30min/4h, com aviso a 80%.
  - `ticket_categories`: 2 níveis, opcionalmente presas a uma fila.
  - `tickets`: protocolo `number` a partir de 1000, exibido como SUP-1000.
  - Satélites: `ticket_status_history` e `ticket_events` (append-only), `ticket_comments`, `ticket_attachments` (bucket privado `ticket-attachments`).
  - Chat: `chat_conversations.active_ticket_id` e `chat_messages.ticket_id`.
  - View `ticket_queue`, com o SLA calculado na leitura.
- **Escrita só por RPC SECURITY DEFINER**, que confere o ator no banco (usuário ativo ou token vigente): `create_ticket`, `ticket_update`, `ticket_transition`, `ticket_assign`, `ticket_set_active`, `ticket_take_over`. O `service_role` só lê `tickets` e a trilha, e `guard_ticket_update` barra até o dono.
- **Triggers:**
  - carimbo do ticket em foco no INSERT da mensagem, ignorando o valor que vem do app;
  - 1ª resposta pela mensagem humana entregue;
  - retomada de `aguardando_cliente` para `em_atendimento` quando o cliente responde;
  - saída do foco quando o ticket termina.
- **Decisões do dono aplicadas** (rodada de perguntas da Fase 4):
  - matriz proposta: o member pode tudo no ticket (cancelar pede motivo) e os catálogos são só do admin;
  - `resolvido` não reabre sozinho;
  - o tempo em `resolvido` pausa o prazo de solução, e a 1ª resposta nunca pausa;
  - resposta humana anterior à abertura conta como 1ª resposta, na abertura;
  - todo ticket nasce de conversa;
  - tickets fora do Realtime nesta fase.
- **`cadastros.sql` P01c:** a Fase 4 abre UPDATE de fila para a tela de Configurações (4f), então o teste agora prova só que fila não é apagada. A troca está coberta pelo T93 de `tickets.sql`.

**Decisões tomadas:**
- **Ordem da trilha por `seq`.** A corrida R2 mostrou "novo → em_atendimento" antes de "∅ → novo", e `ticket.focused` antes de `ticket.created`. Causa: uma RPC grava várias linhas na mesma transação, todas com o mesmo `occurred_at` (`v_now`), e o `id` é um uuid aleatório. Correção:
  - a sequência `public.ticket_log_seq` alimenta a coluna `seq` de `ticket_status_history` **e** de `ticket_events`, então a ordem vale entre as duas tabelas;
  - os índices passaram a `(ticket_id, occurred_at desc, seq desc)`;
  - o `occurred_at` continua igual ao `v_now`, porque as métricas da Fase 9 o comparam com os carimbos do ticket;
  - o T18b trava a ordem.

  A migration nunca saiu do banco local, então a correção entrou no próprio arquivo. O banco local recebeu o mesmo delta por `ALTER`, com a coluna por último nos dois lugares.
- **Consequência para o PR 2.** `getTicketTimeline` ordena history e events por `(occurred_at, seq)`, não por `(at, id)` como a spec dizia. O cursor precisa respeitar isso.
- **Correção na spec da corrida R3.** "O outro recebe `VERSION_CONFLICT`" só vale quando a mensagem chega primeiro. Quando a transição vem primeiro, a mensagem perde **sem erro**:
  - ela vem de um trigger;
  - o webhook nunca pode falhar;
  - `resolvido` não é retomado.

  O comportamento está certo.
- **Revisão adversarial da migration** (4 frentes: segurança, estado/SLA, travas/triggers, compatibilidade com o app; cada achado atacado por um verificador independente). Compatibilidade: nenhuma quebra; o código da `main` roda em cima. Dois achados confirmados e corrigidos no próprio arquivo:
  1. **1ª resposta conta no ACEITE, não no `created_at`** (média). O reenvio de uma mensagem `failed` (`send/route.ts`) reaproveita a mesma linha, com o `created_at` da tentativa que falhou, e o `service_role` nem tem UPDATE nessa coluna. Com o carimbo por `created_at`, uma resposta aceita 6 h depois da abertura ficava registrada como dada em 10 min, e o prazo aparecia cumprido.
     - Agora `ticket_sla_from_chat_message` usa `now()` no UPDATE que aceita e `created_at` no INSERT já aceito. Vale igual para `first_ai_response_at`.
     - No envio normal a diferença é a latência do provedor.
     - **Muda a escolha da spec** ("`created_at`, não o `now()` do tick") e fica alinhado à decisão 4 do dono: só conta o que o cliente recebeu.
     - Testes: T31c e T31d agora esperam o aceite, e o T31e cobre o reenvio atrasado, fora do prazo, para o analista e para a IA.
  2. **Deadlock entre `delete_app_user` e as RPCs de ticket com o mesmo usuário** (baixa). A exclusão trava mensagens → `app_users` → set null em `tickets`; a RPC trava ticket → `app_users` pela FK. Dava 40P01 em `create_ticket` e em `ticket_take_over`.
     - Agora `require_ticket_actor`, a 1ª instrução de toda RPC de ticket, pega em modo **compartilhado** o advisory lock `public.app_users:gestao`, que as RPCs de gestão de usuário já pegam exclusivo.
     - A função passou a `volatile`: `stable` conferiria o ator no snapshot de antes da espera.
     - Contraprova: as corridas do verificador repetidas no clone, sem 40P01.
     - **Resíduo aceito:** INSERT direto em `ticket_comments`/`ticket_attachments` (PR 3) com autor = usuário sendo apagado ao mesmo tempo ainda pode dar 40P01. É raro e se resolve repetindo; o PR 3 pode passar por RPC com a mesma trava, se valer.

**Verificação:**
- **Testes SQL** (`./scripts/db-local-test.sh`): baseline 52, cadastros 63, segredo_integracao 7 e tickets 153, todos ok.
- **Aplicação do zero, provada fora do CI.** Montei um banco descartável `crm_fresh` no mesmo container:
  - `create database … owner postgres`;
  - `pg_dump -s -N public -N supabase_migrations` do `postgres`, restaurado como `supabase_admin`;
  - os default privileges da imagem e do `docker/db-init.sql`.

  Resultado:
  - as 10 migrations aplicam, com "baseline ok: 30 tabela(s) e 62 função(ões)";
  - as 4 suítes SQL passam nele;
  - o `pg_dump -s -n public` dele é idêntico ao do banco local, a não ser por 3 default privileges do `postgres` para si mesmo que a imagem cria ao subir;
  - os buckets e a publication do Realtime também são iguais.
- **Mutações, só no `crm_fresh`:**
  - sequência invertida: falha o T18b;
  - trigger de carimbo desligado: a suíte cai;
  - pausa que não empurra o prazo de solução: barrada pela CHECK `tickets_resolution_due_check` e pelos testes;
  - carimbo da 1ª resposta de volta ao `created_at`: falham T31c, T31d e T31e.
- **Corridas R1–R5**, com duas ou três sessões `psql` reais, `pg_sleep(5)` segurando a trava, um observador em `pg_stat_activity`/`pg_locks` e `log_lock_waits`. Nenhuma sessão recebeu 40P01, e o log do servidor tem 0 "deadlock".

  | Corrida | Resultado |
  |---|---|
  | R1a (inbound → `create_ticket`) | B esperou a trava FOR UPDATE da conversa; o ticket nasceu com a mensagem vinculada (`linked_messages=1`) |
  | R1b (`create_ticket` → inbound) | a mensagem nasceu carimbada no ticket novo |
  | R2 (dois "Assumir") | o segundo recebe `ALREADY_ASSIGNED`; um único `ticket.assigned` |
  | R3a (inbound → transição com a versão velha) | `VERSION_CONFLICT` |
  | R3b (transição → inbound) | `resolvido` v5, sem retomada e sem erro |
  | R4a (inbound → cancelar) | a mensagem ficou no ticket; foco nulo |
  | R4b (cancelar → inbound) | a mensagem ficou **solta**; nunca cai em ticket encerrado |
  | R5 estresse (rename × inbound × "Assumir") | 200 + 200 (com folga aleatória) + 1000 voltas, 0 erros; uma 4ª sessão pausando: 200 voltas, só `VERSION_CONFLICT` esperados. 1600/1600 mensagens no ticket em foco |

  Os roteiros ficaram no scratchpad da sessão e não entram no repo.
- **App:** typecheck ✓ · lint ✓ (0 erros; os 9 avisos já existiam) · test ✓ (99 arquivos, 1078) · build ✓ (rodado no checkout principal com o `database.types.ts` novo; ver armadilhas).

**Pendências / próximos passos:**
- PRs 2–7 da Fase 4, cada um a partir da `main` depois do merge do anterior:
  - 2: back, núcleo;
  - 3: back do chat, conexão, satélites e catálogos;
  - 4 a 7: telas.
- A migration roda **só no banco local** (`./scripts/db-local-apply.sh`). Produção não existe (Fase 10).

**Armadilhas descobertas:**
- **`pnpm` global desta máquina é o 10.2.0**, que recusa o `pnpm-workspace.yaml` só com configurações ("packages field missing or empty"). Use `npx -y pnpm@10.33.0 <script>`, a versão do `packageManager`.
- **Worktree com `node_modules` em symlink:** o Turbopack recusa ("points out of the filesystem root"), então `next build` não roda nele. `tsc`, `eslint` e `vitest` rodam por `node_modules/.bin/`. O build roda num checkout com `node_modules` de verdade.
- **Depois de um `next build`, o vitest também acha `.next/standalone/**/*.test.ts`** (100 arquivos em vez de 99). Não é teste novo.
- **Mesmo `occurred_at` numa transação:** trilha nova ordena por `seq`, nunca por `id` uuid.
- **Tempo nos testes SQL:**
  - `guard_ticket_update` barra `created_at` até para o dono. Para "passar o tempo", `pg_temp.shift_ticket` usa `set local session_replication_role = replica` (como comando `SET`; `set_config()` dá "permission denied");
  - `format('%s', boolean)` escreve `t`/`f`.
- **Sequência não volta no ROLLBACK:** os testes consomem protocolos. No banco local, o próximo ticket sai com número alto (a sequência já passou de 1100 e sobe a cada rodada), e isso não é bug.
- **`chat_integrations.provider` é UNIQUE:** um teste que commita uma integração quebra o `baseline.sql` de quem roda depois no mesmo banco.

## [2026-09-25] Fase 3 — cadastros: empresas, filas, planos, contratos e o selo no chat

**Agente/Modelo:** Claude Opus 5.5 (orquestrando workflows de subagentes: desenho com leitores + 3 arquitetos + juiz; back e front em ondas; revisão adversarial em 5 lentes com verificação independente)
**Objetivo:** O analista liga um contato do WhatsApp a uma empresa e vê no chat o selo do contrato ("Contrato suspenso"); há telas de Clientes e Contatos e cadastro de filas (produtos), planos e contratos de suporte.
**Arquivos alterados:** branch `feat/fase3-cadastros`, commits separados por camada (`git log 856b404..HEAD`). Por camada:
- **Infra:** app local na porta **3200** do host (decisão do dono; o container segue na 3000).
- **Banco:** `supabase/migrations/20260925120700_cadastros.sql`, `…120800_encerrar_contrato_futuro.sql` e `supabase/tests/cadastros.sql`.
- **Back:**
  - `src/lib/formatters/{cnpj,search-text}.ts`;
  - `src/features/{contracts,customers,products,contacts}/*`;
  - rotas `/api/{customers,products,support-plans,contracts}/**`, mais `PATCH /api/contacts/[id]` e a rota de contato do chat.
- **Front:**
  - `/app/clientes`, `/app/clientes/[id]` e `/app/contatos`;
  - painel do contato do chat;
  - `ListPagination`, `CatalogCombobox`, `CustomerPicker` e `ContractStatusBadge`;
  - navegação.

**O que foi feito:**
- **Modelo:**
  - empresa (`customers`) com CNPJ alfanumérico opcional e único entre ativas;
  - fila (`products`) e plano (`support_plans`);
  - contrato de suporte com filas cobertas;
  - `contacts.customer_id` com FK;
  - ligar, trocar e desligar empresa viram `contact_events`.
- **Invariantes no banco:**
  - no máximo 1 contrato **vigente** (ativo ou suspenso) por empresa;
  - encerrado é terminal;
  - vencimento 1..28;
  - empresa arquivada não recebe contrato nem vínculo novo e não arquiva com vigente;
  - o selo (`customers.contract_status`) é derivado por trigger.
- **Valor protegido na estrutura:**
  - o `service_role` não tem SELECT em `monthly_amount`;
  - a única leitura é `get_support_contract_amounts`, que confere admin ativo;
  - contrato só é escrito pelas RPCs, que conferem admin de novo;
  - um `select('*')` em contrato falha com 42501, de propósito.
- **Papéis (decisão do dono):**
  - member cria e edita empresa e liga ou desliga contato;
  - admin arquiva e reativa, cria fila e plano e escreve contrato.
- **Onde aparece o quê:**
  - a ficha decide o papel no servidor, e o payload do member não leva valor nem vencimento;
  - o painel do chat mostra empresa + selo e nunca valor.
- **react-hook-form + zod compartilhado com a rota:** primeiro uso real (UI.md §5.23).

**Decisões tomadas:**
- **Com o dono:**
  - 1 contrato vigente, e não "1 ativo" do plano;
  - vencimento 1..28;
  - só CNPJ, sem CPF;
  - os papéis acima.
- **Minhas:**
  - encerrar sem data um contrato futuro usa o maior entre hoje e o início (migration `…120800`);
  - `cadastroErrorResponse` para o bloco que se repetia em 5 rotas;
  - `isColorName`/`getColorStyle` com `Object.hasOwn` (antes, `"constructor"` passava);
  - catálogo que falha devolve `null` e o combobox diz "não foi possível carregar" (a spec pedia `[]`).
- **Rotas além do plano:** `POST /api/support-plans`, `POST /api/customers/[id]/restore` e `POST /api/contracts/[id]/status`.

**Verificação:**

| Check | Resultado |
|---|---|
| typecheck | ✓ |
| lint | ✓ 0 erros; 9 avisos que já existiam |
| test | ✓ 100 arquivos, 1081 testes |
| build | ✓ |
| SQL | ✓ cadastros 63/63; baseline 52/52; segredo 7/7; reaplicar = 0 migrations; tipos gerados sem diff |

- **Testes que pegam regressão:** uma cópia de `cadastros.sql` com grants injetados (valor, anon, helper como RPC) reprova os casos certos.
- **Corridas provadas em duas sessões psql**, como service_role:
  - dois `create_support_contract` simultâneos: o 2º espera a trava e recebe `CURRENT_CONTRACT_EXISTS`;
  - contrato × arquivar, nas duas ordens: nunca empresa arquivada com contrato vigente;
  - ligar × arquivar: só estados permitidos. As travas não conflitam; o resultado equivale a ligar e depois arquivar.
- **Ponta a ponta com o app em container na porta 3200** (admin e member reais):
  - fila e plano pelo admin; empresa com CNPJ alfanumérico pelo member;
  - 409 de CNPJ repetido apontando a existente; DV errado → 400;
  - member não cria contrato nem fila (403);
  - contrato criado e suspenso; 2º vigente → 409;
  - webhook cria o contato, o member liga, e o painel mostra `suspenso` (**pronto quando**);
  - sem valor nem vencimento no painel, na busca e no HTML da ficha do member (conferido com padrões que resistem aos comentários do React);
  - o admin vê "R$ 1.234,56" e "Todo dia 10";
  - arquivar com vigente → 409.

  Os dados de teste foram apagados.
- **Revisão adversarial**, 5 lentes com verificação independente: 5 achados confirmados, todos corrigidos:
  - **média:** listas liam sem confirmar o usuário. Veio junto o teste de contrato `pages-guard.test.ts`;
  - **média:** página exatamente no fim (206 com lista vazia);
  - **baixas:** ano 0000 → 500; produto criado em voo apagava o escolhido; selo empurrava o "Atual" para fora do seletor.

  Nenhum achado alto.

**Pendências / próximos passos:**
- **Push e PR** (sem merge).
- **Conferir no navegador antes do merge** (sem Playwright, por regra):
  - Esc voltando um passo no painel do chat;
  - combobox e select dentro da gaveta (< 640px);
  - barra com 3 abas;
  - selo e "Empresa arquivada" no tema escuro;
  - arquivar em dois toques no Safari do iOS;
  - `type="date"` no iOS.
- **Limites conhecidos:**
  - o seletor de empresa mostra as 20 primeiras;
  - "Contatos (N)" da ficha para em 200;
  - o filtro "Todas" não inclui arquivadas;
  - a busca não normaliza NFD;
  - trecho de telefone com menos de 4 dígitos vira busca por nome;
  - o selo não é ao vivo (sem Realtime em `customers`).
- **Fora da fase, anotados:**
  - `api/chat/conversations/route.ts` monta `.or()` com termo cru (injeção de filtro PostgREST);
  - `api/tags` devolve `error.message`;
  - `dialog.tsx` passa `undefined as never` no ramo gaveta;
  - `@aws-sdk/client-s3` sem uso.
- **Próxima fase:** Fase 4 (tickets).

**Armadilhas descobertas:**
- **`select('*')` em `support_contracts` dá 42501 para TODOS**, admin inclusive. Isso também vale para `.select()` sem argumento e para o embed `support_contracts(*)`. É a falha fechada escolhida. Colunas sempre por constante, e o `Row` gerado (que traz `monthly_amount`) nunca vira tipo de tela.
- **Página server que lê dado precisa do guard própria.** O layout de `(dashboard)` não roda na navegação pelo cliente.
- **O PostgREST responde 206 com `[]` quando o offset é igual ao total**, e 416 (`PGRST103`) só depois dele. Paginação precisa tratar os dois.
- **`z.iso.date()` aceita o ano 0000**, que o Postgres recusa (22008).
- **`in` num objeto de lookup aceita chaves do protótipo.** Use `Object.hasOwn`.
- **RHF:** o `field.value` do `Controller` é o valor da renderização. Callback que termina depois de um `await` deve ler `getValues()`.
- **`<div>` dentro de `<button>` é HTML inválido.** Envoltório de badge em linha-botão é `span`.
- **Comentários do React quebram regex de texto no HTML** (`Todo dia <!-- -->10`). Checagem de vazamento procura o rótulo e o valor separados.

## [2026-09-25] Fase 2 — baseline novo, contato no lugar de lead, segredos no Vault e mídia privada

**Agente/Modelo:** Claude Opus 5.5
**Objetivo:** O CRM de suporte roda inteiro no banco novo: contato no lugar de lead, nenhuma credencial de integração em tabela ou env, mídia do cliente fora do alcance público e chat ao vivo pelo Realtime.
**Arquivos alterados:** branch `feat/fase2-baseline-contatos`, commits separados por camada (`git log 1c6e8f0..HEAD`).
- **Banco (commit do baseline):**
  - `supabase/migrations/202609251201{00..500}_*.sql`, 6 arquivos;
  - `supabase/seed.sql` e `supabase/tests/baseline.sql`;
  - as 45 migrations da clínica foram para `supabase/legado-clinica/`.
- **Infra:**
  - `docker-compose.yml`, com `realtime` e `storage`;
  - `docker/db-init.sql` e `docker/dev-gateway.conf`;
  - `scripts/db-local-apply.sh` (com livro-razão) e `scripts/db-local-test.sh`;
  - CI com o job `banco`.
- **Back:**
  - `features/contacts` e `/api/contacts`, `/api/contacts/[id]`, `/api/contacts/[id]/avatar`;
  - `/api/chat/media/[id]`;
  - `src/lib/storage/chat-media.ts`, `put-media.ts` (o `r2.ts` saiu) e `features/chat/lib/media/stored-media.ts`;
  - `features/chat/lib/connection/integration.ts` e `lib/security/safe-equal.ts`;
  - webhook uazapi, rotas de envio, `persist`, transcrição, `get-runtime-environment.ts`;
  - tipos gerados em `src/lib/supabase/database.types.ts`.
- **Front:**
  - tela de contato do chat e cartão de contato;
  - `image-variant.ts`;
  - `use-chat-realtime.ts` e `subscribeAuthenticated`, em `lib/supabase/client.ts`.

**O que foi feito:**
- **Baseline novo** (6 migrations: fundação, usuários, integração, contatos, chat, storage/realtime; mais `20260925120600`, que vem da revisão):
  - toda migration termina em `assert_security_baseline()`;
  - `service_role` com grant mínimo, por coluna onde importa;
  - `chat-media` privado, com teto de 50 MB e lista de MIME;
  - Realtime só para `authenticated` com `app_role`.
- **Tipos do banco gerados** (`pnpm db:types`, supabase CLI 2.118.0 via `npx`). O `types.ts` escrito à mão saiu.
- **Contatos:**
  - `resolve_contact_identity` substitui o resolvedor de lead, sem o ramo de deal;
  - `PATCH /api/contacts/[id]` edita só nome, e-mail e notas, e responde 422 se vier telefone;
  - `POST /api/contacts` cria pelo resolvedor.
- **`sender_type` em toda mensagem:**
  - `contact` na entrada;
  - `device` no fromMe do celular da empresa;
  - `agent` em envio, nota, anexo, áudio e encaminhamento.
- **uazapi no Vault:**
  - `config` guarda só a `apiUrl`;
  - o segredo do webhook é gerado por integração e comparado em tempo constante;
  - sem segredo, o webhook responde 401;
  - saíram os logs `[uazapi-dbg]` e o log do envelope cru, que trazia o `token`.
- **Mídia privada:**
  - `media_bucket`/`media_key` na linha;
  - `media_url` = `/api/chat/media/<id>`, que confere a sessão e redireciona (302) para URL assinada de 10 min;
  - foto do contato em `contacts.avatar_*`;
  - a uazapi baixa por URL assinada;
  - a transcrição lê pelo `service_role`.
- **Cofre:**
  - catálogo tipado (`OPENAI_API_KEY`, `OPENAI_TRANSCRIPTION_MODEL`), cache de 60 s, sem fallback para env;
  - cofre ilegível → 503.
- **Correções achadas no caminho:**
  - guard de banco que três rotas chamavam sem testar o resultado;
  - etiquetar conversa falhava sempre;
  - prévia não limpava com nota depois;
  - clique duplo e reenvio simultâneo mandavam duas vezes;
  - `INVALID_ROLE` virava 500;
  - Realtime assinava como `anon` (ver Armadilhas).

- **Revisão adversarial independente** (subagente, só leitura, sobre o diff inteiro da fase): nada de severidade alta ou média. Os três achados baixos foram corrigidos:
  1. **Teste de contrato de guard:** aceitava guard num ramo quando o banco era acessado por helper, que é justamente a regressão real de `messages/[messageId]`. Agora helper que acessa o banco conta como acesso, guard dentro de `if` não vale, e o teste do resultado tem de vir antes do banco.
  2. **Segredo do webhook:** duas conexões simultâneas podiam deixar o Vault e a uazapi com segredos diferentes. Entrou a RPC atômica `ensure_chat_integration_secret` (migration `20260925120600`), e o `persist` registra o valor que ela devolve. Corrida provada em duas sessões: as duas devolvem o mesmo segredo.
  3. **Cache do cofre:** uma leitura em voo repunha o valor antigo depois da invalidação. Agora há um contador de geração.

**Decisões tomadas:**
- **`POST /api/contacts`, e não `/api/contacts/manual`.** A Fase 3 põe a listagem no mesmo recurso. A origem `api` fica reservada à API v1.
- **Redirect para URL assinada, não proxy dos bytes.** `<audio>`/`<video>` pedem por Range, e o storage-api já responde isso.
- **A cópia encaminhada aponta para o mesmo objeto do bucket**, sem novo upload.
- **Segredo do webhook mantido ao reconectar.** Trocar é rotação explícita, da aba Conexão na Fase 5.
- **O front de Configurações ainda tem o ramo `source === "environment"`**, inalcançável. A aba Cofre da Fase 5 reescreve essa tela.
- **Portas locais:** o plano previa 3100/55321/55322, mas o compose seguiu em 3000/54321/54322, a convenção do Supabase local. Nesta máquina, a 3000 e a 3100 estão ocupadas por containers de outros projetos, e o teste ponta a ponta rodou `next dev -p 3200`. **Decisão pendente do dono.**
- **Corrida de identidade provada em duas sessões** (é o caso que `supabase/tests/baseline.sql` não cobre):
  1. a sessão A resolve `+55 (11) 99000-0777` e segura a transação por 2 s;
  2. a sessão B resolve `5511990000777` 0,5 s depois e fica bloqueada no lock por telefone até o commit de A;
  3. B devolve `created=false`.

  Resultado: um contato só, com o nome de A preservado.

**Verificação:**

| Check | Resultado |
|---|---|
| typecheck | ✓ |
| lint | ✓ 0 erros; 9 avisos que já existiam, em `verify-webhook.test.ts` |
| test | ✓ 78 arquivos, 737 testes |
| build | ✓ |
| SQL | ✓ baseline 52/52 e segredo da integração 7/7; reaplicar = 0 migrations; tipos gerados sem diff |

- **Commits isolados:** os commits que separei à mão foram validados em árvore isolada (`git checkout-index`).
- **Ponta a ponta com `next dev` no stack local** (24 passos, todos ✓):
  - webhook: 401 sem segredo e com segredo errado; cria contato, conversa e mensagem; retry não duplica nem infla não lidas; fromMe vira `device`;
  - Realtime entrega conversa e mensagem com dados;
  - rotas: lista e tela de contato; PATCH de notas 200 e de telefone 422; etiquetar 2× dá 200/200;
  - mídia: sem sessão 401; com sessão 302 para URL assinada na origem pública, que entrega o arquivo; foto do contato 302.

  Os dados de teste foram apagados depois.
- **Vault e storage validados pelo PostgREST** como `service_role`:
  - `config` com token → 23514;
  - segunda integração → 23505;
  - `anon` na RPC → 42501;
  - apagar a integração apaga os segredos;
  - URL pública do objeto → 400;
  - MIME com parâmetro e `text/html` → recusados.

**Pendências / próximos passos:**
- **Push e PR** (sem merge).
- **`@aws-sdk/client-s3` ficou sem uso** no `package.json`: remover num PR `chore`.
- **O relay para a IA ainda manda o envelope cru**, com o `token` da instância. É a Fase 5, relay v1.
- **Objetos substituídos ficam no bucket:** foto antiga do contato e mídia de mensagem apagada. Falta uma limpeza.
- **Deploy (Fase 10):** criar o 1º admin e fechar os default privileges do `supabase_admin` em produção (ver `DEPLOY.md`).

**Armadilhas descobertas:**
- **Realtime assina como `anon` se o join sair antes do token.**
  - O `supabase-js` com `accessToken` assíncrono manda o join assim que o WebSocket abre. Se a busca de `/api/auth/supabase-token` perde a corrida, a assinatura de `postgres_changes` é gravada em `realtime.subscription` com `claims_role = anon`, e todo evento chega com `new: {}` e `errors: ["Error 401: Unauthorized"]`.
  - O token que chega depois **não** corrige a assinatura já gravada.
  - Use sempre `subscribeAuthenticated`, que espera o `setAuth()`.
  - Diagnóstico: `select claims_role from realtime.subscription`.
- **A 1ª conexão ao Realtime depois de subir o stack falha** (`Tenant realtime-dev is initializing`). As seguintes funcionam.
- **`service_role` tem grant mínimo.**
  - Upsert sem `ignoreDuplicates` vira `ON CONFLICT DO UPDATE` e exige UPDATE, que `conversation_tags` e `contact_tags` não têm.
  - `select('*')` em `app_users`/`app_environment_variables` falha: o SELECT é por coluna.
- **O bucket compara MIME literal.** `audio/ogg; codecs=opus` é recusado; `storageContentType` tira os parâmetros.
- **A URL assinada nasce com a origem INTERNA** (`SUPABASE_URL`, que no Docker é `host.docker.internal`). `signStorageObject` troca pela pública (`NEXT_PUBLIC_SUPABASE_URL`).
- **`normalize_phone` tira o DDI 55:** `5511990000123` é gravado como `11990000123`.
- **O compose valida o `env_file` do `web` mesmo subindo só `db`.** Sem `.env.local`, nem `config` roda; o CI copia o exemplo.
- **O ECR público (`public.ecr.aws`, imagem do Postgres e do PostgREST) limita pull anônimo por segundo, e os runners do GitHub dividem IP.** O 1º run do job `banco` falhou em 11 s com `toomanyrequests: Rate exceeded`. O job agora puxa em série (`COMPOSE_PARALLEL_LIMIT=1`) e com até 5 tentativas; no run seguinte, precisou de 2.
- **`git add -p` não existe neste ambiente.** Para separar commits de um arquivo com mudanças de dois assuntos, monte a versão intermediária, grave com `git hash-object -w` + `git update-index --cacheinfo` e valide com `git checkout-index -a --prefix=<dir>`.

## [2026-09-25] Sessão confirmada no banco em toda rota /api e login sem open redirect

**Agente/Modelo:** Claude Opus 5.5
**Objetivo:** Fazer um usuário desativado, ou com papel que o app não conhece, perder o acesso às rotas `/api` na hora, e não só quando o cookie de 7 dias vence. Fazer o login redirecionar só para a própria origem.
**Arquivos alterados:**
- **Rotas com guard novo (13):** chat (`conversations/[id]` GET, `contact`, `search`, `send-audio`, `send-file`, `[id]/tags`, `conversations/tags`, `transcribe`), `connection/state`, `tags`, `tags/[id]`, `settings/automation` GET, `settings/bot-signature` GET.
- **Rotas de lead:** `leads/[id]` e `leads/manual`.
- **Guard:** `require-dashboard-session.ts` (sai `hasDashboardSession`).
- **Login:** `login-form.tsx`.
- **Novos:** `src/features/auth/lib/safe-redirect.ts` (+ teste) e `src/app/api/api-guards.test.ts`.
- **Testes ajustados:** `leads/manual` e `transcribe`.

**O que foi feito:**
- **Guard de banco na primeira linha**, antes de ler o corpo (upload de até 64 MB em `send-file`):
  - `requireDashboardUser()` nas rotas de chat e etiquetas;
  - `requireDashboardAdmin()` em `connection/state` e nos dois `GET` de configuração, que só as telas de admin usam.
- **Rotas de lead:** trocaram `hasDashboardSession` (só confere o cookie) por `requireDashboardUser`. O `hasDashboardSession` saiu, porque sem uso ele só convidaria o mesmo erro.
- **Teste de contrato:** varre todo `route.ts`, decide o que é público pela mesma lista do guard (`isPublicApiRoute`) e falha se um handler não chamar guard de banco, direto ou por função local. Foi validado com uma rota-sonda sem guard, que ele reprovou.
- **Login:** `safeRedirectPath` resolve o `?redirect=` contra a origem do app e só aceita a mesma origem. Os testes cobrem `https://`, `//`, `/\`, tab, `javascript:` e `data:`.

**Decisões tomadas:**
- **Guard em cada handler, e não consulta ao banco no proxy.** No proxy pesaria em toda requisição, inclusive páginas e assets; nos handlers, o custo é uma leitura de `app_users` por chamada de API.
- **`connection/state` e os `GET` de configuração ficam só para admin**, porque os únicos chamadores são telas de admin.

**Verificação** (com `pnpm@10.33.0`):

| Check | Resultado |
|---|---|
| typecheck | ✓ 0 erros |
| lint | ✓ 0 erros; 9 avisos que já existiam |
| test | ✓ 72 arquivos, 669 testes |
| build | ✓ |

**Pendências / próximos passos:** o webhook da uazapi sem segredo configurado segue aberto e é tratado na Fase 2.

**Armadilhas descobertas:**
- **Teste de rota que não mocka o guard quebra com "`cookies` was called outside a request scope"**, porque o guard lê o cookie. Mocke `@/lib/auth/require-dashboard-session`.
- **Varredura de guard por handler dá falso negativo quando o guard vive num helper local** (caso do avatar). O teste de contrato aceita helper do mesmo arquivo que chama o guard.

---

## [2026-09-25] Reescrita do commit inicial público (dados da origem)

**Agente/Modelo:** Claude Opus 5.5
**Objetivo:** Tirar do histórico público os dados da origem que a limpeza do commit inicial deixou passar (decisão do dono: reescrever a `main`).
**Arquivos alterados:**
- **Commit inicial:** `docs/CONTRATO-HANDOFF-GRUPO.md`, `UI.md`, comentário de uma migration, `src/features/meta/components/tracking-filters.tsx` (só existe no commit inicial).
- **Commit inicial e branch:** `chat-header.tsx`, `contact-info.test.ts`, `normalizers/uazapi.test.ts`, `media-key.ts` e o teste dele.

**O que foi feito:**
- **Valores trocados por fictícios:** o JID do grupo de handoff, dois IDs da Meta (campanha e anúncio) e mais **quatro telefones** com cara de reais. Os telefones estavam no formato `wa_id` da Meta, sem o nono dígito, que a primeira limpeza não cobria. Eram o "dono" e o contato no teste do normalizer, um exemplo no cabeçalho do chat e um caminho de bucket real em `media-key`.
- **Commit inicial recriado** (a `main` continua com um commit só) e a branch da Fase 1 rebaseada em cima dele. A árvore final da branch difere da anterior só na troca desses números.
- **Varredura antes de publicar:** `git log -p` das duas refs não encontra nenhum dos valores reais, nem a marca, domínio, IP ou host da origem.

**Decisões tomadas:** force-push na `main` com `--force-with-lease` preso ao SHA antigo. Com um commit só e repositório criado no mesmo dia, ninguém mais dependia dele.

**Pendências / próximos passos:** a GitHub pode manter o commit antigo acessível por SHA direto por um tempo; purga completa só pelo suporte da GitHub, se o dono quiser.

**Armadilhas descobertas:**
- **Telefone brasileiro tem forma de 12 dígitos** (`wa_id` da Meta, sem o 9º). Varredura que exige o `9` na frente do assinante não acha esses números.
- **Módulos que a Fase 1 apagou ainda estavam no commit inicial.** A varredura da branch (`HEAD`) não vê o que só existe lá, como o ID em `tracking-filters.tsx`. Varra cada ref que vai ser publicada.

---

## [2026-09-25] Revisão adversarial da Fase 1 e correções

**Agente/Modelo:** Claude Opus 5.5
**Objetivo:** Achar o que a poda quebrou ou deixou falso antes do PR, já que as skills `bug-hunter` e `verification-before-completion` não existem neste ambiente.
**Arquivos alterados:**
- **Dados:** `docs/CONTRATO-HANDOFF-GRUPO.md`, `UI.md`, comentário de `supabase/migrations/20260806010000_fill_meta_attribution_snapshot.sql`.
- **Assinatura do bot:** `bot-signature-settings.tsx`, `push-bot-signature.ts`, `get-bot-signature.ts`, `api/settings/bot-signature/route.ts`.
- **Política:** `politica-de-privacidade/page.tsx`.
- **Demo:** `scripts/seed-demo.mjs` e `scripts/reset-demo.mjs` removidos; `package.json` e `.env.local.example` ajustados.
- **Comentários:** 5 comentários de código.
- **Docs:** AGENTS, PRD, SKILLS, DB, `docs/API.md`, `docs/especificacao_dashboard_frontend.md`, skills uazapi.

**O que foi feito:**
- **Revisão:** três revisores independentes (regressão, segurança, escopo/docs) e um cético por achado. Houve 9 achados confirmados e 1 refutado; os menores ficaram sem verificação e foram conferidos à mão.
- **Correção da limpeza do commit inicial.** Ainda estavam no repo, e portanto no commit público `e35f887`:
  - o JID real de um grupo de WhatsApp da origem (a segunda ocorrência no contrato de handoff);
  - um ID de campanha Meta (em `UI.md`);
  - um ID de anúncio (num comentário de migration).

  Os três viraram valores fictícios. A varredura original procurava de 15 a 17 dígitos, e esses têm 18.
- **Assinatura do bot.** Sem agente configurado, a tela dizia "salva" e prometia "reconciliar na próxima sincronização" por uma rota que saiu. Agora ela avisa que o valor só fica no CRM, e os comentários dizem que a leitura por GET volta na API v1.
- **Política de Privacidade.** Afirmava envio de dados à Meta e descrevia a clínica como controladora de dados de saúde. Virou um aviso provisório de "política em revisão", com contato e `noindex`. A política definitiva é pré-requisito do deploy (Fase 10).
- **Demais correções:**
  - `seed-demo`/`reset-demo` saíram, como o plano mandava na Fase 1 e eu tinha esquecido;
  - exemplos do AGENTS apontavam arquivos removidos;
  - `adminOnly` virou `allowedRoles`, que é o nome real;
  - a skill uazapi apontava para `normalizers/evolution.ts`.

**Decisões tomadas:**
- **A página de privacidade vira aviso provisório, sem poda parcial.** Tirar só a parte da Meta deixaria uma política de clínica, que também é falsa para o produto novo. **Decisão a revisar pelo dono.**
- **Os `revalidatePath("/app/leads" | "/app/funil")` ficam por ora.** Estão nas rotas de lead e tags que o chat usa, não fazem nada e são reescritos na Fase 2, quando essas rotas viram `contacts`.
- **`recharts` fica nas dependências.** Está sem uso até a Fase 9, e remover dependência também mexe no lockfile.

**Verificação:** ver a entrada do PR desta fase (checks rodados depois destas correções).

**Pendências / próximos passos — segurança, anteriores à Fase 1 (confirmadas pela revisão):**
1. **Sessão só por JWT em 17 handlers.**
   - **Quais:** 14 rotas não chamam guard nenhum:
     - chat: `contact`, `search`, `send-audio`, `send-file`, `tags`, `conversations/tags`, `transcribe`;
     - `connection/state`;
     - `tags`, `tags/[id]`.

     Outras 3 usam `hasDashboardSession`, que também é só JWT: `leads/[id]` PATCH e DELETE, e `leads/manual`.
   - **Efeito:** um usuário desativado, ou com papel desconhecido no banco, segue enviando WhatsApp e mexendo em contato até o cookie expirar (7 dias).
   - **O "falha fechado" da Fase 1 cobre só:** login, `getAppUser`/viewer, token do Supabase e cookie com papel desconhecido.
   - **Correção proposta:** `requireDashboardUser()` na primeira linha de cada handler, antes de ler o corpo, mais um teste de contrato que varre as rotas.
2. **Open redirect no login.** O `?redirect=` aceita URL externa (`login-form.tsx:63`). Correção: comparar a origem com `new URL(raw, location.origin)`.
3. **Webhook uazapi sem segredo aceita qualquer chamada.** Já está previsto na Fase 2 (falhar fechado + comparação em tempo constante).
4. **Histórico público.** Os três IDs acima continuam no commit `e35f887` de `origin/main`. Tirá-los de lá exige reescrever o commit inicial e fazer force-push na `main`; a decisão é do dono.

**Armadilhas descobertas:**
- **Varredura de dado sensível com faixa de tamanho fixa deixa passar.** IDs de WhatsApp e da Meta têm 18 dígitos. Procure `[0-9]{15,}` sem limite superior.
- **Tirar uma rota pode deixar mensagem de UI mentindo sem quebrar teste nenhum.** O caso aqui foi o toast de "reconciliar". Ao remover rota, procure no texto da UI e nos comentários quem prometia usá-la.

---

## [2026-09-25] Fase 1 — poda do legado da clínica (TS e rotas; banco intacto)

**Agente/Modelo:** Claude Opus 5.5
**Objetivo:** Deixar no app só o núcleo que o CRM de suporte aproveita (Início com notas, WhatsApp, Conexão, Equipe, Configurações, Perfil), com o chat uazapi recebendo e enviando sobre o banco atual.
**Arquivos alterados:** 9 commits na branch `refactor/poda-legado-clinica`, um por passo da seção F do plano. Saíram 298 arquivos (~40 mil linhas): telas, rotas e módulos `appointments`, `board`, `dashboard`, `deals`, `financeiro`, `followups`, `meta`, `patients`, `pipelines`, quase todo `leads`. Ajustados no núcleo: chat (painel de contato, filtros, envio, transcrição), casca e menu, guard, proxy, guards de sessão, login, equipe, configurações, docs.

**O que foi feito (por commit):**
1. **Tags:** paleta e tipo `Tag` extraídos de `leads` para `src/features/tags/`.
2. **Chat:**
   - o painel de contato perde funil, origem, valor e próximo agendamento;
   - sai o filtro por etapa de funil;
   - saem os canais Evolution (sem auth nenhuma) e Meta Cloud, e a rota `status/[phone]`;
   - envio com provedor que não seja uazapi passa a falhar explicitamente.
3. **Início:** fica só o mural de notas.
4. **Pessoas:** saem Leads, Funil (inclusive funis personalizados), Pacientes e as rotas de lead que só eles usavam.
5. **Agenda e follow-ups:** saem, com as entradas `/api/integracao/*` e `/api/webhooks/n8n/*` deles.
6. **Métricas e funil:** saem métricas comerciais, funis personalizados e colunas do funil; Configurações perde a aba Funis.
7. **Vendas:** saem vendas, pagamentos e procedimentos.
8. **Rastreamento Meta e papel `paid_traffic`** saem; menu e guard ficam alinhados ao núcleo.
9. **Integração antiga:** saem `/api/integracao/*`, `/api/webhooks/n8n/*`, feedbacks, deals e `verifyWebhookSecret`. Nenhum prefixo de API pública sobra, além do webhook da uazapi e do login.

**Decisões tomadas:**
- **Um PR, não nove.** Os passos dependem uns dos outros; nove PRs sem merge entre eles empilhariam branch sobre branch (CONTRIBUTING).
- **O que a poda não tocou:**
  - **identidade:** fica em `features/leads` até a Fase 2, que renomeia o módulo inteiro;
  - **`ssrf-guard` e assinatura HMAC:** não mudaram de lugar. A assinatura era específica da Meta e ficaria órfã; a Fase 2 a recupera da tag;
  - **`humanizeUntil`:** saiu junto do modelo de paciente; a Fase 4 recupera da tag se servir.
- **Menu e guard ajustados num commit só** (passo 8), em vez de reescrever os testes quatro vezes.
- **Papel desconhecido falha fechado.** O banco ainda aceita `paid_traffic` na Fase 1. Login com papel desconhecido → 403; `getAppUser` → sem viewer; lista da equipe → omite. Cookie antigo com o papel → sessão inválida. Testes novos cobrem os quatro caminhos.
- **Ficam de propósito, sem uso hoje:**
  - `verifyWebhookAuth` e o registro/tabela de logs de integração (base da Fase 5);
  - kanban, skeletons e formatadores de dinheiro e porcentagem (Fases 4, 8 e 9);
  - primitivos de UI. O AGENTS §3 proíbe apagar código aparentemente morto sem pedir.
- **Rotas de lead que o chat chama por URL continuam:** `PATCH /api/leads/[id]` e `POST /api/leads/manual`, além de `/api/tags`.

**Verificação** (com `pnpm@10.33.0`):

| Check | Resultado |
|---|---|
| typecheck | ✓ 0 erros |
| lint | ✓ 0 erros; 9 avisos (eram 16, e os que saíram estavam em arquivos removidos) |
| test | ✓ 69 arquivos, 620 testes |
| build | ✓ |

Critério da fase conferido: nenhum import de módulo legado em `src`, e nenhum `fetch("/api/...")` do código restante aponta para rota inexistente.

**Pendências / próximos passos:**
- **Fase 2:** baseline novo do banco, renome lead→contato, stack local com Realtime e Storage, segredos no Vault, mídia privada.
- **Revisão e merge do PR desta fase.**

**Armadilhas descobertas:**
- **O TypeScript não enxerga `fetch` por URL.** Antes de apagar rota, procure chamadores em string (`"/api/..."`). O chat chamava três rotas de leads que pareciam legado.
- **`.next/types/validator.ts` guarda a lista de rotas do último build.** Depois de apagar rota, o typecheck acusa "Cannot find module" até apagar o `.next`.
- **Grafo de imports sem regra para teste engana.** Um teste que importa qualquer arquivo vivo (ex.: `lib/utils`) parece vivo mesmo com o alvo morto. O teste segue o arquivo de mesmo nome sem `.test`.
- **No zsh, `$VAR` sem aspas NÃO se divide em palavras.** Um filtro com vários prefixos virou uma string só e o script "não achou nada". Use `${=VAR}`.
- **Os ramos por provedor no envio caíam no "marca como enviada".** Tirar os ramos Evolution/Meta sem um `else` que lance erro faria qualquer provedor não suportado "enviar" sem sair do servidor.

---

## [2026-09-25] Plano de implantação e repositório novo sem histórico

**Agente/Modelo:** Claude Opus 5.5
**Objetivo:** Planejar a conversão do CRM de clínica de origem num CRM de suporte técnico para software house, e separar o repositório para o produto novo.
**Arquivos alterados** (commit inicial, comparado com a última versão da origem):
- **Novos:** `docs/PLANO-IMPLANTACAO.md`.
- **Reescritos:** `PROGRESS.md`, `SETUP.md` (fluxo de compose), `README.md` e o topo do `PRD.md` (§1–§5 no produto-alvo).
- **Marca:** `src/config/site.ts` virou a fonte única (`name`, `slug`), e dela derivam o cookie, o prefixo de token e o `TRACK_SOURCE`. Também mudaram os componentes de marca e de casca, o login, o manifest e o SW, com logos e fundo do login regenerados. Nomes técnicos neutros: tmpdir, `history.state`, localStorage.
- **Infra local:** `docker-compose.yml` e `scripts/db-local-apply.sh` (containers `crm-suporte-*`), `supabase/config.toml`, Dockerfiles, `.env*.example`.
- **Docs e skills:** `AGENTS.md`, `SKILLS.md`, `UI.md`, `CONTRIBUTING.md`, `DB.md` (referências), `docs/*`, skills e agente em `.claude/`/`.agents/`.
- **Migrations herdadas:** strings de 3 arquivos (ver Decisões).
- **Dados de teste:** 12 `*.test.ts(x)`.
- **Removidos:** `DEPLOY.md`, `deploy/`, `.github/workflows/deploy.yml`, o staging herdado (`docker-compose.staging.yml`, `Caddyfile`, `scripts/deploy.sh`, `scripts/server-bootstrap.sh`, `.env.staging.example`, `.env.registry.example`), `scripts/setup-local.*`, `mcp/` (MCP antigo), `META-LEAD-TRACKING.md`, `SPEC.md`, `ROADMAP.md`, `imagens/`, `public/brand/logo-completa.png` (sem uso).

**O que foi feito:**
- **Investigação só de leitura.** Dez agentes mapearam banco, chat, API, telas, infra/testes e um projeto irmão do mesmo template. Três planos independentes foram consolidados por um juiz. Quinze decisões de produto foram fechadas com o dono. Resultado: [`docs/PLANO-IMPLANTACAO.md`](docs/PLANO-IMPLANTACAO.md).
- **Fase 0, parte 1.** O WIP de Financeiro foi preservado numa branch do repositório de origem, e o remote da origem ficou só para leitura (`clinica`, push-url `sem-push`). O repo novo nasceu de um commit sem histórico.
- **Limpeza antes de publicar.** Saíram:
  - a infra de produção da origem (IP, domínios, estrutura da stack);
  - o staging herdado;
  - o PROGRESS antigo;
  - o JID de um grupo real de WhatsApp.
- **Telefones com cara de reais** foram trocados por fictícios no mesmo formato (`99000-00NN`), incluindo a forma sem o 9º dígito.
- **Marca da origem retirada antes do primeiro push (pedido do dono).** Sem a marca, o código público não aponta para o sistema de origem, que segue no ar com o mesmo código. `git grep -i` pela marca antiga não acha nada, e os logos e o fundo do login foram regenerados como imagens neutras.

**Decisões tomadas:**
- **Histórico zerado e repo público (dono).** Publicar o histórico exporia a infra e os achados de segurança da produção da origem.
- **A tag `legado-clinica` fica só local.** Ela aponta para a última versão da origem e é de lá que as Fases 7 e 8 recuperam telas. Enviar a tag, ou a branch do WIP, ao repo novo publicaria o histórico inteiro da origem.
- **Os scripts de deploy da origem não vieram.** A Fase 10 os recupera da origem e parametriza. Hoje o produto roda só em Docker local (decisão do dono).
- **Exceção à regra "migration aplicada não se edita" (AGENTS §3.8).** Troquei só strings com a marca em 3 migrations herdadas:
  - o prefixo do nome descritivo dos segredos no Vault (a busca é por `secret_id`, então nada quebra);
  - a descrição desses segredos;
  - o prefixo de `event_id` do CAPI.

  Motivo: elas nunca foram aplicadas em banco deste produto e são arquivadas na Fase 2. Decisão a revisar pelo dono.
- **Cookie de sessão renomeado** para `crm-suporte-session`. Sessões locais antigas caem uma vez.

**Verificação** (na árvore do commit inicial, com `pnpm@10.33.0`):

| Check | Resultado |
|---|---|
| typecheck | ✓ 0 erros |
| lint | ✓ 0 erros; 16 avisos anteriores a esta mudança |
| test | ✓ 117 arquivos, 1052 testes |
| build | ✓ |

**Pendências / próximos passos:**
- **Fase 0, resto:** portas locais novas (3100 / 55321 / 55322), se houver colisão com outros projetos.
- **Fase 1:** poda do TS legado, na ordem da seção F do plano.
- **Não decidido pelo dono:** hospedagem, domínio e túnel local para o webhook da uazapi.

**Armadilhas descobertas (código herdado):**
- **Segredos pela UI.** Cadastrar segredo na tela Variáveis não tem efeito, exceto para `OPENAI_*`: o resto do código lê `process.env` direto.
- **`supabase/seed.sql` está quebrado desde a migration de funis.** Ele usa `on conflict (key)` e insere sem `pipeline_id`. O `db-local-apply.sh` para no seed e não cria `admin@local`.
- **Worker em segundo plano.** O `CMD` da imagem sobe só o `server.js`, e o `meta-dispatcher` não roda em lugar nenhum.
- **`relay-envelope.ts` do projeto irmão é fail-open** (`?? "bot"`). Não portar o fallback.
- **`/api/chat/status/[phone]` sem cookie leva 401.** A rota não está nos prefixos públicos do guard.
- **`git checkout --orphan` deixa tudo como "novo" no index.** `git rm` recusa sem `-f`. É seguro aqui, porque os arquivos continuam na origem.
- **O `pnpm` global desta máquina é o 10.2.0.** Ele falha até em `pnpm -v` com "packages field missing or empty", por causa do `pnpm-workspace.yaml` sem `packages`. Use `npx -y pnpm@10.33.0 <script>`, a versão fixada em `packageManager`.
- **Copiar o repo com `node_modules` achata os links simbólicos do pnpm.**
  - O efeito é um typecheck com dezenas de erros falsos (`send` não existe em `S3Client`) e um eslint sem `@humanfs/node`.
  - O conserto é `rm -rf node_modules && npx -y pnpm@10.33.0 install --frozen-lockfile`.
  - Pela mesma razão, um `.next/` antigo gera erro de typecheck em `.next/types/validator.ts` para página que já não existe: apague o `.next`.

**Armadilhas herdadas da origem que continuam valendo** (resumo do PROGRESS antigo):
- **Self-host do Supabase:**
  - a publication `supabase_realtime` e o schema `_realtime` não são criados por ninguém; sem eles o Realtime morre em silêncio ou em laço;
  - `authenticator` é papel reservado, e `postgres` não é superusuário na imagem (sincronizar senha exige `-U supabase_admin`);
  - o healthcheck oficial do Realtime responde 403;
  - `localhost` dentro do container resolve para `::1`, e o storage-api só escuta IPv4.
- **nginx:** `proxy_pass` com variável não substitui o prefixo da URI; exige `rewrite` explícito. Status 200 não prova o roteamento.
- **Docker:**
  - healthcheck ausente faz `up --wait` dizer "Healthy" para container em laço;
  - `docker run` com nome de volume errado cria um volume vazio;
  - toda conferência por diff precisa de guarda contra os dois lados vazios.
- **Segurança do banco:**
  - trocar `to anon` por `to authenticated using (true)` transfere o furo; a policy precisa filtrar por `app_role`;
  - `revoke … from anon` não fecha função, porque o EXECUTE nasce para PUBLIC;
  - `alter default privileges IN SCHEMA … FROM PUBLIC` é aceito e não faz nada; só a forma global subtrai.
- **Testes e front:**
  - Vitest com `jose` exige `// @vitest-environment node`;
  - `DndContext` sem `id` (use `useId()`) quebra a hidratação;
  - `Textarea` com `rounded-lg` recorta a primeira letra.
