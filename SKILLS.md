# SKILLS.md — Skills para o CRM Suporte

Curadoria filtrada pela **stack real deste projeto**. Normativo: leia antes de invocar qualquer skill.

> **Precedência:** skill que contradiz o [`AGENTS.md`](AGENTS.md) **perde**. Skill é conselho genérico escrito para "um projeto Next qualquer"; este arquivo e o AGENTS descrevem *este* app. Se a skill assume outra stack, aproveite só os princípios.

---

## Stack real (não presuma diferente)

| Item | Real | Consequência |
|---|---|---|
| **Next.js** | **16.2.6 — App Router** | `src/app/` com route group `(dashboard)`. Route handlers em `src/app/api/*`. O middleware chama-se **`src/proxy.ts`**, não `middleware.ts`. Leia `node_modules/next/dist/docs/` antes de usar API que você "lembra". |
| **React** | **19.2.4** | Server Components por padrão. `use()`, Actions e `useOptimistic` existem. Não é React 18. |
| **TypeScript** | **`strict: true`** | O tipo protege. Não espalhe `any`. Alias `@/*` → `src/*`. |
| **Tailwind** | **v4, CSS-first** | ⚠️ **Não existe `tailwind.config.js`.** Tokens vivem em `@theme` dentro de `src/app/globals.css`; PostCSS via `@tailwindcss/postcss`. Skill que manda editar `tailwind.config.js` está errada aqui. |
| **UI** | **Base UI (`@base-ui/react`)** + primitivos próprios em `src/components/ui` (27) | ⚠️ **Não é Radix.** `shadcn` está nas deps como CLI/estilos, mas os primitivos foram portados para Base UI. A API de composição difere (`render={<Button/>}` em vez de `asChild`). |
| **Ícones** | **lucide-react v1** | Ícone de WhatsApp é próprio: `src/features/chat/components/whatsapp-icon.tsx`. |
| **Estado** | React local + server components + `router.refresh()` | ⚠️ **Sem Redux, Zustand, Jotai ou TanStack Query.** É deliberado. Revalidação vem do servidor. |
| **Forms** | **react-hook-form + zod** (`@hookform/resolvers`) | Existe de verdade — diferente de projetos com form manual. Use. |
| **Gráficos** | **recharts** | Sem uso desde a Fase 1; volta nas métricas de suporte (Fase 9). |
| **Drag & drop** | **@dnd-kit** | Kanban do funil (`src/components/kibo-ui/kanban`). |
| **Banco** | **Supabase (Postgres)** — `supabase-js` | **RLS em todas as tabelas; `anon` não alcança nada.** Server usa **service role** (grant mínimo, por coluna onde importa); o navegador só assina o Realtime do chat com JWT `authenticated` curto, por `subscribeAuthenticated`. Segredos no **Vault**. Tipos **gerados**: `pnpm db:types` (supabase CLI fixada via `npx`, só para isso). Ver §Segurança. |
| **Auth** | **JWT HS256 próprio** (`jose`) em cookie `crm-suporte-session` | ⚠️ **Não é Supabase Auth.** Papéis `admin`/`member`. Guard em `src/lib/auth/route-guard.ts`. |
| **Toast** | **sonner** | |
| **Tema** | **next-themes** (classe `.dark`) | Claro/escuro compartilham os mesmos componentes. |
| **Datas** | **date-fns** + `react-day-picker` | |
| **Testes** | **Vitest + Testing Library + jsdom** · testes de SQL em `supabase/tests/` | `pnpm test`; `./scripts/db-local-test.sh` no banco local. CI: job `qualidade` (typecheck + lint + test + build) e job `banco` (baseline do zero, reaplicar no-op, testes de SQL, tipos gerados sem diff). |
| **Package manager** | **pnpm 10.33** | Não é npm nem yarn. |
| **Deploy** | **VPS + Docker Compose + Traefik** | Há `.vercel/` histórico, mas **produção não é Vercel**. |

### Arquitetura real

