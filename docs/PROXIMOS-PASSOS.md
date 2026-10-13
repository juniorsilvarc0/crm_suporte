# Próximos passos — onde o projeto está e o que falta

> **Para quem vai continuar o desenvolvimento** (agente de IA ou pessoa) sem ter acompanhado as conversas anteriores. Este arquivo diz onde o trabalho parou, o que vem agora e em que ordem. O **porquê** de cada coisa está nos documentos que ele aponta.
>
> **Manter vivo:** todo PR que muda o que falta fazer atualiza este arquivo no mesmo PR ([`AGENTS.md`](../AGENTS.md) §8 e §9). Retrato de **2026-10-02**.

## 1. Ordem de leitura

1. [`AGENTS.md`](../AGENTS.md): as regras. Nenhum arquivo é editado antes dos §0 e §2.
2. Este arquivo.
3. [`docs/PLANO-IMPLANTACAO.md`](PLANO-IMPLANTACAO.md): as dez fases do produto (§E) e a verificação de cada uma.
4. [`docs/PLANO-FASE-5.md`](PLANO-FASE-5.md): os PRs da fase em curso e as decisões do dono (D1 a D14).
5. [`PROGRESS.md`](../PROGRESS.md): as entradas do topo. Cada uma tem "Pendências" e "Armadilhas descobertas".
6. [`PRD.md`](../PRD.md), [`UI.md`](../UI.md), [`SKILLS.md`](../SKILLS.md) e [`CONTRIBUTING.md`](../CONTRIBUTING.md), conforme a task.

## 2. Estado atual

