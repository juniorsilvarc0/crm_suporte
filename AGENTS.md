<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# AGENTS.md — Regras Operacionais para Agentes de IA

> **Análise antes de código · alteração mínima · máxima aderência ao que já existe.**

Este documento é **normativo**. Ele vence suposições, hábitos do modelo e "boas práticas" genéricas da internet. Se você é um agente de IA (Claude Code, Codex, Cursor, qualquer um) lendo isto: você **não está autorizado a editar arquivo** antes de cumprir o §0 e o §2.

**Produto:** **CRM Suporte** — CRM de atendimento de suporte técnico para software house: chamados pelo WhatsApp, triagem por IA externa via API, tickets, empresas, contatos, contratos e SLA. ⚠️ **Em conversão** a partir de um CRM de clínica: os módulos da clínica saíram na Fase 1 (ver §4.2); banco e tipos herdados mudam nas fases seguintes de [`docs/PLANO-IMPLANTACAO.md`](docs/PLANO-IMPLANTACAO.md).

**Documentos irmãos (leitura obrigatória, §2):** [`PRD.md`](PRD.md) · [`UI.md`](UI.md) · [`PROGRESS.md`](PROGRESS.md) · [`SKILLS.md`](SKILLS.md) · [`CONTRIBUTING.md`](CONTRIBUTING.md)

---

## §0. Template de Tarefa (aplique a TODA task)

**Independente de como o pedido chegar** — uma frase, um print, um áudio transcrito, "arruma isso aqui" — a sua **primeira ação** é enquadrar a task neste template e devolver o bloco preenchido **antes de tocar em qualquer arquivo**. Derive os campos da task + leitura do código. Não pergunte o que dá para descobrir lendo. O que não der para derivar **e** mudar o resultado → §7 (pare e pergunte).

### §0.1 Abra a resposta com este bloco

```
TASK ENQUADRADA
- Objetivo: <o resultado esperado, 1–2 frases — não a implementação>
- Área: <início | chat | conexão | equipe/config | perfil | webhook |
         banco/Supabase | infra/deploy | (fases seguintes: tickets, clientes,
         API v1, agenda, financeiro, métricas)> + arquivos prováveis
- Camadas tocadas: <front | back (route handler) | banco (migration)> — ver CONTRIBUTING §Escopo
- Fora de escopo: <o que você NÃO vai tocar>
- Toca dado sensível, produção ou banco? <sim/não — qual tabela; lembrar §3>
- Pronto quando: <critério observável: "webhook uazapi não duplica lead ao reenviar",
                  "mensagem enviada pelo chat aparece com tick de entregue">
- Orçamento de arquivos: "deve tocar N arquivos: X, Y, Z"
- Reuso encontrado: <o que já existe (§5)> | nenhum (grep: "<termos>")
- Skills lidas: SKILLS.md ✓   (obrigatório — diz quais valem e quais quebram a stack)
```

Se não puder preencher honestamente, **pare e pergunte** (§7). Depois execute o §2.

### §0.2 Regras que valem em toda task

1. **Orçamento estourou 2×?** O desenho está errado, não a execução — pare e reavalie. Diff mínimo (§4).
2. **Mesma edição semântica em ≥3 arquivos** = abstração faltando. Pare e proponha. Mas não abstraia no 1º uso; no 2º, duplique (regra dos 3 usos, coerente com §4/§5).
3. **Vai mudar contrato** (props, tipo exportado, retorno de route handler, shape de query, assinatura de RPC)? `grep` os call sites **antes**.
4. **Discorde quando for o caso.** Pedido errado, ambíguo ou com caminho mais simples → diga **antes** de executar. Nunca faça silenciosamente algo diferente do pedido.
5. **Frontend não inventa dado nem regra de negócio** para "melhorar a apresentação". Se o número não existe no banco, ele não aparece na tela. Ver UI.md §Princípios.
6. **Nada de mock silencioso.** Se a integração externa não responde, o estado é erro/vazio explícito — não dado fabricado.
7. **Português do Brasil** em UI, comentários, commits e docs. Nomes de código (variáveis, tipos, arquivos) em inglês, como já é.

### §0.3 Stack real (para não escrever código de versão/ferramenta errada)