```
src/app/(dashboard)/app/*   telas autenticadas
src/app/api/*               route handlers (4 famílias de auth — ver abaixo)
src/features/<dominio>/     components/ queries/ schemas/ types.ts
src/components/{ui,data-display,forms,layout,kibo-ui}/
src/lib/{auth,supabase,security,formatters,http,image}/
src/config/                 navigation.ts (menu + allowedRoles), site.ts (marca)
supabase/migrations/        fonte da verdade do schema
```

### Modelos de autenticação convivendo

Confundir os modelos é o erro mais caro deste repositório. A API v1 para integradores (token com escopo) entra na Fase 5 do plano.

| Família de rota | Autenticação | Onde |
|---|---|---|
| `/app/*` e a maioria de `/api/*` | Cookie `crm-suporte-session` (JWT HS256) **e**, em todo handler `/api`, confirmação no banco (`requireDashboardUser`/`requireDashboardAdmin`) | `src/proxy.ts` + `src/lib/auth/route-guard.ts` + `src/lib/auth/require-dashboard-session.ts`; `src/app/api/api-guards.test.ts` garante |
| `/api/chat/webhook/uazapi` | Segredo em query string (`?s=`), próprio da uazapi | `src/app/api/chat/webhook/uazapi/route.ts` |
| *(Fase 5)* `/api/v1/*` | Token de API com escopo (hash em `api_tokens`), base em `verifyWebhookAuth` | `src/lib/security/api-token.ts`, `src/lib/security/verify-webhook.ts` |

Rota nova em `/api` = **decida e declare** qual modelo ela usa. Se nenhum servir, pare e pergunte (AGENTS §7).

---

## 🟢 §Segurança — leia antes de tocar em dados

Estado **verificado via Management API em 2026-08-06**:

- **23 tabelas públicas, todas com RLS habilitada.**
- **6 policies no total.** Quatro são `service_role ALL`. Duas são `SELECT` para `anon`/`authenticated` em `chat_conversations` e `chat_messages` — existem **para o Realtime do chat**.
- `anon`/`authenticated` têm grants amplos no catálogo (161 cada), mas **a RLS bloqueia antes** — grant sem policy não lê nada.
- Todo acesso real passa por **service role no servidor**: `src/lib/supabase/server.ts` e `src/lib/supabase/admin.ts`. O client anon (`src/lib/supabase/client.ts`) serve ao Realtime.

**Regras:**

1. **Não amplie a superfície do `anon`.** Consulta nova = server component / server action / route handler com service role.
2. Ligar Realtime em tabela nova exige policy `SELECT` para `anon`. Isso é **decisão de segurança** — pergunte antes.
3. Service role **ignora RLS**. Autorização é do guard e da rota, não do banco. Route handler novo = decida a auth (tabela acima).
4. Nunca traga para o cliente: `api_tokens.token_hash`, `app_users.password_hash`, `meta_attributions.ctwa_clid`, tokens de integração.
5. Administração do banco **pela Supabase Management API**, com o token que o usuário fornecer na sessão. Nunca persista o token.

Skills para isso: **`supabase`** (RLS) + **`backend-security-coder`**.

---

## Tier 0 — Skills locais deste repositório

Moram em `.claude/skills/` e ganham de qualquer skill genérica no assunto delas.

| Skill | Quando | Por quê |
|---|---|---|
| **`uazapi-integration`** | Qualquer coisa de WhatsApp: conectar/QR, enviar/receber, ticks, áudio/ptt, anexo, lead automático, relay ao n8n, "não recebe mensagem" | Validada contra a instância real. O formato do webhook ali é o **real**, não especulativo. Regra de ouro documentada: tudo pende da linha `chat_integrations`. |
| **`testes`** | Escrever, rodar ou expandir teste | Descreve a configuração real (Vitest + Testing Library + jsdom) e os comandos deste projeto. |

Há também o subagente **`engenheiro-de-testes`** (`.claude/agents/`) para trabalho de teste em lote.

---

## Tier 1 — Use sempre