| | |
|---|---|
| `main` | até o PR #44 (o 13d: o PR 13 fecha, §5.1). Aberto: o PR dos documentos do PR 14 (§5.2). |
| Verificação na `main` | `typecheck`, `lint` (9 avisos antigos), `test` (4417 testes em 234 arquivos) e `build` verdes. |
| Trabalho em curso | Documentos do PR 14 **prontos**, à espera do merge. Falta rodar o roteiro curl com Docker (§5.2). |
| Produção | roda o que foi publicado em 2026-09-29 (PR #19). **Nada do #20 ao #38 foi publicado.** Publicar é decisão do dono (§8). |

## 3. O que já foi feito

| Fase ([plano §E](PLANO-IMPLANTACAO.md)) | Estado | PRs |
|---|---|---|
| 0 · Separar o repositório | feito | commit inicial |
| 1 · Poda do legado | feito | #1 |
| 2 · Baseline do banco, contatos, Vault, mídia privada | feito | #4 (e #2, #3: sessão confirmada no banco) |
| 3 · Cadastros (empresas, contatos, filas, planos, contratos) | feito | #5, #6 |
| 4 · Tickets | **falta o Quadro** (§5.4) | banco #7 · back #8, #9 · lista e detalhe #10 · chat e Início #11 · Configurações › Atendimento #15 |
| 5 · API v1 + relay | **em curso** (§4 e §5) | relay sem token #19 · banco #20 · `withApi` #21 · tokens com escopo #22 · catálogos #23 · empresas e contatos #24 · `/context` #25 · tickets #26, #27 · conversas da IA #28, #29 · envio #30 · a IA na tela #31 · teto do corpo #33 · relay v1 #34 · chave de assinatura e teste de conexão #36 · registros e Saúde (back) #40 · Integrações em abas #41 · Registros e Saúde #42 · editar token #43 · catálogo em Variáveis #44 |
| 6 · Eventos, worker e SLA ativo | não começou | |
| 7 · Agenda e follow-ups | não começou | |
| 8 · Financeiro | não começou | |
| 9 · Métricas de suporte | não começou | |
| 10 · Produção | infra feita; faltam dois itens (§5.6) | #12, #14, #17, #18 · identidade visual #13 |

Correções fora do plano que já entraram: testes de tela instáveis (#16, #32), guarda de URL (#35), escrita só da própria origem (#37), pedido do QR por POST (#38).

O que cada PR decidiu e por quê está no `PROGRESS.md` (uma entrada por PR) e na descrição do próprio PR no GitHub, na seção "Decisões que tomei e você deveria revisar".

## 4. PR 12b: feito (#40)

**O que é:** o back das abas Registros e Saúde da tela de Conexão ([plano da Fase 5](PLANO-FASE-5.md), PR 12): `GET /api/connection/logs` e `GET /api/connection/health`. Só leitura, só administrador, sem migration. A tela vem no PR 13.

**Como terminou (2026-10-02):** o código da branch `feat/conexao-registros-e-saude` entrou como estava. Os dois testes que falhavam foram reescritos de acordo com o código, e os docs do item 5 da lista antiga foram atualizados. A branch `wip` pode ser apagada depois do merge do #40.

**Não feito:** a conferência por HTTP contra o stack local (item 4 da lista antiga). O ambiente em que o PR foi terminado não tinha Docker. Vale fazer antes de publicar, com o roteiro de §9.2:
- filtros e paginação, inclusive a segunda página com filtros e linhas de mesmo `created_at` atravessando o corte;
- `pedido` com caractere inválido é ignorado (200), e cursor inventado dá 400;
- os números da Saúde batem com a conta feita em SQL;
- dois pedidos seguidos à Saúde trazem o mesmo `generatedAt`.

### 4.1 Decisões tomadas (não refazer)

- **Leitura que falha não vira vazio nem zero.** A lista devolve `unavailable` (a rota responde 500) e cada parte da Saúde tem o seu `unavailable`. É de propósito o contrário do padrão das outras listagens: numa tela de diagnóstico, "nenhum registro" com o banco fora do ar é mentira.
- **As chaves do filtro são os nomes da URL** (`integracao`, `status`, `acao`, `token`, `pedido`, `periodo`), como nas listas de tickets, clientes e contatos. O cursor não é filtro.
- **Valor desconhecido na URL é ignorado,** e a rota devolve os filtros que valeram.
- **`acao` só aceita o que está em `INTEGRATION_LOG_ACTIONS`.** Um teste confere essa lista contra as rotas da v1 e contra quem grava no repasse.
- **Busca por `pedido` (o `request_id`) ignora o período.**
- **Sem `count` na lista:** página de 50 com cursor opaco sobre `(created_at, id)`.
- **O `payload` nunca sai.** Dele o banco extrai só `payload->>by`, que vira `actor` quando é um uuid.
- **O repasse é contado pela ação** `conversation.message_received`. O teste de conexão e a trilha da chave usam o mesmo provider `relay` e não são entregas.
- **A API separa 4xx (erro de quem chama) de 5xx (erro do CRM).** Só entra o que foi registrado: pedido sem token ou barrado por excesso não aparece.
- **Última mensagem recebida, sem migration:** procura nas 50 conversas mais recentes. É o horário da mensagem, informado pelo provedor, e não o da chegada. Mensagem apagada e conversa limpa não contam. `exact: false` quer dizer piso.
- **A Saúde guarda o resultado por 10 s por processo.** A rota é GET, e GET fica fora da trava de origem: sem isso, uma aba em laço chamaria o provedor em laço.

### 4.2 Limites conhecidos

- Filtro raro (`status=error` com tudo saudável) lê o período inteiro: `status` e `action` não têm índice. Um índice parcial resolve, e pede migration.
- A última mensagem recebida teria uma consulta só, e exata, com um índice em `chat_messages (created_at) where direction = 'inbound'`. Também é migration.
- O expurgo de `integration_logs` (90 dias, D9) só começa a rodar na Fase 6.
- `src/features/integrations/components/integration-logs-table.tsx` está órfã e filtra no navegador. O PR 13 a refaz.

## 5. Depois, nesta ordem

### 5.1 PR 13 da Fase 5: a tela de Integrações em abas (front)

Texto do plano: [`PLANO-FASE-5.md`](PLANO-FASE-5.md), "PR 13". O PR foi dividido em três.

**13a, feito (#41):**
- `/app/conexao` virou **Integrações**, com as abas na URL pelo `UrlTabs` (`src/components/layout/url-tabs.tsx`, que o Atendimento também usa): WhatsApp (a padrão), API do CRM, Agente de IA (`keepMounted`) e Variáveis.
- `/app/configuracoes` só redireciona (307) para `/app/conexao?aba=variaveis`. O item Configurações saiu do menu, e o Atendimento segue em `/app/configuracoes/atendimento` (D14, decidido em 2026-10-02).
- O `revalidatePath` das rotas de token, de variável e da chave aponta para `/app/conexao`.
- O pedido do QR continua POST (#38).

**13b, feito (#42): as abas Registros e Saúde,** sobre as rotas do #40. Como ficou está em `UI.md` §5.19. Em resumo:
- **Registros:** `IntegrationLogsTable` refeita. Os filtros ficam na URL e são lidos no servidor, e "Carregar mais" pede `GET /api/connection/logs` com o cursor. A página só lê os registros com a aba aberta.
- **Saúde:** `IntegrationHealthPanel` pede `GET /api/connection/health` ao abrir a aba e no "Atualizar". A página nunca a lê.
- **Não feito:** o roteiro por HTTP contra o stack local (§4), de novo por falta de Docker.

**13c, feito (#43): editar token na API do CRM.** Nome, escopos um a um (com "Aplicar IA de triagem" e "Limpar"), quem usa, limite por minuto e validade, sobre o `PATCH /api/api-tokens/[id]` que já existia. Como ficou está em `UI.md` §5.19.

**13d, feito (#44): Variáveis.** "Adicionar" escolhe num `FormSelect` só as chaves do catálogo sem valor. Saíram a coluna Origem e os rótulos "Servidor" e "Sobrescrever", e variável fora do catálogo só tem "Remover". Com ele, o PR 13 fecha.

### 5.2 PR 14 da Fase 5: documentação da API e guia do agente

**Documentos, feito (no PR aberto, à espera do merge):** `docs/API.md` e `docs/GUIA-AGENTE-IA.md` reescritos a partir do código. Neles ficaram decididos e documentados:
- **o contrato é aditivo:** o OpenAPI publica `additionalProperties: false` e uuid só em minúsculas, mas a API aceita maiúsculas e pode ganhar campos. O cliente não deve validar a resposta de forma estrita e deve ignorar o que não conhece;
- **os limites de texto contam unidades UTF-16;**
- **despedir-se antes do handoff:** depois dele o envio responde 409;
- **o `changed: false` do handoff vem sem `ticket_id` e sem `note_id`.** Os PATCH, as transições e a atribuição devolvem o ticket mesmo assim. O texto antigo deste item dizia "não traz o ticket", e o código mostrou que isso só vale no handoff;
- **o cliente .NET no upload de anexo.**

**Falta: rodar o roteiro curl de 8 passos** (`GUIA-AGENTE-IA.md` §6) contra o app local e anotar a saída no `PROGRESS.md`. É o "pronto quando" da Fase 5, e pede Docker. A ordem difere da do plano em dois pontos:
- o handoff vem antes do envio recusado (409), o que dispensa uma sessão de analista;
- resolver o ticket leva duas transições (`novo` → `em_atendimento` → `resolvido`), porque a matriz de estados não permite pular.

### 5.3 PR 11b da Fase 5: tirar o filtro `bot` do repasse

Só depois de o dono confirmar que a IA só responde quando `conversation_status` é `bot`. Entra com o teste que falha se o filtro voltar.

### 5.4 Fase 4, PR 7: o Quadro

`/app/tickets/quadro` sobre `kibo-ui/kanban`, com "Mover para", véu e 409 desfazendo com toast ([plano §E](PLANO-IMPLANTACAO.md), item 4c). É o que falta da Fase 4.

### 5.5 Fases 6 a 9

Descrição e "pronto quando" de cada uma em [`PLANO-IMPLANTACAO.md`](PLANO-IMPLANTACAO.md) §E.

- **6 · Eventos, worker e SLA ativo.** A Fase 5 deixou para ela:
  - o repasse passa para o outbox, com nova tentativa. Hoje é "no máximo uma vez";
  - teto de repasses simultâneos;
  - a troca da chave de assinatura sem intervalo de recusa;
  - o expurgo de `integration_logs` e de `api_idempotency_keys`;
  - o escopo `notices:claim`.
- **7 · Agenda e follow-ups.** Telas recuperadas da tag local `legado-clinica`, que não existe no repositório público.
- **8 · Financeiro.** Em paralelo com a 7.
- **9 · Métricas de suporte.** `docs/especificacao_dashboard_frontend.md` é da clínica e está obsoleto: não usar.

### 5.6 O que falta da Fase 10

- Política de privacidade definitiva: o texto está escrito (`src/features/legal/privacy-policy.ts`, 2026-10-09) e espera a revisão jurídica e os dados do controlador (os trechos `[[ ]]`). Enquanto houver um trecho a preencher, a página se declara rascunho e não é indexada.
- Cópia do backup fora do servidor: requisito de go-live, ainda sem destino.

## 6. Correções e propostas fora do plano

Nenhuma é pré-requisito do §4 ou do §5. Cada uma pede PR próprio.

### 6.1 Tela de Conexão do WhatsApp (só com o OK do dono)

Mexe no fluxo de conexão, que não se testa contra o provedor de verdade. Detalhe no PROGRESS de 2026-10-01, "O pedido do QR deixa de ser GET".

- O painel pede QR quando não deveria: "Atualizar" e "Tentar de novo" pedem em qualquer estado, e o fluxo fica em `"qr"` depois de parear.
- Um pedido de QR que falha é mudo: a tela fica em "Gerando QR Code…" sem dizer por quê.
- Não medido: o que o provedor faz num `/instance/connect` com a instância já conectada. Medir com uma instância de teste.

### 6.2 Segurança e robustez

| Item | Onde |
|---|---|
| Abrir a conversa zera as não lidas por GET. O `PATCH { action: "mark-read" }` da mesma rota já existe: trocar a chamada tira a exceção da lista em `api-guards.test.ts` | `src/app/api/chat/conversations/[id]/route.ts` |
| A busca da lista de conversas monta o `.or()` com o termo cru. Usar tokens, como `searchTokens` na lista de tickets | `src/app/api/chat/conversations/route.ts` |
| A trava de origem mora só no proxy. Repeti-la nas rotas pede o método, que os guards não recebem | `src/proxy.ts`, PROGRESS 2026-10-01 |
| Telas do chat e da conexão mostram o código do erro do proxy (`unauthorized`, `cross_origin`) no lugar da frase: leem `error`, e não `message` | `use-messages.ts`, `connection-panel.tsx`, `audio-message.tsx` |
| A guarda de URL confere o nome, e não para onde ele resolve. Fechar antes de aceitar URL vinda de token (`source_url` de anexo, que por isso ainda não existe na v1) | `src/lib/security/ssrf-guard.ts` |
| As chamadas ao provedor seguem redirecionamento levando o token. **Mexe no envio do WhatsApp: só com o OK do dono** | `senders/uazapi.ts`, `connection/uazapi.ts` |
| `api/tags` devolve `error.message` do banco | `src/app/api/tags/route.ts` |

### 6.3 Envio pela API e mensagens da IA

Detalhe nos PROGRESS dos PRs 10a, 10b e 10c.

- Conciliar o envio de desfecho desconhecido com `POST /message/find` do provedor (`track_id`).
- Medir o `/send/text` com a instância deslogada, com instância de teste.
- A falha de uma mensagem de token não tem saída na tela: falta uma ação de dispensar.
- O administrador apagar a nota de um token (PR 10d; decisão do dono).
- A busca dentro da conversa rotula toda saída como "Você", inclusive a da IA.

### 6.4 Webhook de entrada

`status@broadcast`, reação e mensagem editada viram mensagem nova do cliente e são repassadas à IA. Medir o que o provedor entrega e filtrar no normalizador. O que fazer com reação e edição é decisão de produto.

### 6.5 Tela e limpeza

- Backlog visual: [`UI.md`](../UI.md) §12.
- Os modais antigos que recusam fechar durante o envio ainda não usam `dismissible` do `Dialog`.
- O stub de `window.matchMedia` aparece em 13 arquivos de teste: cabe num setup do vitest.
- `firstParam` e o tipo `SearchParams` estão copiados em três consultas (tickets, clientes, contatos). O 12b cria `src/lib/http/search-params.ts`; migrar as três é um PR pequeno.
- `@aws-sdk/client-s3` está no `package.json` e foi anotado como sem uso. Conferir e remover.
- `.agents/skills/` é uma cópia antiga das skills de `.claude/skills/`: decidir se some ou se passa a espelhar.

## 7. Decisões que esperam o dono

O padrão descrito é o que está no código hoje. Cada uma está explicada no PR indicado.

| Decisão | PR | Padrão hoje |
|---|---|---|
| Corrigir a tela de Conexão (§6.1) | #38 | não corrigido |
| O que sobra em `/app/configuracoes` (D14) | 13a | **decidido** (o dono delegou): só o Atendimento; o resto foi para Integrações |
| A IA só responde em conversa `bot`? Libera o PR 11b | #34 | o filtro `bot` continua |
| Rotação do segredo do webhook (D13) | #36 | proposta: adiar |
| Testar a URL do agente antes de salvar | #36 | o teste vai à URL salva |
| Escopo `comments:read` fora do preset da IA; upload a partir de cliente .NET | #27 | como está (o dono pediu para deixar para depois) |
| O resumo do handoff vira nota interna no chat | #28 | implementado assim |
| Alcance de `conversations:handoff`; trocar o foco em conversa `human` | #29 | permitido |
| Tetos de envio (20 por minuto, 100 por hora); a integração envia em qualquer status; `{{...}}` no texto | #30 | como está |
| Ninguém edita mensagem da IA; integração se chama "Integração" | #31 | implementado assim |
| Repasse "tudo ou nada"; o ticket inteiro no envelope | #34 | implementado assim |
| Sem registro em log da recusa por origem; segunda camada nas rotas | #37 | sem log; só no proxy |
| O painel do contato não tirar o foco de um campo já clicado | #32 | não corrigido |
| Redirecionamento nas chamadas ao provedor | #35 | segue o redirecionamento |
| Índices para os registros e para a última mensagem recebida (migration) | 12b | sem índice |

## 8. Publicar em produção

- **Só com autorização literal do dono** ("pode subir"), por lote ([`AGENTS.md`](../AGENTS.md) §3.9 e §10). Leitura para diagnóstico é permitida.
- O roteiro é o de [`deploy/README.md`](../deploy/README.md) §Deploy seguinte: `publicar.sh` aplica as migrations antes do build e troca uma réplica por vez.
- **A sessão de nuvem do Claude Code não alcança a VPS:** não tem a chave SSH, o endereço do servidor nem liberação de rede. Em 2026-10-02 o dono pediu para publicar, e o deploy ficou para ele rodar da própria máquina. Configurar a chave de produção num container de nuvem é possível, mas não é recomendado: amplia quem alcança uma VPS compartilhada.
- Para o que está na `main` e ainda não foi publicado:
  - o #24 mudou o vhost: depois do `publicar.sh`, reinstalar como em `deploy/README.md` §Atualizar o vhost;
  - há duas migrations (#20 e #28), aditivas. Se a do #28 falhar com `lock timeout`, nada mudou: rodar de novo, fora do horário do backup (03:30 UTC);
  - uma aba da tela de Conexão aberta antes do deploy deixa de receber o QR até ser recarregada (#38).
- Regras do dono que valem sempre:
  - o servidor é compartilhado com outros sistemas: não tocar em nada que não seja deste;
  - não mexer na conexão do WhatsApp de produção nem nos segredos dela;
  - não gravar nem perder dado do banco de produção;
  - nunca testar contra o provedor ou o agente de verdade.

## 9. Como trabalhar aqui

### 9.1 O ciclo de cada PR

É o que os PRs #20 a #38 seguiram.

1. Branch a partir da `main`. Se o PR anterior ainda não foi mergeado, a partir da ponta dele: o `PROGRESS.md` é append-only no topo, e duas branches irmãs sempre conflitam ali.
2. Bloco `TASK ENQUADRADA` ([`AGENTS.md`](../AGENTS.md) §0.1) antes de editar.
3. Código e testes juntos. Teste ao lado do arquivo, com título em português que diz o comportamento.
4. **Mutação:** uma lista de alterações propositais no código novo, cada uma tem de derrubar algum teste. A que sobrevive vira teste, ou sai da lista com o motivo anotado.
5. **Revisão independente:** um ou dois revisores numa cópia separada do repositório, com a missão de achar defeito (segurança; regressão e qualidade dos testes). Cada achado é conferido antes de virar mudança.
6. **Conferência por HTTP contra o stack local,** no servidor de desenvolvimento e no build de produção (`.next/standalone`).
7. `pnpm typecheck`, `pnpm lint`, `pnpm test` e `pnpm build`, com o código de saída lido.
8. Documentação no mesmo PR: `PROGRESS.md` (entrada nova no topo), este arquivo, e `PRD.md`, `UI.md`, plano e skill quando mudam.
9. Commits por camada (banco, back, front, docs), em português.
10. PR para a `main` com a descrição escrita para o dono, em linguagem simples: o que é, o que muda, **decisões que tomei e você deveria revisar**, como foi verificado, deploy. O dono faz o merge.
11. Fechar com o bloco `CONCLUÍDO` ([`AGENTS.md`](../AGENTS.md) §8).

As skills `bug-hunter` e `verification-before-completion`, que o `AGENTS.md` pede, podem não estar instaladas no ambiente. Diga isso no fechamento; os passos 4 a 7 fazem o papel delas.

### 9.2 Conferência local sem tocar em nada real

- O banco é o Supabase local do `docker-compose.yml`. A integração de WhatsApp do ambiente local tem de apontar para um endereço que não existe (`https://demo.invalid`), e o roteiro confere isso antes de começar.
- Provedor e agente, quando o teste precisa deles, são servidores de mentira em `127.0.0.1`.
- O roteiro apaga o que criou e devolve a configuração local ao que era, mesmo quando falha.
- Sem Playwright nem teste de navegador ([`AGENTS.md`](../AGENTS.md) §3.12).

### 9.3 Armadilhas que custaram tempo

O campo "Armadilhas descobertas" de cada entrada do `PROGRESS.md` tem a lista completa. As que mais se repetem:

- `next build` reescreve `next-env.d.ts`: devolver com `git restore next-env.d.ts`.
- Trocar de branch depois de rodar o servidor de desenvolvimento deixa `.next/dev/types` apontando para rotas da branch anterior, e o `typecheck` falha com TS2307 em `.next/dev/types/validator.ts`. É arquivo gerado: apagar `.next/dev/types`.
- `comando | tail` engole o código de saída: para saber se passou, rodar sem pipe e ler `$?`.
- Em zsh, uma variável chamada `path` é o `PATH`: `read -r st path` quebra todos os comandos seguintes do laço.
- Arquivo `route.ts` só exporta handler e configuração, e handler de rota de sessão é sempre `export function` (`api-guards.test.ts`).
- Rota que muda estado nunca é GET: a trava de origem só cobre escrita, e o Next responde HEAD chamando o GET.
- `vi.restoreAllMocks()` não zera o histórico de `vi.fn()`: usar `vi.clearAllMocks()` no `beforeEach`.
- Com relógio de mentira, avançar o tempo em passos (um `act` por segundo), e clicar com `fireEvent`: o `userEvent` espera um temporizador que não anda.
- O `created_at` do banco tem microssegundos e o `Date` do JS tem milissegundos: cursor guarda o texto cru.
- Nunca listar processo com `pgrep -fl` ou `ps e`: imprime o ambiente, com os segredos locais.