**Next.js 16.2.6 App Router** · **React 19.2.4** · **TypeScript `strict: true`** · **Tailwind v4** (CSS-first, `@theme` em `src/app/globals.css` — **não existe `tailwind.config.js`**) · UI **Base UI (`@base-ui/react`)** + primitivos próprios em `src/components/ui` · **react-hook-form + zod** · **Supabase** (service role no servidor; anon só para Realtime do chat) · **Vitest + Testing Library** · **pnpm 10.33** · Node ≥20 · deploy em **VPS com Docker Compose atrás do Traefik**. Detalhe completo e skills por área: [`SKILLS.md`](SKILLS.md).

### §0.4 Verificação e fechamento

```bash
pnpm typecheck   # tsc --noEmit
pnpm lint        # eslint (flat config)
pnpm test        # vitest run
pnpm build       # next build — pega erro de fronteira client/server
```

Rodou **nesta resposta**, ou não rodou — "deve passar" não conta. Feche com o bloco `CONCLUÍDO` do §8, acrescentando **arquivos vs. orçamento** (§0.1) e **decisão que tomei sozinho e você deveria revisar**.

---

## §1. Hierarquia de regras (resolução de conflitos)

Quando duas orientações conflitarem, obedeça nesta ordem:

1. Instrução explícita e recente do usuário **nesta sessão**
2. `AGENTS.md` do subdiretório onde você está editando (se existir)
3. Este `AGENTS.md` (raiz)
4. `SKILLS.md`
5. `PRD.md` / `UI.md` / `CONTRIBUTING.md` / `PROGRESS.md`
6. Padrões observados no código existente
7. Convenções gerais da linguagem/framework
8. Sua opinião sobre "a melhor prática"

**Nunca** promova o item 8 acima dos demais. Se discordar de um padrão do projeto, **diga** — não o contorne em silêncio.

---

## §2. Protocolo de início de sessão (bloqueante)

Nenhuma edição de arquivo é permitida antes de concluir **todos** os passos:

- [ ] Ler este `AGENTS.md` **e** o `AGENTS.md` do subdiretório alvo, se existir
- [ ] Ler `PRD.md`, `UI.md`, `PROGRESS.md` e `SKILLS.md`. Se algum não existir, **criá-lo** conforme §9 antes de prosseguir
- [ ] Ler no mínimo **2–3 arquivos vizinhos** do código a ser alterado (mesmo diretório ou imports diretos)
- [ ] `grep` / busca semântica para checar se o que você vai criar **já existe** (§5)
- [ ] Declarar em uma frase: o que vai mudar, onde e por quê

Abra a primeira resposta da sessão com:

```text
CONTEXTO CARREGADO
- AGENTS.md: [raiz | raiz + <subdir>]
- Docs lidos: PRD ✓ | UI ✓ | PROGRESS ✓ | SKILLS ✓   (ou "criados")
- Arquivos vizinhos lidos: <lista>
- Reuso encontrado: <o que já existe> | nenhum (grep: "<termos usados>")
- Plano: <1 frase>
```

Se não puder preencher isso honestamente, **pare e pergunte**.

---

## §3. Regras invioláveis

| # | Regra |
|---|---|
| 1 | **Nenhum comando Git de escrita** (`commit`, `push`, `checkout`, `reset`, `rebase`, `stash`, `branch`, `merge`, `cherry-pick`) sem autorização explícita e literal do usuário **nesta sessão**. Ler estado (`status`, `diff`, `log`, `show`) é sempre permitido. |
| 2 | **Nunca commitar/pushar/mergear direto na `main`.** Branch + PR, sempre. Ver `CONTRIBUTING.md`. |
| 3 | **Nenhuma dependência nova** (pnpm/npm), lib, framework ou padrão arquitetural sem alinhamento prévio. Proponha, aguarde aprovação. |
| 4 | **Nenhuma regressão.** Não remova, renomeie nem altere assinatura de código existente fora do escopo da task. |
| 5 | **Nenhuma alteração fora do escopo.** Não "aproveite para" refatorar, reformatar, reordenar imports ou "melhorar" arquivo que a task não pediu. |
| 6 | **Não invente.** Arquivo, função, coluna, env var ou endpoint que você não verificou **não existe**. Não afirme que existe. |
| 7 | **Não delete comentário, teste ou código aparentemente morto** sem pedir. Código que parece inútil frequentemente não é. |
| 8 | **Migration é sempre arquivo novo** em `supabase/migrations/AAAAMMDDHHMMSS_descricao.sql`, idempotente e não destrutiva. **Nunca edite migration já aplicada.** |
| 9 | **Produção não se toca sem autorização explícita e literal.** Isso inclui: SQL de escrita, aplicar migration, alterar `.env` no servidor, `docker compose up`, rebuild de imagem, rotacionar token, mexer em webhook/permissão no Meta. Leitura (query read-only, `docker logs`, `docker ps`, inspeção de env mascarada) é permitida para diagnóstico. |
| 10 | **Banco administrativo pela Supabase Management API** (`https://api.supabase.com`) com o token que o usuário fornecer na sessão. Nunca persista esse token em arquivo, log, commit ou documentação. |
| 11 | **Segredo nunca vai para o repositório.** Nem em código, nem em doc, nem em comentário, nem em mensagem de commit. Se você viu um segredo no chat, ele não entra em arquivo. |
| 12 | **Não use Playwright nem teste de browser.** A verificação é `typecheck` + `lint` + `vitest` + `build` + leitura do diff. |