| Skill | Quando | Por quê |
|---|---|---|
| `systematic-debugging` | Qualquer bug, **antes** de propor fix | Root cause antes de remendo. Obrigatória pelo AGENTS §6.2. |
| `verification-before-completion` | Antes de declarar concluído | AGENTS §8 exige typecheck + lint + test + build **executados**. |
| `bug-hunter` | Investigação e fechamento | Obrigatória pelo AGENTS §6.2. |
| `code-simplification` | Diff cresceu / ficou complexo | Reforça diff mínimo (AGENTS §4). |
| `code-reviewer` | Antes de entregar | Pega regressão e alteração fora de escopo. |
| `typescript-pro` | Sempre que escrever código | `strict: true` de verdade. Ignore recomendação de mexer no `tsconfig` — já está configurado. |

---

## Tier 2 — Stack-específicas

| Skill | Área | Observação |
|---|---|---|
| **`supabase-postgres-best-practices`** | Schema, índice, query, RLS, policies | ✅ Escrita pela Supabase. Referência para migration e para query sobre `chat_messages` (~7,2k linhas). |
| **`supabase`** | supabase-js, Realtime, RLS, Storage | ✅ Fonte primária. O chat usa Realtime (`postgres_changes` INSERT+UPDATE). |
| `postgres-best-practices` | Postgres puro | Equivalente enxuto da anterior; use uma das duas, não as duas. |
| **`backend-security-coder`** | Route handlers, webhooks, token de API, rate limit | ✅ Quatro modelos de auth convivendo — prioridade alta. |
| `api-security-best-practices` | Superfície HTTP, idempotência de webhook | Webhooks são públicos por definição. |
| `nextjs-app-router-patterns` | Route groups, layouts, route handlers | ✅ App Router de verdade. ⚠️ Escrita para Next 14/15 — confira contra `node_modules/next/dist/docs/`. |
| `nextjs-best-practices` | RSC vs client, data fetching, cache | ✅ Mesma ressalva de versão. |
| `react-best-practices` | Componente novo, performance | ✅ Bate com a stack (React 19). |
| `react-component-performance` | Telas pesadas: funil (kanban), chat, tabela de leads | Re-render em lista grande. |
| **`vitest-skill`** | Escrever teste | ✅ É Vitest mesmo. Mas prefira a skill local **`testes`**, que tem os comandos e o setup deste repo. |
| `zod-validation-expert` | Schema de entrada de rota e de formulário | ✅ Zod v4 existe e é usado (`src/features/*/schemas/`). |
| `postgresql` / `sql-optimization-patterns` | Query lenta, plano de execução | Use com a Management API (read-only) para medir antes de otimizar. |

---

## Tier 3 — Por sintoma

| Sintoma | Skill / caminho |
|---|---|
| WhatsApp não envia, não recebe, ticks errados, mídia sumindo | **`uazapi-integration`** (local) → checar `chat_integrations` primeiro |
| Contato duplicado / conversa duplicada | `resolve-contact-identity.ts` (RPC com lock por telefone) + `upsert-message.ts`; a chave é o telefone normalizado |
| Query lenta / lista pesada (`chat_messages`) | `supabase-postgres-best-practices` |
| Dado sensível chegando ao cliente | `backend-security-coder` + §Segurança |
| Realtime do chat não atualiza | `supabase` (Realtime) — conferir se a policy `SELECT` de `anon` continua na tabela |
| Re-render / tela lenta no funil ou no chat | `react-component-performance` |
| `build` quebra mas `typecheck` passa | Módulo de servidor vazando para client component. Extraia tipo/helper para arquivo neutro. |
| Bug de fluxo | `systematic-debugging` → `bug-hunter` |

---

## 🚫 NÃO invoque — quebram esta stack

