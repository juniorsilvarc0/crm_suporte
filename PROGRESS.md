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

## [2026-10-09] Retenção da fila de entrega: expurgo das linhas encerradas após 30 dias

**Agente/Modelo:** Claude Opus 5.5.
**Objetivo:** o `event_outbox` não tinha expurgo: cada mensagem recebida em conversa `bot` gravava o envelope (com o texto do cliente) para sempre, duplicando o chat. Decisão do dono (2026-10-09): apagar as linhas encerradas com mais de 30 dias.
**Arquivos alterados:** `supabase/migrations/20261009170000_outbox_expurgo.sql`, `supabase/tests/event_outbox.sql` (+6 casos, 25), `src/lib/supabase/database.types.ts` (regenerado), `src/lib/jobs/worker.ts` (+teste); docs: `PRD.md` §8, `UI.md` §5.19, `docs/CONTRATO-WEBHOOKS.md` §7, este PROGRESS.
**O que foi feito:**
- **`outbox_purge(p_older_than interval default '30 days')`:** apaga só `sent`, `skipped` e `dead_letter` cuja última mudança (`updated_at`) passou da retenção. `pending`, `processing` e `retry` nunca saem, por mais velhos que sejam. Retenção abaixo de 30 dias é recusada (`22023`), no molde do `purge_integration_logs` (mínimo 90 dias, D9).
- **Job de manutenção (a cada hora, uma réplica por vez pelo lease):** chama `outbox_purge()` junto das outras purgas; uma purga que falha não impede as outras.
**Decisões tomadas (revisar):**
- **Conta pela última mudança, não pela criação:** uma entrega que ficou dias em nova tentativa e depois foi entregue ainda fica 30 dias visível na lista.
- **Webhook esgotado também sai depois de 30 dias:** dá para reenviá-lo enquanto estiver lá.
**Verificação:** typecheck ✓ · lint ✓ · test ✓ · build ✓ · SQL `event_outbox` 25 ✓ e a suíte inteira (só `baseline.sql` e `segredo_integracao.sql` falham, e só no banco local).
**Pendências / próximos passos:** produção hoje tem ~500 linhas com menos de 2 dias: o 1º expurgo de verdade acontece só daqui a 30 dias.
**Armadilhas descobertas:** nenhuma nova.

## [2026-10-09] Produção: a API v1 deixou de ir para o log do nginx do host

**Agente/Modelo:** Claude Opus 5.5.
**Objetivo:** aplicar em produção a regra D8 (docs/PLANO-FASE-5.md) que já estava no repositório: `?phone=` e `?cnpj=` da API v1 são dado pessoal, e o `access.log` e o `error.log` do host são compartilhados com as outras stacks. Autorizado pelo dono em 2026-10-09.
**Arquivos alterados:** nenhum no repositório (a config já estava em `deploy/nginx-host.conf` e `deploy/app-gateway.conf`).
**O que foi feito (produção, 2026-10-09 17:42 UTC):**
- **appgw:** já estava certo. Cada rodízio do deploy regrava a config dele a partir do código novo (`aplicar_appgw`), então o `location /api/v1/` sem error log estava no ar desde os deploys anteriores.
- **vhost do host (`ticbox.spincode.com.br`, o nosso):** backup em `/etc/nginx/sites-available/ticbox.spincode.com.br.bak-20261009-174244`, arquivo novo gerado por `crmsup.sh nginx https`, `nginx -t` ✓, `systemctl reload nginx`. Entraram dois blocos: `/api/v1/` na porta 80 (308 para https, sem log) e `/api/v1/` no 443 (sem access nem error log). O limite de corpo (64 MB) é do `server`, então o anexo de 50 MB segue valendo.
- **Retratos antes/depois** (`docker ps` e `nginx -T`) em `/opt/crm-suporte/ops/20261009-174244-vhost-api-v1/`: nenhum container mudou; no `nginx -T`, só os dois blocos novos.
**Verificação:** `/api/v1/health` 200 por https e 308 por http (o método se mantém); claim sem token 401; uma marca única na URL da API v1 **não** aparece no `access.log` nem no `error.log`, e a marca de controle em `/app` aparece; WhatsApp recebendo durante e depois do reload; réplicas saudáveis.
**Como reverter:** `cp -p /etc/nginx/sites-available/ticbox.spincode.com.br.bak-20261009-174244 /etc/nginx/sites-available/ticbox.spincode.com.br && nginx -t && systemctl reload nginx`.
**Armadilhas descobertas:**
- **O appgw não precisa de passo manual:** o `aplicar_appgw` de cada rodízio já regrava a config. Só o vhost do host fica de fora do `publicar.sh` (README §Atualizar o vhost).

## [2026-10-09] Fase 6c-4: aviso ao cliente sem duplicar (claim/finalize) — fecha a Fase 6c

**Agente/Modelo:** Claude Opus 5.5.
**Objetivo:** quem avisa o cliente na troca de status (o agente, pelo WhatsApp) nunca manda o mesmo aviso duas vezes, mesmo recebendo o evento repetido: reivindica o passo antes de enviar e o fecha depois (decisão 6 e §C do plano: "só `claimed:true` autoriza o envio").
**Arquivos alterados:** `supabase/migrations/20261009150000_ticket_notices.sql`, `supabase/tests/ticket_notices.sql` (28 casos), `supabase/tests/event_outbox.sql` (conserto do CI, abaixo), `src/lib/supabase/database.types.ts` (regenerado); `src/lib/api/v1/notices.ts`, `src/features/tickets/server/ticket-notices.ts`, `src/app/api/v1/tickets/[ref]/notices/[step]/{claim,finalize}/route.ts`, `src/lib/api/v1/openapi.ts`, `src/lib/api/v1/scopes.ts` (comentário), `src/app/api/v1/notices.test.ts` (13); docs: `docs/GUIA-AGENTE-IA.md` §2.9, `docs/API.md`, `docs/CONTRATO-WEBHOOKS.md`, `PRD.md` §7.4, este PROGRESS.
**O que foi feito:**
- **`ticket_notices`** (único por `ticket_id, step`), só por RPC: o service_role não tem grant na tabela.
- **`ticket_notice_claim`:** passo livre → `claimed: true` com `claim_token` e lease (30 s a 15 min, padrão 2 min); já enviado → `already_sent`; lease valendo → `in_progress`; lease vencida sem finalize, ou falha anterior → reivindica de novo (attempts + 1). A trava da linha serializa duas reivindicações simultâneas.
- **`ticket_notice_finalize`:** só com o `claim_token` atual (fencing → `claim_lost`). `sent` fecha para sempre; `failed` libera na hora. Repetir o mesmo desfecho é seguro; outro desfecho depois de fechado → `already_finalized`.
- **API v1:** `POST /tickets/{ref}/notices/{step}/claim` (200 também na recusa, com `reason`; corpo opcional) e `/finalize` (409 `notice_claim_lost` / `notice_already_finalized`, com `current`), escopo `notices:claim`, no OpenAPI.
**Decisões tomadas (revisar):**
- **O claim não aceita `Idempotency-Key`:** repetir a resposta guardada daria `claimed: true` às duas entregas do mesmo evento. Resposta perdida → a lease segura o passo e depois ele volta: o aviso atrasa, não duplica.
- **O passo é escolhido por quem avisa** (o `id` do evento = um aviso por evento; um nome fixo = um aviso por ticket). O plano não fixava o vocabulário.
- **O preset "IA de triagem" continua sem `notices:claim`**, e o guia manda usar token do tipo integração (`api`) para avisar: token `ai` só envia em conversa `bot`, e a troca de status quase sempre acontece com a conversa `human` ou `resolved`.
- **O CRM não manda o aviso sozinho:** ele só garante que quem manda não duplica (o texto e o canal são de quem avisa).
**Conserto do CI (vermelho na `main` desde o #74):** `event_outbox.sql` afirmava "service_role NÃO lê event_outbox direto", regra que a migration da 6c-2 (`20261009140000`) mudou de propósito (SELECT por coluna, sem a lease). O caso agora confere a regra nova: lê o status, NÃO lê a lease, NÃO escreve. Produção não foi afetada (só o job "banco" do CI). Na 6c-2 eu tinha rodado só o teste SQL dos webhooks. No CI desta PR, o job "qualidade" pegou um teste intermitente do aviso de WhatsApp (`whatsapp-connection-banner.test.tsx`, do #72): a altura do aviso é publicada num efeito logo depois de ele entrar no DOM, e a asserção corria entre os dois. Agora espera (`waitFor`).
**Verificação:** typecheck ✓ · lint ✓ (0 erros; os 9 avisos de sempre) · test ✓ (4890/4890) · build ✓ · SQL: `ticket_notices` 28 ✓, `event_outbox` 19 ✓, demais verdes (`baseline.sql` e `segredo_integracao.sql` falham só no banco LOCAL, pelo resto de uma integração antiga; no CI passam) · migration reaplicada sem efeito; baseline 40 tabelas/88 funções · smoke do serviço real contra o PostgREST local (claim → in_progress → claim_lost → sent → already_sent → 404s) ✓.
**Pendências / próximos passos:** Fase 6c concluída. Do plano restam: Fase 10 (política de privacidade definitiva, cópia do backup fora do servidor) e as pendências fora do plano (log do `/api/v1/` no nginx; assinar o evento `connection` da uazapi na próxima reconexão).
**Armadilhas descobertas:**
- **Migration que mexe em grant quebra teste SQL de outra área.** Rode `./scripts/db-local-test.sh` inteiro antes de commitar, e confira o CI da `main` depois do merge (`gh run list --branch main`).
- **O gateway local reinicia em laço sem o container `storage`** (a config dele aponta para ele): para um smoke contra o PostgREST local, suba `rest`, `storage` e `gateway`.

## [2026-10-09] Fase 6c-3: aba Webhooks em Integrações

**Agente/Modelo:** Claude Opus 5.5.
**Objetivo:** o administrador cadastra e cuida dos destinos de webhook pela tela, sem chamar as rotas na mão: segredo mostrado uma vez, teste de conexão, troca de segredo, pausa, exclusão, entregas recentes e reenvio.
**Arquivos alterados:** `src/features/webhooks/components/` (`webhooks-manager.tsx`, `webhook-form.tsx`, `webhook-secret-view.tsx`, `webhook-deliveries.tsx`, com testes), `src/features/webhooks/lib/webhook-display.ts` (+teste), `src/features/connection/lib/connection-tabs.ts`, `src/app/(dashboard)/app/conexao/page.tsx` (+teste); docs: `UI.md` §5.19, `PRD.md`, `docs/CONTRATO-WEBHOOKS.md` §7, este PROGRESS.
**O que foi feito:**
- **Aba `?aba=webhooks`**, entre API do CRM e Agente de IA. A página lê os destinos no servidor (`getWebhookSubscriptions`); sem Supabase admin ou com a leitura falhando chega `null`, e a aba diz "Não foi possível carregar os destinos." (nunca "nenhum destino").
- **Lista** com status em texto (Ativo/Pausado), URL, resumo dos eventos e o aviso "Sem segredo: nada sai". **Testar** à vista; o resto no menu "Mais ações".
- **Cadastrar/editar** (`ModalShell` com react-hook-form e o schema da rota): eventos em checkboxes com Marcar todos/Limpar; a recusa da URL pelo servidor vai para o campo; editar manda só o que mudou.
- **Segredo uma vez** (cadastro e troca) no mesmo `Dialog`, `dismissible={false}`, foco no copiar, `router.refresh()` só depois de Concluir. Troca sem resposta avisa que o segredo pode ter mudado.
- **Confirmação** para trocar segredo, pausar e excluir; reativar não pede.
- **Entregas recentes:** leitura ao abrir e no Atualizar, filtros de destino e status, Reenviar só na esgotada, resposta de filtro antigo descartada.
**Decisões tomadas (revisar):**
- **A aba não fica montada ao trocar** (sem `keepMounted`, ao contrário do Agente de IA): o segredo só aparece dentro de um diálogo modal, que impede trocar de aba enquanto está aberto, e as entregas se releem ao voltar.
- **Os destinos são lidos em toda abertura de Integrações** (como os tokens), e não só com a aba aberta: é uma consulta pequena, e a aba abre sem esqueleto.
- **Campo de URL é texto com `inputMode="url"`**, e não `type="url"`: o balão nativo do navegador barraria o envio com outra mensagem.
**Verificação:** typecheck ✓ · lint ✓ (0 erros; os 9 avisos são de `verify-webhook.test.ts`) · test ✓ (4863/4863) · build ✓. `bug-hunter`/`verification-before-completion` não estão instaladas: revisão manual (renderização única das ações por linha, nome acessível dos checkboxes, campo de URL, estados de falha).
**Pendências / próximos passos:** 6c-4 (`ticket_notices` + `/api/v1` notices claim/finalize).
**Armadilhas descobertas:**
- **Checkbox do Base UI dentro de `<label>` com `aria-label` soma os dois no nome acessível** ("Ticket aberto (ticket.created) Ticket abertoticket.created"). O texto visível precisa de `aria-hidden`. O diálogo de edição de token (`api-token-edit-dialog.tsx`) tem o mesmo problema, e o teste dele contorna com regex; fica para uma task própria.
- **Renderizar as mesmas ações duas vezes (uma `sm:hidden`, outra `hidden sm:block`) duplica os botões para o leitor de tela e para o Testing Library.** Uma renderização só, com tamanhos responsivos (`h-11 sm:h-8`).

## [2026-10-09] Fase 6c-2: webhooks de saída — o envio (servidor)

**Agente/Modelo:** Claude Opus 5.5.
**Objetivo:** os eventos que a 6c-1 enfileira saem de fato: assinados, com nova tentativa e reenvio manual, e administráveis por rotas de admin. A tela é a 6c-3; os avisos ao cliente, a 6c-4.
**Arquivos alterados:** `supabase/migrations/20261009140000_webhook_entregas_leitura.sql`, `supabase/tests/webhooks_saida.sql` (+3 casos, 35 no total); `src/features/webhooks/` (`catalog.ts`, `types.ts`, `schemas/webhook.ts`, `queries/get-webhooks.ts`, `server/send.ts`, `server/dispatch.ts`, `server/audit.ts`, com testes); `src/app/api/webhooks/**` (6 rotas, com testes); `src/lib/jobs/worker.ts` (+teste); `src/features/integrations/` (`types.ts`, `lib/log-labels.ts`, `components/integration-logs-table.tsx`, testes de rótulos e filtros); docs: `docs/CONTRATO-WEBHOOKS.md` (novo), `docs/API.md`, `PRD.md` §7.4, `UI.md` (filtros da aba Registros), este PROGRESS.
**O que foi feito:**
- **Despachante (`dispatch.ts`):** a cada 20 s (e no boot), reivindica até 5 entregas `webhook` do outbox. Para cada uma, lê o destino (pausado ou excluído → `skipped`), confere a URL na guarda de SSRF (recusada → `dead_letter`), lê o segredo pelo RPC (sem segredo → `dead_letter`; nada sai sem assinatura), monta o corpo `{id, event, occurred_at, data, ticket}` com o ticket **atual** no formato da API v1 e envia. Falha → `retry` com backoff 30 s ×4 até 24 h; 8 tentativas ou 3 dias → `dead_letter` (no próprio claim). Erro de leitura → `retry`, nunca corpo pela metade.
- **Envio (`send.ts`):** cabeçalhos `X-CRM-Event`, `X-CRM-Event-Id`, `X-CRM-Timestamp` e `X-CRM-Signature: v1=HMAC-SHA256(segredo, "<ts>.<corpo>")` (o `signEvent` do relay), 10 s de prazo, sem seguir redirecionamento, nunca rejeita.
- **Worker:** `runWebhookDispatch` sem lease de job (o claim serializa por evento, como o relay), com trava por processo: uma leva lenta (até 5 × 10 s) não empilha com a seguinte.
- **Rotas (admin, `requireDashboardAdmin` na 1ª linha):** `GET/POST /api/webhooks` (cadastrar gera o segredo, grava no Vault e o devolve uma vez, com `no-store`; se o Vault falha, desfaz o cadastro); `PATCH/DELETE /api/webhooks/[id]` (URL nova passa pela guarda de novo); `POST …/[id]/secret` (troca, com releitura que confirma o que ficou guardado: 409 se outra troca venceu); `POST …/[id]/ping` (`webhook.ping` assinado na hora, 10 por minuto por admin); `GET /api/webhooks/deliveries` (por destino e status); `POST …/deliveries/[id]/requeue` (só `dead_letter`; outra situação → 409).
- **Leitura das entregas:** a migration dá ao `service_role` SELECT **por coluna** no `event_outbox`, sem as colunas da lease. A escrita continua só pelos RPCs.
- **Trilha:** integração nova `webhooks` em `integration_logs`, com cadastro, alteração (**os nomes dos campos, nunca a URL**, que pode carregar token), exclusão, troca de segredo, teste e reenvio, e quem fez. A aba Registros já filtra por ela (rótulo "Webhooks"; sem filtro de token, como o repasse). A lista de ações vem do catálogo (`WEBHOOK_AUDIT_ACTIONS`), e um teste confere que cada uma é gravada por alguma rota.
**Decisões tomadas (revisar):**
- **A trilha entrou nesta PR**, e não na da tela: quem troca um segredo ou aponta a URL para outro lugar precisa ficar registrado desde a primeira rota. Custou 3 arquivos de `integrations/`.
- **Dedupe pelo `id` do corpo, não pelo `X-CRM-Event-Id`:** a assinatura não cobre cabeçalhos (mesma regra do relay).
- **Teste de conexão funciona com o destino pausado:** serve justamente para conferir antes de religar.
- **Smoke de ponta a ponta fora do repo** (rotas e despachante reais contra o banco local, entregando num servidor HTTP local que confere a assinatura): gatilho real → fila → entrega `sent` com o ticket atual; HTTP 500 → `retry` em ~30 s; ping; troca de segredo valendo no ping seguinte; pausa sem enfileirar; trilha completa; exclusão limpa o Vault.
**Verificação:** typecheck ✓ · lint ✓ (0 erros; os 9 avisos são de `verify-webhook.test.ts`, que já existia) · test ✓ (4841/4841) · build ✓ · SQL `webhooks_saida.sql` ✓ (35) · `assert_security_baseline()` ✓ · smoke local 5/5. As skills `bug-hunter` e `verification-before-completion` não estão instaladas nesta sessão: a caça e a verificação foram manuais (guard do prefixo `/api/webhooks`, gatilho de `updated_at`, semântica das 8 tentativas, autor na aba Registros).
**Pendências / próximos passos:** 6c-3 (aba Webhooks em Integrações: destinos, segredo mostrado uma vez, teste, entregas e reenvio); 6c-4 (`ticket_notices` + `/api/v1` notices claim/finalize).
**Armadilhas descobertas:**
- **`hasSupabaseAdminEnv()` lê `SUPABASE_URL`, não `NEXT_PUBLIC_SUPABASE_URL`.** Para rodar rota real fora do container (smoke), passe `SUPABASE_URL` apontando para o gateway local (`localhost:54321`).
- **`ticket_events` é só de inserção (`TICKET_LOG_APPEND_ONLY`):** evento sintético inserido num smoke local não se apaga, nem como `postgres`. Use um ticket de teste.

## [2026-10-09] Fase 6c-1: webhooks de saída — o banco

**Agente/Modelo:** Claude Opus 5.5.
**Objetivo:** a decisão 6 do plano ("mudou o ticket → o CRM emite um evento assinado"), lado do banco: destinos com segredo no Vault e os eventos de ticket enfileirados na mesma transação da mudança. O envio (HMAC, tentativas) é da 6c-2; a tela, da 6c-3; os avisos ao cliente (`ticket_notices`), da 6c-4.
**Arquivos alterados:** `supabase/migrations/20261009130000_webhooks_saida.sql`, `supabase/tests/webhooks_saida.sql` (32 casos), `src/lib/supabase/database.types.ts` (regenerado); docs: `PRD.md` §8, este PROGRESS.
**O que foi feito:**
- **`webhook_subscriptions`:** nome, URL (http/https), eventos (formato do catálogo, 1 a 50) e o **id** do segredo no Vault. RLS sem policy; `service_role` com SELECT/INSERT/DELETE e UPDATE **por coluna** (`secret_id` só muda pela RPC). Apagar o destino apaga o segredo do Vault (gatilho). `set_webhook_subscription_secret` (mínimo 32 caracteres) e `get_webhook_subscription_secret`, no molde do segredo da integração do chat.
- **`webhook_emit(evento, id, quando, dados)`:** para cada destino **ativo** que assinou, `outbox_enqueue('webhook', '<id>:<destino>', …)`: o mesmo evento nunca entra duas vezes para o mesmo destino. Usa o índice GIN parcial (`events @>`; conferido no EXPLAIN).
- **Gatilhos (mesma transação):** `ticket_events` (criado, alterado, atribuído; prioridade alterada também como `ticket.priority_changed`), `ticket_status_history` (cada transição; de resolvido para atendimento também `ticket.reopened`), `ticket_comments` (**sem o texto**), `ticket_attachments` e `tickets` (carimbos do `sla_sweep` → `ticket.sla_breached`, um por prazo).
- **`outbox_requeue(id)`:** reenvio manual — só `webhook` em `dead_letter`, volta com tentativas zeradas.
**Decisões tomadas (revisar):**
- **A linha da abertura (nada → novo) não sai como `ticket.status_changed`:** a abertura é `ticket.created`; sem isso, quem assina status receberia o mesmo fato duas vezes (pego no teste).
- **Sem tabela `webhook_deliveries`:** o `event_outbox` já guarda status, tentativas, último HTTP e erro por entrega; a tela da 6c-3 lê de lá.
- **O corpo leva só ids e o que mudou** (a descrição como `{"changed":true}`, o comentário sem texto); o despachante acrescenta o ticket atual ao enviar.
- **Sem destino ativo, nada é enfileirado** (custo de um SELECT por mudança). Produção hoje não tem destino: a migration não muda nenhum comportamento até alguém cadastrar um.
**Verificação:** testes de SQL ✓ (32 novos; os de tickets 164, outbox 17, SLA 4 e os demais seguem verdes — `baseline.sql` e `segredo_integracao.sql` falham só no banco LOCAL, pelo resto de uma integração de testes antigos); migration reaplicada sem efeito; `assert_security_baseline()` com 39 tabelas e 86 funções; typecheck ✓ · lint ✓ (0 erros) · test ✓ (4781/4781) · build ✓.
**Pendências / próximos passos:** 6c-2 (despachante no worker: claim `webhook`, HMAC `X-CRM-Signature: v1=…` com timestamp, backoff até 8 tentativas, `webhook.ping`, rotas admin de destinos e de reenvio).
**Armadilhas descobertas:**
- **`create_ticket` grava no histórico de status a linha da abertura (`from_status` nulo).** Gatilho em `ticket_status_history` que quer só transições precisa pular essa linha.
- **`= any(coluna_array)` não usa índice GIN;** `coluna @> array[valor]` usa.

## [2026-10-09] Monitor de conexão do WhatsApp (e o incidente que o motivou)

**Agente/Modelo:** Claude Opus 5.5.
**Objetivo:** saber em minutos — e não 15 horas depois — que o WhatsApp caiu, guardar o motivo quando a uazapi informar, e avisar todo mundo na tela. Pedido do dono: "faça… sem derrubar o WhatsApp".
**O incidente (2026-10-08, diagnóstico só de leitura em 2026-10-09):**
- A última mensagem antes da queda é de **16:06:51 (Brasília)**, no meio de uma conversa movimentada (o atendente respondia pelo celular segundos antes). No dia anterior, o mesmo horário teve 108–203 mensagens por hora.
- **Não foi o CRM:** o log do nginx do host não tem nenhuma chamada às rotas de conexão no dia 08/10; nenhuma ação em produção nesse horário; `chat_integrations` sem alteração desde 29/09.
- **Foi logout de verdade** (não queda de rede): o dono precisou de QR novo em 09/10 às 07:53; as mensagens voltaram em seguida.
- **O motivo não ficou registrado:** o webhook só assina `messages`/`messages_update`, e evento não reconhecido só vira log, perdido ao recriar as réplicas. Causas possíveis: aparelho removido em "Aparelhos conectados" no celular, o próprio WhatsApp encerrando a sessão (comum em API não oficial) ou logout pelo painel/API da uazapi.
**Arquivos alterados:**
- banco: `supabase/migrations/20261009120000_chat_connection_events.sql` (tabela só de inserção: estado, motivo, origem, hora; RLS sem policy; `service_role` com SELECT/INSERT apenas), `supabase/tests/chat_connection_events.sql` (10 casos), `src/lib/supabase/database.types.ts` (regenerado);
- back: `src/features/chat/lib/connection/uazapi.ts` (`getUazapiStatus` devolve `reason` quando o provedor informa — aditivo), `src/features/connection/server/connection-monitor.ts` (+ teste, 9), `src/features/connection/queries/get-connection-events.ts`, `src/features/connection/types.ts`, `src/lib/jobs/worker.ts` (5º job, 2 min, lease `whatsapp_monitor`) + `worker.test.ts`, `src/app/api/connection/status/route.ts` (sessão; só banco), `src/features/integrations/{types.ts,queries/get-integration-health.ts}` (+ teste);
- front: `src/features/connection/components/whatsapp-connection-banner.tsx` (+ teste, 8), `src/components/layout/dashboard-shell.tsx`, `src/app/globals.css` (`--app-alert-height` no `--app-chrome-top`), `src/features/integrations/components/integration-health-panel.tsx` (+ teste); docs: `UI.md` §5.19 e §5.19.2 (nova), `PRD.md` §14, este PROGRESS.
**Garantias de "sem derrubar o WhatsApp":**
- O monitor **só lê** o provedor (`GET /instance/status`, a mesma consulta do painel de Conexão e da Saúde). Não pede QR, não reconecta, **não reregistra webhook** e **não escreve em `chat_integrations`** (nem o telefone do dono). Teste dedicado confere que a única tabela tocada é `chat_connection_events`.
- Erro do provedor vira `unknown` com motivo fixo ("o provedor não respondeu"): o corpo da resposta, que pode trazer o token, nunca vai para banco nem log.
- A rota do webhook não foi tocada.
**Decisões tomadas (revisar):**
- **Monitor por consulta, não por evento:** assinar o evento `connection` da uazapi exigiria reregistrar o webhook da instância de produção e mexer na rota mais quente. Fica como próximo passo opcional (só vale na próxima reconexão por QR).
- **Grava só a mudança**, não cada consulta: o histórico fica curto e legível.
- **"Sem resposta da uazapi" não acende o aviso** (não dá para afirmar a queda), mas entra no histórico.
- **Aviso para todos** (analista também): é quem percebe primeiro que os clientes não estão chegando. Só o admin ganha o link, porque a tela de Integrações é de admin.
**Verificação:** typecheck ✓ (0) · lint ✓ (0 erros; os 9 warnings pré-existentes) · test ✓ (4779/4779) · build ✓ · testes de SQL ✓ (10; `baseline.sql` e `segredo_integracao.sql` falham só no banco LOCAL por uma integração uazapi de testes antigos — o CI parte de banco vazio). Migration reaplicada sem efeito; `assert_security_baseline()` com 38 tabelas. PostgREST local: grava (201), lê (200) e recusa apagar (403). Sem teste de browser.
**Pendências / próximos passos:**
- Depois do deploy: conferir nos logs `[whatsapp-monitor] — → open` (o ponto de partida) e a linha em `chat_connection_events`.
- ⚠️ **Os nomes do campo de motivo na resposta da uazapi são palpite** (`instance.lastDisconnectReason` e variantes). Na próxima queda, conferir se o histórico trouxe o motivo; se vier vazio, ajustar `getUazapiStatus`.
- Opcional: assinar o evento `connection` (tempo real) na próxima reconexão.
**Armadilhas descobertas:**
- **Teste de SQL que cria `chat_integrations` com provedor `uazapi` esbarra na chave única** num banco local que já tem a integração. Reaproveite a existente quando houver (tudo volta no ROLLBACK).
- **Aviso que entra no fluxo acima do conteúdo empurra as telas de altura cheia:** elas descontam `--app-chrome-top`. Publique a altura numa variável que entra nesse cálculo.

## [2026-10-09] Deploy: recortes das métricas no ar (#70)

**Agente/Modelo:** Claude Opus 5.5.
**O que foi feito (produção, autorizado por "mergeado.. siga com o recomendado"):** `deploy/publicar.sh` a partir de `origin/main` @ `c20926b3289e`, ~10:37–10:43 UTC. Sem migration. Rodízio limpo; `verificar` ✓; `/app/metricas` 307 sem sessão; logs sem erro. Rollback: `prd-rollback` = `1667770c12e7` (#69).

## [2026-10-09] Correção: o seletor de empresa vazava do modal (Contatos e Agenda)

**Agente/Modelo:** Claude Opus 5.5.
**Objetivo:** o modal "Vincular … a uma empresa" (`/app/contatos`) mostrava o campo de busca e a lista cortados na borda direita, com rolagem horizontal; o dono mandou o print.
**Arquivos alterados:** `src/features/customers/components/customer-picker.tsx` (`min-w-0` na raiz, nas duas aparências) + `customer-picker.test.tsx` (+2), `src/features/contacts/components/link-customer-dialog.tsx` e `src/features/appointments/components/appointment-dialog.tsx` (`grid-cols-[minmax(0,1fr)]` no envelope); este PROGRESS.
**Causa:** o anti-padrão do UI.md §9. O `CustomerPicker` morava num `<div className="grid gap-3">` sem coluna declarada: a trilha `auto` cresce até a linha mais longa da lista ("razão social · CNPJ" com `truncate` = nowrap — no print, uma razão social de empresa individual, que leva o nome completo do titular), e o seletor inteiro passava da largura do modal. O `truncate` nunca chegava a agir. O diálogo da Agenda tinha o mesmo envelope (`grid gap-2`); o do ticket e o painel do chat não (bloco/`max-w-xl`).
**O que foi feito:** proteção nas duas pontas — a raiz do seletor não força mais a largura do pai (`min-w-0`), e os dois envelopes em grid declaram a coluna (`grid-cols-[minmax(0,1fr)]`).
**Verificação:** typecheck ✓ · lint ✓ (0 erros) · test ✓ (4757/4757) · build ✓. jsdom não calcula layout: o teste novo trava as duas classes que impedem o vazamento. Sem conferência em browser (AGENTS §3.12) — conferir no celular e no desktop depois de subir.
**Armadilhas descobertas:**
- **Componente reutilizável que tem texto `truncate` precisa de `min-w-0` na própria raiz.** Senão cada chamador que o põe num grid ou num item flex herda o vazamento, e o defeito aparece num lugar e não no outro.


## [2026-10-09] Fase 9 PR 2: recortes (fila, analista, clientes) e IA × analista

**Agente/Modelo:** Claude Opus 5.5.
**Objetivo:** completar as métricas do plano (§E, Fase 9): ver por fila, por analista e por cliente, e separar o que a IA fez do que o analista fez.
**Arquivos alterados:** `src/features/metrics/types.ts` (linhas com fila/cliente/responsável, `OpenTicketRow`, `BreakdownRow`, `SupportBreakdowns`, `AiVsHuman`), `lib/summarize.ts` (+`groupBy`, `topCustomerIds`, recortes e IA × analista) + `summarize.test.ts` (16), `queries/get-support-metrics.ts` (colunas a mais, linhas dos em aberto, 2ª fase de nomes) + `.test.ts` (5), `components/metrics-breakdowns.tsx` e `ai-vs-human.tsx` (novos) + `metrics-components.test.tsx` (13), `app/(dashboard)/app/metricas/page.tsx`; docs: `UI.md` §5.25, `PRD.md` §6, este PROGRESS.
**O que foi feito:**
- **Mesmas leituras, mais colunas:** abertos e resolvidos trazem fila, cliente e responsável (e a 1ª resposta da IA); "em aberto" passou de contagem para linhas (o total segue o `count` exato). Depois de agregar, uma 2ª fase lê os nomes: filas e equipe inteiras (são poucas), clientes só os do ranking (`.in`).
- **Recortes:** por fila (mais abertos primeiro), por analista (responsável ATUAL; carga em aberto primeiro; "Sem responsável" mostra o que ninguém pegou) e os 10 clientes que mais abriram ("Sem empresa" fora do ranking). Cada linha: abertos, resolvidos, em aberto agora, mediana da 1ª resposta com a amostra.
- **IA × analista:** quem abriu (IA, analista, integração), mediana da 1ª resposta da IA e resolvidos sem nenhuma resposta do analista.
- A amostra parcial agora também considera os em aberto (passou do teto, os recortes são amostra).
**Decisões tomadas (revisar):**
- **Analista = responsável atual**, não "quem respondeu" (o banco não guarda o autor da 1ª resposta no ticket). O subtítulo da tabela diz isso.
- **Recortes em tabela**, não gráfico (muitas classes; comparação número a número).
- **Falha ao ler os nomes = falha da tela**, como as outras leituras: uma tabela cheia de "—" pareceria dado.
**Verificação:** typecheck ✓ (0) · lint ✓ (0 erros; os 9 warnings pré-existentes) · test ✓ (4755/4755; 34 da feature) · build ✓. As seis leituras rodaram no PostgREST local (200). Sem teste de browser.
**Pendências / próximos passos:** a Fase 9 do plano está completa com este PR. Próximos itens abertos: Fase 6c (webhooks de saída + avisos de ticket), endurecer o log de `/api/v1/` no nginx (deploy/), e a política de privacidade definitiva (Fase 10).
**Armadilhas descobertas:**
- **`app_users` tem SELECT por coluna para o `service_role`** (sem `password_hash`): `select("id, name")` funciona; `select("*")` falharia.

## [2026-10-09] Deploy: métricas de suporte no ar (#69)

**Agente/Modelo:** Claude Opus 5.5.
**O que foi feito (produção, autorizado por "mergeado"):** `deploy/publicar.sh` a partir de `origin/main` @ `1667770c12e7`, ~04:37–04:42 UTC. Sem migration. Rodízio limpo, apoio intocado. (Antes, no mesmo dia: o #68 subiu às ~04:22 UTC como `00bbfc81fc0f`, também sem migration e verificado.)
**Verificação:** réplicas em `1667770c12e7` healthy; `verificar` ✓ (37 tabelas, 75 funções, sem porta pública, sharp ✓); `/app/metricas` responde 307 sem sessão; WhatsApp intacto (uazapi ativa, 361 conversas e 15059 mensagens, iguais à foto de antes); logs sem erro; worker reiniciado.
**Como reverter:** `prd-rollback` = `00bbfc81fc0f` (#68).

## [2026-10-09] Fase 9 PR 1: métricas de suporte (`/app/metricas`) — e a Fase 8 sai do plano

**Agente/Modelo:** Claude Opus 5.5.
**Objetivo:** dar ao gestor a tela que decide a fila: quanto está em aberto agora (e com SLA estourado) e como o atendimento andou nos últimos 7/30/90 dias.
**Decisão do dono (2026-10-09): a Fase 8 (financeiro interno) não será feita.** O plano é anterior à integração com a TCBX; hoje a TCBX é o ERP da Ticbox (contratos e títulos em aberto), e mensalidades no CRM seriam uma cobrança paralela. Registrado no `PRD.md` §4 e no `docs/PLANO-IMPLANTACAO.md` (linha da Fase 8).
**Arquivos alterados:**
- feature nova `src/features/metrics/`: `lib/period.ts` (janela no fuso do app, `?periodo=`), `lib/summarize.ts` (agregação pura: medianas, série diária, lastro, `formatMetricDuration`) + `summarize.test.ts` (10), `types.ts`, `queries/get-support-metrics.ts` (5 leituras em paralelo) + `.test.ts` (4), `components/metrics-period-switch.tsx`, `metrics-summary.tsx`, `opened-resolved-chart.tsx` + `metrics-components.test.tsx` (8);
- página: `app/(dashboard)/app/metricas/{page,loading}.tsx` (`requireAdminPage`);
- menu/guard: `src/config/navigation.ts` (item "Métricas", grupo Análise, só admin; link na faixa antes de Ajustes) + `navigation.test.ts`; `src/lib/auth/route-guard.ts` (`/app/metricas` em `ADMIN_PAGE_PREFIXES`);
- tema: `src/app/globals.css` (tokens `--chart-opened`/`--chart-resolved` nos dois temas + `@theme`); docs: `UI.md` §5.25 (nova), `PRD.md` §4 e §6, `docs/PLANO-IMPLANTACAO.md`, este PROGRESS.
**O que foi feito:**
- **Definições (cada número diz a sua janela):** em aberto agora = `ticket_queue` não encerrado e ≠ resolvido; estourado = o `sla_breached` da view (o mesmo selo da lista); abertos = `created_at` na janela; resolvidos = `resolved_at` na janela; 1ª resposta = abertura → `first_responded_at` (analista; resposta antes da abertura conta zero), mediana com a amostra; resolução = abertura → `resolved_at`, tempo corrido, mediana; reaberturas = `ticket_status_history` saindo de "resolvido" para algo que não seja fechado/cancelado; abertos pela IA = `source = 'ai'`.
- **Contagens exatas pelo `count`**; medianas, IA e gráfico pelas linhas lidas (teto de 10.000) — passou, a tela avisa "amostra".
- **Desenho:** uma superfície com o protagonista "Em aberto agora" e seis números da janela (UI.md §5.4/§9: não N cartões iguais); gráfico de linhas pela skill dataviz.
- **Cor do gráfico calculada, não escolhida no olho:** o validador da skill (`validate_palette.js`) reprovou os pares só de verdes da marca (no escuro saem da faixa de luminosidade ou perdem contraste contra o card `#042D29`) e aprovou ciano `#0891b2` (abertos) + verde `#0a7e4d` no claro / `#16a34a` no escuro (resolvidos): daltonismo ΔE 14,3 e 16,1, contraste ≥ 3:1.
**Decisões tomadas (revisar):**
- **Métricas só para admin** (o gestor é admin hoje). Recorte por analista é desempenho de pessoa; abrir para member é trocar o `allowedRoles` e o guard.
- **Janela de 7/30/90 dias, padrão 30, sem "tudo".**
- **Resolução em tempo corrido**, não pelo relógio do SLA (que pausa): é o que o cliente sente. O SLA continua no selo.
- **"Métricas" é um link solto na faixa do admin** (a do membro não muda). A faixa do admin passa a ter 8 entradas; se apertar no `lg`, a saída é agrupar.
**Verificação:** typecheck ✓ (0) · lint ✓ (0 erros; os 9 warnings pré-existentes) · test ✓ (4743/4743; 22 da feature + guard/menu) · build ✓. As cinco leituras rodaram no **PostgREST local** (200; 3 em aberto e 2 estourados na base de teste). Sem teste de browser (AGENTS §3.12): revisão visual não feita.
**Pendências / próximos passos:** Fase 9 PR 2: recortes por fila, cliente e analista; IA × humano (1ª resposta da IA vs do analista, tickets resolvidos sem humano).
**Armadilhas descobertas:**
- **`content` do `Tooltip` do recharts 3 espera `TooltipContentProps` com os genéricos padrão.** `TooltipContentProps<number, string>` passa no Vitest e no editor, mas o `tsc` do build recusa. Leia a contagem de erros do `typecheck` antes de seguir: ela já mostrava "1".
- **Os tokens `--chart-1..5` são todos verdes da marca.** Para duas séries que precisam se distinguir, crie um token próprio e passe no validador da skill dataviz nos dois temas.

## [2026-10-09] Fase 7 PR 2b-3: aviso de conflito entre compromissos do mesmo técnico

**Agente/Modelo:** Claude Opus 5.5.
**Objetivo:** avisar, ao agendar, que o técnico escolhido já tem outro compromisso no mesmo horário, a pendência que a 2b-2 deixou.
**Arquivos alterados:** `features/appointments/lib/appointment-conflicts.ts` (+`.test.ts`, 9 casos), recuperada da clínica e adaptada; `app/api/appointments/route.ts` (+`GET ?from=&to=`); `components/appointment-dialog.tsx` (aviso) + `appointment-dialog.test.tsx` (+4 casos); docs: `UI.md` §5.1.1, `PRD.md` §6, este PROGRESS.
**O que foi feito:**
- **Regra pura** (`findAppointmentConflicts`): só compromissos do MESMO técnico (lá era um médico só; aqui o compromisso do técnico A não ocupa a agenda do B); sem técnico, nada a apontar; `cancelado` libera o horário; a edição não conflita consigo mesma; fim exclusivo; duração ausente = 1 hora (como a grade).
- **`GET /api/appointments?from=&to=`** (sessão, `requireDashboardUser`): os compromissos do período com só o que o aviso usa (horário, duração, situação, técnico, tipo, assunto). Leitura resiliente: erro vira lista vazia + log, porque o aviso é melhor esforço.
- **Aviso no diálogo** (também na ficha do ticket), na mesma mecânica do aviso de bloqueio: busca os compromissos do dia escolhido, guardados com o dia. Texto: "Ana Lima já tem Trocar a impressora (09:00–10:00). Dá para agendar mesmo assim." **Avisa, não impede.**
**Decisões tomadas (revisar):**
- **Sem técnico, sem aviso.** Conferir contra todos os compromissos da casa avisaria em toda visita de horário cheio, e o aviso viraria ruído.
- **A rota nova não distingue "sem compromissos" de "leitura falhou"** (usa `getAppointments`, que devolve `[]` e loga). Para um aviso de melhor esforço, preferi não duplicar a consulta.
**Verificação:** typecheck ✓ · lint ✓ (0 erros; os 9 warnings pré-existentes) · test ✓ (4720/4720; 13 novos; `api-guards` cobre o GET novo) · build ✓. O teste "editar não conflita consigo mesmo" tem controle positivo (o OUTRO compromisso da mesma técnica aparece; o próprio, não) para não passar à toa antes de a busca voltar.
**Pendências / próximos passos:** Fase 8 (Financeiro), pelo plano.
**Armadilhas descobertas:**
- **Teste de "não aparece" em aviso que depende de fetch passa à toa** se roda antes de a busca voltar. Ponha no mesmo teste um caso que TEM que aparecer e espere por ele (`findByRole`), e só então afirme a ausência do outro.

## [2026-10-09] Deploy: Fase 7 completa no ar (#63–#67)

**Agente/Modelo:** Claude Opus 5.5.
**Objetivo:** subir a Fase 7 (retornos no ticket, agendar a partir do ticket, fila de retornos, Agenda em calendário e bloqueios) em produção.
**O que foi feito (produção, autorizado por "tudo mergeado"):** `deploy/publicar.sh` (com `CRMSUP_HOST` apontando a VPS) a partir de `origin/main` @ `1457913df185`, ~04:06–04:11 UTC. Sem migration (livro-razão segue 19). Rodízio limpo (`web2` e depois `web`, drenando pelo appgw), apoio intocado.
**Verificação:** as duas réplicas em `1457913df185` healthy; `verificar` ✓ (anon 0/0, `authenticated` só nas tabelas do chat, `assert_security_baseline()` com 37 tabelas e 75 funções, sem porta pública, sharp ✓); páginas `/app`, `/app/agendamentos` e `/app/follow-ups` respondem 307 sem sessão, e `/api/agenda-blocks` responde 401; **WhatsApp intacto** (uazapi ativa, 361 conversas e 15059 mensagens, iguais à foto de antes; madrugada sem mensagem nova na janela); logs das réplicas sem erro e o worker reiniciado nas duas.
**Como reverter:** `prd-rollback` = `6468de22a151` (#62), e `app.anterior` = #62 (deploy/README.md §Rollback).

## [2026-10-09] Fase 7 PR 2b-2: bloqueios da Agenda

**Agente/Modelo:** Claude Opus 5.5.
**Objetivo:** cadastrar períodos sem atendimento (férias de um técnico, feriado de todos), vê-los no calendário e ser avisado ao agendar em cima deles. Fecha a Fase 7.
**Arquivos alterados:**
- lib: `features/appointments/lib/agenda-blocks.ts` (+`.test.ts`, 12 casos), recuperada da clínica e adaptada: entrou o técnico (`assignee`, `relevantBlocks`, `blockLabel` com o nome, `describeAgendaBlockPeriod` para a lista); saíram os horários rápidos e a compatibilidade com dados antigos de lá;
- schema: `schemas/agenda-block.ts` (+`.test.ts`, 6 casos): dia inteiro (`start_date`/`end_date` inclusive → 00:00 do 1º até 00:00 do dia seguinte ao último) ou intervalo (`starts_at`/`ends_at` locais), tudo em ISO para a rota;
- back: `queries/get-agenda-blocks.ts` (`getAgendaBlocks(range)`, `null` = falhou), `app/api/agenda-blocks/route.ts` (GET `?from=&to=`, POST) e `[id]/route.ts` (DELETE), todas com `requireDashboardUser` na 1ª linha;
- UI: `components/agenda-blocks-dialog.tsx` (+`.test.tsx`, 5 casos), `agenda-month-view.tsx` e `agenda-time-grid.tsx` (desenho), `agenda-calendar.tsx` e `agenda-toolbar.tsx` (prop `blocks`, botão "Bloqueios"), `appointment-dialog.tsx` (aviso, +`appointment-dialog.test.tsx`, 4 casos), `agenda-calendar.test.tsx` (+2 casos); página: `agendamentos/page.tsx` (bloqueios no `Promise.all`); docs: `UI.md` §5.1.1 e nota no §5.17, `PRD.md` §6, este PROGRESS.
**O que foi feito:**
- **Cadastro** no diálogo "Bloqueios" da faixa: dia inteiro ou horário de um dia, motivo, técnico (vazio = todos); lista dos próximos com excluir. Sem edição (nada aponta para um bloqueio).
- **Calendário** (UI.md §5.17): hachura no dia inteiro, linha `motivo · horário` no parcial, minicalendário com número riscado/relógio, faixa de fundo na grade que não rouba clique.
- **Aviso no diálogo de agendamento** (também na ficha do ticket): busca os bloqueios do dia escolhido e avisa quando o horário cruza um bloqueio de todos ou do técnico escolhido. Fim exclusivo: o almoço até 13:00 não atrapalha a visita das 13:00. **Avisa, não impede.**
**Decisões tomadas (revisar):**
- **Member cadastra e exclui bloqueio**, como faz com compromisso (molde a, sob sessão). Se for coisa de admin, troca-se o guard das duas rotas de escrita.
- **Horário parcial é de um dia só** no formulário (Dia · Das · Até). O schema aceita intervalo que atravessa dias; a tela não oferece, porque ausência de vários dias é "dia inteiro".
- **Excluir bloqueio sem confirmação**: é reversível (cadastra-se de novo) e o toast confirma.
- **Conflito entre compromissos** (dois na mesma hora para o mesmo técnico) **não entrou**: pede uma leitura de compromissos por dia que a tela ainda não tem. Fica como pendência.
**Verificação:** typecheck ✓ · lint ✓ (0 erros; os 9 warnings pré-existentes) · test ✓ (4707/4707; 31 novos; `api-guards` cobre as 2 rotas novas) · build ✓. As consultas de bloqueios (com o técnico embutido pela FK) e a da agenda por período rodaram contra o **PostgREST local** (banco/rest/storage/gateway ligados só para isso e desligados depois): 200 nas três; base local sem dados. Sem conferência visual em browser (AGENTS §3.12).
**Pendências / próximos passos:**
- Aviso de **conflito entre compromissos** do mesmo técnico (rota de leitura por dia + aviso no diálogo, no molde do aviso de bloqueio).
- Fase 8 (Financeiro) pelo plano.
**Armadilhas descobertas:**
- **`z.discriminatedUnion` não aceita membro com `.transform()`** (vira `ZodPipe`). Refine em cada objeto pode (no zod 4 continua `ZodObject`), e o transform vai depois da união.
- **`agenda_blocks` tem duas FKs para `app_users`** (técnico e quem cadastrou): o embed precisa do hint `app_users!agenda_blocks_assignee_id_fkey`.
- **O `Alert` tem `role="alert"`**: em teste, `findByRole("alert")` acha o aviso do diálogo.

## [2026-10-09] Fase 7 PR 2b-1: Agenda em Mês, Semana, Dia e Lista

**Agente/Modelo:** Claude Opus 5.5.
**Objetivo:** a Agenda deixa de ser só uma lista e vira calendário: mês, semana e dia, com o período na URL, criar num dia tocando o `+` e editar tocando o compromisso. Os bloqueios ficam para a 2b-2.
**Arquivos alterados:**
- lib (pura, testada): `features/appointments/lib/agenda-view.ts` (+`.test.ts`, 14 casos: parse da URL, intervalo da consulta, links de período/abas, título, agrupamento por dia, minutos no fuso do app) e `lib/time-grid-layout.ts` (+`.test.ts`, 10 casos), recuperado da tag `legado-clinica` sem mudança;
- query: `queries/get-appointments.ts` (`getAppointments(range)` com `gte`/`lt`, ordem crescente, teto de 500 por período — o único chamador é a página);
- UI: `components/agenda-calendar.tsx` (composição + diálogos, +`.test.tsx`, 9 casos), `agenda-toolbar.tsx`, `agenda-view-tabs.tsx` (+`.test.tsx`, 4 casos), `agenda-nav-progress.tsx` (recuperado), `agenda-month-view.tsx`, `agenda-time-grid.tsx`, `agenda-event.tsx` (o card único); `appointment-dialog.tsx` (prop `dateKey` na criação); `appointments-table.tsx` (sem o cabeçalho próprio; vazio fala "neste mês");
- página: `app/(dashboard)/app/agendamentos/{page,loading}.tsx` (tela cheia, `panel-float`, skeleton da grade); docs: `UI.md` §5.1.1, `PRD.md` §6, este PROGRESS.
**O que foi feito:**
- Recuperado da clínica, reinterpretado: a mesma faixa de duas linhas (§5.20), as abas otimistas com `aria-current` honesto e a barra de 2 px do `useLinkStatus` (§5.21), a grade de 1 px por minuto com faixas paralelas (§5.15), o minicalendário do telefone. Saíram: lead, Google Agenda, "Visitou", venda, configurações da agenda (tipos/unidades/horários), filtros de serviço.
- **Card único** (`AgendaEvent`) no mês, na semana, no dia e na lista do telefone: opaco (`bg-card` + tinta do TIPO + barra lateral), hora e assunto (ou o tipo) na 1ª linha, empresa/contato na 2ª; nome acessível com tudo, inclusive a situação.
- **"Hoje" sai do servidor** (`getTodayAppDateKey()` na página) e desce por prop: o mesmo dia no HTML e na hidratação.
**Decisões tomadas (revisar):**
- **Padrão = Mês** (era a lista de todos os compromissos). A Lista continua a um toque e agora é do mês em tela, em ordem crescente.
- **Valores da URL em português** (`mes`, `semana`, `dia`, `lista`); o legado misturava `month`/`list` com `semana`/`dia`.
- **Abas no desenho do "Lista | Quadro" dos tickets**, não no gradiente da linguagem 2.0 da clínica.
- **Sem filtros nesta fatia** (situação, tipo, técnico): entram se o uso pedir.
- **Excluir continua só na Lista** (o diálogo de edição não tem excluir).
**Verificação:** typecheck ✓ · lint ✓ (0 erros; os 9 warnings pré-existentes) · test ✓ (4676/4676; 37 novos) · build ✓. Sem teste de browser (AGENTS §3.12): a revisão visual em 320/375/tablet/desktop, claro e escuro (UI.md §10) **não foi feita** por mim.
**Pendências / próximos passos:**
- **2b-2:** bloqueios (`agenda_blocks`): rotas, cadastro, desenho no mês e na grade (UI.md §5.17) e aviso de bloqueio/conflito no diálogo.
**Armadilhas descobertas:**
- **No mês, o desktop e o telefone estão os dois no DOM** (um some por CSS). Em teste, `getByText` acha os dois: mire a grade do desktop (`role="grid"` que contém `section`) ou use o `aria-live` da faixa.
- **O `console` é silenciado no setup do Vitest.** Para inspecionar um valor num teste descartável, jogue-o num `throw new Error(JSON.stringify(...))`.
- **Formatos reais do `date.ts`:** `formatLongDate` não traz o ano ("Sexta-feira, 09 de outubro"), dia com dois dígitos; `formatMonthShort` sem ponto ("out").

## [2026-10-09] Fase 7 PR 2c-3: a fila de retornos (`/app/follow-ups`)

**Agente/Modelo:** Claude Opus 5.5.
**Objetivo:** uma tela com os retornos de todos os tickets, para o analista ver o que vence e o que já venceu sem abrir ticket por ticket, e concluir dali.
**Arquivos alterados:**
- query: `src/features/followups/queries/get-followups-page.ts` (`parseFollowupQueueParams` + `getFollowupsQueuePage`) + `.test.ts` (11 casos); `src/features/followups/types.ts` (tipos da fila);
- UI: `features/followups/components/followups-queue.tsx` + `.test.tsx` (10 casos), `app/(dashboard)/app/follow-ups/{page,loading}.tsx`;
- menu: `src/config/navigation.ts` (item "Retornos" em Operação; na faixa do desktop, menu "Agenda" com Agenda e Retornos) + `navigation.test.ts`; docs: `PRD.md` §6, `UI.md` §5.1.2, §5.1.4 (nova) e a nota da faixa em §3.3, este PROGRESS.
**O que foi feito:**
- **Query paginada no servidor** no molde de `getContactsPage` (`count` + `range`, página além do fim abre a última, `failed` marcado). O ticket entra por `tickets!followups_ticket_id_fkey!inner(...)`, com a empresa dele, para o filtro "Meus tickets" (`ticket.assigned_to_user_id = viewer`). A linha é mapeada campo a campo: o responsável só serve ao filtro e não vai à tela. Linha com `kind`/`status` fora do enum derruba a página para o estado de falha (como `toTicketListItems`).
- **"Vencido" com um instante só:** a query gera o `fetchedAt`, filtra "Vencidos" com `due_at < fetchedAt` e o devolve; a tela destaca o vencido pelo `useNow(fetchedAt)`. Servidor e tela usam o mesmo corte.
- **Tela de dados (§5.1):** contagem por recorte ("3 retornos pendentes"), filtros no painel e na URL (`?situacao=`, `?responsavel=eu`), tabela em cartões no desktop e pilha no celular, Concluir/Cancelar/Reabrir por PATCH na linha, `ListPagination`.
**Decisões tomadas (revisar):**
- **Menu "Agenda" na faixa do desktop**, em vez de mais um link solto: com Retornos seriam 7 links + Ajustes, e a faixa já está no limite no `lg` (o próprio `navigation.ts` avisa para não virar "régua de texto"). Na gaveta do celular e na busca, "Retornos" aparece como item próprio. O preço: a Agenda passa a estar a 2 cliques no desktop.
- **Rótulo "Retornos", rota `/app/follow-ups`:** o rótulo é o que a ficha do ticket já usa (2c-1); a rota é a do plano.
- **Sem busca livre** nesta fatia. Os filtros que importam são situação e "Meus tickets"; buscar por ticket pede `ilike` no embed e fica para quando fizer falta.
- **O PATCH de situação foi duplicado** da ficha do ticket (2º uso; AGENTS §0.2.2). No 3º, extrair.
**Verificação:** typecheck ✓ · lint ✓ (0 erros; os 9 warnings pré-existentes, 0 novos) · test ✓ (4639/4639; 23 novos, contando o `pages-guard` da página nova) · build ✓ (`/app/follow-ups` registrada). A query foi conferida **contra o PostgREST local** (banco + rest + gateway ligados só para isso e desligados depois): pendentes, vencidos e "Meus tickets" respondem 200, e um controle com coluna inexistente no alias (`ticket.nao_existe`) responde 400 citando `tickets_1`, o que prova que o filtro `ticket.` cai no ticket embutido. A base local não tem retornos: isso confere sintaxe e alvo do filtro, não o recorte com dados. bug-hunter/verification-before-completion: skills não instaladas; revisão do diff à mão.
**Pendências / próximos passos:**
- **2b:** views de calendário (mês/grade/semana/dia) + bloqueios (`agenda_blocks`).
- Retornos vencidos no Início (fila do analista), se o dono quiser.
**Armadilhas descobertas:**
- **Teste que acha "o menu" por `find(kind === "menu")` quebra quando nasce o 2º menu.** O teste do ícone de Ajustes passou a procurar pelo título.
- **Filtro em embed com alias:** o PostgREST aceita o alias (`ticket.assigned_to_user_id`) e também o nome da tabela (`tickets.`); um prefixo que não casa com nenhum embed responde 400 `PGRST108` ("Verify that 'x' is included in the 'select'"). Medido no PostgREST local. Base vazia não prova filtro: para conferir o alvo, filtre uma coluna inexistente pelo mesmo prefixo e veja o 400 citar a tabela embutida (`tickets_1`).
- **Stack local para conferir query:** `docker start crm-suporte-db crm-suporte-rest crm-suporte-storage crm-suporte-gateway` (o gateway cai sem `realtime` e `storage` resolvendo; o realtime só sobe com o banco no ar). A chave de serviço está no `.env.local` do checkout principal.

## [2026-10-09] Fase 7 PR 2c-2: agendar a partir do ticket (laço do ticket, metade agenda)

**Agente/Modelo:** Claude Opus 5.5.
**Objetivo:** do ticket, agendar uma visita (ou treinamento, implantação, acesso remoto) já ligada a ele, e ver na ficha os compromissos do ticket. Com o 2c-1 (retornos), fecha o critério de aceite da Fase 7: "do ticket se agenda uma visita e um retorno".
**Arquivos alterados:**
- query: `src/features/appointments/queries/get-appointments.ts` (+`getTicketAppointments`, mesma seleção e leitura resiliente da lista);
- UI: `features/appointments/components/appointment-dialog.tsx` (prop `context` + tipo `AppointmentTicketContext`), `ticket-appointments.tsx` (novo, painel da ficha) + `ticket-appointments.test.tsx` (5 casos), `appointments-table.tsx` (protocolo do ticket como link no Assunto);
- integração: `features/tickets/components/ticket-detail.tsx` (prop `appointments` + `Section` "Agendamentos"), `app/(dashboard)/app/tickets/[number]/page.tsx` (busca no `Promise.all`), `ticket-detail.test.tsx` (3 renders com `appointments={[]}`); docs: `PRD.md` §6 (linha da Agenda, que faltava), `UI.md` §5.1.1 e §5.1.3 (nova), este PROGRESS.
**O que foi feito:**
- **`AppointmentDialog` ganhou `context`** (só na criação): `ticket_id` e `contact_id` vêm do ticket, sem seletor, e a empresa do ticket já vem escolhida (trocável). Uma linha só de leitura mostra `SUP-1024 · título`, também na edição de um compromisso que tem ticket. A edição **não reenvia** o vínculo (o `context` é zerado quando há `appointment`).
- **Seção "Agendamentos"** na ficha do ticket, abaixo de "Retornos": tipo e situação (os selos da Agenda), data e hora, assunto, técnico · local; "Agendar" e editar por linha. Ticket encerrado = só leitura.
- **Na Agenda**, o compromisso ligado a um ticket mostra o protocolo como link para o ticket.
- **Sem back novo:** o POST de `/api/appointments` já aceitava `ticket_id`/`contact_id` desde o #62 (FK inválida → 422).
**Decisões tomadas (revisar):**
- **Excluir fica na Agenda.** Na ficha só se cria e edita (cancelar é pela situação). Evita exportar o diálogo de exclusão da tabela só para isto.
- **Sem destaque de "atrasado"** no compromisso: a situação é a que a pessoa marcou. A tela não infere "não realizado" de um horário passado (UI.md §1.5).
- **Empilhado sobre o #63** (base `main`): a ficha e a feature de follow-ups vêm de lá. Mergear o #63 antes.
**Verificação:** typecheck ✓ · lint ✓ (0 erros; os 9 warnings pré-existentes, 0 novos) · test ✓ (4616/4616; 5 novos) · build ✓. bug-hunter/verification-before-completion: skills não instaladas; revisão do diff à mão.
**Pendências / próximos passos:**
- **2c-3:** fila `/app/follow-ups` (pendentes/vencidos cruzando tickets) + item no menu.
- **2b:** views de calendário (mês/grade/semana/dia) + bloqueios (`agenda_blocks`).
**Armadilhas descobertas:**
- **`max-width` em `<td>` não segura truncagem** no layout automático de tabela (e o `TableCell` já é `whitespace-nowrap`). Para truncar um bloco dentro da célula, ponha o `max-w-*` no próprio elemento (`block max-w-56 truncate`).
- **Substituição por texto em teste com recuos diferentes:** `followups={[]}` aparece com 6, 8 e 10 espaços no `ticket-detail.test.tsx`. Um replace sem âncora de linha casa duas vezes no mesmo render. Use regex com `^( *)` e `re.M`.

## [2026-10-08] Fase 7 PR 2c-1: Follow-ups ligados ao ticket (laço do ticket)

**Agente/Modelo:** Claude Opus 4.8.
**Objetivo:** o laço do ticket da Fase 7 (metade retornos): do ticket cria-se um RETORNO (follow-up), que aparece na própria ficha com o vencido em destaque, e pode ser concluído/cancelado/reaberto ali. Fecha parte do critério de aceite do plano.
**Arquivos alterados:**
- domínio/feature nova `src/features/followups/`: `lib/followup-kind.ts` + `followup-status.ts` (enum fixo, rótulo+cor, +testes), `schemas/followup.ts` (zod; `done_at` fora — a rota deriva; +teste), `types.ts`, `queries/get-followups.ts` (`getTicketFollowups`, embed do ticket FK-hinted);
- back: `src/app/api/followups/route.ts` (POST) e `[id]/route.ts` (PATCH+DELETE), `requireDashboardUser` na 1ª linha; a PATCH deriva `done_at` do status (concluído→agora; pendente/cancelado→null);
- UI: `components/followup-dialog.tsx` (criar/editar), `ticket-followups.tsx` (painel do ticket: lista + "Novo retorno" + concluir/cancelar/reabrir/editar/excluir, vencido destacado);
- integração: `features/tickets/components/ticket-detail.tsx` (prop `followups` + `now` + `Section` "Retornos") e `app/(dashboard)/app/tickets/[number]/page.tsx` (busca `getTicketFollowups` no `Promise.all`) + `ticket-detail.test.tsx` (3 renders com `followups={[]}`); docs: `UI.md` + este PROGRESS.
**O que foi feito:**
- Feature de follow-ups paralela à de appointments (2a): mesmos moldes (enum fixo + `getColorStyle`, schema compartilhado, query resiliente, rotas molde a com guard).
- No detalhe do ticket, a seção **"Retornos"** (coluna direita, ao lado dos Detalhes/Anexos): cria com contexto (`ticket_id` do ticket), lista por prazo, destaca o **vencido** (pendente + `due_at` < agora), e conclui/cancela/reabre por PATCH direto. `now` vem do `useNow(fetchedAt)` do próprio detalhe (seguro para hidratação).
**Decisões tomadas (revisar):**
- **`done_at` derivado no servidor** (não no corpo): a PATCH carimba `done_at` conforme o status, para honrar o invariante `(status='concluido') = (done_at not null)` sem o cliente precisar saber disso.
- **Retorno mora na ficha do ticket**, não na timeline (o plano fala em timeline): a timeline é um hotspot próprio; a seção "Retornos" entrega o mesmo valor (ver + vencido destacado) com risco menor. A fila `/app/follow-ups` (cross-ticket) e o "Agendar visita" (appointment pelo ticket) ficam para a 2c-2.
- **Sem re-gate de concluir/cancelar no banco** (não há RPC): são PATCH simples; a autorização é do guard da rota. O ticket terminal (`is_terminal`) esconde as ações (só leitura).
**Verificação:** typecheck ✓ · lint ✓ (0 erros; 9 warnings pré-existentes, 0 novos) · test ✓ (4611/4611; `api-guards` cobre as rotas novas) · build ✓. bug-hunter/verification-before-completion: skills não instaladas — revisão à mão.
**Pendências / próximos passos:**
- **2c-2:** fila `/app/follow-ups` (pendentes/vencidos cruzando tickets) + menu; "Agendar visita" a partir do ticket (estender `AppointmentDialog` com contexto inicial de ticket/empresa/contato) + mostrar os compromissos do ticket.
- **2b (adiada):** views de calendário (mapa já levantado nesta sessão) — mês/grade/semana/dia + bloqueios.
**Armadilhas descobertas:**
- **`setState` síncrono em `useEffect` é ERRO de lint** (`react-hooks/set-state-in-effect`). Para "agora do cliente" sem quebrar hidratação, o padrão do repo é o hook `useNow(fetchedAt)` (o setState dele mora num `setInterval`, não dispara a regra). Passei `now` por prop em vez de um effect próprio.
- **supabase `.update()` recusa `Record<string, unknown>`** — tipar o objeto como `Database["public"]["Tables"]["followups"]["Update"]`.
- **Embed do ticket exige hint de FK** (`tickets!followups_ticket_id_fkey`): `ticket_id` tem duas relações (tickets + view ticket_queue) → sem hint, PGRST201.

## [2026-10-08] Fase 7 PR 2a: Agenda — lista + criar/editar/excluir + menu

**Agente/Modelo:** Claude Opus 4.8.
**Objetivo:** primeira tela da Agenda — `/app/agendamentos` com a LISTA de compromissos e o diálogo de criar/editar/excluir. As views de calendário (mês/grade/semana/dia) e os follow-ups ficam para as próximas fatias.
**Arquivos alterados:**
- domínio/feature: `src/features/appointments/lib/appointment-kind.ts` + `appointment-status.ts` (enum fixo, rótulo e cor por `ColorName`, +testes), `schemas/appointment.ts` (zod compartilhado dialog↔rota, +teste), `types.ts` (Appointment + embeds), `queries/get-appointments.ts` (leitura resiliente com embeds FK-hinted);
- back: `src/app/api/appointments/route.ts` (POST) e `[id]/route.ts` (PATCH+DELETE), com `requireDashboardUser` na 1ª linha;
- UI: `components/date-time-fields.tsx` (recuperado do legado, puro), `appointment-dialog.tsx` (criar/editar, estado controlado), `appointments-table.tsx` (lista + excluir com confirmação), `app/(dashboard)/app/agendamentos/{page,loading}.tsx`, `src/config/navigation.ts` (+item "Agenda" em Operação e no TOP_NAV_SPEC) + `navigation.test.ts`; docs: `UI.md` + este PROGRESS.
**O que foi feito:**
- **Enum fixo de tipo e status** (substitui a tabela configurável `appointment_types` + o combobox da clínica): `appointmentKind{Label,Color,Options}` / `appointmentStatus{Label,Color,Options}`, cor pelo sistema de 19 cores (`getColorStyle(name).badge`) — sem hex no componente (UI.md §cores).
- **Lista** (`appointments-table`): colunas quando/tipo/assunto/empresa/técnico/situação + ações; selo por tipo e por status; vazio com `EmptyState`.
- **Dialog**: tipo, título, data/hora (DateTimeFields) + duração, local, situação, técnico (select de `/api/app-users`, que já existia "para o dialog de agendamento"), empresa (via `CustomerPicker`, mesmo seletor do chat/contatos), observações. POST/PATCH; erro de campo pintado a partir do `errors` da rota.
- **Rotas CRUD** (molde a, insert/update direto na tabela — sem RPC): FK inválida → 422; `created_by_user_id` vem do viewer, não do corpo.
**Decisões tomadas (revisar):**
- **Vínculo só a EMPRESA + TÉCNICO no dialog standalone.** `ticket_id`/`contact_id` nascerão do CONTEXTO quando o compromisso for criado a partir de um ticket (2c) — evita construir combobox de contato/ticket agora (não existe pronto; `CustomerPicker` é lista de busca).
- **Status é campo editável** no criar/editar (a cascata de funil da clínica morreu); sem botão "Marcar realizado" dedicado.
- **Menu em Operação** (todos), não admin — como no legado.
- **2a NÃO desvincula empresa** pelo dialog (trocar sim, limpar não): o `optionalUuid` trata `""`/null como "não mexe". Limpar vínculo fica para quando precisar (migration/schema não muda, só a rota).
**Verificação:** typecheck ✓ · lint ✓ (0 erros; os mesmos 9 warnings pré-existentes em `verify-webhook.test.ts`, 0 novos) · test ✓ (4596/4596; `api-guards`/`pages-guard` cobrem a rota e a página novas) · build ✓ (rota `/app/agendamentos` registrada). bug-hunter/verification-before-completion: skills não instaladas — revisão à mão.
**Pendências / próximos passos:**
- **2b:** views de calendário (mês, grade de horários, semana/dia) — recuperar `agenda-month-view`/`agenda-time-grid`/`agenda-list-view`/`agenda-toolbar` + `time-grid-layout`/`appointment-conflicts` (libs puras) + bloqueios (`agenda_blocks`) + aviso de conflito.
- **2c:** follow-ups (`followups-table`, `novo-followup-dialog`, `/app/follow-ups`) + o laço do ticket (agendar visita/retorno a partir do ticket; timeline; retorno vencido destacado) — aí os vínculos ticket/contato entram por contexto.
- Abas mobile: o plano quer `/app/agendamentos` nas abas; deixei de fora (barra tem 4) — rever na 2b/2c.
**Armadilhas descobertas:**
- **`navigation.test.ts` já usava `/app/agendamentos`** como o exemplo de "módulo fora do TOP_NAV_SPEC que aparece no fim". Ao adicionar a Agenda ao spec, troquei o exemplo para `/app/relatorios` (fictício) e somei "Agenda"/"/app/agendamentos" às listas de href (membro/admin) e aos títulos do topo (Ajustes virou `entries[6]`).
- **Embeds da query exigem hint de FK pelo nome** (`customers!appointments_customer_id_fkey`): `appointments.ticket_id` tem duas relações no gerador (tickets e a view `ticket_queue`) → sem hint o PostgREST responde PGRST201.
- **`EmptyState` recebe só `children`** (não `title`/`description`). **`/api/app-users` já existia** feito para este dialog (devolve `{users:[{id,name}], currentUserId}`).

## [2026-10-08] Fase 7 PR 1: schema de Agenda + Follow-ups (banco)

**Agente/Modelo:** Claude Opus 4.8.
**Objetivo:** fundar o módulo de Agenda + Follow-ups do suporte (núcleo do produto), recuperando as tabelas da clínica (tag `legado-clinica`) REINTERPRETADAS. Só o banco nesta PR; as queries e as telas vêm nas próximas.
**Arquivos alterados:**
- banco: `supabase/migrations/20261008160000_agenda_followups.sql` (tabelas `appointments`, `followups`, `agenda_blocks`), `supabase/tests/agenda_followups.sql` (17 casos), `src/lib/supabase/database.types.ts` (regenerado); docs: `PRD.md` §8 (linha Agenda) + este PROGRESS.
**O que foi feito:**
- **`appointments`:** `kind` enum fixo (`visita_tecnica`/`treinamento`/`implantacao`/`acesso_remoto`), `ticket_id?`/`customer_id?`/`contact_id?`/`assignee_id?` (técnico) todos **ON DELETE SET NULL** (apagar o pai não apaga o histórico de agenda), `scheduled_at`, `duration_min`, `location`, `status` (`agendado`/`confirmado`/`realizado`/`cancelado`), `notes`, `created_by_user_id`.
- **`followups`:** `ticket_id` **NOT NULL** (retorno é sempre de um ticket) **ON DELETE CASCADE**, `due_at`, `kind` (`retorno`/`verificacao`/`cobranca`), `status` (`pendente`/`concluido`/`cancelado`) com invariante `(status='concluido') = (done_at is not null)`, índice parcial de pendentes por prazo.
- **`agenda_blocks`:** bloqueios de disponibilidade, por técnico (`assignee_id`) ou globais (null), `range check` (fim > início).
- **Segurança:** molde a (como `external_contracts`) — RLS ligada, NENHUMA policy, `revoke all` inclusive de service_role, `grant select/insert/update/delete` só a service_role. `assert_security_baseline()` ✓ (34→**37 tabelas**, 75 funções). Triggers `set_updated_at` nas três.
**Decisões tomadas (revisar):**
- **Reinterpretação da clínica → suporte:** saíram `lead_id`, `tipo_ensaio`, Google Calendar e os lembretes `reminder_d3/d0`; `appointments` ganhou vínculo a ticket/empresa/contato e técnico. O `followup` deixou de ser disparo automático de mensagem e virou TAREFA (concluída por humano), presa a ticket.
- **Sem a config da clínica** (`appointment_types`/`clinic_units`/`agenda_hours`): o tipo é enum fixo (cor por tipo na UI), não tabela configurável. Se você quiser tipos/horários configuráveis depois, é migration nova.
- **Vocabulário a confirmar:** os valores de `followups.kind` (`retorno`/`verificacao`/`cobranca`) e os `status` são meu palpite razoável — fáceis de ajustar ANTES de telas usarem (migration nova depois).
- **Molde a (grant direto), não RPC:** agenda/follow-ups são CRUD simples; a autorização é da rota sob sessão, como em `external_contracts`. Tickets usam RPC por causa dos invariantes; aqui não há invariante de transição.
**Verificação:** typecheck ✓ · lint ✓ (0 erros; 9 warnings pré-existentes) · test ✓ (4577/4577) · build ✓ · teste SQL `agenda_followups` ✓ (17 casos). bug-hunter/verification-before-completion: skills não instaladas — revisão à mão.
**Pendências / próximos passos:**
- **Fase 7 PR 2:** recuperar da tag `legado-clinica` as queries + telas (`agenda-month-view`, `agenda-time-grid`, `agenda-list-view`, `appointment-dialog`, `followups-table`, `novo-followup-dialog`), adaptando lead/deal/paciente → ticket/customer; menu (`/app/agendamentos`, `/app/follow-ups`) + `allowedRoles`.
- Do ticket, agendar uma visita e um retorno; os dois na timeline; retorno vencido destacado (critério do plano §Fase 7).
**Armadilhas descobertas:**
- **Teste SQL de `followups` precisa de um ticket real** (FK NOT NULL). O setup semeia empresa+técnico(app_user)+contato+conversa(sem integração, para NÃO colidir com o lixo uazapi local) e chama `create_ticket` (id em `#>>'{ticket,id}'`). Os `ON DELETE` são conferidos pelo catálogo (`pg_constraint.confdeltype`), sem depender de guard de delete das tabelas pai.
- **Reaproveitar o legado é `git show legado-clinica:<caminho>`** — a tag tem o módulo inteiro (migrations, componentes, libs). As telas da PR 2 saem dali, não reescritas.

## [2026-10-08] Fase 6b-1b: relay à IA migrado para o outbox (durável, at-least-once)

**Agente/Modelo:** Claude Opus 4.8.
**Objetivo:** o repasse da mensagem do cliente à IA deixa de ser "no máximo uma vez" (fire-and-forget que some num 500) e passa pela fila durável do #59 — at-least-once dentro de uma janela de 120s, sem nunca gravar o token da instância no banco. Caminho crítico WhatsApp→IA.
**Arquivos alterados:**
- back: `src/features/integrations/server/relay-dispatch.ts` (novo: `enqueueRelay`/`dispatchRelayBatch` + entrega por evento) e `relay-dispatch.test.ts`; `src/features/integrations/server/relay-message.ts` (relayInboundMessage vira a primitiva de entrega de UM evento: devolve o desfecho, perde o token; leak-scan extraído para `envelopeLeaksToken`) e `relay-message.test.ts`; `src/app/api/chat/webhook/uazapi/route.ts` (+ `route.test.ts`): enfileira síncrono + `after(dispatchRelayBatch)`; `src/lib/jobs/worker.ts` (+teste): job `relay` a cada 20s; docs: `docs/CONTRATO-RELAY.md` (§7 garantia de entrega) + este PROGRESS.
**O que foi feito:**
- **Webhook (inbound+bot+nova):** `enqueueRelay` SÍNCRONO antes de responder (durável — se o processo cair, o worker entrega) + `after(() => dispatchRelayBatch)` (tentativa imediata de baixa latência). Idempotente por `message_id`.
- **enqueueRelay:** tira o `token` da instância (qualquer caixa) e confirma por `envelopeLeaksToken` que ele não sobrou aninhado — **fail-closed**: envelope com a credencial não é gravado nem entregue. O outbox nunca guarda o token.
- **dispatchRelayBatch:** `claimOutbox('relay', limit 10, max_attempts 6, max_age 120s)` → para cada evento, reconstrói a mensagem (do payload limpo), entrega por `relayInboundMessage` (reusada) e finaliza com fencing: `sent` / `retry` (backoff `outboxRetryAt`) / `skipped` (sem agente) / `dead_letter` (payload corrompido). O outbox mata por idade/tentativas.
- **Worker:** 4º job `relay` a cada 20s, drena o que a tentativa imediata não entregou. **Não usa `job_leases`** — o claim do outbox serializa por evento, então todas as réplicas ajudam.
**Decisões tomadas (revisar):**
- **relayInboundMessage reusada, não duplicada:** virou a entrega de UM evento (devolve o desfecho; o token saiu dela). O leak-scan agora mora no enqueue (único ponto com o token). Preservei a suíte dela quase inteira; os casos de credencial migraram para `relay-dispatch.test.ts`.
- **Sem re-gate de `status='bot'` na ENTREGA:** o webhook filtra no recebimento, `buildRelayFields` lê o status FRESCO (vai no envelope) e o contrato manda o agente só responder com `bot`. Um humano que assume entre o recebimento e a entrega é barrado pelo agente (e pela trava do `409` no envio por token IA). Não gastei um 4º estado do settle com isso.
- **Janela 120s / 6 tentativas / backoff 5s→60s:** mensagem velha perde valor para a IA; vira `dead_letter` e fica só no CRM (lida por `GET /conversations/{id}/messages`).
**Verificação:** typecheck ✓ · lint ✓ (0 erros; 9 warnings pré-existentes em `verify-webhook.test.ts`) · test ✓ (4577/4577, +relay-dispatch) · build ✓. bug-hunter/verification-before-completion: skills não instaladas na sessão — revisão adversarial à mão.
**Pendências / próximos passos:**
- **6c:** `ticket_notices` (derivar do molde Meta — `20260825143000` inacessível) + `webhook_subscriptions` e aba de Webhooks (o outbox já aceita `kind='webhook'`).
- Depois do deploy, conferir no banco de prod: `event_outbox` com linhas `kind='relay'` chegando a `sent`, e `integration_logs` do relay seguindo normais.
**Armadilhas descobertas:**
- **O webhook agora AWAITa o enqueue** (um roundtrip a mais antes de responder 200). É o preço da durabilidade; é um INSERT via RPC, rápido.
- **O leak-scan em relayInboundMessage virou defesa em profundidade** (o dispatch reconstrói a mensagem SEM token, então o guard lá é no-op no fluxo real). O guard ATIVO é o `enqueueRelay`. Não remova o scan da primitiva: ele protege quem a chamar com token.
- **O job de relay NÃO tem `job_leases`** (diferente de SLA/TCBX/manutenção). De propósito: o `claim` do outbox já é o ponto de serialização (skip-locked + lease por evento), então as duas réplicas drenam em paralelo sem reenviar a mesma mensagem.
- **at-least-once:** a mesma mensagem pode chegar ao agente mais de uma vez (retry). O contrato já mandava descartar repetição por `message_id`; o `docs/CONTRATO-RELAY.md` §7 agora diz isso explicitamente.

## [2026-10-08] Fase 6b-1a: infra do outbox de entrega (event_outbox + RPCs)

**Agente/Modelo:** Claude Opus 4.8.
**Objetivo:** fundar a fila durável de entrega (relay à IA e, depois, webhooks) com lease + backoff + dead_letter — **sem** ainda mexer no caminho crítico. O relay migra para cá na 6b-1b; esta PR é só a infra, testada.
**Arquivos alterados:**
- banco: `supabase/migrations/20261008140000_event_outbox.sql` (tabela `event_outbox` + RPCs `outbox_enqueue`/`outbox_claim`/`outbox_settle`), `supabase/tests/event_outbox.sql` (17 casos), `src/lib/supabase/database.types.ts` (regenerado), `src/features/tickets/lib/map-ticket-error.test.ts` (ver armadilha);
- domínio: `src/features/integrations/server/outbox.ts` (helpers `enqueueOutbox`/`claimOutbox`/`settleOutbox` + `outboxRetryAt`) e `outbox.test.ts`; docs: este PROGRESS.
**O que foi feito:**
- **`event_outbox`** (molde do outbox de conversões do projeto irmão): `kind` (`relay`|`webhook`), `event_key` (único por kind → enfileirar é idempotente), `payload`, `status` (pending→processing→sent/retry/dead_letter/skipped), `attempts`, `next_attempt_at` (backoff), lease (`lease_token`/`owner`/`expires_at`), `last_http_status`/`last_error`, `delivered_at`. Dois índices parciais (prontas; órfãs).
- **`outbox_enqueue`** idempotente (`on conflict (kind,event_key) do nothing`, devolve o id novo ou o existente — o 2º enqueue **não** sobrescreve o payload do 1º).
- **`outbox_claim`** (`for update skip locked`): mata o esgotado/velho antes de reivindicar, reivindica até `limit` (travado em [1,100]) marcando `processing` + lease de 2 min + `attempts+1`.
- **`outbox_settle`** com **FENCING**: só o dono da lease (`lease_token`) finaliza; o worker calcula o `next_attempt_at` (backoff exp. com teto) e passa pronto.
- **Segurança (molde `job_leases`):** RLS + `revoke all ... from public, anon, authenticated, service_role` (inclusive service_role — nem lê a tabela); as 3 RPCs são SECURITY DEFINER com `search_path=''`, `revoke ... from public, anon, authenticated` e `grant execute` só a service_role. `assert_security_baseline()` passou.
**Decisões tomadas (revisar):**
- **Infra-primeiro, relay depois.** Quebrei a 6b em duas: esta (fundação, zero no caminho crítico) e a 6b-1b (migrar o relay). O caminho WhatsApp→IA é sensível demais para migrar junto com fundação nova não exercitada.
- **Helpers TS já nesta PR** (ainda sem chamador): são a fundação tipada que a 6b-1b usa de imediato, e os testes os exercitam — não é código morto.
- **Backoff no TS, não no banco:** `outboxRetryAt(attempts, nowMs)` puro (base 5s · 2^(n-1), teto 60s); o banco não decide o "quando". Teto curto de propósito — a janela útil do relay é 120s.
**Verificação:** typecheck ✓ · lint ✓ (0 erros; 9 warnings são pré-existentes em `verify-webhook.test.ts`) · vitest ✓ (4566/4566) · build ✓ · teste SQL `event_outbox` ✓ (17 casos). bug-hunter/verification-before-completion: **skills não instaladas nesta sessão** — fiz a revisão adversarial à mão (achei e corrigi o bug do dead_letter em voo, abaixo).
**Pendências / próximos passos:**
- **6b-1b:** migrar o relay para o outbox (sanitizar o payload tirando o token da instância; reconstruir o envelope fresco na entrega; buscar o token fresco; `max_age` 120s; reavaliar `status='bot'` na entrega; tentativa imediata no `after()` + job de recuperação no worker).
- **6c:** `ticket_notices` (derivar do molde Meta — `20260825143000` é inacessível) e `webhook_subscriptions` + aba de Webhooks.
**Armadilhas descobertas:**
- **`outbox_claim` não pode matar `processing` com lease VIVA.** A 1ª versão dava `dead_letter` em qualquer `processing` esgotado/velho. Como a 6b-1b terá dois reivindicadores quase simultâneos (o `after()` imediato + o worker periódico), matar uma entrega em voo faria o `settle` do dono falhar por fencing e perderíamos o registro de uma entrega que talvez deu certo. Corrigido: só mata `processing` com **lease expirada** (órfã). O esgotamento normal é o worker que resolve via `settle(dead_letter)`; o claim só é a rede de segurança do órfão.
- **O teste `map-ticket-error` varre TODA migration `>= _tickets` por `raise exception 'TAG'`.** Meu `raise exception 'INVALID_OUTBOX_STATUS'` entrou no varrimento e quebrou a igualdade com `TICKET_ERROR_TAGS`. É um guard interno do outbox (service_role, nunca vira resposta de rota), então entrou no `NOT_TICKET_TAGS` — como já estavam `INVALID_LEASE`/`INVALID_RETENTION`. (O `'EVENT_OUTBOX: …'` não casa o regex porque tem `:`.)
- **Tipos gerados marcam os args nuláveis de `outbox_settle` como não-nulos** (mesmo quirk de `job_cursor_set`). O SQL **precisa** de null (sem HTTP não há status — a constraint recusa 0; sem retry não há próximo prazo). O helper passa null em runtime e faz `as unknown as ...Args` com comentário.

## [2026-10-08] Worker: lease + espelho da TCBX fresco sozinho + manutenção

**Agente/Modelo:** Claude Opus 4.8.
**Objetivo:** fechar o fio da TCBX (o espelho de contratos passa a ficar fresco sozinho, sem clicar "Sincronizar") e amadurecer o worker com lease de execução única — a infra de lease que a 6b também vai usar.
**Arquivos alterados:**
- banco: `supabase/migrations/20261008130000_job_leases.sql` (tabela `job_leases` + RPCs `job_claim`/`job_cursor_set`), `supabase/tests/job_leases.sql` (+teste SQL), `src/lib/supabase/database.types.ts` (regenerado);
- domínio: `src/lib/jobs/worker.ts` (jobs `runTcbxReconcile`/`runMaintenance` + lease, 3 intervalos; +teste); docs: este PROGRESS.
**O que foi feito:**
- **Lease (`job_leases` + `job_claim`/`job_cursor_set`):** jobs em TS que fazem várias chamadas (reconciliar a TCBX, purgar) não dão para o advisory lock de 1 SQL do sla_sweep — `job_claim(name, seconds)` pega o lock por N s (quem não pega pula o ciclo) e devolve o **cursor compartilhado** do job, para a leva avançar linear entre réplicas (sem redundância 2×). SECURITY DEFINER; service_role só EXECUTE, nem lê a tabela.
- **Worker (3 jobs):** `sla_sweep` a cada 60s (advisory lock próprio); **reconciliação da TCBX** a cada 5 min (leva de 20 empresas, cursor rolante — passa por todas e recomeça); **manutenção** a cada 1h (`api_idempotency_purge` + `purge_integration_logs`, que os headers da Fase 5 pediam ao "worker da Fase 6"). Cada um gatado pelo lease; nunca lança.
**Decisões tomadas (revisar):**
- **Cursor compartilhado no banco** (não por réplica): a volta pela base avança linear, sem as réplicas repetirem empresas. `""` = recomeçar (o reconcile trata vazio como sem cursor).
- **Leva de 20/5min** → volta completa pela base (~168 empresas) a cada ~45 min; carga modesta na TCBX. Ajustável.
- Ainda **polling** (o webhook DA TCBX depende do Bruno); é o interino profissional para "100% sincronizado".
**Verificação:** typecheck ✓ · lint ✓ · test ✓ (worker + SQL `job_leases` 4 casos + suíte completa) · build ✓. Migration aplicada local + tipos regenerados; **smoke do lease**: pega/não-pega/cursor persiste/re-pega após expirar; service_role executa a RPC mas é barrado na tabela; baseline 33 tab/72 fn ✓.
**Pendências / próximos passos:** ⚠️ depende do **worker LIGADO** (`RUN_JOBS=true` no `.env` do servidor, §3.9) — com ele, SLA automático + TCBX fresco + manutenção rodam juntos. Depois: 6b (outbox + webhooks).
**Armadilhas descobertas:** o gen types marca param `text` como `string` (não anulável) — usar `""` em vez de `null` para "sem cursor". O advisory lock transacional (sla_sweep) não serve para job de várias chamadas (libera no fim da statement) — daí o lease.

## [2026-10-08] Fase 6a — SLA automático: sla_sweep + worker in-process (RUN_JOBS)

**Agente/Modelo:** Claude Opus 4.8.
**Objetivo:** o SLA do CRM passar a estourar e fechar sozinho, sem container novo: carimbar `*_breached_at` uma vez por ticket e fechar o resolvido após 72h.
**Arquivos alterados:**
- banco: `supabase/migrations/20261008120000_sla_sweep.sql` (função `sla_sweep`), `supabase/tests/sla_sweep.sql` (+teste SQL), `src/lib/supabase/database.types.ts` (regenerado);
- domínio: `src/lib/jobs/worker.ts` (`startJobs`/`runSlaSweep`, +teste), `src/instrumentation.ts` (hook do Next, liga o worker só com `RUN_JOBS=true`); docs: UI.md §5.24, este PROGRESS.
**O que foi feito:**
- **`sla_sweep()`** (SECURITY DEFINER, dona = papel das migrations; `service_role` só EXECUTE, porque não pode escrever em `tickets` — assert §14 de _tickets): (1) carimba `first_response_breached_at`/`resolution_breached_at` no **critério EXATO da view `ticket_queue`** (`sla_mode<>'stopped'`, 1ª resposta com `now()`, resolução com `coalesce(sla_paused_at, now())`); (2) fecha resolvido→fechado (há >72h) pelo helper interno `ticket_apply_transition(...,'system',null,null,...)`, replicando o travamento (conversa FOR UPDATE antes do ticket FOR NO KEY UPDATE), em levas de 200. Advisory lock (`pg_try_advisory_xact_lock`) garante **uma réplica por ciclo**.
- **Worker in-process** (`src/instrumentation.ts` → `startJobs`): a cada 60s chama `sla_sweep`; guarda em `globalThis` (HMR), `timer.unref`, nunca lança. Ligado **só com `RUN_JOBS=true`** e runtime Node.
**Decisões tomadas (revisar):**
- **Worker in-process nas réplicas** (aprovado pelo dono), não container novo; o advisory lock dedupe entre réplicas. `RUN_JOBS` default **OFF**.
- O fechamento automático **sobe `version`** (status é coluna de negócio) — esperado, invalida o form aberto; o sweep não passa `expected_version` (lê+trava, como a RPC). Carimbar breach **não** sobe version (só `updated_at`).
- 6a faz **só `sla_sweep`**; os purges (`api_idempotency_purge`, `purge_integration_logs`) que o mesmo worker deveria chamar ficam para a 6b (pedido nos headers das migrations da Fase 5).
**Verificação:** typecheck ✓ · lint ✓ (0 erros) · test ✓ (worker + suíte completa) · build ✓. Migration aplicada no DB local + tipos regenerados; **smoke real no seed**: `{first_response:1, resolution:2, closed:1}`, 2ª passada `{0,0,0}` (idempotente), `service_role` executa, `anon` barrado. Teste SQL `sla_sweep.sql` (completude vs. a própria view + idempotência): 4 casos ok. (As falhas de `conversas.sql`/`segredo_integracao.sql` no teste SQL LOCAL são lixo do DB — uma `chat_integration` commitada em 2026-09-26; no CI o banco é limpo.)
**Pendências / próximos passos:** ⚠️ **ATIVAR em produção = `RUN_JOBS=true` no `.env` do servidor** (edição de `.env` + recriar o web → autorização do dono, §3.9). Até lá, a migration está no ar mas o sweep não roda. Depois: 6b (outbox + webhooks, base do webhook da TCBX).
**Armadilhas descobertas:** `service_role` NÃO escreve em `tickets` (assert local) → o sweep TEM que ser função SECURITY DEFINER. O `ticket_transition` público recusa ator "sistema" e exige versão → use o helper `ticket_apply_transition` direto, replicando o lock. O critério de breach precisa casar a view (`coalesce(sla_paused_at, now())` na resolução), senão carimba fora de hora.

## [2026-10-08] Fase 4 · PR 7 — Quadro (kanban de tickets) + chave "Lista | Quadro"

**Agente/Modelo:** Claude Opus 4.8.
**Objetivo:** a tela que faltava da Fase 4: o Quadro (kanban) dos tickets, arrastando o card entre colunas para mudar o status; e a chave "Lista | Quadro" na tela de Tickets.
**Arquivos alterados:**
- novos: `tickets/queries/get-tickets-board.ts` (+teste), `tickets/components/tickets-board.tsx` (+teste), `tickets/components/ticket-view-switch.tsx` (+teste), `tickets/components/cancel-ticket-dialog.tsx` (extraído da lista), `app/(dashboard)/app/tickets/quadro/{page,loading}.tsx`;
- alterados: `tickets/components/tickets-table.tsx` (usa o `CancelTicketDialog` e o `postTicketAction` extraídos + prop `viewSwitch`), `tickets/lib/ticket-request.ts` (`postTicketAction` compartilhado), `tickets/queries/get-tickets-page.ts` (`buildListQuery` exportado), `tickets/components/ticket-filters.tsx` (`hideStatus`), `tickets/lib/ticket-list-url.ts` (`toListFilters`, `QUADRO_PATH`, `ticketBoardHref/Search`, `countTicketBoardFilters`), `tickets/types.ts` (`TicketsBoard`), `app/(dashboard)/app/tickets/page.tsx` (passa a chave); docs: UI.md §5.24, este PROGRESS.
**O que foi feito:**
- **Colunas = status NÃO-TERMINAIS** (status "ativos" = `sla_mode != stopped`): a pilha de trabalho. Terminais (resolvido/fechado/cancelado) não viram coluna — saem do quadro pelo menu "Mover para" do card. `getTicketsBoard` reusa `buildListQuery` forçando "ativos", sem paginação, com teto `BOARD_MAX=500` (avisa `capped`).
- **Arrastar = transição** (kibo-ui/kanban, dnd-kit): otimista, com véu no card; valida `canTransition` antes de postar; no 409 (versão/transição inválida) **reverte** (via `queueMicrotask`, porque o provider chama meu `onDragEnd` antes do reorder final) e relê. Uma ação por vez (como a lista).
- **"Mover para"** no card (teclado/mobile) com `allowedTargets`; **Cancelar** abre o diálogo de motivo (extraído da lista, agora compartilhado).
- **Chave "Lista | Quadro"** nas duas telas, preservando prioridade/fila/responsável/SLA (o quadro não leva status/busca/ordem).
**Decisões tomadas (revisar):**
- **Quadro = só colunas ativas** (não resolvido/fechado/cancelado) — mantém o quadro limitado e focado no trabalho em aberto; resolver/fechar/cancelar é pelo menu do card. Se quiser uma coluna "Resolvido", dá pra adicionar.
- **Alternância por chave, não item de nav próprio** — o plano pede exatamente isso ("a chave 'Lista | Quadro'"); evita dois itens de menu para o mesmo dado.
- **Extraí `CancelTicketDialog` e `postTicketAction`** da lista para compartilhar com o quadro (a lista segue com 34 testes verdes).
**Verificação:** typecheck ✓ · lint ✓ (0 erros; 9 warnings pré-existentes) · test ✓ (quadro + lista + guards; suíte completa) · build ✓.
**Pendências / próximos passos:** o quadro não tem Realtime (relê no `visibilitychange` e após ações, como a lista). Sem busca no quadro (num quadro se varre); os filtros são os mesmos da lista. A barra mobile não ganhou o Quadro (a chave já alterna).
**Armadilhas descobertas:** o `KanbanProvider` muta `data` no `dragOver` e chama o `onDragEnd` de quem usa ANTES do reorder final — reverter síncrono é sobrescrito; reverti com `queueMicrotask`. O `KanbanCard` desestrutura só `{id,name,children,className}` (não espalha no DOM), então dá pra pendurar o ticket inteiro no item com segurança. `[id]` da rota de transição é o UUID, não o protocolo.

## [2026-10-08] Selo de contrato da TCBX no painel do chat (não "Sem contrato") — fix

**Agente/Modelo:** Claude Opus 4.8.
**Objetivo:** no painel "Dados do contato" do chat, o grupo EMPRESA mostrava "Contrato → Sem contrato" (selo interno nulo) mesmo com contrato ativo na TCBX — contraditório com o grupo "Cliente (TCBX)" logo abaixo ("Situação: Ativo"). O dono pediu para corrigir em todos e não acontecer mais.
**Arquivos alterados:** `chat/components/contact-info-sheet.tsx` (deriva `hasActiveExternalContract` do contexto TCBX já consultado e aplica a precedência no selo do grupo EMPRESA, +teste no contact-info-sheet.test.tsx); docs: UI.md §5.7.12, este PROGRESS.
**O que foi feito:** mesma precedência do #53 (ficha de Clientes): interno (`contract_status`) → contrato ativo na TCBX (`ExternalContractBadge` "Contrato ativo (TCBX)") → "Sem contrato". O sinal vem da consulta **ao vivo** do painel (`useCustomerContext`/`isActiveContract`), então vale mesmo onde o espelho ainda não tem a linha. É só exibição — corrige **todos** automaticamente e não recorre.
**Verificação:** typecheck ✓ · lint ✓ · test ✓ (contact-info-sheet com caso novo; suíte completa) · build ✓.
**Pendências:** nenhuma. Não há mudança de dado — é renderização.
**Armadilhas descobertas:** o `ExternalContractBadge`/`ContractStatusBadge` renderizam com a paleta de domínio (sem tokens `--wa-*`) e funcionam dentro do painel do chat nos dois temas — por isso dá para reusar o mesmo selo da ficha ali.

## [2026-10-08] Enriquecimento automático no 1º contato pelo WhatsApp (TCBX) — PR 3b

**Agente/Modelo:** Claude Opus 4.8.
**Objetivo:** no 1º contato de um número pelo WhatsApp, procurar o cliente na TCBX e já trazer empresa + contratos para o CRM, automaticamente. Número fora da base (ou PF): o contato é criado SEM empresa (como já era).
**Arquivos alterados:** `customers/server/enrich-contact.ts` (serviço `enrichContactFromSource`, +teste), `app/api/chat/webhook/uazapi/route.ts` (gancho `after()` no contato novo, +teste no route.test.ts); docs: este PROGRESS.
**O que foi feito:**
- `enrichContactFromSource(supabase, {contactId, phone, createdBy?})`: resolve o cliente pelo TELEFONE (variações canônicas), e se achar PJ com CNPJ cria/reusa a empresa, vincula o contato (só se ainda estiver SEM empresa — nunca sobrescreve vínculo manual) e espelha os contratos (reusa o contexto já buscado). `not_found`/PF/ambíguo/indisponível: não cria nem vincula. **Nunca lança.**
- O webhook, no passo 4.1, agenda isso com `after()` (pós-resposta, sobrevive a deploy — mesmo mecanismo do relay) **só quando `identity.created`** (contato novo). Best-effort: o webhook responde 200 sem esperar; falha aqui não afeta a mensagem.
**Decisões tomadas (revisar):**
- Dispara por `identity.created` (contato novo), não por direção — assim vale também quando o dono inicia a conversa com um número novo. Só cria empresa se a TCBX tiver o PJ; número aleatório não vira nada.
- `createdBy` vai `null` (criação pelo sistema, não por um usuário). A coluna é anulável.
- **Já existiam** (não reconstruído): vínculo manual contato→empresa (chat "Ligar/Trocar empresa", diálogo em Contatos, desvincular na ficha — tudo via `PATCH /api/contacts/[id]`), vínculo via API (`PATCH /api/v1/contacts/[id]` com `customer_id`), e a seção "Contatos (N)" na ficha da empresa.
**Verificação:** typecheck ✓ · lint ✓ · test ✓ (webhook + enrich + api-guards; suíte completa) · build ✓.
**Pendências / próximos passos:** o relay e o enriquecimento são dois `after()` independentes; se um dia virar gargalo, um outbox (Fase 6) coordena. PR 3 (webhook/polling da TCBX) mantém o espelho fresco depois.
**Armadilhas descobertas:** o webhook é hotspot crítico (nunca pode quebrar) — o enriquecimento entra SÓ por `after()` e `enrichContactFromSource` nunca lança, então uma falha de TCBX/DB não derruba a mensagem. `identity.created` é o sinal de "1º contato" (vem da RPC `resolve_contact_identity`); num reenvio da 1ª mensagem, `created=false`, e não re-dispara.

## [2026-10-08] Esconder "Sem contrato vigente" quando há contrato ativo na TCBX — fix

**Agente/Modelo:** Claude Opus 4.8.
**Objetivo:** com contrato ativo na TCBX, a ficha mostrava o selo "Contrato ativo (TCBX)" no topo MAS ainda a seção interna "Sem contrato vigente"/"Novo contrato" — contraditório. O dono pediu para sumir.
**Arquivos alterados:** `customers/components/customer-detail.tsx` (ContractsSection recebe `hasActiveExternal`; esconde a seção "Contrato" interna quando não há contrato interno e há ativo na TCBX); docs: UI.md §5.1, este PROGRESS.
**O que foi feito:** quando `!current` (sem contrato interno vigente) e `hasActiveExternal`, a seção "Contrato" não renderiza (nem "Sem contrato vigente", nem "Novo contrato") — o contrato aparece no bloco "Contratos (TCBX)" abaixo. Vale para admin e member. Sem contrato ativo na TCBX, tudo como antes.
**Verificação:** typecheck ✓ · lint ✓ · test ✓ (clientes) · build ✓.
**Pendências:** nenhuma. (Em paralelo: PR do enriquecimento automático no 1º contato pelo WhatsApp.)

## [2026-10-07] Contratos da TCBX ESPELHADOS no banco (read-only) + reconciliação — PR 3a

**Agente/Modelo:** Claude Opus 4.8.
**Objetivo:** persistir no CRM, read-only, os contratos que o cliente tem na TCBX (a fonte da verdade): reconciliar as empresas já cadastradas (estavam "sem contrato") e já trazer nas novas. Ninguém cria contrato à mão.
**Arquivos alterados:**
- **banco:** `supabase/migrations/20261007170000_contratos_externos.sql` (tabela `external_contracts`), `src/lib/supabase/database.types.ts` (regenerado);
- **domínio:** `customers/server/external-contracts.ts` (store/sync/reconcile, +teste), `customers/queries/get-external-contracts.ts`, `customers/queries/get-customers-page.ts` (selo da lista, +teste), `customers/types.ts` (`StoredExternalContract`/`ReconcileContractsReport`/`has_external_active`), `customer-source/active-contract.ts` (tipo mais largo), `customers/server/backfill-external.ts` (grava o espelho na importação, reusa o contexto), `api/customers/route.ts` (sincroniza no cadastro manual);
- **rotas:** `api/customers/sync-contracts/route.ts` (reconciliação em massa), `api/customers/[id]/sync-contracts/route.ts` (uma empresa);
- **UI:** `customers/components/external-contracts-card.tsx` (reescrito: lê do banco + botão admin, +teste), `external-contract-badge.tsx` (selo verde, novo), `sync-contracts-button.tsx` (reconciliação em massa, +teste), `customer-detail.tsx` (bloco + selo no cabeçalho), `customers-table.tsx` (selo na lista), `clientes/[id]/page.tsx` e `clientes/page.tsx` (carrega o espelho / botão); docs: UI.md §5.1 + §5.7.12, este PROGRESS.

**O que foi feito:**
- **Tabela `external_contracts`** (espelho read-only): escrita só pelo servidor (service_role), RLS ligada e sem policy, upsert por `(customer_id, provider, external_id)`. `assert_security_baseline()` passou (32 tabelas).
- **Sincronização** (`syncExternalContracts`): consulta a TCBX pelo CNPJ e grava; `not_found` esvazia o espelho (a fonte é a verdade), `unavailable`/`ambiguous` preservam o que havia. `storeExternalContracts` faz upsert e poda o que sumiu (marca com `synced_at` e apaga o anterior).
- **Reconciliação em massa** por cursor: rota + botão admin "Sincronizar contratos (TCBX)" em /app/clientes. **Empresa nova** já nasce com os contratos (importação reusa o contexto já buscado; cadastro manual sincroniza).
- **Exibição**: a ficha lê o espelho (bloco + "Atualizar da TCBX" + "atualizado em"); lista e cabeçalho ganham o selo **"Contrato ativo (TCBX)"** quando não há contrato interno — nunca junto com "Sem contrato".

**Decisões tomadas (revisar):**
- **Selo TCBX separado**, não mexe no `customers.contract_status` (que é do trigger/support_contracts). Precedência: interno → TCBX ativo → "Sem contrato".
- **"Ativo" na lista/índice usa `status_vigencia = 'ativo'`** (campo canônico; a TCBX manda minúsculo — verificado por curl: `CT-2026-000261` veio `status_vigencia: "ativo"`). `isActiveContract` (ficha) cai em `status` na ausência — divergência só teórica (a TCBX sempre manda `status_vigencia`).
- **`not_found` apaga o espelho da empresa.** Um 404 transitório da fonte limparia; risco aceito (a TCBX é a fonte da verdade).
- **Chat continua AO VIVO** (sob demanda no atendimento); a ficha é o espelho persistido. Propósitos diferentes, de propósito.
- O **chat não migrou** para o espelho: `use-external-context` segue servindo o grupo "Cliente (TCBX)" do chat.

**Verificação:** typecheck ✓ · lint ✓ (0 erros; 9 warnings pré-existentes em `verify-webhook.test.ts`) · test ✓ (um instável conhecido — `contact-info-sheet`/`media-key` — oscila na suíte paralela, passa isolado e no CI) · build ✓. Migration aplicada no DB local + tipos regenerados (`pnpm db:types`). bug-hunter/verification-before-completion indisponíveis no ambiente ("Unknown skill") → revisão manual do diff (achou e corrigiu a falta do botão de reconciliação).
**Pendências / próximos passos:** rodar "Sincronizar contratos (TCBX)" em produção (escreve em `external_contracts`, tabela nova e isolada); PR 3 (webhook/polling + id externo) mantém o espelho fresco sem ação manual. Rotas thin (`sync-contracts`) cobertas por api-guards + testes de domínio, sem teste de rota dedicado.
**Armadilhas descobertas:** migration que cria tabela precisa satisfazer `assert_security_baseline()` (RLS ligada, zero grant anon/authenticated, zero policy fora do chat, service_role sem TRUNCATE/TRIGGER/REFERENCES — DELETE é permitido); o baseline checa PROPRIEDADES, não contagem fixa, então criar tabela é ok. O DB local do projeto é o compose próprio (`crm-suporte-db` na 54322), **não** `supabase start`; aplicar com `scripts/db-local-apply.sh` (exige o container de pé + schema `storage`).

## [2026-10-07] Contratos ativos da TCBX na ficha da empresa (somente leitura) — PR 2e

**Agente/Modelo:** Claude Opus 4.8.
**Objetivo:** mostrar, na ficha de cada empresa, os contratos **ativos** que o cliente tem na TCBX — sob demanda, sem escrever nada no nosso banco.
**Arquivos alterados:**
- novos: `src/features/customer-source/use-external-context.ts` (hook genérico por endpoint), `src/features/customer-source/active-contract.ts` (+teste), `src/features/customers/components/external-contracts-card.tsx` (+teste);
- alterados: `src/features/chat/hooks/use-customer-context.ts` (virou atalho fino sobre o hook genérico — API e testes do chat intactos), `src/features/customers/components/customer-detail.tsx` (renderiza o bloco); docs: UI.md §5.1 + §5.7.12, este PROGRESS.

**O que foi feito:**
- Bloco **"Contratos (TCBX)"** na ficha da empresa (`/app/clientes/[id]`), abaixo do contrato interno: lista os contratos com `statusVigencia: "ativo"` (número, modalidade, período, dia de vencimento). Reusa a rota que já existia (`GET /api/customers/[id]/external-context`, #47) — nada novo no servidor.
- **Hook resiliente extraído** para `customer-source/use-external-context.ts` (genérico pelo endpoint: descarta resposta velha, falha vira `unavailable`). O `useCustomerContext` do chat passou a delegar a ele, sem mudar a assinatura.
- `isActiveContract` (puro, testado): ativo = `statusVigencia` (ou, na ausência, `status`) == "ativo", sem caixa/espaços.

**Decisões tomadas (revisar):**
- **NÃO espelhar no `support_contracts`.** A pergunta era "cadastrar os contratos ativos"; medi o modelo e ele **não cabe**: a RPC exige `monthly_amount` e `product_ids` (a TCBX não traz valor nem fila), e o índice `support_contracts_one_current_per_customer_uidx` só deixa **um contrato vigente por empresa**. Gravar exigiria **inventar** valor/produto (proibido, §0.2.5/6) e perderia os contratos extras. O dono escolheu, entre 3 opções, a leitura ao vivo na tela (mantém a arquitetura "sob demanda" já aprovada; o chat já faz igual). As outras opções (contrato interno placeholder; tabela-espelho `external_contracts` com migration) ficaram descartadas/adiadas.
- Mostra para **admin e member** (a rota é `requireDashboardUser`, e o chat já expõe o mesmo contexto ao member).
- Bloco aparece para **qualquer** empresa com CNPJ (não há flag de "sincronizada" — não temos `external_id`); empresa fora da TCBX mostra "Sem cadastro na TCBX", e sem integração o bloco some.

**Verificação:** typecheck ✓ · lint ✓ (0 erros; 9 warnings pré-existentes em `verify-webhook.test.ts`) · test ✓ (244 arq / 4509) · build ✓. bug-hunter / verification-before-completion **indisponíveis neste ambiente** ("Unknown skill") → revisão manual do diff no lugar.
**Pendências / próximos passos:** re-clicar "Importar da TCBX" (fix do telefone canônico do PR 2d); PR 3 (webhook/polling + `external_id`). Se um dia quiser PERSISTIR os contratos da TCBX, é a tabela-espelho `external_contracts` (migration + aprovação, §3.3), não o `support_contracts`.
**Armadilhas descobertas:** `support_contracts` é o contrato **interno** da casa (valor + fila + um vigente por empresa), **não** um espelho de base externa — não tente enfiar contrato de terceiro ali. O hook de contexto externo agora é `customer-source/use-external-context.ts`; `chat/hooks/use-customer-context.ts` é só o atalho do chat.

## [2026-10-07] Integração TCBX: telefone canônico (DDD+8), cursor no backfill e 409=ambíguo — PR 2d

**Agente/Modelo:** Claude Opus 4.8.
**Objetivo:** fazer a busca por telefone casar o cliente certo (o `409` era diferença de formato, não ambiguidade real) e corrigir o laço do backfill. Veio da 1ª importação em produção: 38 empresas criadas, mas 314 deram `409`.
**Arquivos alterados:**
- novos: `src/features/customer-source/resolve-by-phone.ts` (+teste);
- alterados: `src/lib/formatters/phone.ts` (`phoneLookupCandidates`, +teste), `customer-source/types.ts` (estado `ambiguous`), `get-customer-context.ts` (409→`ambiguous`, +teste), `customers/types.ts` (`BackfillReport`: `ambiguous`/`cursor`/`done`), `customers/server/backfill-external.ts` (cursor + `resolveCustomerByPhone` + ambíguo, +teste), `api/customers/backfill-external/route.ts` (`after`, +teste), `customers/components/backfill-external-button.tsx` (laço por cursor), `api/contacts/[id]/external-context/route.ts` (telefone→`resolveCustomerByPhone`, +teste), `chat/components/contact-info-sheet.tsx` (estado ambíguo); docs: UI.md n-a, este PROGRESS.

**O que foi feito:**
- **`phoneLookupCandidates`:** a identidade do número é **DDD + os 8 últimos dígitos**; o 9º extra, o `55` e o `+55` são variações. Gera as variações (com/sem 9, com/sem 55), tentando **o formato como veio primeiro**.
- **`resolveCustomerByPhone`:** tenta as variações até uma casar um cliente **único** (`200`); `409` em todas → `ambiguous`; para em `unavailable`/`not_configured`.
- **`409` virou estado próprio (`ambiguous`):** o painel mostra "Vários cadastros na TCBX com este telefone" (não "erro"), e o backfill conta separado (pula, não cria).
- **Backfill por CURSOR** (id do contato), não por "quem falta vincular": os que não resolvem não são reprocessados — era o bug que, na 1ª importação, martelou a TCBX com **1399 chamadas** (reprocessando os 409 em laço até o teto).

**Decisões tomadas:**
- Ordem das variações: formato como veio primeiro (celular com 9 → começa com 9), para o número real resolver antes de arriscar casar o formato curto com outro cadastro.
- `409` (ambíguo) é pulado no backfill e informado na tela — não é erro nem "sem cadastro".
- A rota antiga por empresa (`/api/customers/[id]/external-context`) segue por `documento`; a por contato usa telefone canônico.

**Verificação:** typecheck ✓ · lint ✓ (0 erros; 9 avisos antigos) · test ✓ · build ✓. Testes: `phoneLookupCandidates` (variações/ordem/curto), `resolveCustomerByPhone` (1ª que acha vence, 409 pula, todas 409=ambíguo, fonte fora para), `get-customer-context` (409→ambiguous), backfill (cursor/done, ambíguo) e as duas rotas.

**Pendências / próximos passos:**
- **Re-rodar "Importar da TCBX"** (já com o telefone canônico) deve resolver muito mais — ex.: PETECOPECAS, cujo 1º candidato `8699783446` bate exatamente o cadastro da TCBX. Validar o rendimento em produção.
- PR 3: webhook/polling + id externo.

**Armadilhas descobertas:**
- **Backfill que filtra "sem empresa" e repete a leva** nos que não resolvem vira laço até o teto, martelando a fonte. Avançar por **cursor** (id) é o certo.
- **TCBX casa por formato exato:** mandar `55`+`9`+número casa vários (409); a identidade real é DDD + 8 últimos — tentar as variações resolve do nosso lado, sem o Bruno.

## [2026-10-07] Integração TCBX: cadastro em massa de clientes (backfill) — PR 2b

**Agente/Modelo:** Claude Opus 4.8.
**Objetivo:** cadastrar em massa, em `/app/clientes`, as empresas que a TCBX conhece, a partir dos contatos do WhatsApp — por telefone (agora que a TCBX aceita).
**Arquivos alterados:**
- novos: `src/features/customers/server/backfill-external.ts` (+teste), `src/app/api/customers/backfill-external/route.ts` (+teste), `src/features/customers/components/backfill-external-button.tsx`;
- alterados: `src/features/customers/types.ts` (tipo `BackfillReport`), `src/app/(dashboard)/app/clientes/page.tsx` (botão admin); docs: este PROGRESS.

**O que foi feito:**
- Serviço `backfillExternalCustomers`: para cada contato SEM empresa, consulta a TCBX pelo telefone; se achar PJ (CNPJ), cria a empresa (ou reusa a que já tem o CNPJ) e vincula o contato. Idempotente, em levas (`limit`, padrão 50), com ensaio (`apply: false`). PF (CPF) fica de fora (`customers` só aceita CNPJ).
- Rota `POST /api/customers/backfill-external` (admin): uma leva por chamada, devolve o relatório + `remaining`. É escrita → POST.
- Botão "Importar da TCBX" na tela de Clientes (só admin, `viewer.role === "admin"`), com confirmação em dois passos; repete as levas até `remaining` zerar, mostra o progresso e dá `router.refresh()` no fim.

**Decisões tomadas:**
- **Por telefone, por contato** — cada contato tem um número → um cliente, então some a ambiguidade do CNPJ solto em mensagem.
- **Idempotente + em levas** (50/chamada): a tela repete; reexecutar só pega quem falta; evita timeout de centenas de consultas numa requisição só.
- **Só PJ** (customers.cnpj); PF não tem onde morar hoje.
- **Admin dispara** (o botão). Eu não posso disparar: a consulta à TCBX a partir de mim é barrada como exfiltração.
- ⚠️ **9º dígito:** telefone que não bate vira "não encontrado" (pulado), não cadastro errado — o risco é perder match, não criar lixo.

**Verificação:** typecheck ✓ · lint ✓ (0 erros; 9 avisos antigos) · test ✓ (4485 testes, 241 arquivos) · build ✓. Testes: serviço (PJ cria+vincula, PF pulado, não encontrado, dedup por CNPJ, `remaining`, fonte indisponível = erro) e rota (admin, apply, ensaio, sem env, erro).

**Pendências / próximos passos:**
- **Requer as 2 variáveis no cofre + deploy.** Sem elas, "Importar da TCBX" não acha nada.
- Confirmar o 9º dígito com casos reais.
- PR 3: webhook/polling + id externo.

**Armadilhas descobertas:**
- **Tipo compartilhado entre servidor e client:** `BackfillReport` foi para `customers/types.ts` (neutro) — o botão (client) não pode importar do serviço/rota (que puxam `getCustomerContext`/admin para o bundle).

## [2026-10-07] Integração TCBX: contexto do cliente por TELEFONE no chat (PR 2c)

**Agente/Modelo:** Claude Opus 4.8.
**Objetivo:** o painel do contato buscar o contexto da TCBX por CONTATO (CNPJ da empresa ou telefone), não só quando há empresa com CNPJ. A TCBX passou a aceitar busca por telefone, então o contexto vale para qualquer conversa.
**Arquivos alterados:**
- novo: `src/app/api/contacts/[id]/external-context/route.ts` (+teste);
- alterados: `src/features/chat/hooks/use-customer-context.ts` (+teste, agora por contato), `src/features/chat/components/contact-info-sheet.tsx` (grupo para qualquer contato) e `contact-info-sheet.test.tsx`; docs: UI.md §5.7.12 e este PROGRESS.

**O que foi feito:**
- O Bruno (TCBX) adicionou os parâmetros `telefone` ("com ou sem +55") e `contrato` em `GET /clientes/contexto` — conferido no catálogo e com número fictício (antes `422`, agora `404`). O nosso `getCustomerContext` já encaminhava `{telefone}` desde o #46.
- Rota nova `GET /api/contacts/[id]/external-context` (member, só leitura): lê o contato (telefone + customer_id); **prefere o CNPJ da empresa vinculada** (mais preciso) e, sem ela, **o telefone do contato**.
- O painel mostra o grupo "Cliente (TCBX)" para **qualquer conversa com contato** (não só com CNPJ). O texto do vazio virou "Sem cadastro na TCBX".
- A rota antiga `GET /api/customers/[id]/external-context` (por empresa) ficou para a ficha de Clientes.

**Decisões tomadas:**
- **Prefere CNPJ, cai no telefone.** Empresa com CNPJ é mais preciso; sem ela, o telefone resolve — assim vale para os ~300 contatos que só têm telefone.
- **O telefone vai como está** (ex.: `558699783446`); a TCBX normaliza o `+55`. ⚠️ O catálogo não menciona o 9º dígito do celular — pode divergir em alguns números (validar com casos reais).
- **Grupo para qualquer contato:** quem não é cliente na TCBX vê "Sem cadastro na TCBX" (informa o atendente) em vez de o grupo sumir.

**Verificação:** typecheck ✓ · lint ✓ · test ✓ · build ✓. Testes novos/ajustados: a rota (CNPJ, telefone, empresa sem CNPJ, contato sem empresa, falhas, sem env), o hook (URL de contato, estados) e o mock do painel (handler de `/external-context`).

**Pendências / próximos passos:**
- Validar o 9º dígito com números reais.
- Cadastro em massa dos clientes (minerados + por telefone) — PR 2b / backfill.
- PR 3: webhook/polling + id externo.

**Armadilhas descobertas:**
- **`NextResponse` reusado quebra:** `const resp = NextResponse.json(...)` no módulo, retornado em várias requisições, falha (o corpo só se lê uma vez). Use uma FUNÇÃO que cria a resposta a cada chamada.
- **`contacts.customer_id` não tem FK** (nasce sem, por decisão de migração): embed do PostgREST (`customers(cnpj)`) não funciona — leia a empresa numa 2ª query.

## [2026-10-05] Integração de clientes externa (TCBX): contexto no painel do chat (PR 2)

**Agente/Modelo:** Claude Opus 4.8.
**Objetivo:** o atendente ver, no painel do contato do chat, o contexto do cliente vindo da TCBX (situação, contrato e títulos em aberto), sob demanda. Continuação da fundação (PR #46).
**Arquivos alterados:**
- novos: `src/app/api/customers/[id]/external-context/route.ts` (+teste), `src/features/customer-source/summarize.ts` (+teste), `src/features/chat/hooks/use-customer-context.ts` (+teste);
- alterados: `src/features/chat/components/contact-info-sheet.tsx` (grupo novo "Cliente (TCBX)"); docs: UI.md §5.7.12 e este PROGRESS.

**O que foi feito:**
- **Rota de sessão** `GET /api/customers/[id]/external-context` (member): chaveia pela empresa, lê o CNPJ no servidor e chama `getCustomerContext({documento})`. Só leitura; devolve `{ ok, result }` com o `CustomerContextResult`. Como a consulta mora em `customer-source` (outro arquivo), o GET não dispara RPC direto e passa no `api-guards`.
- **Helper puro** `summarizeCustomerContext`: soma principal+multa+juros dos títulos em aberto, acha o vencimento mais próximo, e resume o contrato (status quando é um só; contagem quando são vários).
- **Hook** `useCustomerContext(customerId, enabled)`: busca quando a empresa tem CNPJ; `result`/`loading` são DERIVADOS do que chegou (guardado com o id da empresa), não sincronizados por efeito — trocar de empresa já mostra "carregando" sem `setState` dentro do `useEffect`. Falha vira `unavailable`.
- **Painel:** grupo "Cliente (TCBX)" abaixo de "Empresa", só com CNPJ; estados explícitos (esqueleto, indisponível+retry, sem dados, resumo); some com a integração desligada (`not_configured`).

**Decisões tomadas:**
- **O painel passa a mostrar VALOR** (R$ em aberto), exceção consciente ao "nunca valor" do grupo Empresa: vem da fonte autoritativa, não é inventado (UI.md §5.7.12).
- **Member vê** (quem atende precisa). **Só PJ pelo CNPJ** da empresa vinculada — pessoa física/contato sem empresa fica para quando a TCBX aceitar telefone.
- **"Importar como cliente" ficou para o PR 2b** (sem busca por telefone, falta o gatilho natural). Sob demanda, uma consulta por abertura (sem cache/Realtime, como o selo do contrato).

**Verificação:** typecheck ✓ · lint ✓ (0 erros; 9 avisos antigos) · test ✓ (4462 testes, 238 arquivos) · build ✓. Testes novos: helper (soma/vencimento/contratos), rota (401/400/consulta por CNPJ/sem CNPJ/empresa inexistente/falha do banco/sem Supabase) e hook (liga-desliga, resultado, falha→unavailable, retry, troca de empresa).

**Pendências / próximos passos:**
- **PR 2b:** botão "importar como cliente" (com busca por telefone, ou CNPJ digitado).
- **PR 3:** webhook/polling + id externo, após a TCBX.
- Depende da TCBX (Bruno): busca por `telefone`, webhook de mudanças, carga inicial.

**Armadilhas descobertas:**
- **`setState` síncrono dentro de `useEffect` é ERRO de lint** ("cascading renders") neste projeto. O padrão aqui é DERIVAR o estado no render (guardar a leitura com o id a que ela pertence) e deixar o efeito só disparar o fetch.
- **O `api-guards` não segue imports:** um GET de sessão pode chamar função de OUTRO arquivo que faz RPC (leitura do cofre) sem cair na regra "GET não chama RPC". A rota só precisa do guard de sessão e de não ter `.rpc(`/escrita no próprio arquivo.

## [2026-10-05] Integração de clientes externa (TCBX): fundação da consulta sob demanda

**Agente/Modelo:** Claude Opus 4.8.
**Objetivo:** o CRM consultar a base de clientes de uma fonte externa (hoje a API da TCBX, INT-0001) para enriquecer o atendimento — funcionando SEM webhook (consulta na hora), opcional e genérica.
**Arquivos alterados:**
- novos: `src/features/customer-source/{types.ts, get-customer-context.ts, get-customer-context.test.ts}`;
- alterados: `src/features/settings/types.ts` (catálogo do cofre), `src/features/settings/components/environment-variables-manager.tsx` (descrição das chaves novas) e os testes de settings afetados pelo catálogo; docs: este PROGRESS.

**O que foi feito:**
- Duas variáveis no catálogo do cofre: `CUSTOMER_SOURCE_URL` e `CUSTOMER_SOURCE_TOKEN`, gerenciadas pela aba **Variáveis** que já existe (sem UI nova; só as descrições na lista).
- `getCustomerContext({ documento | clienteId | telefone })`: lê a URL + chave do cofre, consulta `GET {base}/clientes/contexto`, valida com zod e devolve um `CustomerContext` NORMALIZADO (identidade + contratos + títulos em aberto). Desfechos: `ok | not_found | not_configured | unavailable`. Nunca lança; falha de leitura nunca vira "cliente não encontrado".
- Independente de webhook: funciona só com a consulta. Sem as duas variáveis → `not_configured`, e o CRM roda igual ao de hoje.

**Decisões tomadas:**
- **Sob demanda, não espelho a base deles** (aprovado pelo dono): guardar só o vínculo e buscar o volátil ao vivo. Webhook/polling e o campo de id externo ficam para PRs seguintes — nada aqui depende deles.
- **Config no cofre, não em tabela nova.** Reusei o mecanismo de Variáveis (Vault) em vez de criar `customer_integrations`: zero migration, UI de configuração de graça.
- **Segurança:** chave só no cofre (nunca em arquivo/log); a URL passa pela guarda SSRF; timeout de 12 s; `redirect: "error"` para não vazar o Bearer num redirect.
- **Tipo normalizado nosso** (não o formato do fornecedor): outra fonte mapeia para o mesmo `CustomerContext`; trocar de fonte é trocar o mapeamento, não quem chama.
- **Genérico e opcional:** o CRM é single-tenant; cada deploy configura a sua fonte (ou nenhuma), e sem fonte a integração fica desligada.

**Verificação:** typecheck ✓ · lint ✓ (0 erros; 9 avisos antigos) · test ✓ (4440 testes, 235 arquivos) · build ✓. 23 casos no teste da consulta (achado, not_found, not_configured, falhas de rede/status/formato, URL interna recusada, chave nunca no log).

**Pendências / próximos passos:**
- **PR 2:** mostrar o contexto no painel do contato do chat + botão "importar como cliente" (decisão do dono: oferecer importar, não criar automático). Aí entram as atualizações de PRD/UI.
- **PR 3 (depende da TCBX):** receptor de webhook (autenticado por token da API do CRM) e/ou polling por listagem, para sincronização; e o campo de id externo em `contacts`/`customers`.
- Pedidos já enviados à TCBX (Bruno): aceitar `telefone` em `/clientes/contexto`; webhook de mudanças (`cliente.*`, `contrato.*`, `financeiro.*`); carga inicial (listagem/replay).
- Hoje a ponte de identificação é documento/CNPJ; telefone só quando a TCBX passar a aceitá-lo.

**Armadilhas descobertas:**
- A guarda SSRF LIBERA `localhost`/`127.0.0.1` fora de produção (para testar contra provedor local), mas bloqueia faixas privadas (`10/8` etc.) em qualquer ambiente — teste de "URL interna" tem que usar `10.0.0.5`, não loopback.
- Adicionar um nome a `RUNTIME_ENVIRONMENT_NAMES` quebra TODOS os testes que fixam o catálogo: o parser (mensagem de erro), o cache (`p_names`), a rota `/api/settings/environment-variables` e o componente da aba Variáveis (chaves selecionáveis + a descrição). Tudo deriva do catálogo, então é só acompanhar os fixtures.

## [2026-10-02] Fase 5, PR 14 (documentos): API e guia do agente reescritos

**Agente/Modelo:** Claude Opus 5.5. O rascunho foi feito por um subagente, a partir do código, e revisado por amostragem.
**Objetivo:** Quem integra o CRM, ou implementa o agente de triagem, lê o que a API faz hoje. Os dois documentos ainda descreviam o CRM da clínica (webhooks do n8n, leads, funil, `/api/integracao/*`), removido na Fase 1.
**Arquivos alterados:** `docs/API.md` e `docs/GUIA-AGENTE-IA.md` (reescritos), `docs/PLANO-FASE-5.md`, `docs/PROXIMOS-PASSOS.md` e este PROGRESS. Nenhum código.

**O que foi feito:**
- **`docs/API.md`:**
  - as três famílias de autenticação;
  - as regras da API v1: escopos e preset, limites, envelope de erro, idempotência, If-Match, cursor, corpo e rotas públicas;
  - o que o contrato garante;
  - a tabela das 31 rotas v1, com o escopo de cada uma;
  - as rotas da tela, por área;
  - o webhook do WhatsApp.
  - **O OpenAPI (`/api/v1/openapi.json`) segue como a referência de cada campo.**
- **`docs/GUIA-AGENTE-IA.md`:**
  - o ciclo do agente: receber o repasse assinado, ignorar o `webhook.ping`, responder só em conversa `bot`, `/context`, abrir e atualizar ticket, escolher o ticket em foco, responder e passar para um humano;
  - as regras que pegam quem começa;
  - boas práticas;
  - os dois avisos antigos que ainda saem por variável de ambiente;
  - o roteiro curl de verificação local, em 8 passos.

**Decisões tomadas:**
- **O contrato é aditivo.** O OpenAPI publica `additionalProperties: false` em todo schema e uuid só em minúsculas. A API aceita maiúsculas e pode ganhar campos, então o guia manda o cliente ignorar o que não conhece e não validar a resposta de forma estrita.
- **O código manda, e não o plano.** Os pontos em que os dois divergiam ficaram como o código faz:
  - `changed: false` só vem sem `ticket_id` e `note_id` no handoff;
  - `customers:write` e `notices:claim` estão no catálogo, mas nenhuma rota os exige;
  - o 415 só existe nas rotas com Idempotency-Key.
- **Ordem do roteiro:**
  - o handoff vem antes do envio recusado (409), o que dispensa uma sessão de analista;
  - resolver leva duas transições, porque a matriz não deixa ir de `novo` a `resolvido`.

**Verificação:**
- Revisão por amostragem contra o código:
  - o limite por IP (1200/min) e o por conversa (100/h);
  - as seis rotas com `Idempotency-Key` obrigatória;
  - o `changed` do handoff;
  - nenhum domínio, IP, e-mail ou segredo nos dois documentos.
- Nenhum teste lê esses arquivos.
- **Não feito:** rodar o roteiro (não há Docker aqui). Pontos que só a execução confirma: a ordem do array `allowed`, a versão do ticket logo depois de criado, e o que o envio chama no WhatsApp de mentira.

**Pendências / próximos passos:**
- **Rodar o roteiro** (`GUIA-AGENTE-IA.md` §6) com Docker e anotar a saída aqui. É o "pronto quando" da Fase 5.
- **`CONTRATO-ASSINATURA-BOT.md` está em parte desatualizado.** Os avisos por variável de ambiente (`TAKEOVER_AGENT_URL`, `BOT_SIGNATURE_AGENT_*`) saem na Fase 6.

**Armadilhas descobertas:**
- **O servidor de WhatsApp de mentira em `127.0.0.1` só funciona com `pnpm dev` no host.** A guarda de URL só aceita loopback em desenvolvimento, e dentro do container `127.0.0.1` é o próprio container.

## [2026-10-02] Fase 5, PR 13d: o catálogo na aba Variáveis

**Agente/Modelo:** Claude Opus 5.5.
**Objetivo:** A aba Variáveis só oferece o que o CRM lê. A chave se escolhe do catálogo, e somem a origem "Servidor" (que não existe desde a Fase 2) e o "Substituir" que levava a uma recusa.
**Arquivos alterados:** `src/features/settings/components/environment-variables-manager.tsx`, `src/features/settings/schemas/environment-variable.ts` (exporta `VAULT_EDITABLE_NAMES`), o teste novo `environment-variables-manager.test.tsx`; docs `UI.md` §5.19, `docs/PLANO-FASE-5.md`, `docs/PROXIMOS-PASSOS.md` e este PROGRESS.

**O que foi feito:**
- **Adicionar variável:**
  - um `FormSelect` só com as chaves do catálogo sem valor. Ficam de fora a chave de assinatura (o CRM gera) e o modelo de transcrição (tem seletor próprio);
  - com uma chave só faltando, ela já vem escolhida, com a frase do que faz;
  - sem chave faltando, o botão desabilita e diz por quê.
- **Saíram a coluna Origem e os rótulos "Servidor" e "Sobrescrever".** O selo do modelo de transcrição diz "Cofre" ou "Padrão".
- **Variável fora do catálogo** (gravada antes dele): "Fora do catálogo: o CRM não lê esta chave.", só com "Remover".
- **Primeiros testes do gerenciador** (7).

**Decisões tomadas:**
- **O tipo `EnvironmentVariableSource` continua com `"environment"`,** e a consulta continua sem produzi-lo. Tirar o membro do tipo é limpeza fora do escopo (AGENTS §3.7), e a tela não depende mais dele.
- **A lista do seletor sai do mesmo catálogo que a rota usa** (`VAULT_EDITABLE_NAMES`, no arquivo do schema): uma chave nova no catálogo aparece na tela sem outra mudança. A frase que descreve a chave fica na tela; chave sem frase mostra a frase genérica.

**Verificação:** `typecheck` ✓ · `lint` ✓ (os 9 avisos antigos) · `test` ✓ (4417 em 234 arquivos) · `build` ✓. Não houve conferência no app contra um banco local, porque não há Docker aqui.

**Pendências / próximos passos:**
- **PR 14:** a documentação da API e o guia do agente, e o roteiro curl que é o "pronto quando" da Fase 5 (pede o stack local).
- **Publicar:** fica com o dono (`PROXIMOS-PASSOS.md` §8).

**Armadilhas descobertas:**
- **Com uma opção só no `FormSelect`, deixar o campo vazio só obriga um clique a mais.** O formulário já abre com a chave escolhida.

## [2026-10-02] Fase 5, PR 13c: editar token na aba API do CRM

**Agente/Modelo:** Claude Opus 5.5.
**Objetivo:** O administrador edita um token de API sem precisar revogá-lo e gerar outro: nome, escopos um a um, quem usa, limite por minuto e validade.
**Arquivos alterados:**
- novos: `src/features/settings/components/api-token-edit-dialog.tsx`, `src/features/settings/lib/api-scope-labels.ts` e os testes deles;
- alterados: `api-tokens-manager.tsx` (botão Editar) e o teste dele, `schemas/api-token-actions.ts` (`apiTokenEditFormSchema`, `isPastExpiry`, `PAST_EXPIRY_MESSAGE`) e o teste dele;
- docs: `UI.md` §5.19, `docs/PLANO-FASE-5.md`, `docs/PROXIMOS-PASSOS.md` (13c, e o §8 sobre publicar) e este PROGRESS.

**O que foi feito:**
- **Editar** em cada token não revogado. O vencido também tem o botão, porque é por ele que se estende a validade.
- **O diálogo** usa react-hook-form com `apiTokenEditFormSchema`, montado a partir das mesmas regras de campo da rota. O limite entra como texto e vira número. A validade entra como data, que vale até 23:59:59 no fuso do app, e o campo vazio quer dizer que o token não vence.
- **O PATCH leva só o que mudou.** Erro de campo do servidor vai para o campo; erro sem campo vira alerta no topo, e o diálogo não fecha.
- **Escopos:**
  - agrupados por recurso, com a ação em português e o código ao lado;
  - "Aplicar IA de triagem" troca escopos, tipo e limite pelos do preset, e "Limpar" desmarca tudo;
  - um `recurso:*` que o token já tenha continua na lista, marcado, e não some ao salvar.
- **A regra "validade no futuro" vale só quando a validade é mexida.** O teste pegou o caso: um token vencido abria com a data antiga e não deixava salvar mais nada. A rota segue aplicando a regra no PATCH (`expiresAtSchema`, agora com `isPastExpiry`).

**Decisões tomadas:**
- **Validade como data, e não data e hora.** "Vale até o fim do dia" é o que se decide ao dar validade a uma credencial, e o UI.md §5.16.1 proíbe `datetime-local`.
- **Um schema de formulário, e não o da rota direto.** A entrada é diferente (texto e data), mas as regras de campo são as mesmas peças. O resultado passa no `updateApiTokenSchema`, e o teste confere isso.
- **Sem mudança na rota nem no banco.** O `PATCH /api/api-tokens/[id]` já aceitava esses campos desde o PR 5.

**Verificação:**
- `typecheck` ✓ · `lint` ✓ (os 9 avisos antigos) · `test` ✓ (4410 em 233 arquivos) · `build` ✓.
- **Mutações conferidas à mão:**
  - tirar a checagem da validade no passado derruba o teste dela;
  - mandar todos os campos no PATCH, em vez de só os que mudaram, derruba 8 testes.
- **Não feito:** a conferência no app contra um banco local (não há Docker aqui), e revisor independente.

**Pendências / próximos passos:**
- **PR 13d:** o catálogo em Variáveis.
- **Publicar em produção:** pedido pelo dono em 2026-10-02 e não feito daqui. A sessão de nuvem não tem chave SSH nem acesso de rede à VPS. O deploy fica para o dono rodar (`deploy/publicar.sh`, mais a reinstalação do vhost do #24); ver `PROXIMOS-PASSOS.md` §8.

**Armadilhas descobertas:**
- **Regra de "data no futuro" no schema do formulário trava a edição de quem já venceu.** O resolver valida o formulário inteiro, mexido ou não. A regra que depende de "o campo mudou" fica no envio (`dirtyFields`), e não no schema.
- **`watch()` do react-hook-form dispara `react-hooks/incompatible-library`.** O projeto usa `useWatch({ control, name })`.
- **Constante usada num schema precisa vir antes dele no arquivo:** o `z` monta o schema na hora de carregar o módulo.

## [2026-10-02] Fase 5, PR 13b: as abas Registros e Saúde de Integrações

**Agente/Modelo:** Claude Opus 5.5.
**Objetivo:** O administrador vê, em Integrações, os registros da API e do repasse ao agente, com filtros, e a saúde das integrações. As rotas do #40 ganham tela.
**Arquivos alterados:**
- novos: `src/features/integrations/components/integration-health-panel.tsx`, `src/features/integrations/lib/log-labels.ts`, e os testes `integration-logs-table.test.tsx`, `integration-health-panel.test.tsx` e `log-labels.test.ts`;
- alterados: `src/features/integrations/components/integration-logs-table.tsx` (refeita; era órfã e filtrava no navegador), `src/features/integrations/lib/log-filters.ts` (exporta `isRequestIdLike`), `src/features/connection/lib/connection-tabs.ts` (duas abas), `src/app/(dashboard)/app/conexao/page.tsx` e o teste dela;
- docs: `UI.md` §5.19, `PRD.md`, `docs/PLANO-FASE-5.md`, `docs/PROXIMOS-PASSOS.md` e este PROGRESS.

**O que foi feito:**
- **Aba Registros** (`?aba=registros`):
  - os filtros ficam na URL e são lidos no servidor por `parseIntegrationLogFilters`: integração, ação, status, token, período e o id do pedido (na busca, com debounce de 300 ms);
  - a 1ª página vem do `getIntegrationLogs` da página, só com a aba aberta;
  - "Carregar mais" pede `GET /api/connection/logs` com o cursor;
  - filtro novo zera o que foi carregado, e a resposta que chega depois da troca é descartada;
  - três estados distintos: falha com "Tentar de novo", vazio sem filtro e vazio com filtro.
- **Aba Saúde** (`?aba=saude`): `IntegrationHealthPanel` pede `GET /api/connection/health` ao montar e no "Atualizar".
  - Cada parte diz o próprio estado em texto colorido, e `unavailable` diz "Não foi possível ler…".
  - A página nunca lê a Saúde.
- **Rótulos** em arquivo neutro (`log-labels.ts`): integração, ação do repasse, período e quem fez. O que a tela não conhece aparece como veio.

**Decisões tomadas:**
- **A Saúde é lida pelo navegador, e não pela página.** O provedor pode levar até 12 s, e a página relê tudo a cada troca de aba. A rota (GET, com a leitura guardada 10 s no servidor) já existia para isso.
- **Os registros são lidos pela página, mas só com a aba aberta.** Assim a 1ª página chega junto com a aba (sem um segundo pedido), e as outras abas não pagam por ela.
- **A ação muda com a integração escolhida:** trocar de integração limpa a ação que não existe na outra, e o filtro de token some com o Agente de IA, que não tem token.
- **Sem total na contagem:** a lista não usa `count` (decisão do 12b), então a tela diz "N registros, e há mais".
- **Número da instância numa linha à parte** na Saúde ("Número: (27) 99999-0000."), em vez de entre parênteses na frase do estado.

**Verificação:**
- `typecheck` ✓ · `lint` ✓ (os 9 avisos antigos) · `test` ✓ (4386 em 231 arquivos) · `build` ✓.
- **Mutações conferidas à mão:**
  - tirar a guarda da resposta atrasada do "Carregar mais" derruba o teste dela;
  - fazer a página ler os registros em qualquer aba derruba o teste da página.
- **Não feito:** o roteiro por HTTP contra o stack local (`PROXIMOS-PASSOS.md` §4), porque não há Docker neste ambiente. Também não houve revisor independente.
- `bug-hunter` e `verification-before-completion` não estão instaladas neste ambiente.

**Pendências / próximos passos:**
- **PR 13c:** edição de token na API do CRM, e o catálogo em Variáveis.
- **Conferência por HTTP** antes de publicar, com os registros e a Saúde na tela.
- **"Filtrar por este pedido" a partir da linha:** não entrou. Hoje o id se copia da tabela.

**Armadilhas descobertas:**
- **`react-hooks/set-state-in-effect` acusa função chamada no efeito que faz `setState` antes do primeiro `await`.** Leitura na montagem: a função devolve o resultado, e o `setState` fica no `.then` (`IntegrationHealthPanel`).
- **A tabela e a lista do celular estão as duas no DOM do jsdom** (o CSS não esconde nada). Nos testes, procurar dentro de `getByRole("table")`.
- **`formatPhone` não põe o `+55`:** devolve `(27) 99999-0000`.

## [2026-10-02] Fase 5, PR 13a: Integrações em /app/conexao, com a aba na URL

**Agente/Modelo:** Claude Opus 5.5.
**Objetivo:** Tudo que liga o CRM a outro sistema fica num lugar só, `/app/conexao` (Integrações), com a aba na URL. `/app/configuracoes` deixa de ser tela e só redireciona, e o Atendimento continua onde estava.
**Arquivos alterados:**
- novos: `src/components/layout/url-tabs.tsx` (o componente), `src/components/layout/url-tab-state.ts` (as funções puras, sem "use client") e o teste `url-tabs.test.tsx`; `src/features/connection/lib/connection-tabs.ts` (a lista das abas);
- alterados: `src/app/(dashboard)/app/conexao/page.tsx` (as quatro abas), `src/app/(dashboard)/app/configuracoes/page.tsx` (só o redirect), `src/features/tickets/components/service-settings-tabs.tsx` (passa a usar o `UrlTabs`), `src/config/navigation.ts`, o `revalidatePath` de `api/api-tokens`, `api/api-tokens/[id]`, `api/settings/environment-variables` e `api/connection/agent/signing-secret`;
- testes: o da página antiga foi movido para `conexao/page.test.tsx` (com as abas novas), `configuracoes/page.test.tsx` passou a testar o redirect, mais `navigation.test.ts` e os dois testes de rota que conferem o `revalidatePath`;
- docs: `PRD.md`, `UI.md` §5.19, `AGENTS.md` §4.1, `README.md`, `SETUP.md`, a skill `uazapi-integration`, `docs/CONTRATO-RELAY.md`, `docs/CONTRATO-ASSINATURA-BOT.md`, `docs/GUIA-AGENTE-IA.md`, `docs/API.md` (só o caminho das telas), `docs/PLANO-FASE-5.md` e este PROGRESS.

**O que foi feito:**
- **`UrlTabs`, o terceiro uso das abas de ajustes,** virou componente de layout. As abas recebem a lista e os painéis, e a primeira é a padrão, fora da URL. A troca é otimista, `router.replace` acontece sem rolar a página, e o `keepMounted` é escolhido por aba. Ele saiu do `ServiceSettingsTabs`, que hoje só o usa: as funções e os testes do Atendimento seguem como estavam, e passam sem mudança.
- **`/app/conexao` (Integrações):** quatro abas.
  - **WhatsApp:** o `ConnectionPanel`, intacto. É a aba padrão.
  - **API do CRM** (`?aba=api`), **Agente de IA** (`?aba=agente`, com `keepMounted`) e **Variáveis** (`?aba=variaveis`): os mesmos blocos e as mesmas leituras que estavam em Configurações.
- **`/app/configuracoes`:** `redirect` (307) para `/app/conexao?aba=variaveis`, a aba que a tela antiga abria por padrão. Não lê nada, porque quem confere o administrador é a página de destino.
- **Menu:** o item Configurações saiu, e "Conexão" virou **Integrações** (o endereço é o mesmo). O menu Ajustes fica com Integrações, Equipe e Atendimento.
- **`revalidatePath`:** as rotas de token, de variável e da chave de assinatura passam a revalidar `/app/conexao`.

**Decisões tomadas:**
- **O dono delegou a escolha** ("o mais profissional, sem débito técnico"). Ficou um endereço por assunto, sem cópia. Duas telas com os mesmos blocos durante uma transição viram duas fontes de verdade, e o `revalidatePath` precisaria apontar para as duas.
- **O endereço continua `/app/conexao`, e só o nome mudou.** Mudar a URL quebraria link, guard e rota (`/api/connection/*`) sem ganho para quem usa. "Conexão" não descrevia mais uma tela com API, agente e variáveis.
- **`redirect`, e não `permanentRedirect`:** o 308 fica guardado no navegador para sempre, e o endereço não poderia voltar a ter página.
- **`/app/configuracoes` continua em `ADMIN_PAGE_PREFIXES`:** cobre o Atendimento e o próprio redirect, e o membro volta para `/app` já no proxy.
- **A aba de variáveis se chama "Variáveis", e não "Cofre"** como no plano: é o título do próprio bloco ("Variáveis do CRM"), e "Cofre" já aparece na tela como a origem do valor.
- **A lista das abas fica num arquivo neutro** (`connection-tabs.ts`, sem "use client"): a página de servidor a entrega ao `UrlTabs` e o redirect a usa para montar o link. O PR 13b pode usá-la no servidor para ler os registros só com a aba Registros aberta.
- **O PR 13 foi dividido em três** (ver o plano): 13a, a estrutura; 13b, Registros e Saúde, sobre as rotas do PR 12b (#40, já na `main`); 13c, a edição de token e o catálogo em Variáveis.

**Verificação:**
- `typecheck` ✓ · `lint` ✓ (os 9 avisos antigos) · `test` ✓ (4341 em 228 arquivos, sobre a `main` com o #40) · `build` ✓ (`/app/conexao`, `/app/configuracoes` e `/app/configuracoes/atendimento` no build).
- O que os testes conferem:
  - os testes do Atendimento passam sem mudança sobre o `UrlTabs`;
  - o teste novo do `UrlTabs` confere a ordem das abas, a aba lida da URL, o `keepMounted` (o painel fica no DOM escondido, e o outro desmonta) e o `replace` sem rolagem;
  - o teste da página confere a ordem das abas, as leituras, o guard antes delas e que os blocos não vazam entre abas.
- Não rodei o app contra um banco local nesta sessão. O redirect e as abas foram conferidos pelos testes e pelo build.
- `bug-hunter` e `verification-before-completion` não estão instaladas neste ambiente. No lugar: a releitura do diff e os quatro comandos acima.

**Pendências / próximos passos:**
- **PR 13b:** as abas Registros e Saúde, sobre `GET /api/connection/logs` e `GET /api/connection/health`. O que os PRs anteriores deixaram para ela está no `docs/PROXIMOS-PASSOS.md` §5.1.
- **PR 13c:** a edição de token, o `FormSelect` do catálogo em Variáveis e a limpeza de Origem e de "Substituir".
- **Cada troca de aba relê a página no servidor** (as seis leituras), como já acontece no Atendimento. São leituras do banco, baratas. A Saúde, que chama a uazapi, não entra nessa leitura: a aba dela pede `GET /api/connection/health` no navegador, só quando aberta (13b).

**Armadilhas descobertas:**
- **Página de servidor não lê constante de arquivo "use client":** o que ela importa de lá é uma referência de cliente, e não o valor. Lista de abas, href e parse ficam em arquivo neutro (`url-tab-state.ts`, `connection-tabs.ts`).
- **O `TabsContent` com `keepMounted` deixa o painel no DOM, escondido.** No teste, o painel aparece com `not.toBeVisible()`, e não com `not.toBeInTheDocument()`.

## [2026-10-02] Fase 5, PR 12b: registros de integração e Saúde (back), terminado

**Agente/Modelo:** Claude Opus 5.5.
**Objetivo:** Terminar o PR 12b que ficou pela metade na branch `feat/conexao-registros-e-saude`: as rotas de leitura dos registros de integração e da Saúde, para as abas do PR 13.
**Arquivos alterados:**
- código, vindo da branch `wip` sem mudança: `src/app/api/connection/{logs,health}/route.ts`, `src/features/integrations/{types.ts,lib/log-filters.ts}`, `src/features/integrations/queries/get-integration-{logs,health}.ts`, `src/lib/api/v1/cursor.ts` (`encodeLogCursor`/`decodeLogCursor`), `src/lib/http/search-params.ts`, e os testes de cada um;
- testes reescritos: `get-integration-health.test.ts` e `api/connection/logs/route.test.ts`; um import sem uso a menos em `get-integration-logs.test.ts`;
- docs: `docs/API.md` (as duas rotas), `PRD.md` §7.1, a skill `uazapi-integration`, `AGENTS.md` §4.1, `docs/PLANO-FASE-5.md`, `docs/PROXIMOS-PASSOS.md` e este PROGRESS.

**O que foi feito:**
- **O código da `wip` entrou como estava,** com as decisões que o `docs/PROXIMOS-PASSOS.md` §4.1 registra (falha não vira vazio, cursor sem `count`, filtros com os nomes da URL, `payload` só como `actor`, repasse contado pela ação, Saúde guardada 10 s).
- **`get-integration-health.test.ts` reescrito para o código atual** (47 testes):
  - a lógica é testada por `readIntegrationHealth`. `getIntegrationHealth` guarda o resultado no módulo, e por isso ganhou bloco próprio: uma leitura só em 10 s, leitura nova depois disso, pedidos simultâneos na mesma leitura, e relógio que volta atrás lê de novo;
  - WhatsApp com `cause` (`crm`/`provider`) e `instance`;
  - repasse com `reason`, e sem banco `config` é `unreadable`;
  - as datas do último repasse também têm a janela;
  - o log da falha leva código e mensagem;
  - cada contagem que falha deixa só a parte dela `unavailable`;
  - a última mensagem recebida em um passo só: nenhuma conversa; menos de 50 (exato, sem data mínima); 50 com mensagem achada a partir da atividade da 50ª (exato); 50 sem nada a partir dela (segunda consulta, `exact: false`); e falha em cada uma das três leituras.
- **`logs/route.test.ts`:** as chaves dos filtros são os nomes da URL, `getIntegrationLogs(filters, cursor)` recebe o cursor à parte, a resposta devolve `filters`, filtro desconhecido é ignorado e aparece assim na resposta, vale a 1ª ocorrência do parâmetro, cursor vazio ou só espaço é "sem cursor", e cursor inválido é 400.

**Decisões tomadas:**
- **Esta versão substitui a que eu tinha aberto no mesmo PR #40.** Eu tinha feito outra implementação do 12b sem saber da `wip`: só consultas, sem rotas, sem paginação, lista que falha virando "vazia marcada". Quando o #39 entrou com o `docs/PROXIMOS-PASSOS.md`, as decisões dele passaram a valer (`AGENTS.md` §1: o que está documentado vale mais que a opinião do agente). A branch do #40 foi refeita a partir da `main` com o código da `wip`. A versão anterior não chegou à `main`.

**Verificação:**
- `typecheck` ✓ · `lint` ✓ (os 9 avisos antigos) · `test` ✓ (4334 em 226 arquivos) · `build` ✓ (`/api/connection/logs` e `/api/connection/health` no build).
- **Não feito:** a conferência por HTTP contra o stack local (`PROXIMOS-PASSOS.md` §4). O ambiente não tinha Docker. Também não houve rodada de mutação nem revisor independente.
- `bug-hunter` e `verification-before-completion` não estão instaladas neste ambiente.

**Pendências / próximos passos:**
- Conferência por HTTP antes de publicar (a lista está em `PROXIMOS-PASSOS.md` §4).
- Apagar a branch `feat/conexao-registros-e-saude` depois do merge.
- PR 13: as abas. O 13a (estrutura, aba na URL, `/app/configuracoes` só com o Atendimento) já está pronto localmente e vem em seguida.

**Armadilhas descobertas:**
- **Duas sessões, duas implementações do mesmo PR.** Antes de começar um PR do plano, olhar `docs/PROXIMOS-PASSOS.md` §2 e as branches do remoto (`git branch -r`): o trabalho em curso pode estar numa branch sem PR.
- **Estado guardado no módulo atravessa os testes.** O cache de `getIntegrationHealth` faz o 2º teste receber a leitura do 1º. Teste de lógica chama a função sem cache, e o do cache usa instantes distantes entre si.

## [2026-10-02] Documento de continuidade: onde o projeto está e o que falta

**Agente/Modelo:** Claude Opus 5.5.
**Objetivo:** Um documento no repositório com o estado do projeto e tudo o que falta, na ordem do plano, para quem continuar sem ter acompanhado as conversas anteriores. E o PR 12b, que só existia numa máquina, guardado no GitHub.
**Arquivos alterados:** novo `docs/PROXIMOS-PASSOS.md`; ponteiros em `AGENTS.md` (cabeçalho, §2, §8 e §9), `CLAUDE.md` e `docs/PLANO-FASE-5.md`; este PROGRESS. Nenhum código.

**O que foi feito:**
- **`docs/PROXIMOS-PASSOS.md`:**
  - o estado atual e o que já foi feito, por fase e por PR;
  - o passo a passo para terminar o PR 12b, com as decisões já tomadas;
  - a ordem do que vem depois: PR 13, PR 14, PR 11b, o Quadro e as Fases 6 a 10;
  - as correções e propostas fora do plano, e as decisões que esperam o dono;
  - as regras de deploy e o ciclo de trabalho de cada PR.
- **O documento virou leitura obrigatória** (`AGENTS.md` §2) **e atualização obrigatória** quando a task muda o que falta (§8 e §9).
- **PR 12b guardado:** a branch `feat/conexao-registros-e-saude` foi enviada com um commit `wip`. Não tem PR e não está pronta: 41 testes falham.
- O dono mergeou os PRs #27 a #38 em 2026-10-02. Nenhum PR de código ficou aberto.

**Decisões tomadas:**
- **Um arquivo novo, e não mais uma seção nos planos.** Os planos dizem o que fazer e por quê, e o PROGRESS diz o que foi feito. Faltava um lugar só para "onde paramos e o que vem agora".
- **O `AGENTS.md` mudou:** manter o documento passou a fazer parte de "concluído". Sem isso ele envelhece no PR seguinte.
- **O `wip` foi para uma branch, sem PR.** Código que falha não vai para a `main`, e trabalho sem commit não existe para quem chega depois.
- **O documento aponta, em vez de repetir.** O detalhe de cada item segue no plano, no PROGRESS e na descrição do PR.
- **Repositório público:** sem endereço de servidor, sem segredo e sem detalhe de falha ainda não corrigida.

**Verificação:** typecheck ✓ · lint ✓ (os 9 avisos antigos) · test ✓ (4198 em 220 arquivos) · build ✓. Não há mudança de código. Os números e os caminhos de arquivo citados no documento foram conferidos contra a `main`.

**Pendências / próximos passos:** as do `docs/PROXIMOS-PASSOS.md`. A primeira é terminar o PR 12b.

**Armadilhas descobertas:**
- **Em zsh, uma variável chamada `path` é o `PATH`.** Um `while read -r st path` deixa todo comando seguinte do laço "não encontrado", e a checagem falha calada: uma comparação de arquivos respondeu "não existe na main" para todos, inclusive para o `PROGRESS.md`. Outro nome de variável, ou Python.
- **Resultado bom demais ou ruim demais numa checagem é sinal para conferir a checagem,** antes de relatar.
- **`.next/dev/types` sobrevive à troca de branch.** Depois de rodar o `next dev` numa branch com rotas novas e voltar para a `main`, o `typecheck` falha com TS2307 em `.next/dev/types/validator.ts` (rota que não existe mais). O `next build` só refaz `.next/types`. É arquivo gerado: apagar `.next/dev/types`. No CI não acontece.

## [2026-10-01] O pedido do QR deixa de ser GET

**Agente/Modelo:** Claude Opus 5.5.
**Objetivo:** Pedir o QR age no provedor do WhatsApp, e por isso passa a ser POST: assim a trava de origem do proxy o cobre, e nenhum link de fora o dispara.
**Arquivos alterados:** `src/app/api/connection/qr/route.ts` (o handler virou `POST`), `src/features/connection/components/connection-panel.tsx` (a chamada), os testes novos `src/app/api/connection/qr/route.test.ts` e `src/features/connection/components/connection-panel.test.tsx`, o teste estrutural no fim de `src/app/api/api-guards.test.ts`, e os docs `docs/API.md`, `AGENTS.md` §3.2, `docs/PLANO-FASE-5.md`, a skill `uazapi-integration` e este PROGRESS.

**O que foi feito:**
- **`POST /api/connection/qr`** no lugar de `GET`. O corpo do handler não mudou: confere o administrador, lê a integração e chama `connectUazapi`. Por GET e por HEAD a rota responde 405.
- **A tela** pede o QR com `fetch("/api/connection/qr", { method: "POST" })`. No painel mudou só isso e o tratamento do pedido sem resposta (abaixo).
- **Teste estrutural** ("leitura não muda estado", em `api-guards.test.ts`): nenhum GET de rota de sessão grava em tabela (`.insert(`, `.update(`, `.upsert(`, `.delete(`), chama RPC nem age na uazapi (`connect`, `disconnect`, `register`, `send`, `edit`, `delete`), no handler ou em função local do arquivo. Há uma lista de exceções com o porquê de cada uma, e o teste falha também se uma exceção deixar de ser necessária.
- **Regra nova no mesmo arquivo:** rota de sessão exporta handler como `export function`. Os dois contratos de `api-guards.test.ts` só leem essa forma; `export const GET = POST` escaparia deles.
- **Primeiros testes do painel de Conexão**, só sobre o pedido do QR: é POST; a tela não o faz sozinha com a instância desconectada nem conectada; renova quando o QR vence; para quando vê a instância conectada; e salvar as credenciais não manda dois pedidos ao mesmo tempo.
- **Pedido de QR sem resposta legível** (rede, ou o 405 de uma aba aberta antes do deploy): o painel tira da tela também o código de pareamento antigo, e não só o QR.

**Decisões tomadas:**
- **Por que POST:** a trava de origem (`isCrossOriginWrite`) só cobre escrita. Um GET, qualquer site faz o navegador de um administrador logado abrir, e o cookie `SameSite=Lax` acompanha a navegação. Cada pedido de QR chama `/instance/connect`, que reinicia o pareamento.
- **As outras leituras com efeito ficam como estão,** na lista de exceções do teste: `GET /api/connection/state` grava o telefone do dono quando o provedor diz que conectou, e `GET /api/chat/conversations/[id]` zera as não lidas da conversa aberta. Em nenhum dos dois o valor gravado é escolhido por quem pede: um contador zerado, e o telefone que o provedor informa. `GET /api/auth/logout` apaga o cookie de propósito: é o destino do `redirect` do layout quando o usuário do cookie já não vale, e por isso precisa ser GET.
- **Sem mexer no fluxo de conexão.** Só o método mudou. Quando o painel pede QR segue igual, agora com teste. O que a revisão achou de errado nesse "quando" é antigo e vai em PR próprio (ver Pendências).
- **O teste estrutural é uma rede, e não uma prova.** Ele não segue import: um GET que grave por uma função de outro arquivo passa. E `.rpc(` conta como gravação mesmo podendo ser leitura, porque daqui não dá para saber: o GET que precisar de uma RPC de leitura entra na lista de exceções, com o porquê.

**Verificação:**
- `typecheck` ✓ · `lint` ✓ (os 9 avisos antigos) · `test` ✓ (4198 em 220 arquivos; eram 4173 em 218) · `build` ✓.
- **Mutação:** 39 alterações propositais, na rota, na chamada da tela e em outras rotas de sessão (um GET passando a gravar, a chamar RPC, a enviar pelo WhatsApp, um handler exportado por `const`). Todas derrubam algum teste. Na primeira rodada sobreviveram 3, todas sobre QUANDO a tela pede QR; cada uma virou teste.
- **Revisão:** um revisor independente, numa cópia privada. Confirmou que nada mais pede o QR por GET (código, service worker, docs, scripts) e que, pela configuração do nginx, o POST da própria tela passa na trava em produção. O que mudou por causa dele: `.rpc(` e handler por `const` entraram na rede; função local deixou de casar por sufixo do nome (`log(` em `console.log(`); três títulos de teste diziam mais do que o teste prova; o código de pareamento antigo ficava na tela depois de uma falha.
- **Por HTTP, contra o stack local** (a integração local aponta para `https://demo.invalid`, e o roteiro confere isso antes): 13 verificações no servidor de desenvolvimento e 14 no build de produção. GET e HEAD em `/api/connection/qr` dão 405 mesmo com sessão de administrador; POST da própria tela chega à rota; POST de outro subdomínio, de outro site e com `Origin` de outro host dá 403; sem sessão, 401. Os roteiros da trava de origem seguem passando (45 no build de produção).
- `bug-hunter` e `verification-before-completion` não estão instaladas neste ambiente. No lugar: a revisão adversarial e os quatro comandos acima.

**Pendências / próximos passos:**
- **O painel pede QR quando não deveria (antigo, achado na revisão; próximo PR):**
  - "Atualizar" e "Tentar de novo" pedem QR em qualquer estado, inclusive com a instância conectada (`onManualRefresh` não olha estado nem fluxo);
  - o fluxo fica em `"qr"` depois de parear: se a aba continua aberta e o estado deixa de ser `open` (ou a leitura do estado falha), a tela volta a pedir QR sozinha, a cada 25 s. O intervalo do QR também não pausa com a aba oculta, e a leitura do estado pausa;
  - salvar as credenciais tem dois gatilhos de QR, fundidos só enquanto o primeiro está em curso; e os 25 s contam da montagem, e não do último QR.
  - Ideia de correção: a rota não chamar o provedor quando ele diz que a instância está conectada; "Atualizar" pedir QR só no fluxo de QR; o fluxo voltar a `"auto"` ao conectar. Mexe no fluxo de conexão: PR próprio, para o dono decidir.
- **Pedido de QR recusado ou com erro é mudo (antigo):** `loadQr` não olha `res.ok` nem `ok`/`message`, e a tela fica em "Gerando QR Code…" sem dizer por quê.
- **Não medido:** o que a uazapi faz num `/instance/connect` com a instância já conectada. O OpenAPI só diz 409 para "fluxo de conexão em andamento". Medir com instância de teste, nunca com a de produção.
- **Abrir a conversa zera as não lidas por GET.** O `PATCH { action: "mark-read" }` da mesma rota já existe; trocar a chamada tira essa exceção da lista.
- **No deploy:** uma aba da tela de Conexão aberta antes dele segue pedindo por GET, leva 405 e fica em "Gerando QR Code…" até ser recarregada.

**Armadilhas descobertas:**
- **Dentro de um `act` só, o React não aplica estado entre um temporizador e outro.** Avançar 60 s de relógio de mentira de uma vez deixa as refs (`stateRef`) com o valor antigo durante todo o intervalo, e o painel parece pedir QR depois de conectado. Avançar em passos (1 s por `act`) reproduz o que o navegador faz.
- **`userEvent` trava com o relógio de mentira do vitest** (o clique espera um temporizador que não anda). No teste com relógio controlado, o clique é `fireEvent.click`.
- **O 405 do Next não traz o cabeçalho `Allow`.**
- **O painel de Conexão usa o `Dialog`,** que lê `window.matchMedia`: o teste precisa do mesmo stub dos outros testes de diálogo.

## [2026-10-01] Escrita só é aceita da própria origem

**Agente/Modelo:** Claude Opus 5.5.
**Objetivo:** Um pedido de escrita só é atendido quando parte do próprio CRM; o que vem de outra origem é recusado antes de chegar à rota.
**Arquivos alterados:** `src/lib/auth/route-guard.ts` (função `isCrossOriginWrite`), `src/proxy.ts` (chama a regra antes de tudo), os testes `src/lib/auth/route-guard.test.ts` e `src/proxy.test.ts` (novo), e os docs `AGENTS.md` §3.2, `PRD.md` §9, `docs/PLANO-FASE-5.md` e este PROGRESS.

**O que foi feito:**
- **A regra** (`isCrossOriginWrite`, pura, no guard) vale para todo método que não é GET, HEAD ou OPTIONS:
  - com `Sec-Fetch-Site` (o navegador diz de onde o pedido partiu, e uma página não o forja), só passam `same-origin` (a própria tela) e `none` (ação direta do usuário);
  - sem ele (navegador antigo, ou HTTP fora de localhost), vale o `Origin`, que tem de ser do próprio host. O próprio host é o `Host` do pedido ou o de `APP_PUBLIC_URL`;
  - sem nenhum dos dois não é navegador (curl, outro servidor), e o pedido segue para a checagem de sessão de sempre.
- **O proxy** confere a regra antes de qualquer outra coisa e responde 403 `{ ok: false, error: "cross_origin", message }`. A rota não chega a rodar.
- **Isentas:** `/api/chat/webhook/*` e `/api/v1/*`. São chamadas por servidores, com credencial própria, e não leem o cookie. `/api/auth/*` **não** é isenta: login, logout e definir senha são da tela.
- **Dois testes de alcance** em `src/proxy.test.ts`: o proxy roda em `/api/:path*`, e não há route handler fora de `src/app/api`. A trava só age onde o proxy roda; os dois seguram a premissa.

**Decisões tomadas:**
- **Por que era preciso:** o cookie é `SameSite=Lax`. Isso barra o POST vindo de outro SITE, mas não o de outra origem do MESMO site (um subdomínio vizinho, outra porta em localhost), e as rotas leem JSON mandado como `text/plain`, que o navegador envia sem preflight. Saiu da revisão do PR 12a.
- **No proxy, e não em cada rota.** Os guards (`requireDashboardUser` e afins) não recebem o pedido nem o método, e são chamados também em leitura. Um ponto só, antes de tudo, cobre todas as rotas de escrita de uma vez. O custo: a trava depende de o proxy rodar. Os dois testes de alcance e o roteiro por HTTP no build de produção seguram isso.
- **A regra não olha se o caminho é de `/api`.** O proxy lê o caminho como veio (`/%61pi/...` não começa com `/api/`), e o roteador poderia ler de outro jeito. Página não recebe escrita, então recusar em qualquer caminho não custa nada e tira a dependência.
- **Isenção estreita:** o prefixo escrito assim mesmo, e nenhum `%` no caminho. `..` chega resolvido pelo parser; codificado (`/api/v1/..%2f...`) ele começaria com o prefixo isento. Nenhuma rota do webhook ou da v1 precisa de `%` no caminho, e quem chama de servidor não manda `Origin`.
- **`Sec-Fetch-Site` primeiro, `Origin` como reserva.** É a ordem que não quebra pedido legítimo: atrás de um proxy que troque o `Host`, o navegador novo continua dizendo `same-origin`. Só o navegador antigo depende de o host bater, e para ele vale também `APP_PUBLIC_URL`.
- **A regra não "conserta" o que recebe.** Método ou `Sec-Fetch-Site` em outra caixa, ou com espaço, não é o que um navegador manda: cai do lado da recusa. Só o host próprio é comparado sem diferenciar caixa, porque nome de host não a diferencia.
- **Leitura (GET) fica de fora.** Link, imagem e navegação vindos de outro lugar são legítimos. Por isso rota que muda estado não pode ser GET.
- **Só o host é comparado na reserva por `Origin`.** http contra https no mesmo host fica com o HSTS (`next.config.ts`).
- **Sem registro em log da recusa.** Qualquer um manda um POST com o cabeçalho e encheria o log. O motivo vai no corpo (`error: "cross_origin"`), que é o que a aba de rede mostra.

**Verificação:**
- `typecheck` ✓ · `lint` ✓ (os 9 avisos antigos) · `test` ✓ (4173 em 218 arquivos; eram 4088 em 217) · `build` ✓.
- **Mutação:** 100 alterações propositais em `route-guard.ts` e `proxy.ts`, e todas derrubam algum teste. Não foi assim de primeira: 2 sobreviveram à primeira rodada, e a revisão mostrou outras 3 que a lista não tinha (o `Host` trocado pelo host da URL, 401 para toda `/api` sem sessão, e subdomínio do próprio host aceito). Cada uma virou teste. Duas saíram da lista por serem equivalentes, com o motivo anotado no roteiro.
- **Revisão:** dois revisores independentes, cada um numa cópia privada (segurança; regressão e testes). Nenhum contorno da regra, e nenhum uso legítimo quebrado: as 69 escritas do front usam URL relativa, o service worker não toca em `/api` nem em pedido que não é GET, e o nginx de produção repassa o `Host`. O que mudou por causa deles:
  - a regra deixou de olhar se o caminho é de `/api`, e a isenção passou a recusar caminho com `%`: o proxy roda para `/%61pi/...`, mas vê um caminho que não começa com `/api/`;
  - origem sem host é recusada mesmo com host próprio vazio (`APP_PUBLIC_URL` sem esquema vira host `""`);
  - os testes do proxy passaram a montar o pedido na forma real (a URL com o endereço em que o servidor escuta, o host público só no `Host`), e o das rotas isentas passou a rodar sem sessão. Do jeito anterior, trocar o `Host` pelo host da URL, ou responder 401 a toda `/api` sem sessão, passava nos testes;
  - faltava o caso "subdomínio do próprio host", que é a topologia de produção;
  - o comentário do proxy dizia "rota nenhuma", e GET fica de fora.
- **Por HTTP, contra o stack local:** 42 verificações no servidor de desenvolvimento e 45 no build de produção (standalone). Com o cookie de um administrador: escrita vinda de outro subdomínio, de outro site, de outra porta e com `Origin: null` leva 403; a própria tela, o curl e o `Origin` do próprio app passam; o webhook e a v1 respondem pelas regras deles; e 21 formas de caminho (`//`, `..`, `%2e%2e`, `%2f`, `/%61pi/`, maiúsculas, `\`, `;`) não chegam a rota nenhuma. O roteiro não grava nada: confere por hash que a senha local não mudou, e que não há usuário nem registro a mais.
- `bug-hunter` e `verification-before-completion` não estão instaladas neste ambiente. No lugar: a revisão adversarial e os quatro comandos acima.

**Pendências / próximos passos:**
- **Escrita por GET:** a trava não cobre GET, nem HEAD (o Next responde HEAD chamando o handler de GET). Revisar as rotas de GET que têm efeito, num PR próprio.
- **Segunda camada:** a trava mora só no proxy. Repeti-la nas rotas pede o método, que os guards não recebem. Proposta, sem data.
- **Oito pontos da tela mostram o código `cross_origin` no lugar da frase:** os do chat e da conexão leem `error`, e não `message`. O 401 do proxy já tinha o mesmo efeito. Só aparece se a trava disparar num uso legítimo.
- **Atrás de túnel ou de proxy que troque o `Host`,** `APP_PUBLIC_URL` tem de ser o endereço que o navegador usa. Só importa para navegador sem `Sec-Fetch-Site`.

**Armadilhas descobertas:**
- **`SameSite=Lax` não separa subdomínios.** "Site" é o domínio registrável: `a.exemplo.com.br` e `b.exemplo.com.br` são o mesmo site, e `localhost:3000` e `localhost:3001` também. Cookie não tem porta.
- **`text/plain` é um tipo "simples":** o navegador o manda para outra origem sem preflight, e `readJsonBody` faz o parse do texto.
- **`request.nextUrl.pathname` não decodifica `%XX`,** e o `matcher` do proxy casa também a forma decodificada: o proxy RODA para `/%61pi/...`, mas vê um caminho que não começa com `/api/`. Regra de segurança por prefixo de caminho, no proxy, tem de falhar para o lado fechado.
- **A URL que o proxy recebe leva o endereço em que o servidor escuta** (`localhost:3000`), e não o host público, que só vem no cabeçalho `Host`. Teste de proxy que monta a URL com o host público não vê a diferença entre `request.nextUrl.host` e `request.headers.get("host")`.
- **Mock de sessão que devolve um usuário para qualquer token** faz o teste de "rota aberta sem sessão" passar com sessão. Em teste de rota pública, a sessão é `null`.
- **`new URL("localhost:3200")` é válida:** esquema `localhost:`, host vazio. Variável de URL sem esquema não lança; devolve host `""`.
- **O Next responde HEAD chamando o handler de GET.** GET com efeito é efeito também por HEAD.
- **Rota de sessão nova:** mora em `src/app/api/`, e escrita nunca é GET. Prefixo novo em `ORIGIN_EXEMPT_API_PREFIXES` só para rota que NÃO lê o cookie.
- **Chamar rota de sessão por script:** sem `Origin` e sem `Sec-Fetch-Site`, passa como antes. Quem mandar um `Origin` de outro host leva 403.
- **O `Sec-Fetch-Site` só existe em contexto seguro** (HTTPS ou localhost). Pelo IP da rede local em HTTP, o Chrome não o manda, e a regra cai no `Origin`.
- **O parser de URL já devolve o host em minúsculas** e sem a porta padrão, e o `Headers` já entrega o valor sem espaço em volta. Normalizar de novo é código que nenhum pedido alcança.
- **Pipeline engole o código de saída:** `pnpm typecheck | tail -1 && ...` segue mesmo com erro, porque o status é o do `tail`. Para encadear verificação, rodar sem pipe e ler `$?`.

## [2026-10-01] Fase 5, PR 12a: chave de assinatura gerada pelo CRM e teste de conexão do agente

**Agente/Modelo:** Claude Opus 5.5.
**Objetivo:** O administrador gera a chave de assinatura do relay pela tela (mostrada uma vez), troca, remove, e testa a conexão com o agente; o Cofre só guarda o que o app lê.
**Arquivos alterados:**
- novos: `src/features/integrations/server/relay-ping.ts`, `src/app/api/connection/agent/signing-secret/route.ts`, `src/app/api/connection/agent/test/route.ts`, `src/features/settings/queries/get-relay-signing.ts`, `src/features/settings/components/relay-signing-settings.tsx`, cada um com o seu teste; e os testes `get-environment-variables.test.ts` e `configuracoes/page.test.tsx` (a lista do Cofre e a página não tinham teste), `relay-signing-settings.mobile.test.tsx` e `components/ui/dialog.drawer.test.tsx` (a gaveta do celular);
- alterados: `src/components/ui/dialog.tsx` (prop `dismissible`), `relay-message.ts` (o envio virou `postRelayEvent`), `relay-envelope.ts` (chaves reservadas), `settings/types.ts`, `get-runtime-environment.ts`, `schemas/environment-variable.ts`, `queries/get-environment-variables.ts`, `api/settings/environment-variables/route.ts`, `automation-settings.tsx`, `environment-variables-manager.tsx` (textos), `configuracoes/page.tsx`, e os testes deles;
- docs: `docs/CONTRATO-RELAY.md` (e o teste que o confere), `PRD.md`, `UI.md` §5.10 e §5.19, `docs/PLANO-FASE-5.md`, a skill `uazapi-integration` e este PROGRESS.

**O que foi feito:**
- **Chave de assinatura** (`/api/connection/agent/signing-secret`, só admin):
  - `POST` gera 32 bytes aleatórios em hex, grava no Cofre (`set_app_environment_variable`) e devolve o valor uma vez, com `Cache-Control: no-store`. O corpo é um objeto estrito: a chave nunca vem de fora;
  - gerar com a chave já existente é 409 (o `23505` da RPC);
  - trocar (`replace: true`) e remover levam `expectedUpdatedAt`, o `updated_at` da chave que a tela mostrava, e a rota recusa (409) se a guardada já não é essa;
  - depois de gravar, a rota relê a chave e só a devolve se for a guardada;
  - erro do cofre ao gravar ou ao remover não é tratado como "não aconteceu": a rota confere o que ficou guardado, e marca com `applied: false` o erro em que nada mudou;
  - quem gerou, trocou ou removeu fica em `integration_logs` (`signing_secret.generated|rotated|removed`, com `payload.by`).
- **Teste de conexão** (`POST /api/connection/agent/test`, só admin): `pingAgent` manda um `webhook.ping` à URL salva pelo `postRelayEvent`, que saiu de dentro do `attempt()` do relay. Mesma guarda de URL, mesma chave lida sem cache, mesmos cabeçalhos, 10 s, sem seguir redirecionamento. Corpo: `{event, event_id, relay_version, sent_at}`. Responde 200 com o desfecho (e o host testado), registra em `integration_logs` (ação `webhook.ping`) só quando o pedido saiu, e tem teto de 10 testes por minuto por administrador.
- **Envelope da mensagem:** `event`, `event_id` e `sent_at` na raiz, vindos do provedor, não são repassados (`PING_ONLY_KEYS`).
- **Cofre:** a rota de gravar só aceita o catálogo (`RUNTIME_ENVIRONMENT_NAMES`, agora em `settings/types.ts`); `RELAY_SIGNING_SECRET` não se grava nem se apaga por ela, não aparece na lista e saiu do cache de 60 s (o tipo de `getRuntimeEnvironmentVariable` recusa o nome). Apagar segue aceitando qualquer nome bem formado. O piso de 32 caracteres do PR 11 saiu.
- **Tela** (Configurações → Agente de IA): o bloco "Chave de assinatura do webhook" e o botão "Testar conexão". O comportamento está no `UI.md` §5.19.
- **`Dialog` travável** (`dismissible={false}`, `UI.md` §5.10): toque fora e arrastar não fecham, e o X chega ao `onOpenChange` de quem abriu. Na gaveta do celular o `dismissible` vai para o vaul, e a gaveta travada leva `data-locked`.
- **Contrato:** a seção 9 diz que a chave é gerada pelo CRM e que a troca tem uma janela, e a seção 10 (nova) descreve o `webhook.ping`.

**Decisões tomadas:**
- **O front mínimo veio junto** (o plano o punha no PR 13): sem ele a chave não teria por onde entrar, já que o nome deixou de ser gravável à mão. O PR 12 virou 12a (este) e 12b (registros e Saúde).
- **Carimbo no lugar de trava no banco:** a conferência do `updated_at` é feita na rota, antes da RPC. Um passo só no banco pediria migration. Sobra uma janela de milissegundos entre conferir e gravar, e a releitura depois de gravar cobre quem gerou. O carimbo é comparado como TEXTO, do jeito que o PostgREST o entrega (microssegundos): convertido em `Date`, perderia precisão.
- **A rota do teste não recebe URL:** ela testa a que está salva, e a tela desabilita o botão com o campo alterado. Testar um endereço que o repasse não usa diria "funciona" sobre a coisa errada. Fica para o dono decidir se quer "testar antes de salvar".
- **`event` e `event_id` dentro do corpo do ping:** a assinatura cobre o corpo, e não os cabeçalhos (achado da revisão do PR 11). E o envelope da mensagem passou a recusar essas chaves vindas do provedor: sem isso, a frase do contrato ("a mensagem nunca tem `event`") seria uma promessa que o código não cumpria.
- **Cofre ilegível não vira "sem chave":** o teste não sai, como o repasse.
- **O teste responde 200 mesmo quando o agente falha:** a rota funcionou; quem não respondeu foi o agente. O desfecho vai em `result`.
- **Desfecho desconhecido não é falha:** erro do servidor sem a marca `applied: false`, resposta que não é do app, ou pedido que não voltou podem ter gravado. A tela fecha a confirmação e passa ao estado "última operação não confirmada", que só oferece reler. Ela não relê sozinha: com a rede fora do ar o `router.refresh()` recarrega a página e leva o aviso junto.
- **Com a chave à vista o estado não é relido.** O `router.refresh()` vira navegação completa quando o servidor está com outro build ou a busca falha, e a chave, que só aparece uma vez, se perderia. O refresh acontece ao fechar.
- **O `Dialog` compartilhado ganhou `dismissible`.** Era o jeito de travar a gaveta do celular: recusar um fechamento no `onOpenChange` a deixava deslocada. A prop é opcional, e só o bloco da chave a usa por ora.
- **Chave em hex (64 caracteres), sem prefixo:** copia inteira com dois cliques e é usada como texto, como o contrato já dizia.
- **A troca tem uma janela, e este PR não a fecha:** a chave nova só existe depois de o CRM já assinar com ela. O contrato e a tela dizem isso. Quem fecha é o reenvio do outbox (Fase 6).
- **Três frases antigas da aba Variáveis foram corrigidas** (a "reserva no ambiente do servidor" saiu na Fase 2). O resto da limpeza dessa aba fica para o PR 13.

**Verificação:**
- **Testes:** 265 casos novos (a suíte foi de 3823 para 4088, em 217 arquivos). Entre eles:
  - o teste de contrato lê o `docs/CONTRATO-RELAY.md` e confere as frases da seção do teste, a tabela de campos e o exemplo do ping contra o código;
  - o bloco da chave tem um arquivo para o desktop e outro para a gaveta do celular (a largura é lida uma vez por arquivo);
  - a página de Configurações ganhou teste: cada leitura chega ao bloco dela, o bloco não remonta no refresh, e a aba do agente fica montada.
- **Mutação:** 348 alterações propositais no código, e todas derrubam algum teste. Não saiu assim de primeira:
  - 1ª rodada (200): 7 sobreviveram. Quatro eram lacunas de teste (o registro esperado ou não, a latência incluindo as leituras, o corpo que não é objeto no apagar, a resposta 200 com `ok: false`), e viraram teste;
  - 2ª rodada (310): 3 sobreviveram. Duas lacunas (status 400, e resposta com a chave e status de erro);
  - 3ª rodada (348): 1 sobreviveu, o título do diálogo de troca;
  - ficaram fora da lista, com o motivo anotado nela: 2 mutantes equivalentes e 1 que só o `tsc` pega.
- **Revisão:** três revisores independentes (segurança; qualidade dos testes; comportamento, tela e contrato), cada um numa cópia privada, e depois um quarto só sobre as correções. Nenhum defeito grave. O que mudou por causa deles:
  - **segurança:** trocar e remover conferem a chave que a tela mostrava; a rota relê a chave antes de devolvê-la; a trilha de quem mexeu na chave; teto de testes por minuto; `event`, `event_id` e `sent_at` reservados no envelope; a chave fora do cache;
  - **testes:** 20 alterações de comportamento que os testes da 1ª versão deixavam passar, entre elas a chave vinda de `Math.random`, um `GET` que devolvesse a chave, a URL e a chave indo para o console no teste de conexão, e o teste reenviado quando não há resposta;
  - **tela e contrato:** o contrato prometia "aceitar a chave nova e a anterior", que não é possível com a chave gerada pelo CRM; "sem assinatura" tinha dois sentidos na mesma aba; a falha de desfecho desconhecido aparecia como "não foi possível";
  - **segunda rodada:** a chave se perdia se o `router.refresh()` virasse recarga da página com ela à vista; uma falha de rede recarregava a página e levava o aviso junto; no celular a gaveta fechava com um toque fora, e ficava deslocada depois de um fechamento recusado.
- **Ponta a ponta contra o banco local:** 82 verificações, com um agente de mentira em 127.0.0.1 e a sessão de um administrador e de um membro que já existem no banco local. Entre elas: 401 sem sessão e 403 para membro nas três rotas; a chave gerada assina o teste e o repasse seguinte, conferida por conta feita em Python e pela função do documento; a troca com a data que a página de verdade entrega, e a recusa com data velha; a trilha com quem gerou, trocou e removeu; o teto de 10 por minuto; a mensagem com chaves de raiz forjadas (`event: webhook.ping`) chegando ao agente sem elas. O que o teste criou foi apagado, e a configuração local voltou ao que era.
- **Servidor de produção local** (`node .next/standalone/server.js`, banco local): 30 verificações. A chave é gerada, trocada e removida pelo build de produção, e o teste de conexão passa pela guarda de produção (`http`, `localhost` e nome de um rótulo só recusados).
- typecheck ✓ · lint ✓ (só os 9 avisos antigos) · test ✓ · build ✓.
- As skills `bug-hunter` e `verification-before-completion` não estão instaladas neste ambiente; no lugar delas ficaram a revisão adversarial e os quatro comandos rodados.
- **Nenhuma mensagem saiu para o WhatsApp, e nenhum agente de verdade foi chamado.** Produção não foi tocada.

**Pendências / próximos passos:**
- **PR 12b:** leitura real de `get-integration-logs.ts` com filtros, e Saúde. A taxa de erro do relay tem de filtrar pela ação `conversation.message_received`: o teste e a trilha da chave usam o mesmo provider.
- **PR 13:** as abas da Conexão. Lá o bloco da chave e o botão mudam de lugar, o `revalidatePath` passa a apontar para `/app/conexao`, e o campo de nome do Cofre vira `FormSelect` do catálogo (hoje o servidor recusa com o motivo). A coluna Origem, os rótulos "Servidor"/"Sobrescrever" e o "Substituir" em variável antiga saem junto.
- **D13 (rotação do segredo do webhook):** proposta de adiar, aguardando o dono.
- **A guarda de URL não resolve DNS** (pendência do PR da guarda): o teste de conexão devolve ao administrador o status e o tempo da resposta. Fechar num PR próprio (resolver o nome e fixar o endereço antes do pedido).
- **Testar antes de salvar:** decisão do dono.

**Armadilhas descobertas:**
- **Banco de mentira que responde na hora não distingue `await` de `void`.** O teste "o registro é gravado antes de a resposta voltar" passava com o `await` trocado por `void`. Só uma gravação que termina quando o teste manda (promessa travada) prova a espera.
- **`router.refresh()` pode virar recarga da página inteira.** Quando o servidor responde com outro build, ou a busca falha, o Next cai para a navegação do navegador (`fetch-server-response.js`). Daí duas regras: não chamar `refresh()` com algo na tela que só aparece uma vez, e não chamar `refresh()` no caminho de uma falha de rede (ele leva o aviso junto).
- **Na gaveta do celular, recusar um fechamento a deixa deslocada.** O vaul arrasta a folha, pede o fechamento, e não a devolve se quem abriu recusar; o toque seguinte a fecha. Quem recusa no `onOpenChange` passa `dismissible={false}` ao `Dialog` enquanto recusa. Os modais antigos que recusam durante o envio ainda não passam (backlog do `UI.md`).
- **`useMediaQuery` guarda a consulta por módulo:** num arquivo de teste a superfície (caixa ou gaveta) é a do primeiro render. Desktop e celular vão em arquivos separados. E o arrasto da gaveta não é observável no jsdom: o teste confere `data-locked`.
- **`Tabs.Panel` do Base UI desmonta a aba inativa.** O estado do componente morre na troca de aba, e um pedido em curso volta para ninguém. O HTML do servidor só tem o DOM da aba ativa, mas os dados embutidos da página levam as props de TODAS as abas: nunca passar segredo como prop.
- **Erro do cliente do banco não quer dizer que nada foi gravado.** A resposta pode se perder depois do commit. Onde isso importa (uma chave que passa a valer), a rota confere o que ficou guardado antes de responder que falhou.
- **O carimbo de `updated_at` se compara como TEXTO.** O PostgREST o entrega com microssegundos; convertido em `Date`, dois carimbos diferentes ficam iguais.
- **Arquivo `route.ts` só exporta handler e configuração.** Uma constante exportada quebra o `next build` ("not a valid Route export field"). Fica privada do módulo.
- **`z.string()` sem `error` responde em inglês** quando o campo falta ou não é texto, e a rota que devolve a mensagem do schema leva isso à tela.
- **O limitador (`rate-limit.ts`) é por processo e mora na memória.** Em teste, cada caso usa uma chave só dele (um administrador por teste). No ponta a ponta, esperar o `Retry-After`.
- **Listar processo com `pgrep -fl` (ou `ps e`) pode imprimir o AMBIENTE dele,** e o servidor de teste carrega os segredos locais no ambiente. Para achar e encerrar processo: `pgrep -f` (só os pids).
- **Mutante que se desfaz sozinho:** com o relógio de mentira o instante inicial é 0, e `inicio || performance.now()` cai no valor certo. Em mutante que guarda um instante, usar `??`.
- **`userEvent.setup()` instala a própria área de transferência:** o `vi.spyOn(navigator.clipboard, "writeText")` vem DEPOIS do `setup()`.
- **Durante a mutação, a worktree tem arquivo mutado:** não editar fonte nem teste, não rodar `next build` e não mexer em documento que teste lê (`docs/CONTRATO-RELAY.md`). O aviso de "arquivo alterado em disco" nessa hora é o roteiro, e não é para corrigir. A cópia dos revisores é feita antes de a mutação começar.

## [2026-10-01] Guarda de URL: recusa o que escapava, e deixa de barrar host público por engano

**Agente/Modelo:** Claude Opus 5.5.
**Objetivo:** A guarda que impede o CRM de buscar ou postar em rede interna vale para toda grafia de endereço interno, e não recusa endereço público.
**Arquivos alterados:**
- `src/lib/security/ssrf-guard.ts` e o teste (vieram de `src/features/chat/lib/connection/`);
- só o import: `connection/uazapi.ts`, `senders/uazapi.ts`, `media/persist-inbound.ts`, `get-relay-url.ts`, `relay-message.ts`, as rotas `connection/persist`, `chat/transcribe` e `settings/automation`, e quatro testes;
- `src/features/chat/lib/media/persist-inbound.test.ts` (novo: o download de mídia não tinha teste);
- docs: `PRD.md`, `AGENTS.md` (mapa), `docs/PLANO-FASE-5.md`, `docs/CONTRATO-RELAY.md`, a skill `uazapi-integration` e este PROGRESS.

**O que foi feito:**
- **Mudou de lugar:** a guarda já era usada pela conexão da uazapi, pela mídia, pela transcrição e pelo relay. Foi para `src/lib/security`, como o plano da Fase 5 pedia. Commit à parte, sem mudança de regra.
- **Passou a recusar:**
  - nome com ponto final (`localhost.` é `localhost`);
  - os sufixos `.internal` e `.home.arpa`, e `local`, `internal` e `home.arpa` sozinhos;
  - em produção, nome de um rótulo só (`db`, `gateway`): só resolve na rede do Docker;
  - IPv4: CGNAT (`100.64.0.0/10`), `192.0.0.0/24`, `198.18.0.0/15`, multicast e a faixa reservada;
  - IPv6: link-local inteira (`fe80::/10`, antes só o prefixo `fe80`), site-local, multicast, e as formas que embutem um IPv4 (compatível, traduzido, NAT64, 6to4, Teredo).
- **Deixou de recusar por engano:** nome de host que começa por `fc`, `fd` ou `fe80` (`fcm.googleapis.com`, por exemplo). A regra antiga comparava o começo do texto, pensando em IPv6, e pegava nome.
- **O que não mudou:** as mensagens de erro, a assinatura das funções, o HTTPS obrigatório em produção, e a liberação de `localhost` e `127.0.0.1` fora de produção.

**Decisões tomadas:**
- **As faixas vêm do `BlockList` do Node** (`node:net`), no lugar da conta de octetos feita à mão. O `new URL` já entrega o host normalizado (IPv4 em decimal, hex, octal, forma curta ou largura total vira `a.b.c.d`), e o `BlockList` confere o IPv4 mapeado em IPv6 contra as regras de IPv4. Sobrou menos código para errar.
- **Nome de um rótulo só é recusado só em produção.** Em dev ele continua valendo (um serviço de mentira na rede local).
- **A guarda segue sem resolver DNS.** Ela confere o host literal. Basta para URL que só um administrador configura; não basta para URL vinda de um token (`source_url`).

**Verificação:**
- **Tabela de hosts:** 162 casos no teste da guarda (eram 18), em dev e em produção: os hosts que o app usa de verdade, os vizinhos de fora de cada faixa, as duas metades de cada faixa, e as grafias que confundem (usuário no lugar do host, barra invertida, dígito de largura total, letra circulada, percent-encoding).
- **Mutação:** 96 trocas na guarda (cada faixa removida, alargada e estreitada) e 17 no download de mídia. Todas derrubam algum teste.
- **Guarda antiga × nova:** 16 mil hosts gerados, nos dois ambientes. Toda diferença cai numa das categorias acima, e nenhum host público passou a ser recusado. O veredito da nova confere, caso a caso, com uma conta independente feita com o `ipaddress` do Python.
- **Servidor de produção local** (`node .next/standalone/server.js`, banco local): 15 URLs de agente pelo caminho real. As internas foram recusadas sem nada sair; as públicas que começam por `fc` e `fd`, e a com ponto final, passaram pela guarda.
- **Ponta a ponta do relay em dev:** as 52 verificações seguem passando.
- **Produção, só leitura:** a URL da instância do WhatsApp é HTTPS, com nome público com ponto, sem sufixo interno; as 6 URLs externas de mídia guardadas também. Nenhuma regra nova as alcança.
- **Node 22 (imagem de produção) e Node 25 (local):** o `BlockList` e a normalização do `new URL` dão o mesmo resultado nos dois.
- **Revisão:** um revisor de segurança independente tentou furar a guarda por grafia (IPv4 e IPv6 ofuscados, zona, IDNA, usuário, barra invertida, porta, esquema) e não achou desvio. Os testes que ele sugeriu entraram.
- typecheck ✓ · lint ✓ (só os 9 avisos antigos) · test ✓ (3823) · build ✓.

**Pendências / próximos passos:**
- **As chamadas à uazapi seguem redirecionamento** (envio e conexão). Já estava na lista do plano. O download de mídia, a transcrição e o relay não seguem. Fechar mexe no caminho de envio do WhatsApp: proposta ao dono, não feita.
- **Nome público que resolve para endereço interno passa pela guarda** (ela não resolve DNS). Fechar pede resolver o nome e conferir o endereço antes de conectar.
- `transcribe/route.ts` não tem teste do caminho que baixa a mídia pelo endereço do provedor.

**Armadilhas descobertas:**
- **Comparar o começo do TEXTO do host com um prefixo de IPv6 pega nome.** `host.startsWith("fc")` recusava `fcm.googleapis.com`. Primeiro saber se é IP (`isIP`), depois conferir a faixa.
- **Não reimplemente a leitura de IP.** O `new URL` já normaliza as grafias, e o `BlockList` já sabe de faixa e de IPv4 mapeado em IPv6. Medido no Node 22 e no 25.
- **O host da URL guarda o ponto final.** `new URL("https://localhost./").hostname` é `localhost.`: quem compara nome tem de tirá-lo.
- **Mutante de prefixo equivalente:** alargar `224.0.0.0/4` para `/3`, ou `fe80::/10` para `/9`, dá a mesma união de endereços por causa da faixa vizinha. Não é buraco de teste.
- **Parâmetro com valor padrão em helper de teste:** passar `undefined` aciona o padrão. O caso "sem a origem" estava, sem querer, testando "com a origem".

## [2026-10-01] Fase 5, PR 11: relay v1 (envelope com dados do CRM, assinatura e registro)

**Agente/Modelo:** Claude Opus 5.5.
**Objetivo:** Cada mensagem nova do cliente em conversa `bot` chega ao agente com os dados do CRM, assinada com a chave do Cofre, e cada repasse fica registrado com status e latência.
**Arquivos alterados:**
- novos: `src/lib/security/hmac.ts`, `src/features/integrations/server/relay-envelope.ts`, `src/features/integrations/server/relay-message.ts`, `docs/CONTRATO-RELAY.md`, e os testes (`hmac.test.ts`, `relay-envelope.test.ts`, `relay-message.test.ts`, `relay-contract.test.ts`, `get-relay-url.test.ts`, `automation/route.test.ts`, `automation-settings.test.tsx`);
- alterados: `src/app/api/chat/webhook/uazapi/route.ts` (passo 5) e o teste, `src/features/chat/lib/upsert-message.ts`, `src/features/settings/lib/get-relay-url.ts`, `src/features/settings/lib/get-runtime-environment.ts` e o teste, `src/features/settings/types.ts`, `src/features/settings/schemas/environment-variable.ts`, `src/app/api/settings/automation/route.ts`, `src/app/api/settings/environment-variables/route.test.ts`, `src/features/settings/components/automation-settings.tsx`, `.env.example`, `.env.local.example`;
- só comentário: `src/lib/api/v1/context.ts`, `src/features/integrations/server/triage-context.ts`;
- docs: `PRD.md`, `UI.md`, `AGENTS.md` (mapa), `docs/PLANO-FASE-5.md`, `docs/PLANO-IMPLANTACAO.md`, `docs/GUIA-AGENTE-IA.md` (aviso), a skill `uazapi-integration` e este PROGRESS.

**O que foi feito:**
- **Envelope v1** (`relay-envelope.ts`): o evento `messages` da uazapi sem o `token`, mais `relay_version`, `conversation_id`, `conversation_status`, `message_id`, `contact`, `customer`, `contract{status,alert}`, `active_ticket` e `media_url` (URL assinada por 10 min).
  - `contact`, `customer` e `active_ticket` saem pelos mapeadores da API v1: um formato só para quem integra.
  - O status e o ticket em foco são lidos na hora do envelope, da mesma linha da conversa. Só o ticket em foco é lido.
  - Do provedor não passa chave de raiz com nome de campo do CRM, nem em outra caixa, e os campos do CRM vão no fim do corpo.
- **Envio** (`relay-message.ts`): URL lida de `app_settings` (sem a reserva de `N8N_WEBHOOK_URL`), conferida por `assertRelayUrl`, `POST` com prazo de 10 s e sem seguir redirecionamento. Cabeçalhos `User-Agent`, `X-CRM-Event`, `X-CRM-Event-Id`, `X-CRM-Timestamp` e, com chave, `X-CRM-Signature`.
- **Assinatura** (`src/lib/security/hmac.ts`): `v1=` + HMAC-SHA256 em hex de `<timestamp>.<corpo>`. A chave é `RELAY_SIGNING_SECRET`, no Cofre, lida a cada repasse sem o cache de 60 s.
- **Registro:** uma linha em `integration_logs` por repasse (provider `relay`, `request_id` = id da mensagem), com status, HTTP e latência. Sem corpo e sem a URL do agente.
- **Webhook:** o passo 5 agenda o repasse com `after()`, e o `upsertMessage` devolve `messageId` (o id da mensagem nova) no lugar de `inserted`.
- **Tela do agente:** a linha de estado passou a dizer quatro coisas (ativo, sem URL, URL recusada com o motivo, configuração ilegível com o campo travado). Os textos sobre o fallback de ambiente saíram.
- **Cofre:** a chave de assinatura só é aceita com 32 caracteres ou mais, sem espaços.
- **`docs/CONTRATO-RELAY.md`:** o contrato para quem constrói o agente, com exemplo, vetor de assinatura e a conferência em Node e em Python.

**Decisões tomadas:**
- **Tudo ou nada.** Leitura que falha derruba o repasse (o registro diz por quê). Um envelope sem os campos, ou com um `bot` suposto, pareceria verdade à IA. A única exceção é a URL da mídia.
- **Uma 2ª tentativa, só de leitura.** O relay passou a depender de mais leituras que antes. Quando uma falha e nada saiu, ele espera 1 s e tenta de novo. O que chegou a sair nunca é enviado de novo.
- **Sem a marca de repasse do plano.** Ela só é segura com trava atômica, e isso pede migration: sem a trava, duas entregas simultâneas da uazapi repassam em dobro, que é o que o PR 1 fechou. Fica para o outbox da Fase 6.
- **`active_ticket` no formato inteiro da API** (com `version`), e não os seis campos do plano: o agente altera o ticket sem um GET antes, e aprende um formato só.
- **`message_id` acrescentado** ao envelope: é o id para descartar repetição. O `X-CRM-Event-Id` repete o valor, mas a assinatura não cobre cabeçalho.
- **Chave lida sem cache.** Com o cache de 60 s por processo, uma das duas réplicas assinaria com a chave antiga (ou sem chave) por até um minuto, e o agente recusaria esses pedidos.
- **`after()` no lugar do `void`.** O Next termina os callbacks de `after()` antes de sair; uma promessa solta morre no `process.exit`. Medido (abaixo).
- **A credencial é procurada no corpo.** Além de tirar o `token` da raiz, o repasse não envia se o valor do token da instância aparecer em qualquer lugar do corpo. Token com menos de 16 caracteres não é procurado (daria falso positivo).
- **Gerar a chave pela tela ficou para os PRs 12 e 13.** Até lá ela entra por Configurações → Variáveis.
- **A guarda de URL compartilhada não foi endurecida aqui.** Vai num PR próprio, em seguida.

**Verificação:**
- **Testes:** 217 casos novos (a suíte foi de 3439 para 3656): 192 em sete arquivos novos e 25 nos três que já existiam (o do webhook foi de 13 para 23).
  - O teste de contrato (`relay-contract.test.ts`) lê o `docs/CONTRATO-RELAY.md`: falha se um campo ficar sem descrição, se o exemplo sair do schema ou se o vetor de assinatura não conferir. Ele também **roda** o trecho de Node.js do documento contra o que o CRM assina.
  - A assinatura é conferida por conta independente (`openssl`, Python e `node:crypto` no próprio teste), nunca pela função do app.
- **Mutação:** 236 trocas propositais no código (208 minhas e 28 do terceiro revisor, adaptadas). Todas derrubam algum teste, nenhuma por tempo esgotado.
- **Revisão:** três revisores independentes (segurança, contrato e comportamento, qualidade dos testes), cada um numa cópia própria. Nenhum defeito de gravidade alta. O que mudou por causa deles:
  - a chave passou a ser lida sem cache (com o cache, uma réplica mandava sem assinatura por até 60 s depois de a chave ser gravada);
  - o status e o foco passaram a ser lidos na hora do envelope, e só o ticket em foco é lido (antes, até 21 tickets, e um vizinho com linha estranha derrubava o repasse);
  - a 2ª tentativa de leitura, e o motivo fixo quando o contexto e o cofre falham juntos;
  - `after()` no lugar do `void`;
  - chave de raiz do provedor em outra caixa (`Conversation_Status`) deixou de passar, e a credencial passou a ser procurada no corpo inteiro;
  - status HTTP fora de 100 a 599 não vai mais para a coluna (o banco recusava a linha, e a falha sumia);
  - a tela ganhou os estados "URL recusada" e "configuração ilegível";
  - o piso de 32 caracteres da chave no Cofre;
  - o documento: deduplicar por `message_id` (a assinatura não cobre cabeçalho), o que de fato é repassado (reação, edição como mensagem nova), a trava do 409 só para token do tipo IA, `If-Match: W/"<version>"`, e os trechos de conferência (chave vazia era aceita; o de Python lançava com entrada estranha);
  - os testes: 26 mutantes do terceiro revisor sobreviviam à 1ª versão. Os principais: o mapeador de contato e empresa podia sumir (a linha inteira do banco iria ao agente), a linha de erro do registro podia ganhar o payload, e a mídia podia não chegar ao envelope.
- **Ponta a ponta contra o banco local** (`next dev` da worktree, provedor e agente de mentira em 127.0.0.1): 52 verificações.
  - O envelope, os cabeçalhos e a assinatura, conferida também pela função de Python do documento.
  - Reenvio não repassa; mensagem da empresa não repassa; conversa com analista não repassa; encerrada volta para `bot` e repassa.
  - Empresa sem contrato, contrato suspenso e ticket em foco.
  - Chave gravada, removida e trocada: vale no repasse seguinte.
  - Agente com 500, com 307 (o destino não recebe nada), derrubando a conexão, lento (o webhook responde sem esperar; registro de tempo esgotado em ~10 s) e fora do ar.
  - `N8N_WEBHOOK_URL` definida no ambiente apontando para uma armadilha: nada chegou lá.
  - Nem o registro nem o console levaram o caminho da URL, o token, a chave ou o texto do cliente.
  - Tudo o que o teste criou foi apagado, e a configuração local voltou ao que era.
- **Repasse em curso no deploy** (build de produção, `node .next/standalone/server.js`, banco local): com a 1ª leitura do repasse presa numa trava do banco, o servidor recebeu SIGTERM logo depois de responder o webhook. Ele esperou 6,9 s, o repasse terminou e foi registrado, e só então o processo saiu.
- **Produção, só leitura, antes de começar:** `app_settings` sem a linha `automation`, e `N8N_WEBHOOK_URL` vazia no ambiente. Não há agente configurado: tirar o fallback não desliga nada.
- typecheck ✓ · lint ✓ (só os 9 avisos antigos) · test ✓ (3656) · build ✓.
- **Nenhuma mensagem saiu para o WhatsApp e nenhum agente de verdade foi chamado.**

**Pendências / próximos passos:**
- **PR da guarda de URL** (`assertSafeUrl`): hoje ela recusa por engano nome de host que começa por `fc`, `fd` ou `fe80` (`fcm.googleapis.com`, por exemplo), e ainda deixa passar alguns nomes e faixas de rede interna (o risco já listado em `docs/PLANO-FASE-5.md` §4). Só um administrador configura a URL, e em produção só vale HTTPS.
- **Normalizador do webhook:** `chatid: status@broadcast` (status do WhatsApp), reação e tipo sem tratamento viram mensagem do cliente e são repassados. Já era assim antes deste PR. Medir o que a uazapi entrega e filtrar.
- **PR 11b:** tirar o filtro `bot`, depois de o dono confirmar que a IA só responde com `conversation_status: bot`.
- **PRs 12 e 13:** gerar a chave pela tela, "testar" o agente, a tela dos registros e o estado da assinatura.
- **Dívida do "no máximo uma vez":** mensagem gravada cujo webhook respondeu 500 não é repassada no reenvio da uazapi. Fica só o `console.info`.
- **Sem fila:** cada mensagem abre uma conexão ao agente, sem teto de repasses simultâneos. O teto vem com o worker da Fase 6.
- **`.agents/skills/uazapi-integration/SKILL.md`** é uma cópia da skill parada na Fase 2: ainda descreve o relay cru com o token. Não é citada em nenhum documento normativo; decidir se some ou se passa a espelhar a de `.claude/skills`.

**Armadilhas descobertas:**
- **Cache por processo com duas réplicas muda o comportamento de quem lê segredo.** `getRuntimeEnvironmentVariable` guarda o catálogo por 60 s, e só a réplica que gravou zera o dela. Para o que não pode valer com atraso, use `readRuntimeEnvironmentVariable`.
- **Espalhar o payload do provedor e os campos do CRM na mesma raiz não basta.** `{...provedor, ...crm}` faz o CRM vencer a chave de nome igual, mas não a variante em outra caixa, e a ordem das chaves fica a do provedor. Um leitor de JSON que ignora caixa fica com a última.
- **A assinatura `ts.corpo` não cobre cabeçalho.** Id e tipo do evento, se forem para deduplicar ou decidir, têm de estar no corpo. Vale para os eventos da Fase 6.
- **`fetch` devolve status que o `Response` do padrão não deixa construir** (um agente pode responder 999). Gravado sem conferir, o check `between 100 and 599` de `integration_logs` recusa a linha, e a falha some.
- **`after()` em teste de rota:** chamado fora de um pedido do Next, ele lança. O teste troca o `after` de `next/server` por uma lista e roda os callbacks à mão. Isso também prova que a resposta não espera o repasse.
- **Fixture com exatamente as colunas do DTO esconde o `select("*")`.** Só com uma coluna a mais na linha do banco (e a consulta comparada inteira) o teste percebe que o mapeador sumiu.
- **`expect.objectContaining` numa linha de registro deixa entrar o que não devia** (o payload, por exemplo). Linha de erro se compara por igualdade.
- **Teste de tela que digita uma URL tecla a tecla é lento.** Com a máquina saturada, estourou os 5 s. `user.paste` faz o mesmo em um evento.
- **Parar um roteiro Python iniciado pelo pyenv:** `pgrep -f | head -1` devolve o atalho do pyenv, não o Python. Matar só ele deixa o roteiro rodando (e mutando arquivo). Mate todos os pids que casam, e confira com `pgrep` antes de mexer no código.
- **O vitest grava cache em `node_modules/.vite`.** Um revisor numa cópia com `node_modules` por link simbólico escreve na árvore de verdade. Dê a ele uma config com `cacheDir` próprio.

## [2026-10-01] API v1: teto do corpo também nas escritas sem Idempotency-Key

**Agente/Modelo:** Claude Opus 5.5.
**Objetivo:** Nenhuma rota da v1 lê um corpo maior que o teto dela, com ou sem Content-Length.
**Arquivos alterados:** `src/lib/api/v1/with-api.ts`, `src/lib/api/v1/with-api.test.ts` e este PROGRESS.

**O que foi feito:**
- O `withApi` passa a ler o corpo com teto antes de chamar o handler também nas rotas sem Idempotency-Key (`PATCH` de ticket e de contato, `transitions`, `assign`, `PUT active-ticket`). Acima do teto, 413 `payload_too_large`, sem chamar o handler.
- Antes, só o cabeçalho Content-Length era conferido nessas rotas. Um pedido sem ele (corpo em pedaços) era lido inteiro pelo handler, até o limite de 64 MB do servidor. Nas rotas com Idempotency-Key a leitura já tinha teto.

**Decisões tomadas:**
- **A leitura com teto é numa cópia do pedido,** como já era nas rotas idempotentes: o handler segue lendo o corpo dele, sem mudar nenhuma rota.
- **Sem condição por método.** Pedido sem corpo (GET) passa direto pela mesma leitura, que devolve vazio.

**Verificação:**
- 8 casos novos no `with-api.test.ts`: os quatro métodos de escrita acima do teto, o teto exato, um byte acima, o teto próprio da rota, e pedido sem corpo.
- **Mutação:** 6 trocas, todas derrubam algum teste.
- **Contra o servidor de verdade** (`next dev` da worktree, token criado e apagado no fim): corpo de 1,2 MB sem Content-Length é 413; com Content-Length é 413; corpo de 0,9 MB em pedaços passa pelo teto e chega à validação (400); corpo pequeno em pedaços chega à rota (404 da conversa que não existe). As 41 verificações das rotas de conversa seguem passando.
- typecheck ✓ · lint ✓ (só os 9 avisos antigos) · test ✓ (3439) · build ✓.

**Pendências / próximos passos:** nenhuma deste PR. Em produção o nginx já repassa com Content-Length e teto de 1 MB; isto fecha o caso de quem chega ao app por outro caminho.

**Armadilhas descobertas:**
- **Conferir o Content-Length não é limitar o corpo.** O cabeçalho é opcional (corpo em pedaços), e o `request.json()` lê o que vier. O teto de verdade é na leitura.

## [2026-10-01] Testes de tela instáveis: a causa era a pressa do teste, não o produto

**Agente/Modelo:** Claude Opus 5.5.
**Objetivo:** Os dois testes de tela que falhavam com a máquina carregada passam sempre, e a suíte local roda os mesmos arquivos do CI.
**Arquivos alterados:** `src/features/chat/components/contact-info-sheet.test.tsx`, `src/features/tickets/components/ticket-detail.test.tsx`, `vitest.config.ts` e este PROGRESS. Nenhum código de produto mudou.

**O que foi feito:**
- **`contact-info-sheet` › "toque fora com o Novo ticket sujo…"** (aberto desde 2026-09-29, sem causa raiz): o teste digitava no título antes de o painel assumir o foco. O painel leva o foco para si ao abrir (`initialFocus`), um instante depois da montagem. Quando isso caía no meio da digitação, o foco saía do campo, nenhuma tecla entrava, o formulário ficava limpo e o toque fora fechava o painel. Os quatro testes que abrem no "Novo ticket" agora esperam o painel assumir o foco (`renderNewTicket`).
- **`ticket-detail` › "Atender recusado por já ter dono…"**: o teste clicava em "Assumir mesmo assim" com o botão ainda desabilitado. O 409 dispara uma releitura, que é uma transição do React, e o botão só habilita quando ela termina. O clique em botão desabilitado não faz nada, e o 2º pedido nunca saía. O teste agora espera o botão habilitar.
- **`vitest.config.ts`:** `.next/**` fora da suíte. O `next build` deixa em `.next/standalone` uma cópia de arquivos do projeto com um teste junto, e a suíte local rodava 1 arquivo e 3 testes a mais que o CI.

**Decisões tomadas:**
- **Não mexi no produto.** A pergunta deixada em 2026-09-29 era se o rascunho do ticket se perdia. Não se perde: nos casos que falharam, o campo estava vazio porque nada tinha sido digitado.
- **Só aumentar o tempo de espera não resolvia o do ticket.** Com 3 s no lugar de 1 s ainda falhou 1 vez em 48. O pedido não estava atrasado; ele não tinha saído.

**Verificação:**
- **Antes, medido:** o arquivo do painel falhou em 6 de 64 execuções (8 em paralelo). Nas 6, o diagnóstico gravou o campo vazio e o foco no painel; nas 58 que passaram, o texto inteiro e o foco no campo. O do ticket falhou em 2 de 36 (12 em paralelo, com cobertura), sempre na espera do 2º pedido.
- **Depois:** o do painel, 80 de 80; o do ticket, 72 de 72, com a mesma carga.
- typecheck ✓ · lint ✓ (só os 9 avisos antigos) · test ✓ (3431, a mesma contagem do CI) · build ✓.

**Pendências / próximos passos:**
- **Proposta de produto, para o dono decidir:** o painel do contato não deveria tirar o foco de um campo em que a pessoa já clicou. Num aparelho lento, quem toca no título logo depois de abrir pode ter o foco levado para o painel. A regra já está no UI.md ("foco automático nunca rouba de outro campo"), e a biblioteca aceita uma função em `initialFocus`. Não fiz porque mexe em foco no celular, e isso não se confere sem navegador.

**Armadilhas descobertas:**
- **Teste que age logo depois de abrir um diálogo corre contra o foco inicial dele.** O `userEvent.type` clica no campo e digita tecla por tecla; se o foco sair no meio, as teclas vão para outro elemento, sem erro nenhum. Espere o diálogo assumir o foco antes de digitar.
- **Botão ligado a `useTransition` nasce desabilitado.** `getByRole` acha o botão, e o clique nele não faz nada. Espere `toBeEnabled()` antes de clicar.
- **Aumentar o tempo de espera não conserta ação que não aconteceu.** Antes de mexer no tempo, confira se o clique ou a digitação chegou ao destino.
- **Para achar teste instável, rode o arquivo inteiro, não só o caso.** Sozinho (`it.only`), o do painel passou 40 de 40; o arquivo inteiro falhou em 6 de 64.
- **Carga de verdade vem de rodar em paralelo.** Oito a doze execuções ao mesmo tempo (o do ticket, só com cobertura ligada) reproduziram o que uma execução por vez nunca mostrou.

## [2026-10-01] Fase 5 · PR 10c: a IA e as integrações aparecem na tela

**Agente/Modelo:** Claude Opus 5.5.
**Objetivo:** Quem atende vê quando uma mensagem ou nota veio da IA ou de uma integração, e o pedido de handoff tem nome na timeline do ticket.
**Arquivos alterados:**
- chat: `src/features/chat/types.ts`, `lib/message-sender.ts` (novo), `lib/note-actions.ts`, `lib/message-actions.ts`, `lib/outgoing-message.ts`, `components/message-bubble.tsx`, `components/chat-footer.tsx` e `components/chat-view.tsx`, com os testes (os da bolha, do rodapé e do helper são novos);
- tickets: `src/features/tickets/types.ts`, `lib/timeline-view.ts`, `components/ticket-timeline.tsx` e `queries/get-ticket-timeline.ts`, com os testes;
- API: `src/lib/api/v1/ticket-activity.ts`, com `src/app/api/v1/ticket-activity.test.ts`;
- `UI.md`, `PRD.md`, `docs/PLANO-FASE-5.md`, este PROGRESS.

**O que foi feito:**
- **`ChatMessage` ganhou `sender_type` e `sent_by_token_id`.** As leituras da tela já traziam os dois (`select("*")` e o Realtime); faltava o tipo.
- **Bolha:** a mensagem da IA leva "IA" e a de uma integração leva "Integração", acima do conteúdo. A citação e a barra "Respondendo…" dizem o mesmo, no lugar de "Você". A bolha da IA não cola na do analista.
- **Nota de token:** "Nota interna · IA" ou "· Integração", no chat e na timeline do ticket.
- **Falha de token:** ✕ e "Não enviada", sem "Tentar novamente". O servidor já recusava o reenvio (PR 10b).
- **Mensagem de token não tem "Editar".** O predicado é o mesmo da rota, que passa a recusar.
- **Timeline do ticket:** `ticket.handoff_requested` vira "Pediu atendimento humano", com ícone próprio. A mensagem de token leva o mesmo nome que na bolha.
- **`sent_by_token_id` nos itens de mensagem da timeline,** na tela e na API v1 (`GET /tickets/{ref}/timeline`).

**Decisões tomadas:**
- **Um helper só para o nome** (`automatedSenderLabel`), usado na bolha, na citação, na barra de resposta, na nota e na timeline do ticket. Os nomes são os da trilha: "IA", "Integração" (token) e "Automático" (o próprio sistema, sem token). Na 1ª versão a integração aparecia como "Automático" na mensagem e "Integração" no evento do mesmo token; o revisor apontou.
- **As regras de ação valem pelo remetente ou pelo token** (`isAutomatedMessage`): o banco aceita uma linha `ai` sem o token gravado, e ela não pode virar editável.
- **O pedido de handoff não repete o motivo.** O banco grava a nota e o evento no mesmo instante, e a timeline põe a nota logo acima do evento: o motivo apareceria duas vezes seguidas.
- **Ninguém edita a mensagem de um token.** A linha seguiria assinada pela IA com um texto que ela não escreveu, e a API mostraria esse texto à própria IA como dela. Apagar continua como hoje (qualquer analista, para todos).
- **"Não enviada" por extenso na falha de token:** sem o botão, o ✕ sozinho seria só cor (UI §1). Em `red-700` no claro e `red-200` no escuro: o `red-500` do "Tentar novamente" dá 3,4:1 e 2,1:1 sobre a bolha de saída.
- **`TicketMessageSender` virou o `MessageSenderType` do chat:** eram dois vocabulários iguais.
- **Administrador apagar a nota de um token ficou fora.** Pede o papel de quem vê na tela (`/api/app-users`) e muda permissão; vai num PR próprio (10d), com a decisão do dono.

**Verificação:**
- **Testes:** três arquivos novos (a bolha, com 22 casos; a barra de resposta, com 4; o helper de remetente, com 16) e casos novos nos que já existiam: ações da mensagem, nota, timeline do ticket (texto, componente e consulta), a rota da timeline na API e a conversa (agrupamento das bolhas). O componente publicado no OpenAPI passou a ser comparado com o schema da rota.
- **Mutação:** 90 trocas no código do PR (47 minhas e 43 do 2º revisor, rodadas por ele numa cópia e por mim no fim). Todas derrubam algum teste. Na 1ª passada do revisor, 21 das dele atravessavam; viraram os casos acima.
- **Revisão adversarial** (2 revisores independentes, cada um numa cópia própria). Nenhum defeito de comportamento. Corrigidos:
  - responder a uma mensagem da IA dizia "Respondendo você mesmo";
  - o token de integração tinha dois nomes na mesma timeline ("Automático" na mensagem, "Integração" no evento);
  - o pedido de handoff repetia o motivo da nota que fica logo acima, e o teste afirmava a ordem que o banco nunca grava;
  - a bolha da IA colava na do analista;
  - o contraste do rótulo e do "Não enviada" no tema escuro;
  - as lacunas de teste (o menu da bolha, a barra de resposta, o nome repetido, o OpenAPI da timeline).
- Sem navegador (AGENTS §3.12): a tela é conferida por teste de componente.
- typecheck ✓ · lint ✓ (só os 9 avisos antigos) · test ✓ (3434 na máquina; no CI são 3 a menos) · build ✓.
- As skills `bug-hunter` e `verification-before-completion` não estão instaladas neste ambiente; no lugar delas ficaram a revisão adversarial e os quatro comandos rodados.

**Pendências / próximos passos:**
- **PR 10d (decisão do dono):** o administrador apagar a nota de um token. Hoje a nota da IA não sai da tela por ninguém.
- **A falha de um token não tem saída na tela.** Não reenvia, não edita e não apaga (apagar exige o id do provedor, que a mensagem que não saiu não tem). Se a conversa já saiu de `bot`, nem a IA a reenvia, e a bolha "IA · Não enviada" fica para sempre. Falta uma ação de dispensar.
- **A nota do ticket e o anexo de um token dizem "Integração" mesmo quando o token é da IA** (`comment-actions.ts`). Esses itens trazem o id do token, não o tipo dele.
- **A busca dentro da conversa** ainda rotula toda saída como "Você", inclusive a da IA. A rota de busca não traz o `sender_type`, e nem ela nem o componente têm teste.
- **A rota de editar responde à mensagem de token com o texto da janela vencida** ("não pode mais ser editada"). Só chega ali uma aba antiga ou uma chamada direta.
- **Campo novo e quem valida fechado.** Os schemas publicados saem com `additionalProperties: false`, e o PRD promete mudança só aditiva. Um integrador que valide a resposta contra o schema antigo quebra a cada campo novo. Decidir no PR da documentação da API (PR 14): avisar no OpenAPI ou publicar as respostas abertas.
- **Contraste do que já existia:** "Encaminhada" (60%) e "Tentar novamente" (`red-500`) ficam abaixo de 4,5:1 no tema escuro.
- **Mensagem do celular da empresa** (`device`) segue sem rótulo na bolha; a timeline do ticket já diz "Celular da empresa".
- **As pendências do PR 10b seguem valendo** (conciliar o envio pendente, medir a instância deslogada, `{{...}}` no texto).

**Armadilhas descobertas:**
- **Campo novo obrigatório num tipo de tela quebra as fábricas dos testes, não o código.** `ChatMessage` é montado à mão em sete arquivos de teste. O `tsc` aponta os que não usam cast; a fábrica com `as ChatMessage` compila sem o campo, e o teste passa a medir `undefined`.
- **`toEqual` trata chave `undefined` como ausente.** O teste da consulta da timeline passava sem `sent_by_token_id` na linha de mentira. Ponha o campo na fábrica.
- **Teste por trecho de texto não vê nome repetido.** `toHaveTextContent("IA")` passa com "IA · IA". Para o nome de quem enviou, `within(item).getByText("IA")`: texto exato, uma vez.
- **O teste da rota valida a resposta contra o mesmo schema que a rota usa.** Afrouxar o schema nunca o derruba. O que o integrador lê em `/openapi.json` precisa de teste próprio, comparando o componente publicado.
- **Regra medida só no predicado não mede a tela.** "Mensagem de token não tem Editar" passava no helper, e tirar a regra do menu da bolha não derrubava nada. Abra o menu no teste.
- **No mesmo instante, a timeline põe mensagem antes de evento** (`KIND_RANK`). A nota e o evento do handoff nascem na mesma transação: no teste, use o mesmo `at`.
- **Rota sem teste herda a regra pelo predicado.** `PATCH .../messages/[messageId]` não tem teste próprio; a recusa da edição de mensagem de token é medida em `message-actions.test.ts`, e a rota chama o mesmo predicado.

## [2026-10-01] Fase 5 · PR 10b: envio de texto pela API v1, no máximo uma vez

**Agente/Modelo:** Claude Opus 5.5.
**Objetivo:** A IA e as integrações enviam texto ao cliente pelo CRM, pelo mesmo caminho da tela, sem que uma repetição automática entregue a mesma mensagem duas vezes.
**Arquivos alterados:**
- `src/features/chat/lib/send-outbound.ts` (novo, com teste): o envio de texto, extraído de `src/app/api/chat/conversations/[id]/send/route.ts`, que passa a chamá-lo (com teste);
- `src/app/api/v1/conversations/[id]/messages/route.ts` (o `POST`), com `src/app/api/v1/conversations.test.ts`;
- `src/features/chat/lib/senders/uazapi.ts` (com teste) e `src/features/chat/lib/connection/ssrf-guard.ts` (só o tipo do erro);
- `src/lib/api/v1/conversations.ts`, `openapi.ts` e `with-api.ts` (este com teste); `src/app/api/v1/tickets.test.ts`;
- `PRD.md`, `docs/PLANO-FASE-5.md`, `docs/PLANO-IMPLANTACAO.md`, `.claude/skills/uazapi-integration/SKILL.md`, este PROGRESS.

**O que foi feito:**
- **`POST /conversations/{id}/messages`** (`messages:send`, com Idempotency-Key). O corpo é `{text}`, de 1 a 4.096 caracteres; o CRM não assina nem altera o texto. Token de IA grava `ai`; token de integração grava `system`. Devolve a mensagem (201).
- **`send-outbound.ts`:** o trecho da rota da tela (chave do envio, linha `pending`, provedor, resultado), com o autor como parâmetro. A rota da tela chama o helper e responde o mesmo de antes.
- **A IA só fala na conversa `bot`.** O status é relido na hora em que a mensagem vai ao provedor, e não na leitura inicial. Fora de `bot`: 409 `conversation_not_owned_by_ai`, com `current`. A integração não tem essa trava.
- **No máximo uma vez, para o token:**
  - 502 `whatsapp_unavailable`: a mensagem com certeza não saiu. A linha fica `failed`, e a mesma chave tenta de novo na mesma linha.
  - 504 `delivery_unknown`: o provedor não confirmou. A linha fica `pending`, e enquanto ela estiver assim a mesma chave não manda de novo: responde 504. Quando o webhook confirma, a chave responde 200 com a mensagem; se o webhook avisar que falhou, ela volta a tentar.
  - 422 `idempotency_key_reused`: a mesma chave com outro texto. A chave vale para um texto só, enquanto a linha existir.
- **Tetos por conversa, por token:** 20 envios por minuto e 100 por hora. Só conta o que vai ao provedor.
- **Só quem escreveu reenvia.** O "Tentar novamente" da tela sobre a linha de um token recebe 409.
- **Cliente da uazapi:** `UazapiHttpError` (status e o que o corpo do erro diz), `uazapiSendDefinitelyFailed` (a falha prova que não saiu?), e 2xx com corpo `null` deixa de virar falha. A guarda de URL passou a lançar `UnsafeUrlError`, com as mesmas mensagens.
- **`withApi`:** o 422 `idempotency_key_reused` vindo do handler libera a chave em vez de guardá-la. Vale para toda rota; o `POST /tickets` tem esse 422 (chave ou `external_id` já usados em outra conversa).
- **Credencial que não pôde ser lida:** 503 `unavailable` para o token, como as outras leituras. Na tela segue 500.

**Decisões tomadas:**
- **O PR 10b ficou só com o envio.** Os rótulos na tela vão no 10c.
- **Corpo `{text}`, sem `client_id`** (o plano previa os dois). A Idempotency-Key já é obrigatória e virou a chave do envio, junto com o id do token. Duas chaves para a mesma coisa abririam a combinação "mesma Idempotency-Key, outro `client_id`".
- **Desfecho desconhecido não vira `failed` para o token.** A 1ª versão marcava `failed` e mandava repetir. O revisor de segurança mostrou o que isso faz: o provedor aceita, a resposta se perde, e a repetição entrega a mesma mensagem duas vezes. O analista segue como sempre (toda falha vira `failed`): ele vê a conversa, e mudar isso pede um estado novo na tela.
- **"Com certeza não saiu" vem do OpenAPI oficial da uazapi e de medição,** não de suposição:
  - 4xx do provedor;
  - 5xx com `error_source: whatsapp_server` (recusa do próprio WhatsApp), ou com um texto de erro que diz não haver sessão (`No session`, `… not connected`: os textos que o spec usa em outras rotas);
  - nenhum pedido chegou ao provedor: a conexão nem abriu, ou o certificado dele foi recusado no aperto de mão. Os códigos foram medidos no Node 22 (o da imagem de produção) e no 25, com servidores locais e certificados de teste;
  - a URL da integração não passou na guarda.
  O 500 genérico (`Failed to send message`) fica como desconhecido. Na dúvida, desconhecido.
- **A linha `pending` não é promovida pelo eco.** O eco prova que a uazapi criou a mensagem; não sei se ele vem antes ou depois do aceite do WhatsApp. A linha anda pelos eventos de status.
- **`failed` com `external_id` não vira "já enviada"** (sugestão de dois revisores). Com a regra nova, a linha de um token só fica assim quando o WhatsApp avisou erro depois do eco, e reenviar é o certo.
- **O dono da conversa é conferido antes de gravar, não depois.** Depois fecharia mais alguns milissegundos, mas deixaria uma bolha `failed` na conversa que o analista acabou de assumir.
- **O 409 de dono e os tetos só valem para o que vai sair.** Repetir a chave de uma mensagem que já saiu devolve a mensagem, mesmo com a conversa já em `human`.
- **Teto da hora em memória,** como o do minuto. Contar no banco contaria linhas, e o reenvio de uma falha não cria linha.
- **A recusa de chave reusada não toma a chave, em nenhuma rota.** O 422 é guardado por 24 h (D6). Guardado, o pedido com o texto errado passava a ser o dono da chave, e o pedido certo recebia 422 dali em diante. O ponta a ponta pegou. No `POST /tickets` muda uma coisa: a repetição dessa recusa roda de novo, em vez de vir do que estava guardado (sem `Idempotent-Replayed`). A resposta é a mesma.
- **Mensagem apagada não é reenviada pelo token:** sairia de novo ao cliente o que o CRM mostra como apagado.

**Verificação:**
- **Testes:** 87 casos no `POST /messages` da v1, 28 na rota da tela (eram 9), 13 diretos no helper (`send-outbound.test.ts`), 66 no cliente da uazapi (eram 4), mais os da guarda de URL, do `withApi` e do `POST /tickets`. Todo status que a rota devolve nesses casos é conferido contra o OpenAPI publicado.
- **Rota da tela igual à de antes:** a rota antiga (do `git show`) e a nova rodam lado a lado com o mesmo banco de mentira. Meus 38 cenários e os 180.000 do revisor (3 sementes) não mostram divergência em status, corpo, cabeçalhos, chamadas ao banco, ao provedor e ao log. A única diferença é a pedida: linha de token.
- **Mutação:** 231 trocas no código do PR, 160 minhas e 71 do 3º revisor (que rodou as dele numa cópia). 225 derrubam algum teste. Das outras 6:
  - 4 do revisor deixaram de casar com o texto depois das correções; reescrevi as quatro, e elas estão entre as 225;
  - 2 sobrevivem de propósito: o `default` inalcançável da rota da tela, e o reenvio pela tela de uma linha `failed` apagada (não é requisito; o token não reenvia).
  Na 1ª rodada o revisor tinha achado 41 trocas que atravessavam a suíte inteira; viraram teste.
- **Contra o banco local** (`next dev` da worktree, tokens criados e apagados no fim), 45 verificações, em duas partes. Nenhuma mensagem saiu para o WhatsApp.
  - Com a integração de dev (`demo.invalid`, que nem resolve): 502, a linha `failed` com o token e a chave; a mesma chave reusa a linha; outro texto é 422; a IA em conversa `human` é 409 sem gravar; a integração grava `system`.
  - Com um provedor de mentira em 127.0.0.1 (a URL da integração de dev é trocada só durante o teste e devolvida no fim):
    - a conexão cai depois de o pedido chegar: 504, a linha fica `pending`, e cinco repetições depois o provedor segue com UM pedido recebido;
    - confirmada a entrega (como o webhook faria), a mesma chave responde 200 e passa a contar como 1ª resposta da IA;
    - 500 genérico e 502 de proxy: 504, sem reenvio;
    - recusa do WhatsApp: 502 e `failed`; com o provedor de volta, a mesma chave vira 201 na mesma linha;
    - 500 com `No session`: 502 e `failed`;
    - corpo `null` no 2xx: 201;
    - conversa assumida no meio: a 2ª mensagem da IA é 409, e a chave da 1ª ainda devolve a mensagem.
- **Revisão adversarial** (3 revisores independentes, cada um conferindo rodando). Corrigidos:
  - **grave (segurança):** falha de desfecho desconhecido virava `failed`, e a API mandava repetir: mensagem em dobro. É a regra do "no máximo uma vez";
  - a IA respondendo depois de o analista assumir (o status era lido antes de tudo; o plano pedia a conferência no envio);
  - a mesma chave com outro texto: mandava o texto antigo e respondia como se fosse o novo;
  - o "Tentar novamente" da tela reenviando a mensagem da IA, com a conversa já em `human`;
  - o 200 com `pending` guardado por 24 h para uma mensagem que podia nunca ter saído;
  - a repetição de uma mensagem que já saiu respondendo 409 depois de a conversa mudar de dono;
  - só o teto por minuto, que em janela fixa deixa passar o dobro na virada;
  - 504 "pode ter saído" quando a URL da integração era recusada antes de qualquer pedido;
  - credencial ilegível respondendo 500 em vez de 503;
  - os textos do OpenAPI: o 201 nem sempre traz `sent`, "nunca manda de novo" tinha exceção, e o exemplo do "número desconectado" não estava medido.
  A rota da tela não teve regressão apontada.
- typecheck ✓ · lint ✓ (só os 9 avisos antigos) · test ✓ (3369 na máquina; no CI são 3 a menos, pelo teste velho de `.next/standalone`) · build ✓.
- As skills `bug-hunter` e `verification-before-completion` não estão instaladas neste ambiente; no lugar delas ficaram a revisão adversarial e os quatro comandos rodados.

**Pendências / próximos passos:**
- **PR 10c (tela):**
  - "IA" ou "Automático" na mensagem de token, e a assinatura da nota sem autor usuário;
  - rótulo de `ticket.handoff_requested` e `sent_by_token_id` na timeline;
  - tirar o "Tentar novamente" da mensagem de token (o servidor já recusa);
  - quem apaga e quem edita a mensagem da IA. Hoje qualquer analista edita por 15 minutos, e a linha segue assinada pelo token com um texto que ele não escreveu.
- **Conciliar o desfecho desconhecido.** A uazapi tem `POST /message/find` com `track_id`: dá para perguntar se a mensagem existe lá e resolver a linha `pending` nos dois sentidos. Hoje ela só anda pelo webhook:
  - se o provedor não enviou, fica `pending` para sempre;
  - o tick casa pelo `external_id`, que nessa linha só existe depois do eco. Um `Sent` que chegue antes do eco se perde, e a linha só anda no `Delivered`. Com o cliente offline, a mesma chave responde 504 por horas para uma mensagem que saiu.
- **Medir o `/send/text` com a instância deslogada.** O spec não diz o que ele devolve; nas outras rotas é `No session`, com 401 ou 500. Se for o 500 genérico, cada mensagem da IA durante uma desconexão fica `pending` e não sai depois de reconectar. Medir com uma instância de teste, nunca com a de produção.
- **A tela ainda tem a janela antiga:** resposta que se perde vira `failed`, e o "Tentar novamente" pode entregar em dobro. Fechar pede um estado de "não confirmado" na bolha.
- **`redirect: "error"` no `fetch` do provedor.** Hoje um redirecionamento levaria o cabeçalho `token` a outro host e passaria pela guarda de URL. Vale para todos os envios; PR próprio.
- **Decisões para o dono:**
  - `{{...}}` no texto: a uazapi troca `{{name}}`, `{{first_name}}`, `{{lead_*}}` antes de entregar, e o spec não mostra como desligar. O CRM grava o texto pedido. Vale para a tela também. Opções: neutralizar o marcador, recusar ou só avisar (hoje a API avisa na descrição do campo).
  - os tetos (20 por minuto e 100 por hora, por conversa e por token) e a falta de um teto entre conversas: um token em laço ainda alcança muitas conversas, limitado só pelo limite de requisições dele;
  - a integração (`system`) envia em qualquer status de conversa, inclusive com um analista atendendo;
  - o analista não reenvia a mensagem que falhou de um token (pode copiar o texto e enviar como dele).
- **Erro do provedor no log:** `[send] provider send failed:` imprime até 200 caracteres do corpo de erro da uazapi, que pode trazer o número. Já era assim na tela.
- **O corpo guardado da idempotência traz o texto da mensagem** por 24 h. A limpeza da tabela é da Fase 6.
- **Contato anonimizado:** o envio não confere, como as leituras de conversa. Ainda não existe fluxo que anonimize.

**Armadilhas descobertas:**
- **"Falhou" não é "não saiu".** Demora, conexão que cai e 5xx de proxy acontecem depois de o provedor ter recebido o pedido. Quem repete sozinho (um programa) não pode tratar isso como falha.
- **A referência da uazapi mudou de versão** (2.4.2, 148 rotas; a skill dizia 2.1.1). O 500 do `/send/text` ganhou a forma com `error_source`, e o campo `text` aceita placeholders. Baixe o `openapi-bundled.json` antes de decidir o que um erro quer dizer.
- **Um 422 guardado toma a chave de idempotência.** Todo 422 que quer dizer "esta chave é de outro pedido" tem de liberar a chave.
- **`vi.mock` de um módulo inteiro esconde o export novo dele.** O helper passou a importar `uazapiSendDefinitelyFailed` de `senders/uazapi`; o teste que troca o módulo por `{ sendUazapiText }` só não quebra enquanto ninguém chama o export que falta. Use `importOriginal` e troque só o que fala com a rede.
- **Dois limites em janela fixa avaliados juntos contam o que o outro barrou.** O teto da hora só pode ser consultado depois de o do minuto deixar passar.
- **Roteiro de mutação morto no meio deixa o mutante no arquivo.** Uma execução em segundo plano foi encerrada pelo limite de tempo e deixou `"validation_error"` no lugar de um código. O roteiro agora guarda o original em disco, restaura no sinal e na partida seguinte, e roda só os testes do PR.
- **O ponta a ponta precisa de um provedor de mentira para o desfecho desconhecido.** O `demo.invalid` só produz "a conexão nem abriu". Um servidor em 127.0.0.1 que recebe o pedido e derruba a conexão cobre o resto, e conta quantos pedidos chegaram.
- **Certificado recusado pode chegar como `ECONNRESET`.** Contra um site público de teste, o certificado vencido e o autoassinado vieram assim; com servidor local vieram `CERT_HAS_EXPIRED` e `DEPTH_ZERO_SELF_SIGNED_CERT`. `ECONNRESET` fica como desconhecido, porque também acontece no meio do pedido.
- **Revisor que muta arquivo precisa de cópia própria.** Um revisor esperou o worktree parar por três minutos para mutar no lugar, enquanto eu esperava por ele. Diga no pedido: cópia de `src/` com symlink de `node_modules`, e vitest com `--root`.
- **Mais um teste de tela instável sob carga:** `src/features/tickets/components/ticket-detail.test.tsx` (um `waitFor`), visto uma vez com a máquina carregada. Fora deste PR.

## [2026-10-01] Fase 5 · PR 10a: conversas na API v1 (ler, handoff e ticket em foco)

**Agente/Modelo:** Claude Opus 5.5.
**Objetivo:** A IA e os integradores leem a conversa e as mensagens, passam a conversa para um humano e escolhem o ticket em foco pela v1. Nada aqui envia mensagem ao WhatsApp.
**Arquivos alterados:**
- `src/app/api/v1/conversations/[id]/route.ts`, `messages/route.ts`, `handoff/route.ts` e `active-ticket/route.ts` (novos), com `src/app/api/v1/conversations.test.ts`;
- `src/features/chat/queries/get-api-conversation.ts` e `src/features/chat/lib/conversation-status.ts` (novos, o segundo com teste);
- `src/lib/api/v1/conversations.ts`, `cursor.ts` (com teste), `openapi.ts` e `tickets.ts`;
- `src/features/tickets/server/ticket-service.ts`, `lib/map-ticket-error.ts` (os dois com teste) e `types.ts`;
- `src/app/api/v1/api-v1-guards.test.ts` (varredores novos, que valem para toda rota da v1);
- `PRD.md`, `docs/PLANO-FASE-5.md`, este PROGRESS.

**O que foi feito:**
- **`GET /conversations/{id}`** (`conversations:read`): quem conduz, o ticket em foco e o contato. Só lê: não marca como lida.
- **`GET /conversations/{id}/messages`** (`conversations:read`): da mais nova para a mais antiga, com cursor próprio e `limit` de 1 a 200. Traz o token ou o usuário que enviou. Sem mídia por URL.
- **`POST /conversations/{id}/handoff`** (`conversations:handoff`, com Idempotency-Key): chama `conversation_handoff` e devolve o resultado do pedido (`conversation_id`, `status`, `changed`, `ticket_id`, `note_id`). Conversa resolvida é 409 `conversation_not_owned_by_ai`, com `current`.
- **`PUT /conversations/{id}/active-ticket`** (`tickets:write`): chama `ticket_set_active` e devolve o foco que ficou.
- **`handoffConversation`** em `ticket-service.ts`, ao lado do "Assumir": mesma tradução de erros, mesmo aviso ao agente quando a conversa passa a `human`, e o telefone do canal nunca sai dali.
- **Mapa de erros:** `CONVERSATION_NOT_OWNED_BY_AI` (409, com o status da conversa lido do HINT), `INVALID_HANDOFF` (400) e `INVALID_SENDER` (500). O teste do mapa passou a conferir as TAGs das duas migrations.
- **`cursor.ts`:** um codec só para o par (instante, id); o cursor das mensagens é o `m1`, e o de cadastro (`v1`) não vale nele.

**Decisões tomadas:**
- **PR 10 dividido em dois.** O 10a é o que não envia nada ao WhatsApp. O envio da IA mexe na rota de envio da tela (ponto sensível) e vai sozinho no 10b, com os rótulos na tela.
- **As escritas devolvem o resultado da operação, não a conversa.** A 1ª versão relia a conversa e a devolvia inteira. Os revisores mostraram que um token só com `tickets:write` ou só com `conversations:handoff` passava a ler status, contato e datas sem `conversations:read`. Sem a releitura também some o 503 depois de a escrita já ter valido.
- **Nota interna só com `comments:read`,** como na timeline: o corte é na consulta, para não furar a paginação. A IA não lê a própria nota de handoff.
- **O foco exige `tickets:write`,** não um escopo de conversa: é o foco que decide em que ticket a mensagem cai, e abrir ticket (mesmo escopo) já o move.
- **O `note_id` sai na resposta do handoff e na trilha do ticket.** É só um id: sem `comments:read` e `conversations:read` não há como ler a nota.
- **Conversa arquivada ou removida é devolvida no GET,** como no `/context`: remover só tira da caixa de entrada.
- **`PUT` sem Idempotency-Key:** pôr o mesmo foco de novo já é no-op.

**Verificação:**
- **Rotas:** 95 casos em `conversations.test.ts`, com as respostas conferidas contra os schemas publicados e os filtros conferidos na consulta.
- **Varredores da v1** (`api-v1-guards.test.ts`), agora para as 34 rotas:
  - o log leva o molde da rota;
  - o escopo e a Idempotency-Key que o OpenAPI anuncia são os que a rota exige;
  - todo caminho e método do OpenAPI tem rota;
  - todo `$ref` aponta para um componente que existe, e todo componente é usado.
- **Mapa de erros:** o teste lê todas as migrations de `_tickets` em diante. Uma TAG nova sem entrada no mapa reprova, em vez de virar 500 em produção.
- **Mutação:** 93 trocas no código do PR (rotas, consulta, schemas, cursor, serviço, mapa de erros, OpenAPI). Nenhuma sobreviveu. O 3º revisor tinha achado 22 que atravessavam a suíte; todas viraram teste.
- **Contra o banco local** (`next dev` da worktree, tokens criados e apagados no fim), 41 verificações:
  - leitura da conversa sem telefone nem nome, e só com as chaves do contrato;
  - mensagens paginadas sem repetir nem pular; a nota do time só para o token com `comments:read`;
  - foco: troca, no-op, `null`, ticket de outra conversa (422);
  - handoff: nota e evento gravados uma vez só apesar das repetições; a mesma chave repete a resposta (`Idempotent-Replayed`), e outro corpo com a mesma chave é 422; conversa resolvida é 409 com `current`; conversa arquivada sai do arquivo;
  - um token só com `conversations:handoff` passa a conversa e não recebe nenhum dado dela; o `GET` com ele é 403;
  - o corpo guardado da idempotência não tem o telefone;
  - as 30 chamadas ficaram em `integration_logs` com o molde da rota.
  Nenhuma URL de agente estava configurada no servidor de teste: nada saiu para fora.
- **Revisão adversarial** (3 revisores independentes): nenhum defeito de comportamento. Corrigidos:
  - a conversa devolvida a quem não tem o escopo de leitura, e o 503 depois da escrita;
  - os textos do OpenAPI (ordem das mensagens, chave nova a cada handoff, 403 de token revogado no meio da chamada);
  - as lacunas de teste. A mais séria: a regra da nota interna em `/messages` só era medida com os escopos padrão do arnês, e liberá-la para `comments:write` (que a IA tem) passava. Agora há uma tabela de escopos.
- typecheck ✓ · lint ✓ (só os 9 avisos antigos) · test ✓ (3177) · build ✓.

**Pendências / próximos passos:**
- **PR 10b:**
  - `send-outbound.ts` e `POST /conversations/{id}/messages`, com o 409 em conversa que não é `bot`;
  - na tela: rótulo de `ticket.handoff_requested`, assinatura da nota sem autor usuário e "IA" na mensagem da IA;
  - `sent_by_token_id` nos itens de mensagem da timeline (hoje só `GET /messages` o traz);
  - quem apaga a nota da IA (proposta: admin apaga, ninguém edita).
- **Teto do corpo nas escritas sem Idempotency-Key** (este `PUT`, `PATCH` de ticket e de contato, `transitions`, `assign`): o `withApi` só confere o Content-Length. Sem ele (corpo em pedaços), o JSON é lido inteiro, até o limite de 64 MB do servidor. Em produção o nginx repassa com Content-Length, e o teto de 1 MB vale. Fechar no `withApi`, num PR próprio.
- **Decisões para o dono:**
  - um token com `conversations:handoff` pode passar qualquer conversa `bot` para um humano; o único freio é o limite de requisições do token, e a volta é pela tela, uma por vez;
  - o foco pode ser trocado pela API mesmo com a conversa em `human` (abrir ticket já fazia isso). Restringir a IA à conversa `bot` valeria para as duas rotas.
- **Contato anonimizado:** `/context` e `/contacts` o escondem; `GET /conversations/{id}`, `/messages` e a timeline não conferem. Ainda não existe fluxo que anonimize; quando existir, essas leituras entram junto.
- **Limites de texto contam unidades UTF-16,** não caracteres: um motivo com 251 emojis é recusado como "acima de 500". Vale para título, descrição e comentário também.
- **O `pattern` de uuid no OpenAPI sai sem a opção de ignorar caixa:** a API aceita maiúsculas e o schema publicado não. Vale para todos os campos de id da v1.
- **Teste de tela instável:** `contact-info-sheet.test.tsx`, "toque fora com o Novo ticket sujo…". Digita no título antes de o catálogo carregar, e com a máquina carregada só a 1ª letra fica. Falha também sem este PR. Corrigir à parte.

**Armadilhas descobertas:**
- **Devolver o recurso relido numa escrita é dar a leitura dele.** Se a rota de escrita tem escopo próprio, o token passa a ler sem o escopo de leitura, mesmo quando nada muda. Devolva o resultado da operação.
- **Idempotency-Key guarda o `changed: false` por 24 h.** Uma IA que derive a chave da conversa recebe o replay mesmo depois de a conversa voltar para `bot`. Chave nova a cada pedido.
- **`created_at` da mensagem não é a hora de chegada.** Na entrada é a hora do provedor; na saída, a do servidor. Quem sincroniza relendo "até a primeira mensagem conhecida" perde a que chegou atrasada.
- **O arnês de teste da v1 devolve a mesma linha para qualquer consulta.** Um caso só prova um filtro se conferir a cadeia (`has`, `where`); e "a rota não lê X" se confere com `h.chains.X` indefinido.
- **`next build` com o `next dev` da mesma pasta rodando:** pare o servidor de teste antes.
- **O `vitest` roda um teste velho de dentro de `.next/standalone`** (cópia que o build deixa; o `vitest.config.ts` não tem `exclude`). Na máquina, a contagem vem com 1 arquivo e 3 testes a mais que no CI. Não é deste PR.
- **Teste do arnês só com os escopos padrão não mede regra de escopo.** `h.reset([...])` dá todos os escopos do arquivo a todo caso: "sem o escopo X" e "com escopo a mais" precisam trocar `h.scopes` no próprio caso.

## [2026-10-01] Fase 5 · PR 9: banco das conversas da IA (autoria por token e handoff)

**Agente/Modelo:** Claude Opus 5.5.
**Objetivo:** O banco passa a saber qual token escreveu cada mensagem e ganha a operação que passa a conversa da IA para um humano. Nenhuma rota nem tela muda neste PR.
**Arquivos alterados:**
- `supabase/migrations/20261001120000_conversas_ia.sql` (nova);
- `supabase/tests/conversas.sql` (novo);
- `supabase/tests/api.sql`, `baseline.sql`, `cadastros.sql`, `segredo_integracao.sql` e `tickets.sql` (só a linha do portão final);
- `src/lib/supabase/database.types.ts` (gerado);
- `docs/PLANO-FASE-5.md`, este PROGRESS.

**O que foi feito:**
- **`chat_messages.sent_by_token_id`:** o token que escreveu a mensagem. FK para `api_tokens` com restrict, índice parcial, no máximo um autor por mensagem, e fora do UPDATE do app (a autoria não muda depois do INSERT).
- **Remetente amarrado ao tipo do token** (trigger `trg_chat_messages_guard_token_author`): token `ai` escreve como `ai`; token `api`, como `system`. Qualquer outro par é `INVALID_SENDER`.
- **RPC `conversation_handoff(conversa, token, motivo, resumo?, ticket?)`:**
  - trava a conversa e passa de `bot` para `human`;
  - conversa já `human` devolve `changed=false` e não grava nada;
  - conversa `resolved` é `CONVERSATION_NOT_OWNED_BY_AI`, com o status no HINT;
  - o ticket informado tem de ser da conversa e não terminal; sem ele, vale o ticket em foco;
  - deixa uma nota interna no chat, assinada pelo token, com o motivo e o resumo;
  - registra `ticket.handoff_requested` na trilha do ticket, só com o motivo e o id da nota. A nota e o evento ficam no mesmo ticket;
  - traz a conversa de volta para a caixa de entrada, se estava arquivada ou removida.
- **`create_ticket`** deixou de contar nota da IA como 1ª resposta da IA ao vincular as mensagens soltas. É a mesma função de `20260929170000`, com uma linha a mais.
- **`set local lock_timeout = '5s'`** no topo da migration: se algo estiver segurando `chat_messages`, ela desiste sem mudar nada, em vez de deixar o chat na fila atrás do `ALTER TABLE`.
- **Portão dos testes SQL:** `where not ok` virou `where ok is not true` nos seis arquivos (ver Armadilhas).

**Decisões tomadas:**
- **O resumo não vai para a trilha do ticket.** O plano dizia "grava `ticket_event`", e a 1ª versão guardava motivo e resumo no `metadata`. A revisão mostrou o problema: a trilha é append-only (nem o dono apaga) e sai inteira para quem tem `tickets:read`. Um resumo que cite um CPF colado pelo cliente ficaria para sempre, mesmo depois de a mensagem ser apagada. `ticket_update` já seguia essa regra: registra a troca de descrição só como `{"changed": true}`. O motivo curto fica na trilha, como o motivo de uma mudança de status.
- **Nota interna como lugar do motivo e do resumo.** É onde o analista lê ao assumir, vale com ou sem ticket, não vai ao cliente, não vira prévia nem não-lida, e o banco permite apagá-la (`is_deleted` zera o texto). A nota também é o registro de quem pediu o handoff numa conversa sem ticket (o `integration_logs` guarda só o molde da rota, sem o id da conversa).
- **O handoff desarquiva e restaura a conversa.** A lista da tela só mostra arquivada na caixa "Arquivadas", e mensagem do cliente não desarquiva. Sem isso, a IA parava de responder e o pedido ficava onde ninguém olha. O no-op (conversa já humana) não mexe: se está arquivada, foi o time que arquivou.
- **Com ticket informado, a nota vai para ele,** e não para o ticket em foco: quem abre o ticket vê o pedido e o resumo juntos. É a única mensagem que não nasce no foco.
- **O motivo fica também na trilha, apesar de ser texto livre.** É curto (500), da mesma classe do motivo de uma mudança de status, e é o que a própria IA relê depois: o preset dela não lê notas.
- **Handoff em conversa já humana é sucesso sem efeito, não erro.** O que a IA queria já aconteceu. Em conversa resolvida é erro: quem a devolve à IA é uma mensagem nova do cliente.
- **Entrada errada é erro em qualquer estado:** ticket de outra conversa ou encerrado falha mesmo com a conversa já humana.
- **`'ai'` sem token continua aceito.** Exigir o token barraria um dia classificar como `ai` o eco de uma IA que ainda envia direto pela uazapi (D2). O envio pela API (PR 10) tem um caminho só, e ele grava o token.
- **A coluna nova sai no Realtime para o operador logado,** como `ticket_id`: o SELECT de `authenticated` em `chat_messages` é de tabela. É só o id do token; `api_tokens` não tem grant nem policy para `authenticated` (caso P06).
- **O portão dos outros cinco arquivos de teste entrou neste PR,** fora do escopo original: é uma linha por arquivo, e os cinco seguem verdes com o portão estrito.

**Verificação:**
- **SQL:** 70 casos novos em `conversas.sql`. Com o portão estrito: `tickets.sql` 164, `api.sql` 44, `cadastros.sql` 63, `baseline.sql` 52 e `segredo_integracao.sql` 7. Os dois últimos exigem banco sem integração: no banco local rodaram com a integração de dev apagada dentro da própria transação, que termina em ROLLBACK.
- **Migration:** aplicada no banco local; o arquivo rodado uma 2ª vez inteiro não muda nada; o script reaplicado dá "0 migration(s)"; `lock_timeout` não vaza da transação.
- **`create_ticket`:** diff programático contra o corpo de `20260929170000`: uma linha. O corpo daquele arquivo é igual ao que estava no banco.
- **Mutação:** 79 mutantes da migration (entrada, ordem das checagens, ticket, estado, caixa de entrada, evento, nota, resposta, privilégios, trigger, constraints, `create_ticket`). Nenhum sobreviveu, todos pegos pelo código de saída do arquivo, como o CI vê. Na 1ª versão, um sobrevivente (`updated_at`) virou teste.
- **Corrida, com duas sessões psql** (A segura a transação 3 s; B entra 1 s depois):

  | Corrida | Resultado |
  |---|---|
  | dois handoffs na mesma conversa | B espera 2 s e sai com `changed=false`; 1 nota e 1 evento |
  | conversa resolvida: mensagem do cliente (A) × handoff (B) | B espera; a conversa já voltou para `bot`; `changed=true` |
  | handoff (A) × mensagem do cliente (B) | a mensagem espera, cai no ticket em foco, e a conversa segue `human` |
  | handoff (A) × Assumir (B) | Assumir devolve `conversation_changed=false` |
  | Assumir (A) × handoff (B) | `changed=false`, sem nota nem evento |
  | ticket em foco cancelado (A) × handoff sem ticket (B) | `changed=true`, `ticket_id` nulo |
  | ticket cancelado (A) × handoff com esse ticket (B) | `TICKET_TERMINAL`; a conversa segue `bot` |
  | contato renomeado × handoff de conversa arquivada, nos dois sentidos | o segundo espera; a conversa sai do arquivo; sem deadlock |

  Tudo o que a prova criou foi apagado no fim (0 conversas, contatos, tokens e usuários de sobra).
- **Revisão adversarial** (3 revisores independentes, e um 4º só para o que mudou depois deles): nenhum defeito grave na função. Corrigidos:
  - o resumo na trilha;
  - o remetente solto do tipo do token;
  - a nota da IA contando como 1ª resposta na abertura do ticket;
  - o portão que ignorava asserção nula;
  - a falta de `lock_timeout`;
  - handoff de conversa arquivada, que ficava fora da caixa de entrada;
  - a nota num ticket e o evento em outro;
  - as lacunas de teste apontadas.
- typecheck ✓ · lint ✓ (só os 9 avisos antigos) · test ✓ (2972) · build ✓. Os tipos regenerados batem com o arquivo.

**Pendências / próximos passos:**
- **PR 10** (rotas de conversa da v1):
  - mapear `CONVERSATION_NOT_OWNED_BY_AI` (409, com o status do HINT) e `INVALID_HANDOFF` (400) em `mapTicketError`. Hoje cairiam em 500. `INVALID_SENDER` é bug do app, e 500 está certo;
  - o serviço remonta a resposta campo a campo. `conversation_external_id` é o telefone do canal: serve para avisar o agente e nunca sai na API nem fica em `api_idempotency_keys`;
  - a rota deriva o `sender_type` do tipo do token;
  - rótulo de `ticket.handoff_requested` na timeline e assinatura na nota sem autor usuário. Hoje aparecem "Atividade registrada" e "Nota interna" sem nome;
  - `sent_by_token_id` nos DTOs de mensagem; nota em `GET /messages` só com `comments:read`, como na timeline;
  - **quem apaga a nota da IA.** Hoje ninguém, pela tela: a regra é "só o autor", e o autor é um token. Proposta: admin apaga nota de token; ninguém edita. Até lá, o resumo só sai por SQL;
  - guia da IA: despedir-se do cliente ANTES do handoff (depois dele, o envio responde 409); `changed: false` não traz o ticket; ticket errado é erro mesmo com a conversa já humana;
  - atualizar a skill `uazapi-integration` (modelo de dados) quando a IA passar a enviar pela API.
- **Aplicar em produção** só com "pode subir", junto dos PRs 3 a 8b. Se a migration falhar com `lock timeout` (55P03), nada mudou: basta rodar de novo, fora do horário do backup (03:30 UTC).
- O `btrim` do banco só tira espaço: motivo feito só de tab ou quebra de linha passa como não vazio. A rota do PR 10 precisa do `trim()` do zod.

**Armadilhas descobertas:**
- **O portão dos testes SQL deixava passar asserção nula.** `r.ok` aceita NULL e o portão era `where not ok`, que descarta NULL. A listagem mostrava `FALHA`, mas o arquivo saía com 0 e o CI ficava verde. Uma comparação com um lado nulo (`(j ->> 'ticket_id')::uuid = v_a` sem o ticket) caía nisso. Use `ok is not true`, e `is not distinct from` quando um lado pode ser nulo.
- **Texto longo vindo da conversa não entra em tabela append-only** (`ticket_events`, `ticket_status_history`, `contact_events`): não há como apagar depois, e a trilha do ticket sai inteira para `tickets:read`.
- **Nota com `sender_type='ai'` contava como 1ª resposta da IA em `create_ticket`.** O trigger de INSERT ignora nota, mas o vínculo das mensagens soltas só ignorava no ramo humano. Estava inalcançável enquanto nada gravava `ai`.
- **RPC que trava a conversa pode inserir NOTA, não mensagem comum.** A nota não toca em `contacts`. Uma mensagem comum tocaria (`touch_contact_from_inserted_message`), e aí a ordem ficaria conversa → contato, o inverso de quem renomeia o contato: deadlock.
- **Trigger BEFORE roda antes dos CHECKs.** Com o trigger de autoria, um CHECK para o mesmo caso ficava inalcançável; ficou só o trigger.
- **"No space left on device" no Postgres local é o disco da VM do Docker** (32 GB, dividido entre todos os projetos da máquina), não a migration. O `crm-suporte-db` entra em reinício contínuo até sobrar espaço.
- **`baseline.sql` e `segredo_integracao.sql` falham num banco local que já tem integração `uazapi`** (inserem a deles). No CI o banco nasce vazio. Para rodá-los localmente: `begin; delete from public.chat_integrations where provider = 'uazapi';` antes do arquivo; o `rollback` do próprio arquivo desfaz.

## [2026-10-01] Fase 5 · PR 8b: comentário, anexo e timeline do ticket na API v1

**Agente/Modelo:** Claude Opus 5.5.
**Objetivo:** A IA e os integradores comentam, anexam arquivo e leem o histórico de um ticket pela v1.
**Arquivos alterados:**
- `src/app/api/v1/tickets/[ref]/comments/route.ts`, `attachments/route.ts`, `attachments/[attachment_id]/route.ts` e `timeline/route.ts` (novos), com `ticket-activity.test.ts`;
- `src/lib/api/v1/ticket-activity.ts` (novo), `with-api.ts` e `idempotency.ts` (com testes), `scopes.ts`, `conversations.ts` e `openapi.ts`;
- `src/features/tickets/server/ticket-comment.ts` e `ticket-attachment.ts` (novos), extraídos de `src/app/api/tickets/[id]/comments/route.ts` e `attachments/route.ts`;
- `src/features/tickets/queries/get-ticket-timeline.ts` (fontes por opção), `get-api-ticket.ts`, `lib/ticket-timeline.ts`, `types.ts`;
- `src/lib/storage/ticket-attachments.ts` (comentário);
- `supabase/tests/tickets.sql`;
- `PRD.md`, `docs/PLANO-FASE-5.md`, este PROGRESS.

**O que foi feito:**
- **`POST /tickets/{ref}/comments`** (`comments:write`): comentário interno com o token como autor.
- **`POST /tickets/{ref}/attachments`** (`attachments:write`): multipart, só o campo `file`, até 50 MB.
- **`GET /tickets/{ref}/attachments/{attachment_id}`** (`attachments:read`): URL assinada de 10 min, com nome, tipo e tamanho, sem cache.
- **`GET /tickets/{ref}/timeline`** (`tickets:read`): do mais novo para o mais antigo, com cursor opaco.
- **Idempotência com multipart:** o hash é das partes (nome; do arquivo, nome, tipo, tamanho e sha256 lido em pedaços), não do corpo cru.
- **`withApi`:**
  - tipo de corpo por rota (`body: "json" | "multipart"`): o outro tipo é 415 sem ler o corpo nem reservar a chave;
  - teto pelo Content-Length antes de ler: 1 MB por padrão, 50 MB + 64 KiB no anexo. Sem Content-Length, a leitura do JSON para no teto;
  - o multipart é lido uma vez só e chega ao handler em `ctx.form`;
  - caminho acima de 512 caracteres é 404 antes da idempotência.
- **A escrita de comentário e de anexo virou serviço**, com o ator vindo de fora (usuário ou token). As rotas de sessão passaram a chamá-los, sem mudar de comportamento.

**Decisões tomadas:**
- **Escopo novo `comments:read`, fora do preset da IA.** A timeline junta dados de recursos diferentes, e cada um só entra com o escopo dele:
  - `tickets:read`: trilha (status e eventos) e anexos;
  - `conversations:read`: mensagens da conversa;
  - `comments:read`: comentários internos;
  - os dois últimos juntos: nota interna no chat.
  Sem isso, a IA (que tem `tickets:read`) leria o comentário e a nota do time, o que o `/context` já evitava. O corte é na consulta, para não furar a paginação.
- **O link do anexo vem no corpo (JSON), não como redirect:** o integrador vê nome, tipo, tamanho e vencimento.
- **`{attachment_id}` em snake_case**, como o resto do contrato.
- **Tolerância ao multipart do .NET ficou para decisão do dono** (ver Pendências).

**Verificação:**
- **Rotas de sessão:** um revisor comparou `origin/main` e a worktree em 47 cenários (status, corpo byte a byte, logs e sequência de consultas): idênticas. A única diferença, a cópia do arquivo antes de conferir o ticket, foi corrigida.
- **Contra o banco e o storage locais:**
  - comentário e anexo gravados uma vez só mesmo com a repetição;
  - multipart reenviado com outro boundary reconhecido como o mesmo pedido, e outro arquivo com a mesma chave dando 422;
  - arquivo de 51 MB recusado com 413 em 30 ms, sem reservar a chave;
  - o arquivo baixado pelo link idêntico ao enviado, e o anexo de outro ticket dando 404;
  - a timeline só com `tickets:read` trouxe trilha e anexo; com `conversations:read`, as mensagens; com `comments:read`, os comentários.
  Depois, tudo removido (linhas e objeto do storage) e o token revogado.
- **SQL:** 4 casos novos em `supabase/tests/tickets.sql` (comentário e anexo com token como autor; dois autores recusados). 164 casos ok.
- **Mutação:** 19 garantias na 1ª rodada e 21 nas correções da revisão. Todas pegas; a única sobrevivente da 1ª rodada virou teste.
- **Revisão adversarial** (3 revisores independentes; o modo de orquestração em massa estava desligado): nenhum achado grave. Corrigidos:
  - o hash de multipart valia para toda rota idempotente, e as rotas JSON tinham perdido o 415;
  - o 413 só saía depois de ler e hashear o corpo, que era lido duas vezes;
  - a timeline entregava mensagens, comentários e notas só com `tickets:read`;
  - falha de leitura no comentário era 500 pelo uuid e 503 pelo protocolo;
  - cursor com o ano 0000 e `ref` muito longo viravam erro do servidor;
  - `expires_at` do link era calculado depois de assinar;
  - vocabulário duplicado e textos do OpenAPI.
- typecheck ✓ · lint ✓ (só os 9 avisos antigos) · test ✓ (2972) · build ✓.

**Pendências / próximos passos:**
- **Decisão do dono: clientes .NET no upload.** O parser de multipart do Node 22 só aceita `name="file"` e `filename="..."` entre aspas, sem `filename*`. O `HttpClient` do .NET manda sem aspas e com `filename*`, e recebe 400 `invalid_multipart` (a mensagem diz o motivo, e o OpenAPI documenta). curl, requests e n8n funcionam. Tolerar exige normalizar o cabeçalho antes do parse, ou aceitar o arquivo cru no corpo.
- **Comentário e anexo têm só a 1ª camada de idempotência.** Se o servidor cair entre gravar e responder, a repetição depois de 5 min grava de novo. Uma chave de dedupe na linha pede migration.
- PR 9 (banco das conversas da IA). **O `metadata` dos eventos sai inteiro na timeline:** o que o handoff gravar ali aparece para quem tem `tickets:read`.
- Deploy dos PRs 3 a 8b só com "pode subir", com a reinstalação do vhost do 6b.

**Armadilhas descobertas:**
- **`await reader.cancel()` numa metade de `request.clone()` nunca resolve** enquanto a outra metade não for cancelada. Num corpo acima do teto, a requisição ficaria pendurada. Cancele sem esperar.
- **O `formData()` do Node recusa `Content-Disposition` sem aspas ou com `filename*`** (TypeError "Failed to parse body as FormData"). Não é o cliente "mandando errado": é o parser.
- **Ler o corpo na camada de idempotência tem de vir depois do teto e do tipo.** Hashear antes de conferir o Content-Length é ler 64 MB para responder 413.
- **`isTimelineInstant` aceitava o ano 0000**, que o Postgres recusa: virava "tente de novo" para uma entrada que nunca passa. Vale para qualquer cursor com data.
- **Rota que junta dados de vários recursos precisa do escopo de cada um.** A timeline e o `q` de `/tickets` são o mesmo caso.
- **`git mv -k` num diretório não rastreado não faz nada e sai com sucesso.** Use `mv`.

## [2026-09-30] Fase 5 · PR 8a: tickets na API v1 (ler, abrir, editar, status, responsável)

**Agente/Modelo:** Claude Opus 5.5.
**Objetivo:** A IA e os integradores leem e conduzem tickets pela v1, sem abrir duplicado e sem sobrescrever a mudança de outro.
**Arquivos alterados:**
- `src/app/api/v1/tickets/route.ts`, `[ref]/route.ts`, `[ref]/transitions/route.ts` e `[ref]/assign/route.ts` (novos), com `tickets.test.ts`;
- `src/lib/api/v1/tickets.ts` (DTO, entradas, erros), `if-match.ts` (novo, com teste), `ticket-write.ts` (novo), `errors.ts` e `openapi.ts`;
- `src/features/tickets/queries/get-api-ticket.ts` (novo);
- `src/features/tickets/server/ticket-service.ts`: `createTicket` repassa `status`, `external_id`, `ai_triage` e responsável;
- `src/features/tickets/schemas/ticket.ts`: exporta `ticketFieldSchemas`;
- `src/features/tickets/lib/map-ticket-error.ts` e `types.ts`: os checks de `ai_triage` e `external_id` apontam o campo;
- `src/app/api/v1/test-harness.ts` (novo): o Supabase falso dos testes da v1, e `cadastros.test.ts` e `context.test.ts` migrados para ele;
- `PRD.md`, `docs/PLANO-FASE-5.md`, este PROGRESS.

**O que foi feito:**
- **Leitura** (`tickets:read`):
  - `GET /tickets` com cursor e filtros: status e prioridade (lista por vírgula), `is_terminal`, `sla_breached`, fila, responsável (ou `none`), empresa, contato, conversa, `q` e `updated_since`;
  - `GET /tickets/{ref}` por id ou protocolo, com `ETag: W/"<version>"`.
- **Escrita** (`tickets:write`), sempre com o token como ator:
  - `POST /tickets` com `Idempotency-Key` obrigatória. A chave vai também à RPC (`p_idempotency_key`, 2ª camada, por token e sem prazo), e o `external_id` é a 3ª. A origem é o tipo do token, e o token nunca assume;
  - `PATCH /tickets/{ref}`, `POST /tickets/{ref}/transitions` e `POST /tickets/{ref}/assign`, com If-Match obrigatório (D7): 428 sem ele, 412 com versão velha, e a atual volta no ETag e em `current_version`.
- **Resposta das escritas:** o ticket relido inteiro, mais `changed` (e `from`/`to` na transição). O no-op vem antes da versão, então repetir uma escrita que já valeu dá 200 com `changed: false`, não 412.
- **Erros das RPCs no envelope da v1:**
  - versão velha é 412;
  - chave ou `external_id` já usados em outra conversa é 422 `idempotency_key_reused`;
  - `validation` vira `validation_error`;
  - 409 `invalid_transition` traz `allowed` e `current`.

**Decisões tomadas:**
- **PR 8 dividido:** 8a (este) e 8b (comentários, anexos multipart e timeline).
- **`{ref}` aceita id ou protocolo**, também nas escritas: a IA fala em "ticket 1424".
- **`q` exige também `contacts:read` e `customers:read`:** a busca da view alcança o nome do contato e a razão social e o CNPJ da empresa, que o DTO de ticket não entrega. Sem os dois escopos, 403.
- **Referências na v1 são uuid ou null, nunca `""`.** A tela usa `""` como "select vazio"; na API, um `""` que tira a fila em silêncio é erro do cliente.
- **`ai_triage` só entra, não sai** (como na tela). O teto de 16 KB é medido como o banco mede o jsonb, e número em notação científica é recusado.

**Verificação:**
- **Contra o banco local, com as RPCs reais e um token `ai`:**
  - a abertura saiu com origem `ai` e ETag, e a repetição veio com `Idempotent-Replayed`;
  - a mesma chave com outro corpo deu 422, e o mesmo `external_id` com outra chave devolveu o ticket existente;
  - o PATCH sem If-Match deu 428, e a repetição com versão velha deu `changed: false`;
  - valor novo com versão velha deu 412 com `current_version`;
  - a transição inválida deu 409 com `allowed`, e responsável inexistente deu 422;
  - a trilha ficou com `actor_type ai` e o token.
  - Tudo desfeito depois: ticket, trilha, eventos e o foco da conversa restaurado; token de teste revogado.
- **Mutação:** 27 garantias na 1ª rodada, mais 19 nas correções da revisão. Todas pegas; as 3 que sobreviveram na primeira passada viraram teste.
- **Revisão adversarial:** 15 achados confirmados (8 problemas distintos), todos corrigidos; 5 refutados. Os principais:
  - o oráculo do `q` sobre contato e empresa;
  - o `external_id` repetido culpava a Idempotency-Key;
  - o `""` tirava fila, categoria, empresa ou responsável;
  - o teto do `ai_triage` era medido diferente do banco e o erro vinha sem campo;
  - textos do OpenAPI (o 409 de transição e o 404 do `{ref}`);
  - lacunas de teste.
- typecheck ✓ · lint ✓ (só os 9 avisos antigos) · test ✓ (2868) · build ✓.

**Pendências / próximos passos:**
- PR 8b (comentários, anexos multipart com o hash de corpo e timeline).
- Deploy dos PRs 3 a 8a só com "pode subir", com a reinstalação do vhost do 6b.

**Armadilhas descobertas:**
- **Repetição idempotente não traz os headers da resposta original** (`api_idempotency_keys` guarda status e corpo). Por isso a versão também vai no corpo (`data.version`), não só no ETag.
- **`create_ticket` levanta `IDEMPOTENCY_KEY_REUSED` tanto pela chave quanto pelo `external_id`**, sem dizer qual casou. A v1 cita os dois quando o corpo trouxe `external_id`.
- **`search_text` da `ticket_queue` não é só o título:** junta o nome do contato e o `search_name` da empresa, que tem o CNPJ. Filtro que parece inofensivo pode vazar dado de outro escopo.
- **O jsonb não mede como o `JSON.stringify`:** ele põe `": "` e `", "` e expande números. Para tetos em bytes, meça no formato do banco.
- **`const { a: _a, ...resto } = obj` para tirar uma chave deixa aviso de lint** (variável não usada). Liste as chaves que ficam.

## [2026-09-30] Fase 5 · PR 7: contexto da triagem (`GET /api/v1/context`)

**Agente/Modelo:** Claude Opus 5.5.
**Objetivo:** A IA recebe, numa chamada só e pelo telefone, tudo o que precisa para triar.
**Arquivos alterados:**
- `src/app/api/v1/context/route.ts` (novo), com `context.test.ts`;
- `src/features/integrations/server/triage-context.ts` (novo): o builder, que o relay v1 (PR 11) também vai usar;
- `src/lib/api/v1/context.ts`, `tickets.ts` e `conversations.ts` (novos), `cadastros.ts` e `openapi.ts`;
- `src/features/contacts/queries/find-contact-by-phone.ts` e `src/features/contracts/queries/get-current-contract.ts`, extraídos das rotas do 6b, que passaram a usá-los. O primeiro tem teste próprio;
- `src/features/tickets/queries/get-conversation-tickets.ts`: ganhou o aviso de corte (`truncated`), com testes;
- `PRD.md`, `docs/PLANO-FASE-5.md`, este PROGRESS.

**O que foi feito:**
- `GET /api/v1/context?phone=` exige o escopo `context:read`. Devolve:
  - contato, empresa e contrato atual (sem valor);
  - `contract_alert`: `sem_empresa`, `sem_contrato`, `suspenso`, `encerrado` ou null;
  - a conversa mais recente;
  - os tickets abertos dela com `allowed_transitions` e `open_tickets_truncated`;
  - os 5 últimos tickets encerrados do contato;
  - as 20 últimas mensagens, sem nota interna;
  - `ai_may_reply`, verdadeiro só com a conversa em `bot`.
- **Só lê:** não cria contato, não zera as não lidas e não mexe no foco (conferido no banco local).
- **Telefone desconhecido ou contato anonimizado:** 200 com `contact: null` e o resto vazio (D11).
- **Falha de qualquer leitura é 503 inteiro**, nunca contexto pela metade. A exceção é a matriz de transições: ela vira `allowed_transitions: null`, nunca `[]`.
- **DTOs novos de ticket, conversa e mensagem**, base dos PRs 8 e 10. O SLA sai por `lib/sla.ts`, a mesma regra da view `ticket_queue`. `media_url` não sai, porque é rota de sessão.
- **PRD:** registrada a visão do dono de 2026-09-30, "CRM operável 100% pela API": perfil de token decide o alcance, e as ações sensíveis ficam atrás de escopo de admin.

**Decisões tomadas:**
- **Nota interna fica fora das mensagens do contexto:** a IA não tem como repeti-la ao cliente se não a lê.
- **Tickets abertos são os da conversa mais recente** (o plano); os encerrados recentes são os do contato, em qualquer conversa.
- **`contract_alert` vem separado do `contract`**, que tem o mesmo formato de `/customers/{id}/contract`. O relay (PR 11) monta o `contract{status,alert}` dele a partir disso.
- **A matriz de transições é lida sozinha**, e não pelo `getTicketCatalog`: o catálogo inteiro são cinco leituras, e o contexto roda a cada mensagem.

**Verificação:**
- Testes: resposta no schema publicado; filtros e ordens de cada consulta conferidos; só leitura (nenhuma escrita em tabela nenhuma); 503 em cada leitura que falha; D11; alertas; `ai_may_reply`.
- **Mutação:** 32 garantias quebradas de propósito, todas pegas.
- **Contra o banco local:** os 4 contatos e um telefone desconhecido. O SLA vencido e as transições bateram com a view e com a matriz do banco, nenhuma conversa foi alterada, e o `integration_logs` ficou sem o telefone.
- **Revisão adversarial:** 9 achados confirmados, todos corrigidos; 6 refutados. Os principais:
  - `open_tickets` cortava em 20 sem avisar, e numa conversa com muitos resolvidos não fechados a IA acharia a lista completa. Agora há `open_tickets_truncated`;
  - os encerrados recentes eram ordenados por `updated_at`, que muda quando um analista é excluído. Agora é por `closed_at`;
  - a descrição de `sla.breached` enganava em ticket parado;
  - cinco lacunas de teste: entidade certa em cada leitura, ordens e desempates, falha da coluna do contato, e status desconhecido na matriz.
- typecheck ✓ · lint ✓ (só os 9 avisos antigos) · test ✓ (2764) · build ✓.

**Pendências / próximos passos:**
- PR 8 (tickets v1). É o 3º uso do builder falso do Supabase nos testes da v1: extrair para um helper.
- Deploy dos PRs 3 a 7 só com "pode subir", com a reinstalação do vhost do 6b.

**Armadilhas descobertas:**
- **Mudar um tipo compartilhado com o client espalha a edição por dezenas de testes de tela.** Para acrescentar um campo que só o servidor usa, estenda o retorno do servidor (`ConversationTicketsRead`), não o tipo do client.
- **Resolvido não é terminal e não se fecha sozinho até a Fase 6.** Toda lista de "abertos" pode crescer sem limite numa conversa antiga. Quem corta precisa dizer que cortou.
- **`updated_at` de ticket encerrado não é o encerramento:** a FK `on delete set null` de um analista excluído reescreve os tickets dele. Para "os mais recentes", use `closed_at`.

## [2026-09-30] Fase 5 · PR 6b: empresas e contatos na API v1

**Agente/Modelo:** Claude Opus 5.5.
**Objetivo:** A IA e os integradores leem empresas e contatos pela v1, com paginação estável, e acham ou criam um contato pelo telefone sem duplicar.
**Arquivos alterados:**
- `src/app/api/v1/contacts/route.ts` e `[id]/route.ts`, `src/app/api/v1/customers/route.ts`, `[id]/route.ts` e `[id]/contract/route.ts` (novos), com `cadastros.test.ts`;
- `src/lib/api/v1/cursor.ts` e `cadastros.ts` (novos, com `cursor.test.ts`), `responses.ts` e `openapi.ts`;
- `src/features/contracts/lib/contract-view.ts` (novo), extraído de `src/features/customers/queries/get-customer-detail.ts`;
- `deploy/nginx-host.conf`, `deploy/app-gateway.conf`, `deploy/README.md`;
- `docs/PLANO-FASE-5.md`, este PROGRESS.

**O que foi feito:**
- **Contatos** (`contacts:read` / `contacts:write`):
  - `GET /contacts` com `q` (nome), `phone` (igualdade exata, alias incluso, como a RPC), `customer_id`, `updated_since`, `include_archived` e cursor;
  - `GET /contacts/{id}`;
  - `POST /contacts` com `Idempotency-Key`: acha pelo telefone ou cria com `source: api`. Dá 201 se criou e 200 se já existia;
  - `PATCH /contacts/{id}`: nome, e-mail, observações e empresa. `phone` no corpo é 422 `phone_immutable`, e empresa arquivada ou inexistente é 422 `invalid_customer`.
  - Contato anonimizado nunca sai.
- **Empresas** (`customers:read`, só leitura):
  - `GET /customers` com `q`, `cnpj` (com ou sem máscara, dígito verificador conferido), `updated_since`, `include_archived` e cursor;
  - `GET /customers/{id}`;
  - `GET /customers/{id}/contract`: o contrato atual, sem valor nem dia de vencimento. `data: null` quando a empresa nunca teve contrato.
- **Cursor** (`cursor.ts`): opaco, sobre `(updated_at, id)` em ordem crescente, com `limit` de 1 a 200 (padrão 50) e `meta.next_cursor`.
- **Entrada validada por inteiro:** parâmetro desconhecido, malformado ou sem efeito é 400 `validation_error` com `fields`, nunca ignorado.
- **`access_log off` da v1 (D8):**
  - o vhost do host não grava access nem error log de `/api/v1/`, e o redirect da porta 80 é 308;
  - o appgw não grava o error log de `/api/v1/`.

**Decisões tomadas:**
- **Do dono (2026-09-29):**
  - o POST com o telefone de um contato arquivado devolve o contato como está, **sem desarquivar**;
  - o `name` do POST só preenche nome vazio; renomear é pelo PATCH.
- **`phone` do POST é gravado só com os dígitos**, DDI incluso, como o WhatsApp manda (`5511…`). A primeira versão gravava o número já normalizado (sem o 55), diferente dos contatos do WhatsApp; o teste contra o banco local pegou.
- **404 também para id malformado:** para o integrador, o recurso não existe.
- **`/contract` lê todos os contratos numa consulta só** e escolhe o vigente, senão o primeiro encerrado na ordem do selo. Com duas leituras separadas, uma troca de status entre elas responderia "nunca teve contrato".

**Verificação:**
- Testes das rotas: cada resposta no schema publicado no OpenAPI. Os **filtros que chegam ao PostgREST** são conferidos por um builder falso que grava a cadeia de cada `from()`.
- O varredor da v1 cobre as 5 rotas novas sozinho (identidade do `withApi`, 401, 403 sem escopo, método no OpenAPI).
- **Mutação:** 26 garantias na 1ª rodada e 20 na 2ª (as correções da revisão). Todas pegas, menos uma checagem redundante (dia do mês), que saiu do código.
- **Contra o banco local** (`next dev` da worktree, token de teste depois revogado, dados de teste removidos):
  - a paginação de 1 em 1 atravessou 6 páginas sem repetir nem pular, com dois contatos no mesmo `updated_at` (desempate por `id`) e o microssegundo preservado no cursor;
  - o POST ficou idempotente (replay com `Idempotent-Replayed`, 422 com outro corpo);
  - `phone` com máscara achou o contato, e o `/contract` das duas empresas bateu com o selo;
  - o `integration_logs` ficou sem query, sem id na rota e sem corpo.
- **nginx:**
  - `nginx -t` passou na 1.28 (host) e na 1.29 (appgw);
  - em containers descartáveis, `/api/v1/?phone=` não deixou linha em log nenhum, e a rota comum continuou registrada;
  - o POST em http recebeu 308.
- **Revisão adversarial** (6 dimensões, cada achado com 2 ou 3 céticos): 13 confirmados, todos corrigidos; 11 refutados. Os principais:
  - `q` sem token válido (`q=a`) devolvia a base inteira como se fosse o resultado; agora é 400;
  - o appgw ainda gravaria `?phone=` no log de erro durante o deploy;
  - o redirect 301 transformava POST em GET com 200;
  - cursor ou `updated_since` com data impossível (30/02, fuso +99:99, ano acima de 9999) virava 503 "tente de novo" em vez de 400;
  - NUL ou surrogate solto no nome virava 500;
  - `?constructor=1` sumia do `fields`.
- typecheck ✓ · lint ✓ (só os 9 avisos antigos de `verify-webhook.test.ts`) · test ✓ (2717) · build ✓.

**Pendências / próximos passos:**
- **Deploy dos PRs 3 a 6b só com "pode subir".** Este PR muda o vhost do host: depois do `publicar.sh`, reinstale-o como em `deploy/README.md` §Atualizar o vhost (backup, `crmsup.sh nginx https`, `nginx -t`, reload). O appgw é aplicado pelo próprio `subir`.
- PR 7 (`/context`).

**Armadilhas descobertas:**
- **Guarde o `updated_at` do cursor como o PostgREST devolve** (`…39.371221+00:00`). `Date` tem só milissegundo: reescrito, o `eq` do desempate nunca casa.
- **Regex de timestamp não basta.** O Postgres recusa 30/02 e fuso acima de ±15:59, e a leitura vira 503 (erro "do servidor") para uma entrada que nunca vai passar. Valide a data e dê 400.
- **`toISOString` depois do ano 9999 escreve `+010000-…`**, que o Postgres recusa. Limite o instante dos dois lados.
- **`searchTokens` descarta termo de 1 caractere.** Na tela isso é inofensivo; num contrato de API, "nenhum token" vira "sem filtro". Valide antes.
- **`{}` como acumulador de chaves vindas do cliente** herda `constructor` e `toString`, e o `??=` pula essas chaves. Use `Object.create(null)`.
- **`resolve_contact_identity` sobe o `updated_at` do contato existente em toda chamada**, mesmo sem mudar nada. Um integrador que "garante" o contato a cada evento faz a linha reaparecer na sincronização.
- **Dois níveis de nginx:** um log fechado no vhost do host não fecha o do appgw, que também grava a linha da requisição quando a réplica cai.

## [2026-09-29] Fase 5 · PR 6a: catálogos na API v1

**Agente/Modelo:** Claude Opus 5.5.
**Objetivo:** A IA e os integradores leem pela v1 as filas, categorias, status (com as transições permitidas), políticas de SLA e a equipe atribuível.
**Arquivos alterados:**
- `src/app/api/v1/{products,ticket-categories,ticket-statuses,sla-policies,users}/route.ts` (novos) e `catalogs.test.ts`;
- `src/lib/api/v1/catalog.ts` e `responses.ts` (novos), `openapi.ts`;
- `docs/PLANO-FASE-5.md`, este PROGRESS.

**O que foi feito:**
- **Cinco GET com `catalog:read`**, reaproveitando `getTicketCatalog`, `getProducts` e `getAssignableUsers`.
- **DTO campo a campo, estável:** sem cor, posição de tela nem `archived_at`. Os schemas são `strictObject`: um campo a mais reprova o teste, como o OpenAPI (`additionalProperties: false`) promete.
- `ticket-statuses` vem na ordem do quadro, com `transitions` de cada status.
- `sla-policies` vai da **menos urgente para a mais**: `rank` crescente, maior = mais urgente (baixa=1 … critica=4). Está no OpenAPI e no schema.
- **`users`:** só os ativos, com `id` e `name`. Sem e-mail, papel nem foto.
- **Leitura que falha é 503 `unavailable`, com `Retry-After`**, nunca `[]`. Uma lista vazia diria "não há status", e a IA agiria em cima disso.
- As cinco rotas estão no OpenAPI, com os schemas zod que os testes também usam.

**Decisões tomadas:** o PR 6 do plano foi **dividido** em 6a (catálogos) e 6b (empresas e contatos), para caber numa revisão.

**Verificação:**
- Testes das rotas: respostas no schema publicado, ordem e transições dos status, só usuários ativos, 403 sem escopo e 503 na falha.
- O varredor da v1 cobre as 8 rotas sozinho: identidade do `withApi`, 401 sem token e método no OpenAPI.
- **Varredor da v1, regra nova:** toda rota com token, exceto `/me`, recusa com 403 um token **sem escopo**. Isso cobre também as rotas futuras.
- **Mutação:** 6 garantias quebradas de propósito, todas pegas: inativo em `users`, falha virando `[]` (status e categorias), rota sem escopo e campo a mais no DTO.
- **Revisão adversarial:** 4 achados confirmados, todos corrigidos; 1 refutado.
  - O mais sério: o texto do OpenAPI dizia que `/sla-policies` vinha "da mais urgente para a menos", ao contrário da ordem real, e a IA escolheria "baixa" para um incidente grave.
  - Os outros três eram de cobertura: 403 e 503 testados em todas as rotas e partes, e DTO estrito.
- typecheck ✓ · lint ✓ · test ✓ · build ✓ (resultados no PR).

**Pendências / próximos passos:** PR 6b (empresas e contatos). Deploy dos PRs 3 a 6a com "pode subir".

**Armadilhas descobertas:**
- **Na tabela `sla_policies`, `rank` menor = MENOS urgente** (baixa=1). Qualquer texto de "ordem de urgência" precisa conferir o seed, não o nome da coluna.
- **`z.object` descarta chave desconhecida no `safeParse`.** Para o teste reprovar um campo a mais, use `z.strictObject`; o JSON Schema gerado é o mesmo.

## [2026-09-29] Fase 5 · PR 5: tokens com escopo, tipo, limite e validade pela tela

**Agente/Modelo:** Claude Opus 5.5.
**Objetivo:** O admin emite pelo CRM um token que a API v1 aceita, em especial o da IA, com o preset "IA de triagem".
**Arquivos alterados:**
- `src/features/settings/`: `schemas/api-token-actions.ts`, `lib/api-token-access.ts` (novo), `types.ts`, `queries/get-api-tokens.ts`, `components/api-tokens-manager.tsx`, com testes;
- `src/app/api/api-tokens/route.ts` e `[id]/route.ts`, com testes;
- `UI.md` (§5.19), `docs/PLANO-FASE-5.md`, este PROGRESS.

**O que foi feito:**
- **Back:**
  - o POST aceita `scopes`, `actor_type`, `rate_limit_per_min` e `expires_at`;
  - a **rota `PATCH /api/api-tokens/[id]` é nova**: altera só o que veio, só em token **não revogado**, e dá 404 se não achar;
  - a lista, a query e as duas rotas usam as mesmas colunas (`API_TOKEN_LIST_COLUMNS`), **nunca o hash**.
- **Validação:** escopo só do catálogo da v1, ou `recurso:*` de recurso existente. O banco conferia só o formato, e um escopo digitado errado seria aceito sem dar acesso a nada. Validade tem de estar no futuro e ter fuso, e é gravada em UTC; limite vai de 1 a 6.000.
- **Front mínimo** (decisão minha, registrada no plano):
  - gerar token pede **Acesso**, com "Sem acesso" como padrão e "IA de triagem" (escopos D4, tipo `ai`, 300/min);
  - a lista mostra o acesso e o status **Vencido**.

  Sem isso, a IA só poderia usar a API depois do PR 13.

**Verificação:**
- Testes novos de schema, acesso, POST, PATCH e da tela, que gera token nos dois presets pelo combobox.
- **Mutação:** 7 garantias quebradas de propósito, todas pegas:
  - PATCH em token revogado, escopo fora do catálogo, preset trocado e PATCH sem guard;
  - o filtro antigo, `...row` no mapeamento e `select("*")` no POST.
- **Revisão adversarial:** 6 achados confirmados, que eram 4 defeitos baixos, todos corrigidos; 3 refutados.
  - O filtro "Ativos" trazia vencidos. Agora há um status só (Ativo, Vencido ou Revogado) para o filtro, o selo e o esmaecimento, e o filtro ganhou "Vencidos".
  - O teste "nunca o hash" não podia falhar. Agora o `toApiTokenListItem` monta **campo a campo**, então um `select("*")` futuro não vaza o hash, e o teste confere as colunas pedidas.
  - Validade com fuso acima de ±15:59 dava 500 no Postgres; agora é normalizada para UTC.
  - O PATCH vazio perdia a mensagem "Nada para alterar."
- typecheck ✓ · lint ✓ · test ✓ · build ✓ (resultados no PR).

**Pendências / próximos passos:**
1. Deploy dos PRs 3, 4 e 5 juntos com "pode subir". Depois, emitir o token da IA pela tela e passá-lo ao agente.
2. PR 6: catálogos, clientes e contatos na v1.

**Armadilhas descobertas:**
- **Mapear linha do banco com `...row` repassa qualquer coluna a mais**, e o hash junto. Na lista de tokens, o mapeamento é campo a campo.
- **O Postgres recusa fuso acima de ±15:59**, que o ISO 8601 e o zod aceitam. Normalize a data para UTC antes de gravar.
- **Nome de teste que coincide com texto de status** ("Vencido") quebra o `getByText`. Use nomes que não colidam com rótulos da tela.
- **O Dialog responsivo usa `matchMedia`**, que o jsdom não tem: todo teste de componente com modal precisa do stub.

## [2026-09-29] Fase 5 · PR 4: withApi e o esqueleto da API v1

**Agente/Modelo:** Claude Opus 5.5.
**Objetivo:** Uma porta única e testada para toda rota `/api/v1`: token com escopo, limites, idempotência e log sem corpo. Mais as primeiras rotas: `health`, `me` e `openapi.json`.
**Arquivos alterados:**
- `src/lib/api/v1/` (novos): `with-api.ts`, `scopes.ts`, `errors.ts`, `idempotency.ts`, `openapi.ts`, com testes;
- `src/app/api/v1/{health,me,openapi.json}/route.ts`, `api-v1-guards.test.ts`, `routes.test.ts`;
- `src/lib/auth/route-guard.ts` e o teste dele;
- `src/features/integrations/queries/record-integration-log.ts`;
- `SKILLS.md`, `AGENTS.md` (mapa), `docs/PLANO-FASE-5.md`.

**O que foi feito:**
- **`withApi`**, na ordem do plano:
  1. `request_id`;
  2. limite por IP **antes** do banco;
  3. `Bearer` e um SELECT pelo **hash**, só de token não revogado;
  4. vencido é `401 token_expired`;
  5. escopos, com o curinga `recurso:*`;
  6. limite do token, 429 com `Retry-After`;
  7. `last_used_at` no máximo 1×/min;
  8. `Idempotency-Key` quando a rota exige;
  9. exceção vira 500 com `request_id`;
  10. log em `integration_logs` com o template da rota e **sem o corpo**.
- **`withPublicApi`** para `health` e `openapi.json` (D14): sem token e sem banco.
- **Idempotência no `withApi`:** hash do **corpo canônico** (JSON com chaves ordenadas), caminho concreto e o contrato `attempt_id` do PR 3. Guarda só 2xx e 422; o resto, e exceção, libera a chave.
- **`/api/v1/`** virou prefixo público do guard. O `api-guards.test.ts` de sessão deixa de ver essas rotas, e o **`api-v1-guards.test.ts`** assume. Ele confere:
  - **pelo registro `API_V1_HANDLERS`**, por identidade, que todo método exportado, dos 7 (HEAD e OPTIONS incluídos), saiu de `withApi` (ou de `withPublicApi`, só na lista pública);
  - que a rota é um `route.ts`, porque o Next também serve `.tsx` e `.js`;
  - que, sem token **e** com token inválido, a resposta é 401, e que sem Bearer o banco nem é tocado;
  - que cada método está no OpenAPI.
- O **OpenAPI 3.1** sai dos schemas zod (`z.toJSONSchema`), e o teste valida a resposta real de cada rota contra ele.
- **Adiados, com o PR de destino no plano:** `cursor.ts`, `if-match.ts`, o `access_log off` do vhost e o hash de multipart.

**Verificação:**
- 53 testes novos. **Mutação:** 12 garantias quebradas de propósito, todas pegas:
  - Bearer ausente, escopo, validade e token cru no lugar do hash;
  - limite do token, `release` no erro, status guardável e `/me` virando pública;
  - `OPTIONS` declarado à mão, um `route.tsx`, um wrapper em volta do `withApi` e o log sem amostra.
- **Revisão adversarial:** 6 achados confirmados, que eram 4 defeitos; 18 refutados. Os 4, corrigidos:
  - o varredor ignorava HEAD/OPTIONS, `.tsx`/`.js` e formas de export (agora é por registro);
  - uma rajada de token inválido enchia `integration_logs` (agora o log é amostrado em 10/min por IP);
  - o OpenAPI não cobria 429/500 nem o método de cada rota;
  - `1e400` colidia com `null` no hash.
- typecheck ✓ · lint ✓ (9 warnings anteriores) · test ✓ (2.507) · build ✓: o Next aceita `export const GET = withApi(...)` e lista as 3 rotas.

**Pendências / próximos passos:**
1. PR 5, tokens com escopo e tipo pela tela; depois o PR 6, catálogos, clientes e contatos.
2. Deploy junto com o PR 3 (a migration), com "pode subir".

**Armadilhas descobertas:**
- **O `api-guards.test.ts` de sessão não enxerga `export const GET = withApi(`** (o regex dele é de `function`), e o prefixo público tira as rotas v1 dele. Por isso o varredor próprio entra no mesmo PR do prefixo.
- **O limitador por IP é global no processo:** em teste, cada requisição precisa de um `x-forwarded-for` próprio, senão os casos se contaminam.
- **`RouteContext` é um tipo global do Next 16.** Um tipo local com o mesmo nome o esconde sem aviso.

## [2026-09-29] Fase 5 · PR 3: fundação da API v1 no banco (+ deploy do #19)

**Agente/Modelo:** Claude Opus 5.5.
**Objetivo:** Deixar no banco o que o `withApi` (PR 4) precisa: o token sabe se é IA ou integração, o ticket tira a origem dele, o Idempotency-Key tem onde morar e os logs têm retenção.
**Arquivos alterados:**
- `supabase/migrations/20260929170000_api_v1_fundacao.sql` (nova);
- `supabase/tests/api.sql` (novo);
- `supabase/tests/tickets.sql`, no caso T14g;
- `src/lib/supabase/database.types.ts`, regenerado;
- este PROGRESS.

**O que foi feito** (decisões D6, D9 e D10 do `docs/PLANO-FASE-5.md`, aceitas pelo dono):
- **`api_tokens.actor_type`** (`ai`|`api`, padrão `api`), editável pelo app.
- **`require_ticket_actor`** devolve o tipo do token, e o `create_ticket` tira a origem dele. Um `p_source` que o contradiga é `INVALID_SOURCE`: um token de integração não abre ticket "como IA". O corpo do `create_ticket` foi copiado da migration de tickets com uma troca só, e o `diff` confirma.
- **`api_idempotency_keys`** com as RPCs `api_idempotency_begin/finish/release/purge`:
  - `started` + `attempt_id`, `replay` (status + corpo), `reused` (mesma chave com corpo, **caminho concreto** ou método diferentes), `in_progress`;
  - lease vencida é retomada com `attempt_id` novo, e a validade nunca termina antes da lease; chave vencida vale de novo;
  - **só a tentativa dona** conclui (`finish`, só 2xx e 422) ou libera (`release`);
  - guarda por 24 h, com teto de 64 KB;
  - **nem o `service_role` toca a tabela**: tudo passa pelas RPCs.
- **`purge_integration_logs(interval)`**, com padrão **e piso** de 90 dias (D9). Quem executa é o worker da Fase 6.

**Verificação:**
- Migration aplicada no banco local: "baseline ok: 31 tabelas e 67 funções". Reaplicar não muda nada.
- `api.sql`: **44 casos ok**, cobrindo:
  - tipo e origem do ticket, com recusa nos dois sentidos;
  - o ciclo inteiro da idempotência, conferindo o **efeito** e não só o retorno;
  - dono da tentativa, caminho concreto, status nulo, retomada que estende a validade;
  - expurgo seletivo e privilégios.
- **Revisão adversarial:** 13 achados confirmados, que eram 7 defeitos, todos corrigidos; 0 refutados. O mais grave: o `begin` podia devolver `started` sem reserva, se a linha fosse apagada entre o `INSERT` e o `SELECT`. Agora há um laço que tenta de novo e, em último caso, responde `in_progress`. A corrida em si exige duas sessões e não tem teste automático.
- `tickets.sql`: **160 ok**. `cadastros.sql`: 63 ok.
- `baseline.sql` e `segredo_integracao.sql` falham **só no banco de desenvolvimento**, que já tem uma integração uazapi, e os dois inserem outra sem `on conflict`. Não dependem desta migration; o CI roda num banco zerado.
- typecheck ✓ · lint ✓ (9 warnings anteriores) · test ✓ (2.452) · build ✓.

**Produção (registro do deploy do PR #19):**
- **Quando:** 2026-09-29, 16:40–16:44 UTC.
- **O quê:** `29f57d8` pelo `publicar.sh`, com autorização literal do dono. As duas réplicas foram trocadas uma por vez, nada de apoio foi recriado, e o `verificar` passou.
- **Sonda externa:** 475 ok, 0 falhas.
- **Como reverter:** `image.env` = `crmsup-web:prd-rollback` (`c12380593f15`) + `subir`.
- Nenhuma mensagem de cliente chegou nos minutos seguintes: o relay sem token ainda não foi visto rodando em produção.

**Pendências / próximos passos:**
1. **Deploy desta migration** só com "pode subir". O `publicar.sh` a aplica antes do build; ela é aditiva, e a versão no ar convive com ela.
2. PR 4 (`withApi` e esqueleto da v1) e PR 5 (tokens com escopo e tipo pela tela).

**Armadilhas descobertas:**
- **`EXCEPTION` no nível de um bloco `DO` desfaz tudo o que o bloco gravou**, inclusive os resultados de teste já inseridos. Use sub-blocos `begin … exception … end` só em volta do que deve falhar.
- **`GREATEST` não é função de `pg_catalog`**: é expressão da sintaxe, e `pg_catalog.greatest(...)` só falha **na execução**. O PL/pgSQL não confere o corpo ao criar a função, então a migration aplica sem erro. Só um teste que passa pelo caminho pega.
- **O teste T14g codificava a regra antiga** (qualquer token abria ticket como IA). Mudou com a D10: agora o preparo tem um token `ai`.

## [2026-09-29] Fase 5 aberta: plano com as decisões do dono + relay sem o token da uazapi

**Agente/Modelo:** Claude Opus 5.5.
**Objetivo:** Abrir a Fase 5 com um plano executável e fechar primeiro o que é urgente no relay: ele repassava o `token` da instância ao agente, repetia mensagens reenviadas pela uazapi e não tinha prazo.
**Arquivos alterados:**
- `docs/PLANO-FASE-5.md` (novo);
- `src/app/api/chat/webhook/uazapi/route.ts` e o teste dela;
- `src/features/chat/lib/upsert-message.ts`;
- `src/features/chat/lib/normalizers/uazapi.ts`;
- `docs/API.md`, `docs/GUIA-AGENTE-IA.md`, `.claude/skills/uazapi-integration/SKILL.md`.

**O que foi feito:**
- **Plano da Fase 5** em `docs/PLANO-FASE-5.md`: estado atual com `arquivo:linha`, 14 PRs em ordem (banco → back → front), decisões e riscos. Saiu de 6 leitores em paralelo mais uma síntese.
- **Relay sem o `token`:** o envelope vai ao agente sem a chave `token` da raiz (`relayEnvelope`), e o resto segue idêntico. O tipo `UazapiEnvelope` passou a declarar o `token`.
- **Só mensagem nova:** `upsertMessage` devolve `inserted`, tirado do `select("id")` do upsert com `ignoreDuplicates`. Um reenvio da uazapi não insere, e o webhook não repassa de novo. A IA deixa de responder duas vezes à mesma mensagem.
- **Prazo de 10 s** no `fetch` do relay (`AbortSignal.timeout`).

**Decisões tomadas** (as do dono, em 2026-09-29):
- a IA tem credencial própria da uazapi, então tirar o token não a quebra;
- a mudança do contrato do relay é compatível, no mesmo endpoint;
- o token da instância não será trocado por ora;
- as recomendações D4 a D14 do plano foram aceitas;
- a D3 (URL e segredo do agente) fica em aberto até o PR 11.

Minha: juntei os PRs 1 e 2 do plano num só. Os dois mexem no mesmo arquivo crítico, e assim é um deploy em vez de dois.

Troca consciente, apontada pela revisão: o relay passou de "pode repetir" para "**no máximo uma vez**". Uma mensagem pode ser gravada e a resposta do banco se perder antes do relay: aí o webhook dá 500, a uazapi reenvia, o reenvio já não insere, e a IA nunca a recebe. É raro (falha de rede depois do commit) e agora fica no log: `[webhook/uazapi] inbound repetido, sem relay`. O conserto é o outbox da Fase 6, ou uma marca de repasse no relay v1 (`docs/PLANO-FASE-5.md`, PR 11). Antes, o preço era a IA responder duas vezes a todo reenvio.

**Verificação:**
- Teste do Postgres real (stack local, dentro de transação desfeita com `ROLLBACK`): `INSERT … ON CONFLICT DO NOTHING RETURNING id` devolve a linha na 1ª vez e nenhuma na 2ª (`INSERT 0 0`).
- 3 testes novos na rota: sem o token, reenvio sem 2º relay (e com log), prazo de 10 s. **Mutação:** desfazer cada correção quebra exatamente o seu teste.
- O banco falso só deduplica com `onConflict` + `ignoreDuplicates` + `select("id")`. Sem eles, devolve o 42501 que o banco real daria, porque o `service_role` não tem UPDATE nessas colunas.
- Revisão adversarial (2 revisores + 1 cético por achado): 5 confirmados, todos baixos, todos tratados; 4 refutados, entre eles "credencial aninhada ainda sai".
- typecheck ✓ · lint ✓ · test ✓ · build ✓ (resultados no PR).

**Pendências / próximos passos:**
1. **Deploy com "pode subir".** É só imagem: `publicar.sh` troca uma réplica por vez.
2. Seguir o `docs/PLANO-FASE-5.md` a partir do PR 3 (fundação da API no banco).

**Armadilhas descobertas:**
- **`limit 1` sem `ORDER BY` num teste de SQL pode pegar outra linha** depois de um UPDATE: o trigger mexe na conversa e a linha muda de lugar no heap. O primeiro teste de dedup "passou a inserir 2×" por isso.
- **Descartar uma chave com `const { token: _, ...resto }`** gera warning do `no-unused-vars` nesta config. Use cópia + `delete`.

## [2026-09-29] Produção: migração para duas réplicas (appgw) + Atendimento (#15)

**Agente/Modelo:** Claude Opus 5.5. Autorização literal do dono: "Pode subir agora".
**Objetivo:** Pôr no ar o deploy sem interrupção (PR #17) e o Atendimento (PR #15) sem deixar o webhook sem resposta.
**Arquivos alterados:** nenhum código, só este PROGRESS. Na produção, o que está na tabela abaixo.

**O que foi feito** (2026-09-29, UTC), seguindo o `deploy/README.md` §Migração:

| Hora | Passo |
|---|---|
| 14:57 | Backup: banco (776 KB), mídia (120 MB, 786 arquivos) e chave do Vault |
| 14:58 | Código `c12380593f15` (a `main` com o #17) em `app.novo` |
| 14:58 | `segredos` acrescentou só `CRMSUP_APP_PORT=3203` e `APPGW_CONF_FILE`. O hash de todos os outros valores ficou igual, e há cópia em `env/stack.env.bak-*` |
| 14:58 | `migrations`: 0 novas. Conferido: nada mudou em `supabase/` entre `a19db5e` e a `main` |
| 15:00 | Build de `crmsup-web:c12380593f15`. A imagem que estava no ar (`a19db5e`) virou `prd-rollback` |
| 15:01 | Troca de diretório (`app.anterior` = `a19db5e`). Depois, appgw e `web2`, os dois containers novos |
| 15:02 | vhost → 3203, com backup em `sites-available/…bak-20260929-150207`, `nginx -t` e reload |
| 15:03 | `trocar web`: a réplica foi drenada e recriada sem a 3200 |

- Não foram recriados: gateway da API, db, rest, realtime e storage.
- **A conexão do WhatsApp e os dados do banco não foram tocados.**

**Verificação:**
- **Sonda externa** do início do backup (14:57) até 15:10 UTC, com uma pausa de ~5 s às 15:04:40 para religá-la: `GET /login` a cada 1 s e POST no webhook com segredo inválido (401, sem efeito) a cada 2 s. Resultado: **716 sucessos e 0 falhas**.
- **Mensagens reais** continuaram entrando: 723 nas últimas 3 h. A última antes da conferência entrou às 12:03:30 de Brasília, durante a troca da `web`.
- `verificar` ✓: anon com 0 acessos, baseline ok, sharp ok, nenhuma porta pública. A 3200 fechou.
- Logs: nenhum erro nas réplicas. O appgw registrou 1 erro, esperado: tentou resolver `crmsup-web-2` 11 s antes de ela existir.

**Como reverter:**
- **Só a versão do app:** `image.env` = `crmsup-web:prd-rollback` e `crmsup.sh subir` (README §Rollback). Troca uma réplica por vez, sem interrupção.
- **Voltar a uma réplica:** README §Rollback, caso "uma réplica" (`app.anterior` = `a19db5e`, de antes da migração), que também drena.

**Pendências / próximos passos:** o relay à IA ainda não é idempotente. A cópia do backup fora da VPS é requisito de go-live. PR #16 aberto. Daqui em diante, os deploys usam o `publicar.sh`.

**Armadilhas descobertas:** o appgw sobe antes da `web2`, e isso deixa um `could not be resolved` no log. É inofensivo.

## [2026-09-29] Deploy sem interrupção (duas réplicas) + incidente do segredo do webhook

**Agente/Modelo:** Claude Opus 5.5.
**Objetivo:** Que atualizar o app nunca deixe o webhook da uazapi sem resposta, e registrar o incidente de produção desta madrugada.

**Arquivos alterados:** branch `feat/deploy-sem-interrupcao`.
- `deploy/app-gateway.conf` (novo), `deploy/docker-compose.yml`, `deploy/crmsup.sh`, `deploy/publicar.sh`, `deploy/nginx-host.conf`, `deploy/README.md`.
- Este PROGRESS.

**Regra do dono (2026-09-29):** durante o desenvolvimento, **nunca** mexer na conexão do WhatsApp de produção (credenciais, segredo, reconexão, registro de webhook) e **nunca** alterar nem perder dado do banco de produção. Leitura para diagnóstico é permitida.

**Incidente, produção: o quê, quando e como foi revertido**

| Quando | O quê |
|---|---|
| 2026-09-29 01:39:57–01:49:42 UTC (22:39–22:49 Brasília) | Rotacionei o `webhook_secret` no Vault, seguindo o README do PR #14, **antes** de o dono estar pronto para salvar as credenciais em Conexão. Ele decidiu não mexer na conexão de produção. Nesse intervalo, todo webhook da uazapi recebeu 401 |
| 01:49:42 UTC | **Revertido:** o segredo anterior, tirado do `access.log` do nginx sem ser exibido e conferido pelo hash (`1e9ca4cf…`), foi regravado com `set_chat_integration_secret`. A uazapi não foi tocada |

- **Impacto:** não houve atividade no chat na janela (a última mensagem foi às 21:31 de Brasília), então é provável que nada tenha se perdido. Não dá para provar: nem o nginx (sem log nessa rota) nem o app registram os 401.
- **Decisão do dono:** o segredo antigo continua valendo. Ele segue nos logs rotacionados do nginx, com o risco aceito.

**Janelas de reinício do app hoje** (motivo deste PR): **16:08** (correção da mídia), **~21:10** (deploy da identidade) e **22:33** (deploy do PR #14), horário de Brasília, de ~20–30s cada. Em 16:08 e 21:10 havia conversa em andamento, e não há sinal de perda: as mensagens de antes e de depois entraram. Uma mensagem que caísse exatamente nesses segundos teria sido recusada.

**O que foi feito:**
- **Duas réplicas do app** (`web` e `web2`, âncora YAML), **sem porta publicada**. O nginx do host manda o app para `127.0.0.1:3203`, publicado por um container novo, o **appgw** (`crmsup-appgw`, `deploy/app-gateway.conf`). Ele reparte entre as réplicas container a container, pela rede do Docker, sem docker-proxy (`resolve`, `hash $http_x_real_ip`, `proxy_next_upstream error timeout`, `max_fails=0`).
- **O gateway da API não muda.** Ele continua sendo o caminho do app até o banco, com a mesma config e o mesmo label de hash de antes.
- **`crmsup.sh trocar <réplica>`** faz a troca em quatro passos:
  1. tira a réplica do rodízio (` down` + reload do appgw);
  2. drena o que ela já atende (`CRMSUP_DRENO_SEGUNDOS`, padrão 40 s);
  3. recria a réplica (`--force-recreate`) com **parada graciosa de até 160 s** e espera ficar healthy;
  4. devolve ao rodízio. Se não ficar healthy, ela fica fora e o deploy para com erro.
- **`subir`** sobe o resto do stack e troca só as réplicas que mudaram (`compose up --dry-run`). Sem mudança, não drena nada. Ele se recusa a rodar enquanto o `crmsup-web` publica porta, ou seja, enquanto a migração está pendente.
- **O deploy olha a saúde.** Réplica que não está healthy fica fora do rodízio e é trocada primeiro, mesmo sem mudança. O `trocar` se recusa a tirar a única réplica boa. `crmsup.sh rodizio web|web2|nenhuma` faz o mesmo à mão, com a mesma recusa.
- **Trava dos serviços de apoio:** o `subir` pergunta ao compose (`--dry-run`) se recriaria db, rest, realtime, storage, gateway da API ou appgw, e recusa antes de mexer em qualquer coisa. Recriar exige `CRMSUP_RECRIAR_APOIO=sim`, numa janela sem conversa.
- **`stop_grace_period: 160s`** nas réplicas: no SIGTERM o Next termina o que está em curso. Com os 10 s padrão, um envio de vídeo seria cortado.
- `proxy_connect_timeout` do appgw de 2 s para 500 ms (queda fora do roteiro; ver Armadilhas).
- **`keepalive_timeout 4s` no upstream do appgw**, que fecha a corrida de keep-alive com o Node (ver Verificação).
- **Upstream pelo nome do container** (`crmsup-web`, `crmsup-web-2`), não pelo do serviço.
- Segunda revisão:
  - **trava de concorrência** (`$RAIZ/.rodizio.lock`) em `subir`, `trocar` e `rodizio`;
  - o `trocar` **confere a outra réplica durante o dreno**: se ela cair, a réplica em troca volta ao rodízio sem ser recriada;
  - `trocar` de réplica inexistente a tira do rodízio antes de criá-la;
  - a trava da migração lê a porta da **configuração** do container, não do estado em execução;
  - o `publicar.sh` recusa, antes de mexer em qualquer coisa, deploy anterior não terminado e migração pela metade;
  - mensagens de recusa com o caminho certo;
  - README com o rollback dos dois casos.
- A config do appgw mora num caminho estável (`APPGW_CONF_FILE`, fora do código). O script grava no mesmo arquivo e aplica com `nginx -t` + reload; se a nova reprovar, a anterior volta.
- **`publicar.sh`** exige as duas réplicas existentes e healthy.
- **README** com o roteiro de migração de uma para duas réplicas, a migração ao contrário (que também drena e só aponta a borda para destino healthy), o rollback e as armadilhas.

**Decisões tomadas:**
- **Um appgw próprio, separado do gateway da API.** A 2ª tentativa pôs o rodízio num servidor `:8080` do gateway da API, e a migração exigia recriá-lo uma vez. Só que recriar o gateway da API interrompe o app inteiro, webhook incluído, porque ele é o caminho até o banco. O appgw é um container novo: a migração não recria nada do que está no ar.
- **Container a container, não porta por réplica.** A 1ª tentativa (`upstream` no nginx do host com a porta de cada réplica) deu 215 falhas no teste. O docker-proxy aceita a conexão e a derruba enquanto o app ainda sobe, e um POST já enviado não pode ser repetido.
- **Drenar antes de recriar**, em vez de confiar só no `proxy_next_upstream`. Uma requisição em curso numa réplica que para é cortada, e o POST cortado não pode ser repetido.
- **`max_fails=0`: só o deploy tira réplica do rodízio.** Com `max_fails=1` vieram 216 falhas, detalhadas em Verificação.
- **Revisão adversarial antes da produção** (5 revisores + 1 cético por achado, só leitura): 26 achados, 13 confirmados, que se reduziram a 5 defeitos. Todos corrigidos neste PR: saúde ignorada no deploy, corte de rotas longas, recriação silenciosa dos serviços de apoio, migração inversa sem dreno e queda fora do roteiro.
- **Segunda revisão, sobre o delta das correções** (3 revisores + 1 cético por achado): 13 confirmados, que se reduziram a 7 defeitos, todos corrigidos.
- **Fechar a conexão ociosa do lado do nginx** (`keepalive_timeout 4s`), e não desligar o keepalive nem mexer no `KEEP_ALIVE_TIMEOUT` do Next. É a correção padrão (o proxy fecha antes do backend), fica só na config do appgw, que é aplicada com reload, e preserva o reaproveitamento.
- **Parada graciosa longa em vez de dreno longo.** Subir o dreno para ~190 s cobraria 3 min fixos por réplica em todo deploy. Com a parada longa o Next sai assim que termina o que está em curso, e a réplica ociosa para na hora.
- **Testes com a Compose da produção (5.5.0).** Ela e a 2.39 do Mac discordam no hash e no texto do `--dry-run` (ver Armadilhas).
- **`non_idempotent` proibido.** O webhook repassa à IA a cada processamento, **mesmo quando a mensagem é repetida**. É uma lacuna pré-existente: se a uazapi reenviar, a IA recebe duas vezes. Fica como pendência.

**Verificação:**
- **Harness:** a stack de produção roda no Mac, com o nginx e o gerador de carga **dentro da VM Linux** do Docker (`--network host`), o mesmo mecanismo de porta da produção. A carga é de ~40 req/s, metade POST no webhook. As rodadas finais usam a **Compose 5.5.0**, a da produção (binário oficial, checksum conferido).
  - **Migração completa**, com código antigo e novo no mesmo caminho: appgw e `web2`, vhost → appgw, `trocar web`. Em seguida, sob a mesma carga contínua, um deploy normal (as duas réplicas trocadas, uma por vez) e um `subir` sem mudança. Com a Compose 2.39: **0 falhas em 10.836** (5.418 no webhook). Com a 5.5.0 e o código final: **0 falhas em 10.799** (5.400 no webhook). Nas duas, o gateway da API não foi recriado, o `subir` novo rodado no estado antigo foi recusado, e o `subir` sem mudança não drenou nada.
  - **O 502 isolado depois do deploy: causa achada e corrigida.** Nas rodadas com a 5.5.0 apareceu 1 webhook com 502 por rodada (1 em ~10,7 mil), sempre 2 a 4 minutos depois de um deploy. Em 8 min de carga estável a ~330 req/s, longe de deploy, deu **0 em 158.181**. Com o log ligado só nas cópias de teste e captura de pacotes no appgw:
    - o RST veio da réplica nova, pelo MAC dela;
    - a conexão já tinha várias requisições, ou seja, estava sendo reaproveitada;
    - o RST saiu **6,0 s** depois da última resposta, e 5 a 17 ms depois de a requisição nova chegar.

    Causa: o **nginx 1.29 passou a fazer keepalive com o upstream por padrão** (guarda a conexão por 60 s), e o **Node 22 fecha a ociosa aos ~6 s**. Se o timer do Node dispara com a requisição recém-chegada ainda não lida, o `close()` vira RST (`TCPAbortOnClose`). O GET vai à outra réplica, mas o POST não pode ser repetido e vira 502. Na captura com a config antiga houve 135 reaproveitamentos entre 5,5 e 6,1 s de ociosidade, e 2 deles bateram na corrida. Com `keepalive_timeout 4s`: 10.239 reaproveitamentos, ociosidade máxima de **3,993 s**, nenhum acima de 4 s, **0 resets e 0 falhas em 10.584**, com deploy no meio. Rajadas cronometradas não reproduziram a corrida (a janela é de frações de ms), por isso a prova é pela ociosidade medida.
  - **O gateway da API não tem essa corrida:** 1.460 requisições em 1.460 conexões, porque o `proxy_pass` com variável não guarda conexão.
  - **Deploy de imagem quebrada:** a `web2` ficou fora do rodízio, o `subir` terminou em erro e a `web` atendeu sozinha, com **0 falhas em 5.620** (2.810 no webhook). Voltar a imagem boa devolveu a `web2` ao rodízio.
  - **O mesmo teste com `max_fails=1` deu 216 falhas.** A `web`, saudável, resetou uma conexão; o appgw a tirou do rodízio por 2 s e ficou sem destino ("no live upstreams"), duas vezes.
  - **Saúde, sob carga contínua:** **0 falhas em 29.330**, e todas as asserções passaram.
    - Imagem quebrada: a `web2` fica fora. Com o `subir` repetido, ela continua fora e a `web` nunca é tocada.
    - `trocar web` e `rodizio web`, com a `web2` quebrada: recusados.
    - Rollback: a réplica quebrada é trocada primeiro, e a outra fica "sem mudança". Vale tanto com a `web2` quanto com a `web` quebrada.
  - **Correções da 2ª revisão** (bateria com a 5.5.0, 0 falhas de asserção):
    - a `web2` caiu (`kill 1`) durante o dreno da `web`: o `trocar` terminou com erro, a `web` voltou ao rodízio sem ser recriada, e a `web2` ficou fora até voltar healthy;
    - uma 2ª operação durante um `trocar` foi recusada, a trava foi liberada no fim, e a trava de processo morto foi retomada;
    - `trocar` de réplica inexistente com imagem quebrada: ela ficou fora do rodízio;
    - `publicar.sh` com um `ssh` falso que só executa leituras: passou a pré-checagem no estado bom e recusou com o `image.env` divergente.
  - **Trava dos serviços de apoio:** com o `gateway.conf` mudado, o `subir` recusou e o gateway não foi recriado. Com `CRMSUP_RECRIAR_APOIO=sim`, recriou.
  - **Parada graciosa:** um POST com corpo lento, direto na `web2`, durante o `trocar web2`, **terminou com resposta aos 58 s**. O `trocar` esperou. Controle com `docker stop -t 10`, o padrão antigo: **cortado aos 13,7 s, sem resposta**.
  - **Controle, com as duas réplicas recriadas juntas:** 247 falhas em 1.890 (123 no webhook).
- `bash -n` dos scripts ✓. `nginx -t` da config do appgw ✓ (1.29, e a cada aplicação). `verificar` ✓ (sharp, sem porta pública). `nginx -t` 1.28 do vhost ✓.
- typecheck ✓ · lint ✓ (9 warnings, todos anteriores) · test ✓ (2.313). Nenhum arquivo de `src/` mudou.

**Pendências / próximos passos:**
1. **Deploy em produção com "pode subir"**, seguindo o roteiro de migração do README. Vai junto o PR #15 (Atendimento), que já está na `main` e ainda não chegou à produção. Nada do que está no ar é recriado, exceto a `web` antiga no último passo, que é drenada antes.
2. **Relay à IA idempotente:** repassar só quando a mensagem é nova. Hoje o `upsertMessage` não informa se inseriu.

**Armadilhas descobertas:**
- **Porta publicada ≠ conexão recusada.** Com o docker-proxy, uma réplica que ainda está subindo parece aceitar a conexão. Failover de POST só funciona container a container, sem docker-proxy no caminho.
- **Teste de carga no Mac:** o encaminhador de portas do Docker Desktop atrasa conexões sob carga e gera timeouts falsos. Teste com nginx e cliente em `--network host`, dentro da VM.
- **Bind mount de arquivo único** fica preso ao inode. Para recarregar sem recriar, grave **no** arquivo (`cat > f`); `cp`, `mv` e `install` criam um arquivo novo.
- **Réplica saudável também reseta conexão.** Era a corrida de keepalive do nginx 1.29 com o Node, descrita em Verificação e corrigida com `keepalive_timeout 4s`. Com `max_fails>0` e a outra réplica em troca, um único reset desses esvaziava o rodízio.
- **`compose config --hash` ≠ label `com.docker.compose.config-hash` do container.** Para saber se o `up` recriaria um serviço, use `compose up --dry-run --no-deps <serviço>` e procure `Running`.
- ⚠️ **A versão do Docker Compose muda o hash.** A 5.5.0, a da produção, julga **todos** os containers criados pela 2.39 como `Recreate`, db incluído. Atualizar o Compose na VPS faria o próximo `up` recriar o stack inteiro, e é por isso que existe a trava do `subir`. O texto do `--dry-run` também muda: a 2.39 prefixa `DRY-RUN MODE -` e usa dois espaços; a 5.5 imprime ` Container <nome> Running ` com espaço no fim. Teste com a versão da produção.
- **Um `docker pull nginx:1.29-alpine` de outra stack da VPS** move a tag compartilhada, e o próximo `up` recriaria o gateway da API e o appgw.
- **`compose up` sem `--force-recreate` não recria réplica quebrada com a mesma config:** só espera ela ficar healthy, o que nunca acontece.
- **`grep -q` no fim de um pipe com `pipefail`:** o grep sai no 1º casamento, o compose leva SIGPIPE, e o pipe falha mesmo tendo casado. Guarde a saída numa variável antes.
- **SIGTERM no Next 16 é gracioso** (`server.close()` espera o que está em curso). Quem corta é o SIGKILL do Docker, 10 s depois, se não houver `stop_grace_period`/`--timeout`. O `stop_grace_period` só vale para container criado depois dele; na recriação, o `--timeout` do `up` é que manda.
- **O relay à IA é `void fetch` depois da resposta do webhook.** O `process.exit` que vem depois do `server.close()` o mata se ainda estiver pendente: o dreno antes do SIGTERM é o que o protege.
- **Réplica que some da rede não recusa conexão:** o SYN vai para um MAC que não existe e o connect espera o timeout. Se o resolver atualizar a lista nesse meio-tempo, o nginx não faz a 2ª tentativa (NGX_BUSY, "no live upstreams") e devolve 502.
- **O webhook responde 401 sem ler o corpo** (o segredo é conferido antes do `request.json()`). No uso real o segredo é válido e o corpo é lido.
- ⚠️ **nginx 1.29 mudou os padrões do proxy:** keepalive com o upstream ligado, `proxy_http_version 1.1` e nada de `Connection: close`. Todo nginx novo na frente de um Node precisa de `keepalive_timeout` menor que o do Node (~6 s no Node 22).
- ⚠️ **Nome de serviço curto pode ser domínio de topo.** Quando o container some, o DNS do Docker manda a pergunta para fora; `web` voltou `127.0.53.53` (colisão de nome da ICANN). Aponte pelo nome do container.
- **O Docker reaproveita o IP da réplica recriada**, com MAC novo.
- **`docker inspect -f` de container inexistente imprime uma linha vazia E falha.** Com `|| echo 0`, o resultado é `"\n0"`, não `0`. Normalize com `tr -d '[:space:]'`.
- **O `docker port` só mostra porta de container rodando.** Para saber se um container foi CRIADO com porta, use `{{len .HostConfig.PortBindings}}`.
- **O healthcheck com `node -e fetch(...)` sai sem ler a resposta toda** e gera um RST no loopback a cada 15 s. É inofensivo, mas polui o contador `TCPAbortOnClose`.

## [2026-09-29] Testes instáveis: `media-key` corrigido, `contact-info-sheet` investigado

**Agente/Modelo:** Claude Opus 5.5
**Objetivo:** Tirar da suíte as falhas que não dependem do código testado.

**Arquivos alterados:** `src/lib/storage/media-key.test.ts` e este PROGRESS. Nenhum código de produto mudou.

**O que foi feito:**
- **`media-key` › "não leva telefone"** procurava `\d{10,}` na chave inteira, e o UUID aleatório às vezes traz 10+ dígitos seguidos. A verificação agora é feita sem o UUID (`semUuid`). Um caso novo, com UUID fixo cheio de dígitos, prova que a falha rara está coberta.

**`contact-info-sheet` › "toque fora com o Novo ticket sujo pergunta Descartar?"**: investigado, **sem causa raiz ainda**.
- **Sintoma:** o clique fora **fecha** o painel em vez de perguntar, porque `requestExit()` do `NewTicketForm` responde "limpo".
- **Descartado:**
  - fuso horário: falha em `America/Sao_Paulo`, UTC e Tóquio;
  - versão do Node: falha no 25 e no 22;
  - carga da prévia local: falha também sem ela;
  - remontagem por `key`: o formulário não tem `key` e a `ref` é estável.
- **Parcial:** 50ms de espera entre digitar e clicar reduz a falha (de 2/3 para 1/3), mas não elimina. A corrida com o `isDirty` do último render explica só parte.
- **Ambiente:** passa no CI Linux; no macOS falha na maioria das execuções desde 2026-09-28 ~21h de Brasília.
- **Próximo passo:** instrumentar o `requestExit`/`isDirty` no teste; ver se o `register` tardio do rádio de "Fila" (que só aparece quando `productsLoading` vira false) reavalia o `isDirty` depois da digitação; considerar ler o estado na hora (`getValues`/`getFieldState`) em vez do snapshot do render. **Verificar se é bug de produto** (rascunho perdido) antes de mexer no teste.

**Verificação:** `media-key` 10/10, 5 execuções seguidas verdes · typecheck ✓.


## [2026-09-29] PR 6 (Atendimento) trazido para a main atual e adaptado à identidade Ticbox

**Agente/Modelo:** Claude Opus 5.5
**Objetivo:** Publicar o PR 6, que estava pronto mas sem commit desde 2026-09-26 (entrada abaixo), sobre a `main` de hoje: identidade Ticbox, produção e correções.

**Arquivos alterados:** branch `feat/fase4-atendimento`, a partir da `main` (`a19db5e`).
- Os 26 arquivos do PR 6 (9 modificados, 17 novos).
- Ajustes: `service-settings-tabs.tsx`, `configuracoes/atendimento/loading.tsx`, `ticket-request.test.ts` e este PROGRESS.

**O que foi feito:**
- **Cópia do trabalho sem commit:** o diff e os arquivos novos da árvore do dono foram aplicados com `git apply --3way`. **A árvore original não foi tocada**; ela continua na branch `feat/fase4-front-atendimento`, sem commit.
- **Três conflitos resolvidos juntando os dois lados:**
  - `navigation.ts`: ícones da identidade + item Atendimento com `HeadsetIcon`, e Ajustes com engrenagem e as 4 rotas;
  - abas das Configurações: `h-11` do PR 6 + `text-primary-foreground!` da identidade;
  - PROGRESS: as quatro entradas mantidas, em ordem cronológica.
- **Adaptação à identidade:**
  - a aba ativa do Atendimento ganhou `data-active:text-primary-foreground!`; sem ele, o texto ficaria claro sobre lima no tema escuro, a 1,29:1 (UI §3.3);
  - os skeletons de botão ficaram `rounded-md`.
- **Typecheck:** o PR 6 estreitou o parâmetro de `ticketFieldError` para `{ errors }`, e o teste antigo passava um objeto literal com propriedades a mais. O teste passou a tipar o corpo como `TicketTakeOverErrorBody`, que é o que os chamadores fazem.

**Verificação:** typecheck ✓ · lint ✓ (0 erros) · test ✓ (2445, com os do PR 6) · build ✓ (`/app/configuracoes/atendimento` gerada).

**Armadilhas descobertas:**
- O registro do PR 6 dizia "typecheck ✓", mas o `tsc` reprovava. O cache incremental (`tsconfig.tsbuildinfo`) pode esconder erro: numa cópia limpa, o `tsc --noEmit` pegou.
- **Varredura com `grep` sobre uma lista em `$F`:** ela voltou vazia sem erro visível, e deixou passar a aba sem o `!`. Varra arquivo por arquivo, sem `2>/dev/null`.


## [2026-09-29] Produção no ar + correções pós-deploy (mídia, segredo no log, rollback, backup)

**Agente/Modelo:** Claude Opus 5.5. Toda ação em produção teve autorização literal do dono.
**Objetivo:** Registrar o que foi feito na VPS e levar para o repositório o que foi corrigido à mão ou descoberto depois do 1º deploy.

**Arquivos alterados:** branch `fix/fase10-pos-deploy`.
- `deploy/crmsup.sh`, `deploy/publicar.sh`, `deploy/nginx-host.conf`, `deploy/backup.sh` e `deploy/README.md`.
- `src/lib/storage/chat-media.ts` (e o teste dele).
- `src/app/api/users/[id]/avatar/route.ts`.
- Este PROGRESS.

**Produção: o que, quando e como reverter**

| Quando (UTC) | O quê | Como reverter |
|---|---|---|
| 2026-09-28 ~18:30 | **1ª instalação** (`e7058ad`), roteiro do `deploy/README.md`. Criou `/opt/crm-suporte`, o projeto `crmsup` (6 containers, 2 redes e 3 volumes), o vhost `ticbox.spincode.com.br` (app + api) e o certificado Let's Encrypt `webroot` (vence 2026-12-27). 1º admin criado pelo `crmsup.sh admin`, com troca de senha já feita | `crmsup.sh compose down`; remover o link em `sites-enabled` com `nginx -t` e reload; `certbot delete --cert-name ticbox.spincode.com.br` |
| 2026-09-28 19:08 | **Mídia do chat não abria.** No `app.env`, `SUPABASE_URL: http://gateway:80 → http://gateway`, e só o web foi recriado | restaurar `env/app.env.bak-20260928-190812` e rodar `compose up -d web` |
| 2026-09-29 ~00:10 | **Deploy da identidade Ticbox** (`dabcb7c`) pelo `publicar.sh`. Só o web foi recriado | `deploy/README.md` §Rollback (`prd-rollback` = `e7058addda74`; `app.anterior` = `e7058ad`) |
| 2026-09-29 00:13 | **Backup ligado.** O 1º backup (641KB de banco, 29,7MB de mídia com 306 arquivos, chave do Vault conferida) foi restaurado num banco de conferência, que voltou com 1 usuário e 38 contatos. Criado `/etc/cron.d/crmsup-backup`, diário às 03:30 UTC | `rm /etc/cron.d/crmsup-backup` |

A cada ação em produção foi tirado um retrato das outras stacks antes e depois: containers com os mesmos IDs, e vhosts, certificados, redes, volumes e cron idênticos.

**O que foi feito (código):**
- **`toPublicOrigin` compara por URL**, não por texto. `new URL` normaliza a porta padrão dos dois lados. Foi a causa do incidente da mídia. Ganhou teste de regressão.
- **Foto de perfil:** `getPublicUrl` passa pelo `toPublicOrigin`. Antes ela gravaria `http://gateway/...`. Não havia dado a corrigir: nenhum avatar tinha sido gravado.
- **`crmsup.sh`:**
  - `segredos` grava `http://gateway`;
  - `compose()` tira do ambiente os nomes do `stack.env` (`env -u`), porque no compose a variável do shell vence o `--env-file` e outras stacks da VPS usam os mesmos nomes de variável;
  - `build` escolhe o rollback pela imagem **do container no ar** e limpa só as tags `crmsup-web` antigas;
  - `verificar` confere o `require('sharp')`.
- **`publicar.sh`:** as migrations rodam **antes** do build e da troca. Se falharem, nada mais muda.
- **`nginx-host.conf`:**
  - a rota exata do webhook da uazapi fica sem `access_log` e com `error_log` em `crit`, porque o segredo vai na query e o log do host é compartilhado;
  - `map` com nome próprio, sem depender do `conf.d` de outra stack.
- **`backup.sh`:**
  - retenção **antes** do backup;
  - recusa gravar se sobrar menos de 10% do disco;
  - `trap` apaga os arquivos parciais;
  - mídia com 7 dias de retenção (é cópia cheia), banco e chave com 30.
- **README:** rollback volta `app.anterior` e a imagem juntos, seção "Atualizar o vhost", caminhos absolutos, checagem do cron, novas armadilhas.

**Verificação:**
- typecheck ✓ · lint ✓ (0 erros) · build ✓. `bash -n` em todos os scripts.
- **`backup.sh`** em container Debian com `docker` falso, em quatro cenários, todos corretos: sucesso; falha no meio (sem sobras); sem folga (nada gravado); retenção (mídia de 8 dias sai, banco fica). O teste **pegou um bug meu**: variável `local` no `trap`.
- **`nginx -t`** do vhost novo no nginx 1.28, nas duas etapas e **sem** o arquivo de `map` da outra stack.
- **Testes:** novo teste da rota do avatar, que **falha quando a correção é removida**. Na suíte, só os dois testes instáveis antigos descritos nas armadilhas falham, e nenhum é deste PR.
- **Revisão adversarial** (7 agentes): 12 achados.
  - Confirmados:
    - **o procedimento de rotação estava errado**: reconectar não troca o segredo; README e pendências corrigidos;
    - rollback marcando imagem quebrada;
    - `publicar.sh` repetido após falha descartando o `app.anterior` bom.
  - Também corrigidos:
    - retenção preserva os 3 mais novos;
    - checagem do sharp reprova de verdade;
    - `error_log /dev/null` na rota do webhook;
    - teste da rota do avatar;
    - diagrama do README.
  - Refutado por medição: o `du -sb` funciona no BusyBox da imagem do storage.
- **`backup.sh`** passou em mais dois cenários: 5 dumps de 40 dias com backup falhando mantêm os 3 mais novos; diretório vazio não quebra.

**Pendências / próximos passos:**
1. **Deploy deste PR, com "pode subir".** Depois dele, **reinstalar o vhost** (README §Atualizar o vhost) e **rotacionar o segredo do webhook** (README §Armadilhas: `set_chat_integration_secret` + salvar as credenciais em Conexão). O segredo atual ficou gravado 25 vezes no `access.log` compartilhado antes da correção. ⚠️ Reconectar o WhatsApp **não** troca o segredo.
2. **Cópia do backup fora da VPS:** requisito de go-live, ainda sem destino.
3. **Testes instáveis** `contact-info-sheet.test.tsx` e `media-key.test.ts`: investigar e corrigir em PR próprio.

**Armadilhas descobertas:**
- **Teste instável** `contact-info-sheet.test.tsx › "toque fora com o Novo ticket sujo pergunta Descartar?"`:
  - desde ~21h de Brasília de 2026-09-28 falha **sempre** no macOS, com Node 25 e Node 22, com ou sem a prévia rodando, em qualquer TZ;
  - passa no CI Linux, que rodou às 00:05 UTC;
  - com `Date` falso, passa às 12:00 e 00:01 UTC e falha às 23:59 UTC. Não é um limiar de data: é corrida sensível a tempo;
  - sintoma: o clique fora **fecha** o painel em vez de perguntar, porque o formulário não se considera sujo.
- **Teste instável** `media-key.test.ts › "não leva telefone"`: a chave contém um UUID aleatório, e às vezes o UUID traz por acaso 10 dígitos hexadecimais seguidos, o que casa com `\d{10,}`. Falha rara, observada 1 vez; passou 8/8 isolado. A correção é gerar a chave com UUID fixo no teste.
- **Reconectar o WhatsApp NÃO troca o segredo do webhook** (`ensure_chat_integration_secret` reaproveita o existente). Rotação: `set_chat_integration_secret` + salvar as credenciais em Conexão (README §Armadilhas).
- **Teste de rota com multipart** precisa de `// @vitest-environment node`: no jsdom, o `request.formData()` trava até o timeout.
- **`tail` num pipe mascara o código de saída:** `pnpm typecheck | tail -1 && echo ✓` imprime ✓ com o typecheck falhando. Confira `$?` do comando, não do pipe.
- **`trap` de EXIT com variável `local`:** quando o `set -e` derruba o script, o bash já desfez as locais, e o trap morre com "unbound variable". Variável lida em trap é global.
- **`certbot certonly --webroot` com `--deploy-hook`** grava o hook só na renovação desta lineage. Os hooks globais (`renewal-hooks/*`) estavam vazios na VPS.

## [2026-09-28] Identidade visual da Ticbox (faixa verde, logo, paleta, Poppins, ícones)

**Agente/Modelo:** Claude Opus 5.5. Método:
- workflow de 7 agentes: site da Ticbox medido por curl, mapa do sistema visual, auditoria de ícones, 3 direções e juiz;
- revisão adversarial de 10 agentes sobre o diff;
- recomendação seguida a pedido do dono ("faça o recomendado").

**Objetivo:** Aproximar o app da identidade do cliente, a Ticbox, e refinar o cabeçalho e os ícones.

**Arquivos alterados:** branch `feat/identidade-ticbox`, 28 arquivos, sem migration.
- **Base:** `globals.css`, `layout.tsx`, `manifest.ts`, `icon.png`, `apple-icon.png`, `site.ts`.
- **Casca:** `app-header.tsx`, `dashboard-shell.tsx`, `navigation-drawer.tsx`, `logout-button.tsx`.
- **Primitivos:** `logo-mark.tsx` (e teste novo), `button.tsx`, `tabs.tsx`, `brand-signature.tsx`, `page-skeletons.tsx`.
- **Navegação:** `navigation.ts` e o teste dela.
- **Telas:** login, definir-senha, política, banner do PWA, abas de Configurações.
- **Contraste pontual:** `new-ticket-form.tsx`, `connection-panel.tsx`, `quick-reply-picker.tsx`, `notes-panel.tsx` (só o comentário).
- **Docs:** UI.md (§2, §3.1, §3.2, §3.3, §3.3.1, §4.1, §4.3, §5.22, nota do post-it).

**O que foi feito:**
- **Paleta:** a da Ticbox, **medida** no CSS do site dela: `#042D29`, `#0A7E4D`, lima `#AFEB2B`, `#EEF7E2`, faixa `#15312D`, e os cinzas do Bootstrap. `--primary` claro `#097248` é derivado, para o acento passar AA. O tema escuro é derivado, porque a Ticbox não tem um.
- **Tokens novos:** `brand-solid`, `primary-hover`, `brand-deep` e `brand-lime`, com os pares claro e escuro.
- **Superfícies:** raio `0.5rem`; a "água" azul do fundo saiu; sombras neutras.
- **Casca:** a pílula flutuante em gradiente virou a **faixa verde-escura colada no topo**, igual à navbar do site da Ticbox.
  - Logo branca; ícones em lima; item ativo em ladrilho lima; hover `#0A7E4D`.
  - A barra do celular fala a mesma língua.
  - `--app-chrome-top` passa a ser a altura da faixa.
- **`LogoMark`:** SVG inline da logo oficial com três recortes (`symbol`, `wordmark` e `full`), pintado por `currentColor`. `public/brand/*.png` ficaram sem uso, e não foram apagados (§3.7).
- **Ícones do app:** o favicon TC/BX da Ticbox, rasterizado com `sharp`.
- **Ícones da navegação:**
  - Casa no Início;
  - `MessageCircle` para o WhatsApp na nav (o logo preenchido fica nas telas de conteúdo);
  - `BookUser` em Contatos;
  - engrenagem no menu Ajustes, que ganhou `icon` no contrato `TopNavEntry`;
  - `PlugZap` em Conexão e `Settings2` em Configurações.
- **Botão e fonte:**
  - `Button` primário igual ao `.btn-primary` do site: verde-petróleo com texto lima, `rounded-md`;
  - display em **Poppins**, a fonte do site, no lugar do Outfit.
- **Login:** painel `bg-brand-deep` com a logo completa, símbolo em marca d'água e checks lima; sem proporção fixa, então não sobra faixa branca quando aparece o alerta.
- **Nome:** "SUPORTE" ao lado da logo; "Ticbox Suporte" na aba e no PWA, com o novo `siteConfig.brand`. O `slug` não muda.

**Decisões tomadas:**
- **Direção "institucional"** (faixa de ponta a ponta), escolhida pelo juiz: é a mais fiel.
- **Acento derivado `#097248`:** o `#0A7E4D` puro reprova dentro do chip `/10`.
- **Nome visível "Suporte"**, a pedido do dono ("tire o CRM"). Aba e PWA com "Ticbox Suporte" para não perder a marca.
- **O nome ao lado da logo só aparece no `2xl`:** com Poppins, a faixa do admin transbordaria em 1280px.

**Verificação:**
- typecheck ✓ · lint ✓ (0 erros; os 9 avisos antigos são de `verify-webhook.test.ts`) · test ✓ (2313, com 10 novos) · build ✓.
- **Revisão adversarial:** 26 achados, 5 confirmados, todos corrigidos. Os principais:
  - aba ativa das Configurações em 1,29:1 no escuro → `text-primary-foreground!`;
  - `--destructive` do escuro em 3,67:1 no card novo → `oklch(0.75 0.14 25)`, com `dark:text-brand-deep` no único texto sobre `bg-destructive`;
  - aba inativa `text-foreground/60` → `text-muted-foreground`;
  - alvos de toque de 44px na faixa.
- **Aceite visual:** é do dono, pela prévia local (Playwright é proibido).

**Pendências / próximos passos:**
- Aceite visual do dono nos temas claro e escuro, em 320px, 375px, tablet e desktop.
- Deploy só com "pode subir".
- Apagar `public/brand/*.png` e o utilitário `glass`, que ficaram sem uso, só se o dono pedir.

**Armadilhas descobertas:**
- **`Tabs` e a especificidade do escuro.** O primitivo traz `dark:data-active:text-foreground`. Qualquer cor de texto de aba ativa sobre fundo de marca precisa de `!`: `:is(.dark *)` tem especificidade maior e vence em silêncio.
- **Prévia local fora do Docker.** O `.env.local` aponta `SUPABASE_URL=http://host.docker.internal:54321`, que só resolve dentro do container. Rodando `next dev` no Mac, o login cai com "Não foi possível validar o login". Passe `SUPABASE_URL=http://localhost:54321` no comando, sem editar o arquivo.
- **O `next-env.d.ts` é regerado** pelo `next dev`/`build`. Não entra no commit.

## [2026-09-28] Fase 10 — infra de produção em `deploy/` (VPS compartilhada, nginx do host)

**Agente/Modelo:** Claude Opus 5.5
**Objetivo:** Ter o necessário para subir o CRM em `https://ticbox.spincode.com.br` num stack Docker isolado, numa VPS que já roda outras aplicações de produção, sem tocar em nenhuma delas.

**Arquivos alterados:** branch `feat/fase10-producao`.
- `deploy/`, todos novos:
  - `docker-compose.yml`, `gateway.conf`, `nginx-host.conf`;
  - `crmsup.sh`, `backup.sh`, `publicar.sh`;
  - `README.md`, o runbook.
- AGENTS §0.3, §4.1 e §10; SKILLS; PRD (decisão "Produção"); PLANO (Fase 10 destravada); este PROGRESS.
- **Nenhum arquivo de `src/` nem migration.**

**O que foi feito:**
- **Levantamento da VPS, só leitura.** Não há Traefik: o nginx do host segura 80/443, com um arquivo por site e certbot. Já existe outro Supabase lá (`supabase-*`, `realtime-dev.supabase-realtime`). As portas livres no loopback eram 3200 e 3201.
- **Porte do deploy de produção da origem** (tag local `legado-clinica`). Tudo virou `crmsup`: projeto, containers `crmsup-*`, redes e volumes `crmsup_*`, tenant `realtime-dev.crmsup-realtime`.
  - Sem Traefik: app e gateway publicam só em `127.0.0.1`.
  - O banco e os serviços ficam numa rede `internal: true`; só web e gateway ficam também na `borda`.
- **`crmsup.sh`**, a operação no servidor:
  - `segredos` é idempotente, grava em arquivos 0600 e não imprime nada;
  - `build` faz o rollback tag;
  - `papeis` junta o bootstrap da origem com o `docker/db-init.sql`;
  - `migrations` usa o mesmo livro-razão do `db-local-apply.sh` e **nunca** roda o seed;
  - `admin` usa `create_app_user` com troca obrigatória de senha, que vai para um arquivo 0600;
  - há ainda `subir`, `verificar` e `nginx http|https`.
- **Borda com dois hosts:** `api.ticbox…` para o gateway, com `CSP: sandbox`. É a mesma separação da origem, contra XSS armazenado via mídia.
- **Certificado por `certbot certonly --webroot`**, que não reescreve configuração de ninguém.

**Decisões tomadas:**
- Hospedagem, domínios e subir o `origin/main` atual (sem o PR 6) são decisões do dono.
- **Um vhost novo é o único ponto compartilhado.** Não tem como evitar, porque o nginx do host é dono das portas 80/443.
- **Label com o hash do `gateway.conf` em vez de comparar conteúdo.** Veja em Armadilhas por que a comparação falhava.
- **O vhost sobrescreve o `X-Forwarded-For`** (`$remote_addr`), porque o `clientKeyFromRequest` do rate limit usa a 1ª entrada.

**Verificação:** tudo no Mac, com o stack de produção inteiro no projeto `crmsup`, portas 3300/3301, depois derrubado com `down -v`.
- **Roteiro do README seguido à risca:** 12 migrations com `baseline ok`. Reaplicar resulta em 0; o `admin` não duplica.
- **`verificar`:** `anon` alcança 0 tabelas e 0 funções; `authenticated` só `chat_conversations` e `chat_messages`; 0 tabelas sem RLS; nenhuma porta fora do loopback.
- **Fumaça:**
  - app e login: `/login` 200 com HSTS; login com o admin do script; cookie com `Secure`; token do navegador emitido;
  - gateway: raiz 404 e `CSP: sandbox`; `anon` recebe 42501; `authenticated` lê o chat e recebe 403 em `tickets`; o bucket `chat-media` existe;
  - Realtime: **o evento de INSERT chega ao cliente**.
- **Vault:** um segredo gravado **sobreviveu à recriação do container do banco**.
- **Backup:** banco, mídia e chave; a chave no arquivo é idêntica à do container. A restauração num banco novo funcionou, e a trava contra restaurar em `postgres` também.
- **`nginx -t` do vhost** no nginx 1.28, a mesma versão do servidor: ✓ em http e em https.
- **Gateway:** recriado quando a config muda (inclusive editada no lugar) e intacto quando não muda.
- **Checks do repo:** o `next build` passou dentro do `Dockerfile.production`. typecheck ✓ · lint ✓ (0 erros; os 9 avisos são antigos, em `verify-webhook.test.ts`) · test ✓ (2303).
- **Não executados:** as skills `bug-hunter` e `verification-before-completion` não estão instaladas neste ambiente. Fiz revisão manual e a varredura do diff atrás de IP, segredo e nomes da origem.

**Pendências / próximos passos:**
1. Merge deste PR (dono).
2. 1ª instalação na VPS, **com autorização literal**, seguindo `deploy/README.md`. Antes, pedir o e-mail e o nome do 1º admin e a autorização para o cron de backup.
3. **Cópia do backup fora da VPS**: requisito de go-live, ainda sem destino.
4. A política de privacidade definitiva continua pendente (PLANO, Fase 10).

**Armadilhas descobertas:**
- **Chave raiz do Vault.** `vault.getkey_script` gera `/etc/postgresql-custom/pgsodium_root.key` no 1º boot, **dentro do container**. Nem o compose local nem o de produção da origem montavam esse diretório. Recriar o `db` apagaria a chave e deixaria ilegível todo segredo do Vault. Na produção, ela fica no volume `crmsup_db-config`. **No compose local o problema continua** (fora do escopo deste PR).
- **O disco virtual do Docker Desktop encheu** (31 GB), e o daemon travou antes de dar "no space left on device". O `docker builder prune -af` liberou 10,7 GB.
- **Arquivo montado e editado no lugar:** o container **vê** o conteúdo novo, mas o nginx segue com a config lida ao iniciar. Comparar o conteúdo dá "igual" e não recria. Por isso a troca pelo label.
- **`command -v a b c`** no `sh` dessas imagens só imprime o primeiro nome. Não conclua que falta ferramenta por isso.
- **Na VPS, nunca `docker … prune`:** apaga imagem e cache das outras stacks. No Mac é seguro para o cache.

## [2026-09-26] Fase 4 · PR 6 — Configurações › Atendimento (filas, categorias, SLA e status)

**Agente/Modelo:** Claude Opus 5.5 (workflow em 3 ondas: leitura de admin e menu → 4 gerenciadores em paralelo → página; revisão adversarial em 4 frentes; correções em 4 frentes por arquivo mais as extrações da regra dos 3 usos; roteiro dos "pronto quando")
**Objetivo:** O admin cuida do catálogo do atendimento numa tela só:
- filas (criar, renomear, nicho, cor, arquivar/reativar);
- categorias em 2 níveis por fila;
- prazos de SLA por prioridade;
- rótulo e cor dos 8 status.

**Arquivos alterados:** branch `feat/fase4-front-atendimento`.
- **Página:** `app/(dashboard)/app/configuracoes/atendimento/{page,loading}.tsx`, mais o teste da página.
- **Gerenciadores:**
  - `features/products/components/products-manager.tsx`;
  - `features/tickets/components/{ticket-categories-manager,sla-policies-manager,ticket-statuses-manager,service-settings-tabs}.tsx`, com testes.
- **Leitura de admin:** `features/tickets/queries/get-service-settings.ts`, que traz também as arquivadas, e o tipo `ServiceSettings`.
- **Menu:** item "Atendimento" em `config/navigation.ts`, só para admin, em Ajustes.
- **Configurações:** as abas ficaram com 44 px de toque no celular.
- **Extrações:**
  - `SLA_MODES`/`isSlaMode` num arquivo neutro (3º uso);
  - o corpo de erro de catálogo tipado no `ticketRequest` (os 4 gerenciadores faziam o mesmo cast).
- **Docs:** UI.md §5.19.1 e este PROGRESS.

**O que foi feito:**
- **Aba na URL** (`?aba=`): a padrão fica fora da URL, e valor inválido cai em Filas.
- **Falhas:** cada parte que falha mostra "Não foi possível carregar…" com "Tentar de novo".
- **Arquivar e reativar** pedem confirmação na linha (§5.6).
- **Categorias:** a filha herda a fila da mãe. Categoria de fila arquivada, ou filha de mãe arquivada, não oferece Reativar e explica o motivo.
- **SLA:** edição em h:min, gravada em minutos, com o aviso sobre tickets abertos. Solução menor que a 1ª resposta é barrada antes de enviar.
- **Status:** prévia do selo ao vivo. Modo e "encerra" são só leitura.
- **Erros:** 409 com o item existente e 422 no campo do formulário.

**Decisões tomadas:**
- **Tipos da leitura de admin:** reaproveitam `ProductOption` e `TicketCategoryOption`, os mesmos que as rotas devolvem em `item`. A linha pode ser trocada pela resposta sem conversão.
- **Filas:** lista única em vez de tabela mais cartões.
- **Aviso do SLA:** "Vale para tickets abertos daqui em diante e para os que mudarem de prioridade". Trocar a prioridade tira um snapshot novo da política atual.
- **Menu "Ajustes":** é suspenso e não vem no HTML do servidor. A presença do item por papel é testada em `navigation.test.ts`.

**Revisão adversarial:** 14 confirmados e 2 refutados, todos de severidade baixa, todos corrigidos.
- **Textos e comportamento:**
  - o aviso do SLA afirmava que os abertos mantêm o prazo;
  - reativar fila não pedia confirmação;
  - status com cor fora da paleta impedia salvar só o rótulo.
- **Layout e foco:**
  - grades sem trilha declarada alargavam a página no celular;
  - salvar uma linha de SLA ou de Status remontava a linha e jogava o foco no `body`;
  - o renomear de categoria não levava o foco ao campo com erro;
  - as abas tinham 40 px.
- **Testes que faltavam:** a página, as travas de duplo envio, a linha que muda com o servidor e a cor fora da paleta em Filas.

**Verificação:**
- **Roteiro** (`~/.claude/projects/…/e2e/e2e8.mjs`, build de produção na 3201, dados de demonstração): 15 conferências passaram, e tudo o que o roteiro muda é desfeito.
  - O member é redirecionado (307 → `/app`) e recebe 403 na rota de escrita.
  - O admin vê as 4 abas, e `?aba=status` abre a aba certa.
  - **O rótulo e a cor novos aparecem na lista e no detalhe.**
  - **Mudar o SLA de alta não mexe no ticket de prioridade alta aberto.**
  - **Uma fila arquivada some do catálogo do Novo ticket e continua no ticket antigo**, e o admin ainda a vê, marcada.
- typecheck, lint, test e build: ver o fim desta entrada.

**Pendências / próximos passos:**
- **Conferir no navegador:** as 4 abas no desktop e no celular, o Esc nas confirmações e o seletor de cor.
- **`ColorSwatchPicker`** (primitivo compartilhado): quadradinhos de 28 px, abaixo dos 44 px de toque, e `aria-label` com o nome da cor em inglês. Fica no backlog de UI.
- **Próximos:** a tela de métricas (BI), já em desenho com as decisões do dono, e depois o Quadro (PR 7).

**Armadilhas descobertas:**
- **O cache persistente do Turbopack corrompeu no `next dev`** (pânico em `turbo-persistence`), e o servidor ficou de pé mas travado. Apague `.next` e prefira `next build && next start` para os roteiros.
- **O limite de uso da sessão derruba os workflows no meio.** Retome com `resumeFromRunId`: o que terminou volta do cache.
- **Com a demonstração semeada, o banco local tem uma integração uazapi**, e `provider` é UNIQUE. Um roteiro que cria a própria integração falha, e as suítes SQL que inserem integração também. Use os dados da demonstração, ou rode `demo-cleanup.mjs` antes e semeie de novo depois.

## [2026-09-26] Fase 4 · PR 5 — ticket no chat (chip, painel, Novo ticket, Assumir) e fila no Início

**Agente/Modelo:** Claude Opus 5.5 (workflow em 2 ondas: fundação do chat → Início ‖ painel → cabeçalho; revisão adversarial em 4 frentes; correções por agentes; migration aprovada pelo dono; roteiro ponta a ponta com Realtime)
**Objetivo:** O analista trata o ticket de dentro da conversa. O chip do cabeçalho mostra o ticket em foco, o painel do contato abre, troca e cria ticket, e "Assumir" pega conversa e ticket juntos. O Início mostra a fila do dia.

**Arquivos alterados:** branch `feat/fase4-front-chat-inicio`.
- **Banco:**
  - `supabase/migrations/20260926130000_fila_respondeu_apos_resolver.sql`;
  - T95i–k em `supabase/tests/tickets.sql`;
  - `database.types.ts`, regenerado.
- **Chat:**
  - `features/chat/types.ts` (`active_ticket_id`);
  - `hooks/use-messages.ts`: Realtime do cabeçalho; o PATCH aplica só `{id, status}`;
  - `components/chat-shell.tsx`: 409 do limpar e `onConversationUpdate`;
  - `chat-header.tsx`, `chat-view.tsx` e `contact-info-sheet.tsx`;
  - testes novos de `chat-view` e `use-messages`.
- **Tickets:**
  - `lib/ticket-request.ts`: 3º uso, extraído e adotado pela lista e pelo detalhe;
  - `hooks/use-conversation-tickets.ts` e `use-conversation-take-over.ts`;
  - componentes `conversation-ticket-chip`, `take-over-dialog`, `conversation-tickets-group`, `new-ticket-form` e `ticket-queue-panel`;
  - `queries/get-ticket-queue.ts` e `get-tickets-page.ts`: `onlyPending` e o grupo "pendentes";
  - `types.ts`.
- **Outros:** `src/lib/validation/uuid.ts` (`newUuid`) e o Início em `app/(dashboard)/app/page.tsx`.
- **Docs:** UI.md (§5.7.12, §5.7.20 nova, §5.8.1 nova), PRD §7.3 e este PROGRESS.

**O que foi feito:**
- **Cabeçalho do chat:**
  - a linha de apoio mostra o ticket em foco em texto ("IA · SUP-1024 Em atendimento");
  - a partir de `lg`, um chip com o protocolo, o `SlaBadge` e um menu (ações rápidas, Abrir ticket, Trocar foco);
  - sem foco, o chip vira "Abrir ticket";
  - no celular, nada novo na coluna de ações.
- **"Assumir" com ticket em foco:** faz o take-over do ticket e aplica na hora a conversa devolvida.
  - Com `already_assigned`, abre o diálogo "Assumir conversa e ticket / Só a conversa".
  - "Só a conversa" com a conversa já humana não a devolve à IA.
- **Painel do contato:**
  - grupo "Tickets", com as vistas "tickets" (trocar o foco) e "ticket-new" (formulário);
  - mapa de vista-pai para o Esc e o voltar;
  - o cabeçalho abre o painel direto numa vista (`initialView`).
- **Novo ticket:**
  - "Assumir o atendimento" vem ligado;
  - a chave é gerada ao abrir e há trava de ref, então o duplo clique abre 1 ticket;
  - Esc ou toque fora com o formulário sujo pergunta "Descartar?".
- **Leituras:** uma só por conversa (`useConversationTickets` no `ChatView`), refeita ao mudar foco ou status, no `visibilitychange`, depois de cada ação e quando chega mensagem do cliente (debounce de 1 s).
- **Realtime do cabeçalho:** o update de `chat_conversations` vai à lista e à conversa aberta, então mudar o foco em outra aba troca o chip.
- **Limpar conversa com ticket:** mostra o motivo do 409.
- **Início:**
  - a fila fica acima do mural, com "Minha fila" e "Não atribuídos" (até 8 cada, "Ver todos (N)");
  - Atender, e Reabrir · Fechar;
  - a falha de uma seção é isolada.

**Decisões tomadas:**
- **Fila do Início, decidida pelo dono na sessão:** relógio correndo ou pausado **mais resolvido em que o cliente respondeu depois**, estes primeiro. Para isso, a view `ticket_queue` ganhou `replied_after_resolve` (migration nova), porque o PostgREST não compara coluna com coluna.
  - O "Ver todos" usa o grupo de lista "pendentes", com o mesmo `onlyPending` da fila. Um teste prova que o href aplica os mesmos filtros da seção.
  - Resolvido sem resposta do cliente sai da fila e continua em "Resolvidos".
- **Na seção Não atribuídos, o resolvido respondido mostra Reabrir · Fechar**, porque o take-over não reabre ticket resolvido.
- **`newUuid()`:** usa `crypto.randomUUID` e, fora de contexto seguro (`http://` em IP da rede), cai para v4 com `getRandomValues`.
- **Reenvio depois de erro de rede que devolve o ticket da 1ª tentativa** (`created:false`) mostra `toast.warning`, e não "aberto": os dados enviados eram os de antes.
- **PATCH de status:** aplica só `{id, status}`. A linha da resposta desfaria um evento mais novo do Realtime (prévia, ordem, não lidas, `updated_at`).
- **Colar com o painel do contato aberto não vira anexo da conversa.**
- **A coluna de ações do cabeçalho só encolhe com o chip de foco** (`has-[[data-ticket-chip=focus]]`). O botão Assumir/Devolver é `shrink-0`.

**Revisão adversarial** (4 frentes: regressão do chat, ticket no chat, Início e testes): 9 confirmados e 1 refutado.
- **Severidade média:**
  - o sinal "Respondeu após resolver" sumia no corte de 8;
  - o total do "Ver todos" divergia do da lista.
- **Severidade baixa:**
  - resolvido sem dono com resposta ficava fora da fila;
  - `crypto.randomUUID` em `http://` de rede;
  - o reenvio dizia "aberto";
  - o take-over não aplicava a conversa;
  - o colar ia para o chat;
  - o botão Devolver encolhia;
  - o PATCH desfazia o Realtime.

Todos foram corrigidos, e os testes novos falham com o código antigo.
- **Frente de testes, refeita por um agente depois do reinício:** 61 mutantes, 25 sobreviventes. Cada um ganhou teste no arquivo colocado e foi provado por mutação no repo, com restauração conferida por `cmp`/sha1.
  - Chat: o 409 do limpar (`chat-shell.test.tsx` novo), o status do PATCH sem Realtime, a fiação do `ChatView` (notifyInbound, status, leitura única para o painel, foco no chip, take-over com `onConversationUpdate`).
  - `ticketRequest`: sucesso exige 2xx e `ok: true`.
  - Debounce de 1 s, travas contra duplo clique (take-over, troca de foco, fila), o diálogo `already_assigned` (sem rede, recusado, Esc em voo), o 404 que relê e a chave gerada ao abrir.
  - Toque fora com o formulário sujo, o 422 que relê, e o toast só com `changed`.
  - A página do Início entregando a fila (`page.test.tsx` novo).

  Também: o teste instável do detalhe (PR 4, `findByText` de 1 s) passou a esperar 3 s, e os mocks de transição e take-over seguem o formato real das rotas.

**Verificação:**
- **Testes SQL:** baseline 52, cadastros 63, segredo 7, tickets 160.
- **Migration:** a view manteve `security_invoker=true`, e só o `service_role` a lê.
- **App:** typecheck ✓ · lint ✓ (0 erros; os 9 avisos já existiam) · test ✓ (2306) · build ✓.
- **Roteiro ponta a ponta** (`scratchpad/e2e7.mjs`, `next dev` na 3201, com um cliente Realtime em Node autenticado pelo mesmo JWT curto do navegador): as 20 conferências passaram.
  - **Duplo clique = 1 ticket:** 2 POSTs simultâneos com a mesma chave.
  - As mensagens soltas de 24 h e a seguinte aparecem na timeline.
  - Abrir com Assumir leva a `human`, com responsável e `em_atendimento`.
  - **A troca de foco feita por outra aba chega pelo Realtime**, e o carimbo segue o foco.
  - O Início mostra as duas filas, sem `ai_triage` nem chave.
  - Resolvido com resposta aparece na Minha fila com o selo, e "Ver todos" leva à lista "pendentes", que o traz.

  Os dados foram apagados depois.

**Pendências / próximos passos:**
- **Conferir no navegador:**
  - chip e menu no desktop;
  - painel com o grupo Tickets e "Novo ticket" no celular;
  - Esc em camadas;
  - "Assumir" com ticket de outro analista.
- **PR 6:** Configurações › Atendimento (filas, categorias, SLA, status). Falta uma leitura de admin com os arquivados.
- **PR 7:** Quadro.
- **Selo de SLA no chip:** depois da 1ª resposta do analista, só é relido na próxima releitura (foco, status, aba). Reler também na 1ª resposta aceita fica em aberto.

**Armadilhas descobertas:**
- **O reinício da sessão apagou o scratchpad** (`/private/tmp/…/scratchpad`), com a spec e os roteiros. A spec da Fase 4 foi recuperada do journal do workflow de desenho (`~/.claude/projects/…/subagents/workflows/wf_1e550572-3b0/journal.jsonl`). **Guarde fora do scratchpad o que não pode ser perdido.**
- **O reinício da máquina também derruba o Docker:** `open -a Docker`, e a stack volta pelas políticas de restart.
- **Cliente Realtime em Node para teste:** `await sb.realtime.setAuth()` **antes** de `subscribe`, como o `subscribeAuthenticated`. Sem isso a assinatura fica `anon` e nenhum evento chega.
- **Roteiro com `finally` que imprime "TUDO OK":** uma exceção no meio passaria como sucesso. Conte a exceção como falha.
- **Recuar `resolved_at` em teste:** a CHECK `tickets_stamps_after_open_check` exige carimbo depois da abertura. Recue o ticket inteiro.

## [2026-09-26] Fase 4 · PR 4 — telas de lista e detalhe do ticket, navegação

**Agente/Modelo:** Claude Opus 5.5 (workflow em 2 ondas: base e navegação → lista ‖ timeline e anexos → detalhe; revisão adversarial em 4 frentes com 20 verificadores; correções em 3 frentes provadas por mutação; roteiro SSR)
**Objetivo:** O analista acha, filtra e trata tickets na tela. A lista tem filtros na URL e selo de SLA vivo; o detalhe tem timeline, notas, anexos e ações rápidas. "Tickets" entra no menu e na barra do celular.

**Arquivos alterados:** branch `feat/fase4-front-lista-detalhe`.
- **Páginas:** `app/(dashboard)/app/tickets/{page,loading}.tsx` e `[number]/{page,loading}.tsx`.
- **`features/tickets/components/`:**
  - selos de status, prioridade e SLA;
  - `tickets-table` e `ticket-filters`;
  - `ticket-detail` (+ `header`, `sidebar`);
  - `ticket-timeline` e `ticket-attachments`.
- **Hooks:** `use-now` e `use-ticket-mutation`.
- **Lib:** `ticket-actions`, `ticket-list-url`, `timeline-view` e `attachment-view`.
- **Consultas:**
  - `get-assignable-users`, com id, nome, avatar e `is_active`, **nunca e-mail ou papel**;
  - ajustes em `get-tickets-page` (protocolo ignora o status) e `get-ticket-detail` (categoria atual e `in_focus`).
- **Navegação:** `config/navigation.ts` + teste e `config/nav-active.ts` + teste (href mais longo com limite de segmento), usado em `dashboard-shell.tsx`.
- **Outros:**
  - `lib/formatters/bytes.ts`: 3º uso, e as 2 cópias do chat passaram a importá-lo;
  - `contract-card.tsx` exporta `DetailRow`.
- **Docs:** UI.md (§5.1, §5.3.1, §5.22 e a §5.24 nova) e este PROGRESS.

**O que foi feito:**
- **Lista:**
  - filtros (status, prioridade, fila, responsável, SLA, busca e ordem) e página na URL;
  - tabela a partir de `lg` e cartões com barra de acento do SLA abaixo disso;
  - menu ⋯ com Abrir conversa, Atribuir a mim, Mover para… (só destinos da matriz; cancelar pede motivo) e Copiar protocolo;
  - 4 estados distintos: falha, nenhum ativo, base vazia e filtro vazio.
- **Detalhe:**
  - protocolo copiável e título editável;
  - "Responder no WhatsApp", que põe em foco se preciso;
  - ações rápidas (Atender, Aguardar cliente, Resolver, Reabrir, Fechar);
  - linha de fatos e lateral editável: empresa, fila + categoria com "Salvar", prioridade com a dica do SLA, responsável;
  - timeline cronológica com "Carregar anteriores" e notas (só o autor edita e apaga);
  - anexos com upload.
- **Conflito de versão (409):** alerta no topo, toast e refresh.
- **Sem Realtime de tickets:** refresh no `visibilitychange` e depois de cada ação.

**Decisões tomadas** (revise):
- **Menu:** só "Tickets" entra agora; "Quadro" (PR 7) e "Atendimento" (PR 6) entram com as páginas deles, para não haver link para página inexistente. A chave "Lista | Quadro" também fica para o PR 7.
- **Busca por protocolo** ignora o filtro de status. Os outros filtros continuam valendo.
- **"Atender" aparece:**
  - só com o relógio não parado;
  - em ticket sem responsável ou do próprio analista;
  - em novo e em triagem, só se a matriz permite ir a `em_atendimento`.

  Tomar ticket de outro é por "Atribuir".
- **Fila e categoria gravam só no "Salvar":** o `CatalogCombobox` zera o valor enquanto a pessoa busca. A categoria efetiva é derivada da fila escolhida, então reescolher a mesma fila não a apaga.
- **Dica da prioridade:** é o SLA **gravado no ticket** (snapshot). Só a prioridade nova, durante o PATCH, mostra a política do catálogo.
- **"Responder no WhatsApp"** vira "Abrir conversa" em ticket encerrado, que não entra em foco.
- **`getAssignableUsers`** traz também os inativos, com `is_active`: a timeline assina a trilha pelo nome, e quem foi desativado não é "Usuário removido". O "Atribuir" filtra os ativos.
- **Ator `system` na timeline** aparece como "Automático", e evento desconhecido como "Atividade registrada".
- **`formatBytes`** manteve o ponto decimal ("1.5 MB") para não mudar a saída do chat. Trocar para vírgula é decisão de produto.
- **Tons de SLA "aviso" e "cumprido"** usam âmbar e esmeralda, porque não há token semântico. Seguem o `ContractStatusBadge`.

**Revisão adversarial** (4 frentes, cada achado atacado por um verificador): 16 achados confirmados e 4 refutados, todos corrigidos.
- **Severidade média:**
  - 409 de versão numa ação da lateral não tinha toast, e no celular o alerta ficava fora da tela.
- **Severidade baixa, na interface:**
  - a dica de prioridade mostrava a política do catálogo e não o snapshot;
  - a falha das transições sumia com as ações sem aviso;
  - os itens do menu da nota tinham cerca de 28 px no celular;
  - `already_assigned` não relia a tela;
  - o "Definir empresa" aceitava uma 2ª escolha durante a releitura;
  - a busca da fila apagava a categoria;
  - o refresh da timeline deixava um buraco.
- **Severidade baixa, nos testes:** faltavam testes de filtros, foco, categorias por fila, `visibilitychange`, somente leitura em encerrado, escritas da lateral, busca que segue a URL e barra de SLA.

Cada teste novo foi provado matando o mutante descrito, e a restauração foi conferida com `cmp`/`diff --no-index`.

**Verificação:**
- typecheck ✓ · lint ✓ (0 erros; os 9 avisos já existiam) · test ✓ (2169) · build ✓.
- **Roteiro SSR** (`scratchpad/e2e6.mjs`, `next dev` na 3201): 19 conferências, sem navegador (AGENTS §3.12), todas verdes antes e depois das correções:
  - a lista abre para member e admin;
  - os protocolos ativos aparecem e o cancelado não, no filtro padrão;
  - **"Vence em 2 horas"** (alta, aberto há cerca de 6 h com a 1ª resposta dada) e **"Pausado · restavam…"** (aguardando cliente);
  - **o filtro na URL sobrevive a recarregar**, e a busca por protocolo acha o cancelado;
  - "Limpar filtros" aparece no filtro vazio;
  - o detalhe abre com a mensagem da conversa na timeline;
  - **o HTML da lista e do detalhe não traz `ai_triage` nem a chave idempotente**;
  - número inválido ou inexistente leva à tela de 404;
  - o menu tem "Tickets".

  Nenhum e-mail de outro usuário no HTML, só o do próprio viewer, que já vem do cabeçalho.

**Pendências / próximos passos:**
- **O visual e os cliques ficam para o dono conferir no navegador:** sem Playwright pela regra do projeto, a verificação foi código, testes e HTML do servidor.
- **Miniatura de anexo:** a foto é decodificada inteira, com a exibição limitada a `max-h-48`. A variante `thumb` na rota do anexo é backlog; a revisão classificou o risco como aceito.
- **Filtro de fila:** com o catálogo indisponível, ele oferece só "Todas" e "Sem fila", sem aviso. Isso é anterior ao PR 4 e não foi corrigido.
- **Duplicação aceita:** `postTicketAction` da lista e `useTicketMutation` do detalhe são 2 usos. No 3º (Início ou chat, PR 5), vale extrair.
- **PR 5:** chat (chip do ticket em foco, abrir ticket, trocar foco, Assumir) e Início (Minha fila / Não atribuídos).

**Armadilhas descobertas:**
- **`notFound()` numa página com `loading.tsx` responde 200:** o streaming já começou, e a tela de 404 vem no corpo, com `noindex` e o marcador `NEXT_HTTP_ERROR_FALLBACK;404`. Teste pelo corpo, não pelo status. A ficha de Clientes é igual.
- **O selo de SLA arredonda para baixo:** 1h59m59s é "1 hora". Para provar "Vence em 2 horas", recue um pouco menos que 6 h.
- **`router.refresh()` nos testes de componente:** o `RefreshGate` (Suspense com `use()` de uma promise pendente) imita a releitura do Next para provar botões travados durante o refresh.

## [2026-09-26] Fase 4 · PR 3 — chat e conexão com ticket, comentários, anexos e catálogos de admin

**Agente/Modelo:** Claude Opus 5.5 (4 frentes em paralelo; revisão adversarial em 4 frentes com verificação independente; correções; migration aprovada pelo dono; roteiro ponta a ponta)
**Objetivo:** O back da Fase 4 fica completo para as telas. O chat e a conexão respeitam os tickets; o ticket ganha comentários e anexos privados; o admin edita filas, categorias, SLA e rótulos de status.

**Arquivos alterados:** branch `feat/fase4-back-satelites`.
- **Banco:** `supabase/migrations/20260926120000_categoria_trava_mae.sql` e os casos T92e–h em `supabase/tests/tickets.sql`.
- **Chat e conexão:**
  - `features/chat/lib/upsert-message.ts`;
  - `api/chat/conversations/[id]/route.ts`;
  - `api/connection/disconnect/route.ts`, com teste novo;
  - o teste do webhook uazapi.
- **Comentários:**
  - `features/tickets/lib/comment-actions.ts`;
  - `schemas/comment.ts`;
  - `api/tickets/[id]/comments/**`;
  - `schemas/ticket.ts` passa a exportar `isPgSafeText`.
- **Anexos:** `src/lib/storage/ticket-attachments.ts` e `api/tickets/[id]/attachments/**`.
- **Catálogos:**
  - `schemas/catalog.ts`;
  - `mapCatalogError` em `lib/map-ticket-error.ts`;
  - `api/products/[id]`, `api/ticket-categories/**`, `api/sla-policies/[priority]` e `api/ticket-statuses/[key]`;
  - `queries/get-ticket-catalog.ts`.
- Tipos novos em `types.ts`, testes de tudo, PRD e este PROGRESS.

**O que foi feito:**
- **Relay depois de "resolvida":** o trigger já devolve a conversa `resolved` para `bot` no INSERT do inbound, mas o webhook decidia o relay pelo status lido antes. `upsertMessage` agora relê o status no inbound, e a 1ª mensagem depois de resolvida vai para a IA.
- **Limpar conversa com ticket:** `DELETE …?mode=clear` → 409 `{error}`. "Apagar" (sem mode) só arquiva e não toca nos tickets.
- **Desconectar com ticket:** com `wipe`/`deleteIntegration` e tickets, a rota responde 409 `conversations_have_tickets` com a contagem, **antes do logout**, e a instância segue conectada. Um 23503 residual também vira 409, e os 500 não repassam mais `error.message`.
- **Comentários:** o autor vem do viewer; editar e apagar (soft) só pelo autor, com o predicado de `comment-actions` (2º uso de `note-actions`, duplicado); apagado → 409; texto com NUL → 400.
- **Anexos:**
  - valida, sobe e só então faz o INSERT; se o INSERT falha, apaga o objeto;
  - chave `tickets/<ticket>/<uuid>`, sha256 calculado no servidor;
  - HTML, SVG e XML são guardados como `application/octet-stream`;
  - o GET dá 302 para URL assinada de 600 s, `Cache-Control: private`, com download pelo nome original fora de imagem, vídeo, áudio e PDF.
- **Catálogos (admin):** member → 403; `.strict()` barra `sla_mode`/`is_terminal`/`position`; nome ou rótulo repetido → 409 com o item existente; regras do trigger de categoria → 422 no campo do formulário.
- **Catálogo de quem abre ticket:** não oferece categoria de fila arquivada nem subcategoria de mãe arquivada. Se as filas não carregam, as categorias vêm `null`.

**Decisões tomadas:**
- **Migration nova, aprovada pelo dono na sessão:** `guard_ticket_category` lê a mãe com `FOR SHARE` e recusa reativar categoria de fila arquivada (`PRODUCT_ARCHIVED`, 422 no campo `archived`). Achado da revisão, **corrida R6**.
- **`mime` do anexo** guarda o tipo com que o objeto foi gravado: um `.html` fica `application/octet-stream`, e o nome original fica em `file_name`.
- **Ticket encerrado aceita comentário e anexo.** O banco não barra, e não inventei a regra.
- **Formato das 5 rotas de catálogo:** `{ok:true, item}`, com erro com `code` do mapa de tickets.

**Corrida R6:** arquivar a mãe × criar ou reativar a filha, com duas sessões `psql` reais no banco local como `service_role`. A 1ª sessão segura a transação por 3 s. Nas 4 ordens, a 2ª **espera o commit** (cerca de 2 s) e recebe o erro coerente:

| Ordem | Erro da 2ª sessão |
|---|---|
| inserir primeiro → arquivar a mãe | `CATEGORY_HAS_ACTIVE_CHILDREN` |
| arquivar primeiro → inserir | `CATEGORY_ARCHIVED` |
| arquivar primeiro → reativar a filha | `CATEGORY_ARCHIVED` |
| reativar primeiro → arquivar | `CATEGORY_HAS_ACTIVE_CHILDREN` |

Nenhum estado final tem filha ativa sob mãe arquivada. Antes da migration, o verificador reproduziu o estado proibido nas 4 ordens, num cluster descartável.

**Revisão adversarial:**
- **Anexos e autoria:** nenhum achado. Os probes de content-type contra o storage real confirmaram que `html`/`svg`/`xml`/vazio saem como octet-stream.
- **Chat e conexão:** nenhum achado.
- **Catálogos:** a corrida R6.
- **Testes:** dois achados. O teste do relay não fixava qual linha era relida, e o do disconnect não cobria exatamente 1 ticket; os dois foram corrigidos e provados por mutação.

Dos 37 mutantes, os demais morreram.

**Verificação:**
- Testes SQL: baseline 52, cadastros 63, segredo 7, tickets 157.
- `db:types` sem mudança.
- typecheck ✓ · lint ✓ (0 erros; os 9 avisos já existiam) · test ✓ (1965) · build ✓.
- **Roteiro ponta a ponta** (`scratchpad/e2e5.mjs`, `next dev` na 3201, receptor HTTP no lugar da IA e da uazapi): as 43 conferências passaram. Os 4 critérios de pronto do PR 3:
  - resolvida + inbound → relay já na 1ª mensagem;
  - desconectar com apagar + ticket → 409, e a uazapi nem é chamada;
  - `.html` guardado e servido como octet-stream;
  - member → 403 nas rotas de admin.

  Também passaram comentários (autor, 403, 409), anexo com os bytes idênticos pela URL assinada, limpar → 409, SLA novo sem mexer no ticket aberto e categoria repetida, de 3º nível e reativada em fila arquivada. Os dados foram apagados e o catálogo restaurado.

**Pendências / próximos passos:**
- **Anterior a este PR (na `main`):** um retry da uazapi com a mesma mensagem repassa de novo à IA, porque o upsert ignora a duplicata mas devolve a conversa. Tratar no relay v1 (Fase 5), que já vai ter deduplicação.
- **Anterior a este PR:** `disconnect` com corpo JSON `null` lança 500. Não tocado.
- **PR 6 (4f):** falta uma leitura de admin que traga filas e categorias arquivadas (`getProducts` e `getTicketCatalog` só trazem as ativas).
- **Na tela do ticket (PR 4):** ao editar um ticket de fila arquivada, a categoria atual vem do próprio ticket, não do catálogo.
- **Resíduo aceito do PR 1:** INSERT de comentário ou anexo com autor sendo apagado ao mesmo tempo pode dar 40P01.
- **Texto com NUL em `customers`:** continua registrado, fora do escopo.

**Armadilhas descobertas:**
- **supabase-js 2.105, opção `download` de `createSignedUrl`:** o nome passa por `encodeURI` depois de já codificado, e "relatório final.pdf" baixa como `relat%C3%B3rio final.pdf`. `signTicketAttachment` monta o parâmetro com `URL.searchParams`.
- **O UUID das rotas aceita maiúsculas, e o CHECK da `object_key` exige minúsculas.** A chave sai do id lido do banco.
- **Limpeza de anexo de teste:** use a API do storage (`DELETE /storage/v1/object/<bucket>` com `prefixes`), não `delete from storage.objects`, que deixa o arquivo órfão no volume.

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