### §3.1 🟢 Estado de segurança do banco (medido no banco em 2026-08-19, após a migration `20260819120000_blindagem_anon.sql`)

> ⚠️ Esta seção foi **reescrita em 2026-08-19**. A versão anterior (herdada do template) descrevia `anon` com policy `SELECT` nas tabelas de chat. Isso valia enquanto o PostgREST só existia na rede interna; ao publicá-lo para o Realtime funcionar, virou leitura pública na internet. Ver `PROGRESS.md` da mesma data.

**O papel `anon` não alcança absolutamente nada.** Medido no catálogo, não inferido:

| Verificação | Estado |
|---|---|
| Tabelas de `public` com grant para `anon` | **0** |
| Funções de `public` executáveis por `anon` | **0** |
| Tabela/função **nova** nasce aberta para `anon`? | **não** (default privileges fechados) |
| Tabelas alcançáveis por `authenticated` | apenas `chat_conversations` e `chat_messages`, só `SELECT` |

O navegador **não usa mais a chave anônima**. Ele pede um JWT curto (15 min) em `GET /api/auth/supabase-token`, emitido de `src/lib/auth/supabase-token.ts` a partir do cookie `crm-suporte-session`, com `role: authenticated` e o claim **`app_role`**. O `supabase-js` o injeta em REST e Realtime pela opção `accessToken` (`src/lib/supabase/client.ts`).

- As policies de chat **filtram por `app_role`** (`admin`/`member`), repetindo no banco a regra que `src/config/navigation.ts` aplica na navegação. Sem esse filtro, um papel fora de `admin`/`member` (ex.: `paid_traffic`, que o app removeu mas a constraint do banco ainda aceita) leria todas as conversas chamando o PostgREST direto.
- Todo o resto passa por **`createSupabaseServerClient()` / `createSupabaseAdminClient()`**, que usam a **service role** e rodam **somente no servidor** (`src/lib/supabase/server.ts`, `src/lib/supabase/admin.ts`).

**Regras derivadas:**

1. **Não amplie a superfície do `anon`.** Ela é zero, e deve continuar zero. Consulta nova = server component, server action ou route handler com service role.
2. **`authenticated` é alcançável pela internet.** Todo grant a ele é uma rota pública para qualquer operador logado, **fora** do `route-guard`. Conceder tabela nova a `authenticated` é decisão de segurança: pergunte (§7), e escreva a policy filtrando por `app_role`.
3. **Função nova precisa de `revoke execute ... from public, anon, authenticated`.** No Postgres a função nasce com `EXECUTE` para **PUBLIC**, e `anon` herda dali — revogar só de `anon` **não fecha nada**. Padrão em `20260818120000_pacientes.sql:195`.
4. **Nunca** exponha ao cliente `api_tokens.token_hash`, `app_users.password_hash`, `meta_attributions.ctwa_clid` ou qualquer segredo de integração.
5. `createSupabaseServerClient` **não é** um client de sessão do usuário — é service role. Autorização é responsabilidade do guard (`src/lib/auth/route-guard.ts`) e da própria rota, não do banco.
6. ⚠️ **Ordem de deploy:** não existe fallback anônimo. A imagem com o `client.ts` novo precisa estar no ar **antes** de a blindagem ser aplicada; ao contrário, a lista de conversas cai.

### §3.2 Autenticação — modelo real

Não é Supabase Auth. É **JWT HS256 próprio** (`jose`) num cookie `crm-suporte-session`, assinado com `AUTH_JWT_SECRET` (mín. 32 chars, obrigatório em produção).

