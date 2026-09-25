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