| Skill | Por quê |
|---|---|
| **`nextjs-supabase-auth`** | ⚠️ Auth **não** é Supabase Auth — é JWT HS256 próprio (`jose`) em cookie `crm-suporte-session`, com guard testável e papéis `admin`/`member`. A skill faria reescrever o modelo de sessão inteiro. |
| **`react-state-management`** | Empurra Redux/Zustand/Jotai/TanStack Query. Aqui o estado é React local + server components + `router.refresh()`. Adotar qualquer uma viola AGENTS §3.3 (dependência nova). |
| `tanstack-query-expert` | Não há TanStack Query. |
| **`tailwind-design-system`, `tailwind-patterns`** e afins que mandam editar `tailwind.config.js` | ⚠️ É **Tailwind v4 CSS-first**. Não existe `tailwind.config.js`. Tokens em `@theme` no `globals.css`. Use os princípios, ignore a config. |
| Skills que assumem **Radix** como base dos primitivos | A base é **Base UI** (`@base-ui/react`). A API de composição difere (`render={...}`, não `asChild`). Ver `src/components/ui/*`. ⚠️ **Uma exceção:** `vaul` (gaveta do mobile) traz `@radix-ui/react-dialog` como dependência. Ele fica **confinado** a `src/components/ui/drawer.tsx`; nenhum outro arquivo importa Radix, e o desktop não passa por lá. Não use isso como precedente para trazer mais Radix. |
| `prisma-expert`, `drizzle-orm-expert`, ORMs em geral | Sem ORM — `supabase-js` + SQL nas migrations. |
| `jest-skill` | É **Vitest**. |
| `playwright-skill`, `cypress-skill`, `webapp-testing`, `browser-testing-with-devtools` | AGENTS §3.12 proíbe teste de browser. Verificação é typecheck + lint + vitest + build. |
| `vercel-deployment`, `deploy-to-vercel`, `vercel-cli-with-tokens` | Produção é **VPS + Docker Compose + Traefik**. A pasta `.vercel/` é histórica. |
| Skills que assumem **npm** ou **yarn** | É **pnpm**. |
| `stripe-integration`, `paypal-integration` | Não há gateway de pagamento integrado. O módulo financeiro registra contratos/pagamentos/despesas, não processa cobrança. |

---

## ⚠️ Armadilhas conhecidas (aprendidas na prática)

1. **`asChild` não existe.** Base UI usa `render={<Button />}`. Copiar exemplo de Radix/shadcn quebra em runtime, e às vezes só em produção.
2. **`tailwind.config.js` não existe.** Toda alteração de token é em `@theme` no `globals.css`.
3. **O middleware é `src/proxy.ts`.** Procurar `middleware.ts` e não achar leva agentes a recriar o arquivo — não recrie.
4. **`createSupabaseServerClient()` é service role**, não sessão de usuário. Não confie nele para autorização.
5. **`NEXT_PUBLIC_*` entra no bundle no build.** Mudou? Precisa **rebuild**, não restart.
6. **`pnpm build` é o único check que pega vazamento client/server.** `typecheck` e `lint` passam com o vazamento intacto.
7. **Telefone brasileiro tem duas representações.** A Meta Cloud API entrega `wa_id` de 12 dígitos (sem o 9º); outros provedores entregam 13. A normalização é responsabilidade de `src/lib/formatters/phone.ts` + da RPC `resolve_contact_identity` (que é a autoridade) — não invente uma terceira no meio da tela.
8. **Migration já aplicada não se edita.** Sempre arquivo novo (AGENTS §3.8).

---

## Combos por tipo de task

**Tela nova ou componente novo**
1. Ler [`UI.md`](UI.md) → §Primitivos e §Anti-padrões. Reuse `src/components/ui` e `data-display`.
2. Ler 2–3 telas vizinhas (AGENTS §2). Página fina, lógica na feature.
3. `react-best-practices` → `code-reviewer` → `verification-before-completion`.

**Consulta / listagem nova**
1. Server component ou route handler com service role — **nunca** query client-side nova (§Segurança).
2. Leitura resiliente: erro loga e retorna vazio, não derruba a página.
3. `supabase-postgres-best-practices` → `verification-before-completion`.

**Mexendo em WhatsApp**
1. Skill local **`uazapi-integration`** primeiro. Checar `chat_integrations` antes de qualquer hipótese.
2. `backend-security-coder` se tocar o webhook.

**Banco / migration**
1. Management API para inspecionar (read-only). Migration = arquivo novo, idempotente.
2. PR separado por camada, banco primeiro (`CONTRIBUTING.md`).
3. `supabase-postgres-best-practices` → autorização explícita para aplicar (AGENTS §3.9).