- `src/lib/auth/session.ts` — assina/verifica o token.
- `src/lib/auth/route-guard.ts` — decisão de acesso por rota, **isolada do runtime do Next para ser testável**.
- `src/proxy.ts` — traduz a decisão em resposta HTTP (é o middleware; o arquivo se chama `proxy.ts` no Next 16).
- Papéis: `admin` | `member`. O menu esconder um item **não é segurança** — a página confirma o papel fresco no banco (`getDashboardViewer`). Ao adicionar rota de admin, atualize **os dois**: `ADMIN_PAGE_PREFIXES` no guard e `allowedRoles` em `src/config/navigation.ts`.

Skill relacionada: nunca invoque `nextjs-supabase-auth` (ver `SKILLS.md` §Não invoque).

---

## §4. Padrão e arquitetura

- Siga **estritamente** o padrão existente: nomenclatura, estrutura de pastas, tratamento de erro, estilo de tipagem, forma de exportação, camadas.
- **Feature-slice.** Domínio novo mora em `src/features/<dominio>/` com `components/`, `queries/`, `schemas/`, `types.ts`. Não espalhe lógica de domínio em `src/app`.
- **Página é fina.** `src/app/**/page.tsx` busca dados (server), compõe e passa para o componente da feature. Lógica não mora na página.
- **Server por padrão, client só quando precisa.** `"use client"` exige interação, estado ou browser API. Server component não importa módulo que puxa `supabase/server` para dentro do bundle do cliente — se um client component precisa de um tipo/helper de um módulo de servidor, **extraia o tipo/helper para um arquivo neutro** (ver `src/features/chat/lib/contact-info.ts`, que a rota de servidor e o painel client compartilham).
- **Leitura resiliente.** Query de listagem retorna vazio e loga o erro em vez de derrubar a página — é o padrão de `getNotes`, `getAppUsers`. Mantenha.
- Menor diff possível que resolve o problema **completo**. Elegância > engenhosidade.
- Mudança que atravessa camadas (UI → domínio → banco) exige pausa e confirmação (§7) e **commits separados por camada** (`CONTRIBUTING.md`).
- Ao alterar contrato público, liste **todos** os call sites afetados antes de editar.

### §4.1 Mapa de código (para achar as coisas)

```
src/app/
  (dashboard)/app/*      # telas autenticadas: início (notas), chat, conexao,
                         #   equipe, configuracoes, perfil
  api/                   # route handlers, agrupados por finalidade:
    auth/                #   login/logout/definir-senha (cookie de sessão)
    chat/webhook/uazapi/ #   entrada de mensagem, auth PRÓPRIA
    <resto>              #   CRUD do app, protegido pela sessão
                         #   (a API v1 para integradores entra na Fase 5)
  login, definir-senha, politica-de-privacidade, offline
src/features/<dominio>/  # auth, chat, connection, home, integrations (logs),
                         #   leads (só identidade por telefone), quick-replies,
                         #   settings, tags
src/components/
  ui/                    # primitivos (Base UI) — reuse antes de criar
  data-display/          # data-toolbar, empty-state, page-skeletons
  forms/                 # form-select, color-swatch-picker, image-cropper-dialog
  layout/                # dashboard-shell, app-header, page-header, modal-shell
  kibo-ui/               # kanban, spinner, status
src/lib/
  auth/                  # session, route-guard, require-dashboard-session
  supabase/              # server (service role), admin, client (anon/Realtime), types
  security/              # api-token, rate-limit, verify-webhook
  formatters/            # phone, date, money, numbers, percentage, clean-name
src/config/              # navigation.ts (menu + allowedRoles), site.ts (marca)
supabase/migrations/     # fonte da verdade do schema
```

### §4.2 Hotspots — leia antes de editar

Arquivos grandes e acoplados. Abrir e ler a região inteira antes de mudar:

| Arquivo | ~linhas | Por quê é sensível |
|---|---|---|
| `src/lib/supabase/types.ts` | 1411 | Tipos do banco escritos à mão. Mudou coluna? Atualize aqui. Ainda descreve o banco herdado (a Fase 2 troca). |
| `src/features/chat/components/chat-view.tsx` | 1052 | Conversa aberta: bolhas, envio, anexos, áudio, citação. |
| `src/features/connection/components/connection-panel.tsx` | 870 | QR, estado da instância, ciclo de conexão. |
| `src/features/chat/components/contact-info-sheet.tsx` | 541 | Painel do contato e etiquetas, com geometria própria do chat. |
| `src/app/api/chat/webhook/uazapi/route.ts` | 328 | Entrada de toda mensagem: eco, mídia, ticks, identidade, relay. |

