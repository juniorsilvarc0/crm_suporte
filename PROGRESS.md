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