Os módulos da clínica (leads, funil, agenda, financeiro, métricas, rastreamento Meta) saíram na Fase 1; o código deles está na tag local `legado-clinica`.

---

## §5. Reutilização antes de criação

Antes de criar **qualquer** componente, hook, função, tipo, schema ou constante:

1. Busque no projeto:
   ```bash
   grep -rn "NomeProvavel" src/
   grep -rni "verbo\|substantivo" src/components src/lib src/features
   ```
2. Cheque `src/components/ui`, `src/components/data-display`, `src/components/forms`, `src/components/layout`, `src/lib/formatters`, e o `components/` da própria feature.
3. Ordem de preferência: **reusar** → **estender o existente** → **generalizar o existente** → **criar novo**.

Criar algo novo exige justificar **em uma linha** por que as três opções anteriores falharam.

Casos já resolvidos que agentes tendem a reescrever: formatação de telefone (`src/lib/formatters/phone.ts`), data (`date.ts`), dinheiro (`money.ts`), toolbar de busca/filtro (`data-toolbar.tsx`), estado vazio (`empty-state.tsx`), skeletons de página (`page-skeletons.tsx`), casca de modal (`modal-shell.tsx`), select de formulário (`form-select.tsx`).

---

## §6. Skills

### §6.1 Leitura obrigatória (bloqueante)

Antes de codificar, **leia [`SKILLS.md`](SKILLS.md)** — obrigatório, mesmo que você não pretenda invocar skill nenhuma. Ele lista o que serve para **esta** stack (Next 16 / React 19 / Tailwind v4 / Base UI / Supabase service-role / Vitest) e **o que a quebra**. Declare `Skills lidas: SKILLS.md ✓` no bloco do §0.1.

Skill que contradiz este AGENTS ou o SKILLS.md: **eles vencem**. Skill é conselho genérico; estes arquivos descrevem *este* app.

### §6.2 Skills obrigatórias por momento

| Momento | Skills |
|---|---|
| Bug / erro / comportamento inesperado | `systematic-debugging` (**antes** de propor o fix) |
| Escrevendo ou alterando código | `typescript-pro` (o projeto é `strict: true` de verdade) |
| Banco, query, RLS, migration | `supabase-postgres-best-practices` + `supabase` |
| Route handler, webhook, token, dado sensível | `backend-security-coder` |
| Tela nova ou componente novo | ler `UI.md` **antes**; `react-best-practices` |
| Escrevendo teste | skill local **`testes`** (`.claude/skills/testes`) |
| Mexendo na integração WhatsApp | skill local **`uazapi-integration`** (`.claude/skills/uazapi-integration`) |
| Antes de declarar concluído | `bug-hunter`, `verification-before-completion` |

Invocar a skill certa é obrigatório, não opcional. Se uma skill apontar um problema, **corrija antes de responder** — não relate e entregue quebrado mesmo assim.

---

## §7. Ambiguidade → pare

Pause e pergunte, **antes de codificar**, quando:

- A task admite duas interpretações razoáveis
- Há decisão arquitetural embutida (onde mora o estado, quem é dono do dado, qual camada valida)
- O padrão do projeto é ambíguo ou você achou dois padrões conflitantes
- A mudança exigiria dependência nova, quebra de contrato, migration ou mexer em produção
- Você precisaria **adivinhar** nome de arquivo, coluna, env var ou endpoint
- A mudança afeta o contrato consumido por agentes externos (`/api/integracao/*`) ou pelo n8n

Formato: **contexto + as opções + sua recomendação + o que você faria por padrão.** Uma pergunta por vez, direta.

Adivinhar custa mais caro que perguntar. Sempre.

---

## §8. Definição de "concluído"

Uma task só está concluída quando **todos** os itens são verdadeiros **e você os declara**:

- [ ] `pnpm typecheck` — zero erros nos arquivos tocados
- [ ] `pnpm lint` — zero erros e zero warnings novos
- [ ] `pnpm test` — suíte verde; teste novo para comportamento novo quando fizer sentido
- [ ] `pnpm build` — passou (é o único check que pega vazamento de módulo de servidor para o cliente)
- [ ] Skill `bug-hunter` executada
- [ ] Skill `verification-before-completion` executada
- [ ] Diff relido linha a linha: nada fora do escopo
- [ ] Nenhum `TODO`, `console.log`, código comentado ou stub deixado para trás
- [ ] `PROGRESS.md` atualizado (§9)
- [ ] `PRD.md` / `UI.md` atualizados **se** escopo ou interface mudaram
- [ ] Migration nova? Idempotente, arquivo novo, e o PR diz **quando** rodar

Encerre com:

```text
CONCLUÍDO
- Arquivos alterados: <lista>  (orçamento era N, ficou em M)
- typecheck ✓ | lint ✓ | test ✓ | build ✓
- bug-hunter ✓ | verification-before-completion ✓
- Docs: PROGRESS ✓ | PRD ✓/n-a | UI ✓/n-a
- Fora do escopo: nada
- Decisão que tomei sozinho e você deveria revisar: <ou "nenhuma">
- Riscos / o que não foi coberto: <honesto, ou "nenhum">
```

**"Deve funcionar" não é verificação.** Se você não rodou, não está concluído. Se algo falhou e você não resolveu, **diga** — entregar quebrado em silêncio é a única falha inaceitável.

---

## §9. Documentação viva (obrigatória)

Objetivo: **zero perda de contexto** entre sessões, entre modelos e entre agentes. Um agente novo, lendo só estes arquivos, deve retomar o trabalho sem fazer pergunta básica.

Se algum arquivo abaixo não existir, **crie-o na primeira ação da sessão**, preenchido com o que der para inferir do código, marcando lacunas com `[?]`.

| Arquivo | O que é | Ritmo |
|---|---|---|
| [`PRD.md`](PRD.md) | O que o produto é, para quem, escopo, decisões arquiteturais, glossário | Estável. Muda quando o escopo muda. |
| [`UI.md`](UI.md) | Sistema visual: tokens, primitivos, padrões, estados, anti-padrões | Muda quando a interface muda. **Consulte antes de criar UI.** |
| [`PROGRESS.md`](PROGRESS.md) | O que já foi feito, decidido e descoberto | **Append-only.** Entrada nova no topo. Nunca reescreva nem apague entrada antiga. |
| [`SKILLS.md`](SKILLS.md) | Quais skills servem para esta stack e quais quebram | Muda quando a stack muda. |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | Branch, commit, PR, camadas, migrations | Estável. |

Formatos canônicos de `PROGRESS.md` e `UI.md` estão nos próprios arquivos, no topo.

### Regra de ouro da documentação

> **Se não está documentado, não aconteceu.**
> Toda alteração de código exige a atualização de documentação correspondente **no mesmo turno**, antes de declarar concluído. Documentação não é entrega opcional — é parte do diff.

---

## §10. Operação e produção

Produção **ainda não foi definida** (decisão do dono em 2026-09-25): por enquanto o produto roda só em **Docker em localhost**. Hospedagem, domínio e scripts de deploy entram na Fase 10 do [`docs/PLANO-IMPLANTACAO.md`](docs/PLANO-IMPLANTACAO.md). Regras de conduta ficam aqui.

- Não é Vercel.
- **Deploy sai sempre de `git archive origin/main`**, nunca da árvore de trabalho. O que não está commitado não pode estar em produção.
- `NEXT_PUBLIC_*` é **embutido no build**. Trocar essas variáveis exige **rebuild**, não só restart.
- Variáveis de servidor vivem no `.env` do servidor, **fora** do diretório de código, para que um `rsync --delete` não as apague. Não mova.
- Antes de recriar container: **faça backup do `.env` que você vai alterar** e mostre o diff de chaves (não de valores).
- Depois de deploy: verifique `docker ps` (healthy), procure erro no log da aplicação, e confirme que a rota afetada responde. Relate o que viu, não o que esperava ver.
- Rollback: a imagem anterior deve estar tagueada antes do deploy (`<imagem>:prd-rollback`).

---

## §11. Nota sobre o `CLAUDE.md`

O `CLAUDE.md` da raiz **importa** este arquivo (`@AGENTS.md`) e apenas lista os documentos irmãos que precisam ser lidos, porque esses não são importados automaticamente. Fonte única da verdade: **este** documento. Não duplique regra lá; aponte para cá.

Agentes que não leem `CLAUDE.md` (Codex e afins) devem ler `AGENTS.md` diretamente. É o mesmo conteúdo, mesma obrigatoriedade.
