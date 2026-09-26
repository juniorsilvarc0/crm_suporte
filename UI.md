# UI — CRM Suporte

> ⚠️ **Telas citadas como exemplo (2026-09-25).** Vários padrões abaixo apontam para telas herdadas que saíram na Fase 1 (leads, funil, agenda, métricas, rastreamento). Os padrões continuam valendo para as telas novas; os arquivos citados estão na tag local `legado-clinica`.

> **Fonte da verdade visual.** Consulte **antes** de criar qualquer componente, tela ou variação de estilo. Estado confirmado por leitura do código em 2026-08-06.
>
> Ordem obrigatória (AGENTS §5): **reusar → estender → generalizar → criar novo**. Criar primitivo novo exige justificar por que as três anteriores falharam.

---

## §1. Princípios

A interface é **operacional e silenciosa**: hierarquia por tipografia, espaço e divisores. Poucos contêineres. Nenhuma pilha de cartão decorativo.

1. **Densidade a serviço da decisão.** A tela existe para alguém decidir e agir rápido, não para exibir dados.
2. **Uma superfície principal por tela.** Kanban, tabela e agenda vivem numa superfície com borda. Controle não fica dentro de outro cartão.
3. **Ação primária visível; secundárias no menu ⋯.**
4. **Cor nunca é o único sinal.** Status sempre tem texto ou ícone junto.
5. **O frontend não inventa dado nem regra de negócio** para melhorar a apresentação. Número que não existe no banco não aparece na tela.
6. **Estado vazio, carregando, erro e conteúdo longo reproduzem a estrutura real da tela** — não são telas separadas.
7. **Mobile é primeira classe.** Alvo de toque ≥ 44 px, foco de teclado visível, nada dependendo de hover.
8. **Português do Brasil** em toda a interface.

---

## §2. Fundamentos técnicos

| Item | Real |
|---|---|
| CSS | **Tailwind v4, CSS-first.** ⚠️ **Não existe `tailwind.config.js`** — os tokens vivem em `@theme inline` dentro de `src/app/globals.css`. |
| Primitivos | **Base UI** (`@base-ui/react`). ⚠️ **Não é Radix.** Composição via `render={<Button />}`, **não** `asChild`. |
| Tema | `next-themes` com classe `.dark` (`@custom-variant dark`). Claro e escuro compartilham os mesmos componentes. |
| Fontes | **Geist** (`--font-geist-sans`) e **Geist Mono** (`--font-geist-mono`), via `next/font/google` no `src/app/layout.tsx`. |
| Ícones | `lucide-react` v1. WhatsApp é ícone próprio: `src/features/chat/components/whatsapp-icon.tsx`. |
| Gráficos | `recharts`. |
| Drag & drop | `@dnd-kit` (kanban do funil). |
| Toast | `sonner` (`src/components/ui/sonner.tsx`). |
| Merge de classe | `cn()` em `src/lib/utils.ts` (clsx + tailwind-merge). |

---

## §3. Design tokens

### §3.1 Tokens semânticos — use estes, não escalas cruas

`background` · `foreground` · `card` · `card-foreground` · `popover` · `popover-foreground` · `primary` · `primary-foreground` · `secondary` · `secondary-foreground` · `muted` · `muted-foreground` · `accent` · `accent-foreground` · `destructive` · `border` · `input` · `ring` · `chart-1..5` · `sidebar*`

> **Hardcode de cor (`#hex`, `oklch(...)`, `rgb(...)`) dentro de componente é anti-padrão.** Se falta um token, o token é que precisa nascer — no `globals.css`, com o par claro/escuro.

### §3.2 Paleta

Tema **branco + azul-petróleo da marca** (`#1d658e`, oklch hue ~236), com apoio em **teal**
(`#27a9ae`, hue ~199) nos tokens de `accent` e nos gráficos. Valores em `oklch`.

| Token | Claro | Escuro |
|---|---|---|
| `--background` | `oklch(0.99 0.004 235)` | `oklch(0.16 0.012 240)` |
| `--foreground` | `oklch(0.21 0.025 240)` | `oklch(0.96 0.005 235)` |
| `--card` | `oklch(1 0 0)` | `oklch(0.20 0.015 240)` |
| `--primary` | `oklch(0.50 0.10 236)` | `oklch(0.62 0.10 225)` |
| `--accent` | `oklch(0.93 0.035 199)` | `oklch(0.32 0.045 199)` |
| `--muted-foreground` | `oklch(0.47 0.025 240)` | `oklch(0.72 0.018 235)` |
| `--destructive` | `oklch(0.55 0.21 27)` | `oklch(0.62 0.22 27)` |
| `--border` | `oklch(0.91 0.010 235)` | `oklch(1 0 0 / 12%)` |
| `--ring` | = `--primary` | = `--primary` |

Sidebar tem tokens próprios (`--sidebar*`), branco no claro e mais escuro que o fundo no escuro.
As logomarcas vivem em `public/brand/` (`logo.png` colorida, `logo-branca.png` para fundo
escuro, `logo-completa.png` com wordmark) e são consumidas pelo primitivo `LogoMark`.

### §3.3 Casca 3.0 — a linguagem vigente (2026-08-17)

> Esta é a fonte da verdade. O §3.3.1 abaixo guarda a etapa anterior (2.0) como
> histórico; onde os dois discordarem, **vale o 3.0**.

**A aplicação não tem sidebar.** A navegação inteira vive numa **barra superior
flutuante** (`src/components/layout/app-header.tsx`): faixa em gradiente da
marca (`bg-brand-bar`), cantos `rounded-2xl`, folga em volta, sobre um fundo de
água. No celular, barra inferior de vidro + gaveta.

- **Geometria é token, nunca número.** `--app-bar-height` (3.5rem) e
  `--app-chrome-top` (altura + folgas = 4.5rem). Toda tela de altura cheia
  (chat, funil, agenda e os skeletons) desconta `--app-chrome-top`;
  `--mobile-nav-height` continua valendo para a barra inferior. **Nunca**
  escreva `3.5rem` num `calc()` de tela.
- ⚠️ **A casca do header pinta fundo próprio** (`bg-background/80` +
  `backdrop-blur`). Ela é `sticky`: sem fundo, o conteúdo rola à vista pelas
  calhas em volta da barra — e, no PWA do iOS, por baixo do relógio.
- **Navegação agrupada**: `buildTopNavigation` (`src/config/navigation.ts`)
  monta seis entradas a partir da lista **já filtrada por papel** — grupo sem
  item não aparece, grupo de um item vira link, href não previsto entra como
  link no fim. Item ativo = pílula branca; dentro dos menus, `aria-current`.
- ⚠️ **A busca só mostra rótulo a partir de `xl`.** Entre 1024 e 1210px a barra
  do admin não cabe com a busca larga e todos os rótulos truncam.
- **Tipografia**: display **Outfit** (`--font-outfit` → `font-display` e
  `font-heading`) em títulos, navegação e **números de destaque**; corpo e dados
  densos em **Geist**. Número de destaque em Outfit é regra, não gosto: KPI do
  dashboard, KPI do rastreamento, totais de gráfico e resumo de período.
- **Raio base `--radius: 1.1rem`.**
- **Superfícies**: `panel-float` (painel de tela inteira que carrega um módulo —
  hoje a agenda) · `shadow-soft` (cartões e painéis de conteúdo) · `glass`
  (barras translúcidas). **Sombra dentro de sombra é proibida**: sub-superfície
  aninhada em painel flutuante não leva `shadow-soft`.
- 🚫 **O chat não segue esta linguagem.** Ele replica o WhatsApp e tem geometria
  própria: `.wa-surface` redeclara `--radius: 0.5rem`, e os `DialogTitle` do
  módulo levam `font-sans` para não herdar a face de display. Não estenda
  `bg-brand-bar`, `panel-float` nem `font-display` para dentro dele.

**Cartão de pessoa** (lista de leads e de follow-ups no celular): o registro de
gente é um **cartão**, não uma linha de tabela apertada.

```
┌─┬──────────────────────────────────────────────┐
│▍│ (AB)  Nome da pessoa          [etapa]   ⋯    │   ▍ barra de acento = status
│ │       (11) 99999-9999                        │   (AB) AvatarInitials, tom neutro
│ │  contexto · etiquetas · origem      12 ago ⬤ │   ⬤ conversa no WhatsApp (verde)
└─┴──────────────────────────────────────────────┘
```

- ⚠️ **Vale no desktop também, não só no celular.** No desktop a lista continua
  sendo `<table>` (as colunas carregam informação), mas **cada linha é um
  cartão**. Isso é do **primitivo**, não classe copiada:

  ```tsx
  <div className="rounded-xl border border-border/60 bg-muted/20 px-2 pb-2 shadow-soft">
    <Table variant="cards">
      <TableHeader><TableRow variant="cards-header">…</TableRow></TableHeader>
      <TableBody><TableRow variant="card">…</TableRow></TableBody>
    </Table>
  </div>
  ```

  `variant="cards"` afasta as linhas (`border-separate`); `variant="card"`
  desenha o cartão nas **células** — `<tr>` não aceita raio nem borda de forma
  confiável. O leito `bg-muted/20` é o que faz o cartão branco existir. Em uso
  em leads, follow-ups, equipe, tokens de API, variáveis e logs de integração.

- Avatar por `AvatarInitials` (`src/components/data-display/avatar-initials.tsx`),
  **tom único e neutro** — cor, nesta tela, significa etapa.
- ⚠️ **Cartão branco dentro de painel branco precisa de leito tingido.** A pilha
  de cartões vive sobre `bg-muted/25`; sem isso o cartão só teria a borda para
  existir e a lista volta a parecer tabela.
- A barra de acento **nunca é o único sinal**: a badge textual de status fica na
  mesma linha (§1.4).
- A ação de conversa é um **círculo verde do WhatsApp** — a cor da própria marca
  diz o que o botão faz, e círculo marca "ação de contato", não item de barra.

**Widget de KPI**: cada número é um `Card` solto no grid (2 colunas no celular,
4 a partir de `sm`), com chip de ícone circular e valor em `font-display`. Não
volte para a banda única com divisores: oito grandezas diferentes na mesma
moldura leem como planilha. **Widget não tem elevação no hover** — ele não é
clicável, e mover o que não responde ao clique promete interação que não existe.

### §3.3.1 Forma e elevação — linguagem 2.0 (histórico)

Repaginada aprovada pelo dono do produto, inspirada em referência externa de estética
"leve e flutuante", executada **nas cores da marca**. O que mudou em relação à
linguagem original do template:

- `--radius: 0.875rem`. A escala continua derivando dele: `--radius-sm` = `×0.6`, `-md` = `×0.8`, `-lg` = `×1`, `-xl` = `×1.4`, `-2xl` = `×1.8`.
- Controles operacionais: `rounded-lg`. Superfícies e modais: `rounded-xl`/`rounded-2xl`.
- **Botão é pílula** (`rounded-full`) em todos os tamanhos — o primitivo `Button` cuida
  disso; dentro de `button-group` ele volta a `rounded-lg`. Não force raio em botão.
- **Ação primária usa o gradiente da marca**: utilitário **`bg-brand-gradient`**
  (azul-petróleo → azul → teal, definido no `globals.css`), texto `--primary-foreground`.
  O mesmo gradiente marca o **item ativo** da navegação (sidebar e barra mobile).
- **Superfícies principais flutuam**: utilitário **`shadow-soft`** (sombra difusa tingida
  pela marca) no primitivo `Card` e nas superfícies únicas de painel
  (`rounded-xl border border-border/60 bg-card shadow-soft`). Sombra **forte** continua
  exclusiva de sobreposição (popover, dropdown, dialog).
- **Wash de fundo da marca**: o `body` pinta gradientes radiais fixos (azul + teal); a
  casca do dashboard, o login e o PageHeader são **transparentes** para o wash aparecer
  nas calhas. Não pinte `bg-background` em contêiner de página inteira — pinte `bg-card`
  na superfície que precisa de fundo.
- A busca de toolbar (`ToolbarSearch`) e a sidebar (translúcida, `backdrop-blur`) seguem
  a mesma linguagem. Densidade, estados e acessibilidade das telas **não mudaram** — os
  princípios do §1 continuam valendo.

Padrões da iteração por tela (mesma data):

- **Widget de dashboard = `Card` sem override de sombra/raio.** Os wrappers antigos
  usavam `rounded-lg shadow-none` — isso anula a linguagem do primitivo; não reintroduza.
  Chip de ícone de KPI é circular (`rounded-full`).
- **Barra de acento em card mobile de lista**: `span aria-hidden` absoluto
  (`absolute inset-y-0 left-0 w-1`) com classe **literal** de `getColorStyle(...).bar` /
  `getLeadStatusStyle(status).bar`; o pai ganha `relative`. A cor **nunca é o único
  sinal** — o card mantém a badge textual de status (§1.4).
- **Agenda**: chips de evento com raio maior (`rounded-lg` no mês, `rounded-md` na grade
  de horas — `rounded-full` cortaria texto em faixas de 30min); o fundo dos chips da
  grade continua **opaco** (faixas se sobrepõem). Segmentado Mês/Semana/Dia/Lista é
  pílula, com a aba ativa em `bg-brand-gradient`.
- **Dentro de dialog, o fundo de header/footer é `bg-card/95`** (nunca `bg-background`,
  que destoa do popup) e **sub-superfície aninhada não recebe `shadow-soft`** — sombra
  dentro de sombra achata o efeito de flutuação.

### §3.4 Cores de domínio (tags e colunas do funil)

`src/features/tags/schemas/colors.ts` define **19 cores nomeadas** (`slate`…`rose`), cada uma com variações `dot` / `bar` / `text` / `badge` / `ring`. Consuma por `getColorStyle(name)`.

> ⚠️ **As classes são literais estáticas de propósito.** Tailwind v4 só detecta classe escrita por extenso. **Nunca** gere classe por interpolação (`` `bg-${cor}-500` ``) — ela não existe no CSS final e o elemento fica sem cor em produção.

### §3.5 Cor do chip da agenda (Início) — sexo do paciente

Na grade da semana de `/app` (`week-calendar.tsx`), a **cor do chip diz o sexo** do paciente. É o que torna a semana legível de relance numa clínica que atende crianças.

| Sexo | Par de tons (pastel) |
|---|---|
| masculino | `sky-100` · `emerald-100` |
| feminino | `pink-100` · `red-100` |
| sem sexo na ficha / intersexo | `slate-200` (**não** `slate-100`: em pastel ele fica a 18/255 do `sky-100`, e a 5/255 para quem tem deuteranopia — "ficha incompleta" leria como "menino") |
| cancelado / faltou | `bg-muted` + `line-through` (o estado vence a paleta) |

Regras:

- **Fundo claro, texto `-950` da mesma família**, na convenção dos post-its (`noteColorClass`), com `dark:bg-<cor>-300/25 dark:text-<cor>-50`.
- **`ring-1 ring-inset` é obrigatório**: sem contorno, pastel sobre grade branca desaparece.
- Qual dos dois tons do par: hash do **`leadId`**, nunca do id do agendamento — assim o mesmo paciente mantém a cor em todas as semanas dele.
- `pink` e não `rose`: em pastel, `rose-100` e `red-100` ficam quase idênticos.
- Cor nunca é o único portador da informação (WCAG 1.4.1). O nome não codifica sexo, então **o sexo vai por escrito no `title` do chip** — em pastel, `emerald-100` e `red-100` ficam a 5/255 um do outro sob deuteranopia.

> ⚠️ **`/app/agendamentos` NÃO segue esta paleta.** Lá o card é colorido por **status** (`appointmentToneClass`), que é informação diferente e igualmente real. São dois códigos de cor convivendo de propósito.

---

## §4. Primitivos compartilhados

### §4.1 `src/components/ui/` — 27 primitivos

| Grupo | Componentes | Quando usar |
|---|---|---|
| Ações | `Button`, `DropdownMenu` | Toda ação. Menu ⋯ para secundárias. |
| Entrada | `Input`, `Textarea`, `Select`, `Combobox`, `Checkbox`, `Slider`, `Field`, `Label` | Formulários. `Field` para composição nova. |
| Overlay | `Dialog`, `Drawer`, `Popover`, `Tooltip` | Modal, gaveta, ajuda contextual, seletor flutuante. **Use `Dialog`** — ele já vira gaveta no celular (§5.10). |
| Navegação | `Tabs`, `ScrollArea`, `OverlayScrollArea`, `Collapsible` | Seções, listas longas e blocos que abrem sob demanda. |
| Dados/estado | `Table`, `Badge`, `Card`, `Alert`, `Skeleton`, `Empty`, `Separator`, `Calendar` | Tabela, status, loading, vazio. |
| Feedback | `Sonner` (toast), `BrandLoader` | Confirmação e carregamento de marca. |
| Marca/tema | `LogoMark`, `AnimatedThemeToggler` | Identidade e alternância de tema. |

**`Combobox`** — `Combobox` + `ComboboxInput` + `ComboboxTrigger` + `ComboboxPopup` + `ComboboxList` + `ComboboxItem`, sobre Base UI. Use quando o campo precisa **filtrar** e **aceitar valor que não está na lista**; `Select`/`FormSelect` não fazem isso. `ComboboxItem` renderiza uma `div[role="option"]` — em ARIA, `option` é folha, então **botão dentro do item não é anunciado**: dê sempre um caminho de teclado paralelo (ver §5.6).

**`Collapsible`** — `Collapsible` + `CollapsibleTrigger` + `CollapsiblePanel`, sobre Base UI. A altura anima por `--collapsible-panel-height`, publicada pelo primitivo — não meça altura no React. O trigger recebe `data-panel-open`; use `group-data-panel-open:` para girar a seta. Para **linha de tabela que expande**, não use este primitivo: `<tr>` não aceita wrapper. O padrão é linha-gatilho + segunda `<tr>` com `colSpan`, controlada por estado (ver §5.5).

**`Button`** — variantes `default` · `outline` · `secondary` · `ghost` · `destructive` · `link`. Tamanhos `xs` · `sm` · `default` · `lg` · `icon` · `icon-xs` · `icon-sm` · `icon-lg`.
Convenções embutidas: `focus-visible:ring-3`, `aria-invalid` estilizado, `[&_svg]` dimensionado automaticamente, `data-icon="inline-start|inline-end"` ajusta o padding. **Não recrie botão local.**

### §4.2 `src/components/data-display/`

| Componente | Uso |
|---|---|
| `DataToolbar` + `ToolbarSearch` + `FilterButton` + `FilterField` + `ActiveFilters` | **Toolbar canônica** de qualquer tela de dados. Sequência obrigatória: busca → filtros → ordenação → ações. |
| `EmptyState` | Estado vazio de lista/superfície. |
| `SkeletonToolbar`, `KanbanPageSkeleton`, `ListPageSkeleton` | Skeleton fiel à estrutura real. Use em `loading.tsx`. |

### §4.3 `src/components/layout/`

| Componente | Uso |
|---|---|
| `DashboardShell` | Casca autenticada: sidebar + header + área de conteúdo. |
| `AppHeader` | Cabeçalho global. |
| `PageHeader` | Título e descrição da página. |
| `ModalShell` + `ModalFooterActions` | **Casca canônica de modal.** Header fixo + corpo rolável + footer fixo. `size`: `compact` \| `medium` \| `wide` (padrão `wide`). Aceita `formRef`/`onSubmit` para virar `<form>`. |
| `LogoutButton` | Encerrar sessão. |

### §4.4 `src/components/forms/`

`FormSelect` (select compartilhado sobre Base UI) · `ColorSwatchPicker` (paleta de 19 cores) · `ImageCropperDialog` (recorte de avatar, `react-easy-crop`).

### §4.5 `src/components/kibo-ui/`

`kanban/` (board do funil, dnd-kit) · `spinner/` · `status/`.

---

## §5. Padrões de tela

### §5.1 Tela de dados (Clientes, Contatos, Tickets; depois Follow-ups, Financeiro)

```
PageHeader
DataToolbar  →  ToolbarSearch · FilterButton(FilterField…) · ordenação · ActiveFilters · ações
contagem de resultados (texto simples, aria-live — nunca dentro de card)
superfície única com borda:
  desktop → Table
  mobile  → lista de <article> com divisores
paginação compartilhada
```

- Filtro ativo mostra a **quantidade** e tem **limpeza explícita**.
- Loading é `Skeleton` com a geometria do conteúdo, **nunca** spinner de página inteira.
- Vazio é `EmptyState` com frase curta e, quando útil, uma ação.
- **Filtros e página moram na URL** (`?q=&situacao=&page=`): a página server lê `searchParams`, e a busca navega com debounce de 300 ms e `router.replace(…, { scroll: false })`. Sem filtro local repetido no cliente.
- **Lista com erro não diz "nenhum cadastrado".** A consulta devolve `failed: true`, e a tela mostra "Não foi possível carregar…" com **Tentar de novo** (`router.refresh()`). Base vazia, busca vazia e falha são três estados distintos, e a barra de busca nunca some.
- **Paginação compartilhada:** `ListPagination` (`components/data-display/list-pagination.tsx`), com `Link` `rel="prev|next"` e o texto "1–25 de 312 empresas". Página além do fim abre a última que existe (o PostgREST responde 416 com `count`).
- **Carregando:** `ListPageSkeleton`, com a mesma geometria das páginas (`max-w-screen-xl p-4 sm:p-6 lg:p-8`, ação na barra, não no cabeçalho), senão a tela salta.
- Em Clientes, a ação cotidiana de admin é **"Arquivar"**, nunca exclusão física; os contatos continuam ligados à empresa arquivada. Arquivar com contrato vigente é recusado, com o motivo visível no botão.
- Nome e telefone exibidos no chat e em Contatos vêm do contato canônico; snapshot do provedor fica apenas como metadado de auditoria.
- **Valor de contrato nunca em lista.** Só a ficha da empresa mostra valor e vencimento, e só para admin (decidido no servidor, fora do payload do member).
- No Chat, `contact_phone` é apresentação canônica e pode ter máscara; ações de envio usam a identidade original do canal (`external_id`). Nunca converta o campo exibido em destinatário do provedor.
- Se uma pessoa tiver mais de uma oportunidade ativa, alterar sua etapa geral mostra conflito e orienta mover o card correto no Funil; a interface nunca escolhe uma oportunidade silenciosamente.

### §5.2 Funil (`/app/funil`)

Kanban com `@dnd-kit`. Colunas vêm do banco (`board_columns`), com cor e `stage_type`. Um lead pode ter N cards (deals).

**A cor da etapa tinge a coluna, não o card.** O `panel` de `getColorStyle` pinta o `KanbanBoard` inteiro (borda + fundo, claro e escuro); o card fica neutro e usa a mesma cor só como aro fino (`ring`). Assim dá para saber em que etapa se está sem ler o rótulo, e a coluna não vira uma parede de cartões coloridos competindo.

Anatomia do card, nesta ordem:

```
[iniciais]  Nome do lead                   💵 R$ 1.800
            (11) 99999-9999
            📣 Nome da campanha
            [Ganho] 80%              ← só com "meta de etapa" ligado
            [tag] [tag]              ← só no visual normal
            📅 12 ago · Consulta     ← só no visual normal
            interesse…               ← só no visual normal
```

- **Venda registrada ocupa o slot de valor**, em emerald e com ícone de cédula; sem venda, o slot mostra a estimativa (`deal.valor`) em cinza. São dois significados diferentes no mesmo lugar, e o ícone é o que os separa — cor sozinha não basta (§1.4).
- **Venda cancelada não conta** em lugar nenhum: nem no valor do card, nem no filtro, nem na ordenação. É o mesmo critério do dashboard.
- Contêiner do conteúdo usa **`grid-cols-[minmax(0,1fr)]`**. Sem isso a trilha do grid vira `max-content` e conteúdo longo (nome de campanha) vaza do card em vez de truncar.
- **Iniciais em tom único e neutro.** Cor por pessoa seria matiz sem significado disputando com a cor da etapa — ver §9.
- Hover eleva (`-translate-y-0.5` + `shadow-md`, 150 ms) com `motion-reduce` respeitado.
- **Enquanto grava a etapa**, o card fica coberto por um véu com spinner e `role="status"`. Mover sem confirmação visual parecia que nada tinha acontecido.
- **Arrastar e menu "Mover para"** — o arraste nunca é o único caminho. Pelo menu, o card se move na tela primeiro e grava depois.
- **Coluna vazia tem estado**, com texto e ação ("Novo card", ou "Limpar filtros" quando o vazio veio de filtro). Coluna vazia sem nada é área morta.
- **Filtro que zera tudo** mostra um estado no board inteiro dizendo quantos cards existem e oferecendo limpar. Board vazio silencioso parece bug.
- Filtros: tag, serviço, **venda** (com/sem) e **faixa de valor vendido**. Ordenação por valor usa o total vendido, caindo para a estimativa quando não há venda — `deal.valor` está vazio em toda a base, então ordenar só por ele não ordenava nada.
- Densidade normal/compacta em `localStorage` via `useFunnelView` (`useSyncExternalStore`). Ler a preferência dentro de `useEffect` fazia a tela montar no padrão e trocar um frame depois — pisca-pisca visível.
- Contador da coluna é **pílula** (`min-w-5 px-1.5`), não círculo: com 3 dígitos o número precisa crescer na horizontal.
- Etapa órfã (stage sem coluna) cai numa coluna "Sem categoria" em vez de sumir.

### §5.3 Modal

> **No celular, todo modal é uma gaveta.** A troca é automática, no primitivo (§5.10) — quem chama não muda nada.

- Use **`ModalShell`**. Header e footer fixos, corpo rolável (`min-h-0 flex-1 overflow-y-auto`). **Footer nunca dentro da área que rola.**
- `size="wide"` para cadastro/detalhe; `medium` para formulário curto; `compact` para confirmação. **Largura grande não se aplica mecanicamente a alerta simples.**
- Detalhe: duas colunas no desktop, uma no mobile.
- Todo `Dialog` precisa de `DialogTitle`. Descrição quando agregar contexto.

### §5.3.1 Histórico no detalhe do lead

- O histórico de etapas fica **dentro do modal**, imediatamente abaixo de Anotações. Não exige navegação para outra tela.
- Use timeline neutra e discreta: mudança em destaque, data e horário abaixo. A entrada inicial aparece como “Entrou em Novo”; as demais, como “Novo → Agendado”.
- Ordem decrescente: evento mais recente primeiro. Rótulos vêm das colunas atuais do Funil, com fallback legível para etapas antigas removidas.
- **Exceção: a timeline do ticket (§5.24) é cronológica.** Ela é a conversa do atendimento, lida de cima para baixo como o chat, com "Carregar anteriores" no topo e o composer embaixo.
- Carregue sob demanda ao abrir o lead. Preserve a geometria com `Skeleton`; falha mostra mensagem local e “Tentar novamente”; vazio é explícito.
- A timeline usa `max-h-64` e rolagem interna com `overflow-y-auto overscroll-contain [-webkit-overflow-scrolling:touch]`. Não transforme cada evento em card e não aumente indefinidamente o modal.

### §5.4 Rastreamento (`/app/rastreamento`)

**Quatro abas, não uma coluna só.** `Visão geral` · `Custos` · `Campanhas` · `Entrega`. A tela empilhava as quatro operações uma sobre a outra: quem entrava para decidir verba rolava por cima do diagnóstico técnico da CAPI, e quem entrava para investigar entrega passava pelo funil. A faixa de abas é a **mesma receita de Configurações** (`variant="line"` sobre `border-b border-border/70`, `h-11 min-w-max gap-4 px-1 sm:h-10`) — um segundo desenho de aba na mesma aplicação seria dialeto novo sem motivo.

- ⚠️ **A aba troca sem ir ao servidor.** A página é `force-dynamic`; com `router.replace`, cada clique refaria as quatro consultas mais a chamada à Meta, e a troca ganharia a latência sem feedback que a Agenda já pagou (§5.21). Os quatro painéis vêm renderizados do mesmo request — a troca é local, e `window.history.replaceState` só espelha o estado em `?aba=`.
- ⚠️ **Diferente de Configurações, a aba vive na URL.** O período já está lá; um link colado no WhatsApp precisa cair no mesmo período **e** na mesma aba. Por isso é controlada, não `defaultValue`.
- ⚠️ **Quem navega por filtro parte do que já está na URL.** `TrackingFilters` montava a query do zero: trocar o período apagava `?aba=` e jogava quem estava em Custos de volta para a Visão geral a cada clique.
- **O filtro fica acima das abas**, porque vale para as quatro. Repetido dentro de cada uma, a mesma escolha teria quatro donos.
- **Padrão de 7 dias** (era 30). É o intervalo em que ainda dá para agir: anúncio caro descoberto 30 dias depois já queimou a verba do mês. 30 e 90 continuam a um toque.
- ⚠️ **A pílula em `bg-muted` e a faixa com sublinhado não são intercambiáveis.** Sublinhado = mudei de assunto (a navegação da tela). Pílula = mudei o recorte do mesmo bloco (Campanha/Conjunto/Anúncio, dentro de Custos, como `dashboard/by-source-card.tsx` já fazia). Usar as duas iguais apaga a diferença.

#### Visão geral: um número protagonista, não cinco iguais

`PeriodSummary` — uma superfície com **Investido no período** em 32 px, marcado por uma barra de 3 px na cor de destaque, e três números de apoio em 20 px separados por divisor: Novos contatos · Custo por contato · Custo por paciente.

- ⚠️ **Substituiu a `StatBand` de cinco cartões.** A banda dava a mesma moldura, o mesmo tamanho e o mesmo ícone para o investimento e para uma **divisão dele**, e ainda soletrava a conta ("R$ 1.172 ÷ 141 contatos") num parágrafo de 11 px sob cada cartão. Cinco caixas iguais com quatro rodapés cinza não têm hierarquia — é a leitura que faz uma tela parecer preenchida em vez de decidida. A hierarquia agora é por **tamanho**, nunca por peso nem por cor.
- **Uma linha de método para o bloco inteiro**, no lugar de uma dica por cartão. Quando o custo é `—`, essa linha diz **por quê** — sem isso, o traço parece defeito.
- **Cobertura de click ID saiu daqui e foi para `Entrega`.** É qualidade do sinal que a clínica devolve para a Meta, não decisão de verba. Mesmo critério que já tinha tirado "Agendaram/Compareceram" da banda.
- **Custo sem denominador é `—`, nunca `R$ 0`.** Zero paciente com R$ 1.200 gastos não significa paciente de graça. Ver `costPer` em `features/meta/funnel.ts`. Medido em 12/08: a coorte de 7 dias tinha 154 contatos e **zero** pacientes — a tela inteira depende dessa regra estar certa.
- **Investimento indisponível não derruba o resto.** A Meta fora do ar não é o mesmo problema que o banco fora do ar: o dinheiro vira `—`, o motivo aparece na linha de método, e funil, contatos e campanhas seguem.

#### Visão geral: o gráfico do dia a dia

`PeriodChart` — barra de gasto e linha de contatos no mesmo eixo horizontal, dois eixos Y.

- **Formas diferentes porque as grandezas são diferentes**: R$ 120 e 6 contatos não cabem na mesma régua. Barra é dinheiro, linha é gente.
- **Um ponto por dia do intervalo, inclusive o dia vazio.** Pular o dia sem gasto faz o eixo mentir: três dias parados viram um degrau que parece contínuo.
- Convenções herdadas de `dashboard/components/daily-chart.tsx`: eixo sem moldura, tick de 11 px em `muted-foreground`, tooltip nos tokens de popover, e o wrapper `role="img"` com o resumo em texto — **o gráfico nunca é a única forma de ler o dado**.
- Sem investimento conhecido, a barra e o eixo de dinheiro somem; a linha de contatos sozinha não justifica dois eixos.

#### "Do primeiro contato ao paciente"

Uma superfície só (`rounded-xl border bg-card`), etapa por linha: **rótulo + contagem grande + % dos contatos**, barra embaixo, e **a perda entre as etapas**.

- ⚠️ **A perda é a informação, não o que sobrou.** A primeira versão mostrava "3% da etapa anterior" numa linha fina **acima** de cada etapa — lia-se como se pertencesse à etapa de cima — e a barra de 1,5 px de uma etapa com 3 de 144 era invisível. Quem lia não descobria o que importa: que **140 pessoas pararam ali**. Agora a queda vem em número absoluto (`140 não avançaram · seguiram 3%`), com o percentual como apoio.
- **Barra com piso de 1,5% de largura** quando a etapa não é zero. Sem piso, 3 em 144 dá 2% e o bloco some justamente onde a pessoa procura confirmação de que existe algo.
- **Etapas zeradas no FIM viram uma linha só** ("Ninguém chegou ainda em Compareceu, Cliente e Recorrente"). Três linhas idênticas dizendo "0 · 0%" ocupavam um terço do cartão sem informar nada. Etapa zerada **no meio** continua visível: ali o zero é informação — o funil pulou aquela etapa.
- **A barra é `aria-hidden`.** O número e o percentual já estão no texto ao lado; dar `role="img"` à barra repetiria a informação com um rótulo pior.
- **Rodapé carrega o que o funil não mostra**: perdidos, gasto em anúncio sem contato, contato vindo de anúncio fora do ar, e a contraprova de conversas da própria Meta.
- ⚠️ **Nada aqui vira link.** A tela de Leads não aceita filtro por etapa: linkar "Agendado 3" cairia na lista inteira, que é a mesma promessa quebrada de quando o link do lead caía numa lista vazia.

#### Custos: a tabela mostra o que é feio

`CostTable` cruza o gasto que veio da Meta com o desfecho que veio do CRM. A chave é `ad_id` — `MetaAdInsight.adId` **é** `meta_attributions.ad_id_snapshot`, sem tradução. Agrupa por Campanha, Conjunto ou Anúncio.

- ⚠️ **Anúncio que gastou e não trouxe ninguém é linha, não omissão.** Montar a tabela a partir dos leads faz essa linha sumir justamente quando ela importa mais — é ela que justifica cortar verba. Medido em 06–12/08: **8 anúncios queimaram R$ 235,50 sem trazer uma pessoa**.
- ⚠️ **Contato de anúncio fora do ar entra marcado** ("Sem veiculação no período"), senão a soma de contatos aqui não fecharia com a da Visão geral e ninguém saberia por quê. Mesmo período: 3 casos.
- ⚠️ **Contato sem anúncio identificado nunca é somado a uma campanha real.** Vai para "Sem identificação" — jogá-lo numa campanha inflaria o desempenho dela.
- ⚠️ **O total do rodapé soma a verba inteira, inclusive a que não gerou contato.** É por isso que o custo por contato daqui é **maior** que o da Visão geral (medido: R$ 9,60 contra R$ 8,07). As duas leituras estão certas e respondem perguntas diferentes; a nota abaixo da tabela diz qual é qual. Somar só o gasto atribuído daria um total que não fecha com a coluna acima, e a pessoa passaria a conferir a conta em vez de ler o resultado.
- **Seis colunas não cabem em 320 px**: no celular cada linha vira cartão com quatro pares rótulo/valor, o mesmo par `hidden md:block` / `md:hidden` da tabela de campanhas.
- **`null` ordena para o fim nas duas direções.** Ausência não compete por posição com um número.

#### Entrega: deixou de ser colapsável

- ⚠️ **O `Collapsible` saiu.** Ele existia porque a tela era uma coluna só e este bloco empurrava a tabela de campanhas para baixo da dobra. Com aba própria, quem clicou já veio ver isto: colapsável dentro de aba é a mesma pergunta feita duas vezes, e esconde o conteúdo de quem pediu para vê-lo.
- **O que o colapso resolvia migrou para o ponto de alerta na aba** — e ele **não é só cor**: o `aria-label` da aba passa a dizer "Entrega — há conversões falhando" (§1.4).

#### Linguagem: sem jargão de analytics

**"Coorte" e "recorte" não aparecem em lugar nenhum da tela** — nem na tabela de campanhas. São vocabulário de quem monta o relatório, não de quem opera a clínica.

| Antes | Agora |
|---|---|
| Funil da coorte | Do primeiro contato ao paciente |
| Nenhuma campanha neste recorte | Nenhuma campanha trouxe contato no período |
| Cobertura de click ID | Contatos rastreados |
| Sem click ID | Sem rastreio |
| resultado amadurece depois do recorte | quem chegou agora leva tempo para fechar |

A palavra continua nos comentários do código, onde é o termo técnico correto e o leitor é outro.

#### Filtros: atalho na linha, seletor no popover

- **Atalhos de período em chips** (7 · 30 · 90 dias) numa faixa que rola na horizontal. Trocar de 30 para 7 dias custava três toques dentro de um popover; agora custa um.
- ⚠️ **O chip aceso é derivado do `from`/`to` da URL**, nunca guardado à parte. Guardar "qual chip está aceso" ao lado do período real cria duas verdades que divergem no primeiro voltar do navegador.
- ⚠️ **Campanha, conjunto e anúncio são seletores com nome, não campos de ID.** Antes era preciso saber e colar `120200000000000000` — na prática, o filtro não existia para quem opera.
- **As opções saem do período, não do filtro aplicado.** Escolher uma campanha não pode esvaziar a lista de campanhas — mesma regra de `buildTipoFilterOptions` na agenda.
- **Filtro ativo vira chip removível abaixo da faixa**, com o nome por extenso. Sem isso, `Filtros (2)` é a única pista e descobrir *quais* dois exige abrir o popover.
- **"Limpar tudo" zera os filtros, não a aba.**

#### Campanhas

- **Campanha é um accordion.** A linha expande e revela os leads daquela campanha no mesmo vocabulário da tela de Leads: iniciais, nome, badge de etapa do funil, telefone, data do primeiro clique, anúncio, e ação de abrir conversa. Marca de aberto: barra `border-l-2 border-primary` na primeira célula.
- **Linha de tabela que expande** não usa `Collapsible`: `<tr>` não aceita wrapper. É linha-gatilho + segunda `<tr>` com `colSpan`, com `aria-expanded` e `aria-controls` no botão. A lista interna rola em `max-h-96` para uma campanha grande não empurrar a tabela inteira.
- **Exportar CSV mora na barra da tabela** que ele exporta, não numa faixa própria no topo da página.
- `ctwa_clid` **nunca** aparece na tela nem no CSV. O lead exibe só o booleano "sem click ID", que é o que muda decisão.
- **`SortButton` é compartilhado** (`features/meta/components/sort-button.tsx`) entre as tabelas de campanhas e de custos. São dois blocos da mesma tela: duplicar o controle faria as duas ordenações divergirem em ícone, foco e alvo de toque na primeira vez que uma fosse ajustada.

### §5.5 Registrar venda (modal, a partir do card do funil)

`ModalShell size="medium"` com `onSubmit`. Ordem: procedimento → valores → forma de pagamento → observações → **resumo**.

- **Resumo calculado ao vivo, acima do rodapé**: valor, desconto e o recebido. Quem grava dinheiro confere o número antes de confirmar, não depois.
- **A venda é sempre recebida no ato.** Parcelamento no cartão é acordo entre o paciente e o banco — a clínica recebe pela maquininha, então não existe "a receber" a controlar aqui.
- **Dinheiro com centavos**: `formatMoneyExact`, não `formatMoney`. `formatMoney` arredonda de propósito para KPI e card; num registro financeiro, R$ 1.850,50 virando "R$ 1.851" é mentira.
- **Guarda de duplo submit com `useRef`** na primeira linha do handler. `pending` como estado não trava entre o clique e o re-render.
- **Não dá para fechar durante o envio**: o guard vai no `onOpenChange` do `Dialog`, que cobre X, Esc e clique fora de uma vez. Não mexa no `ModalShell` para isso.
- **Reset ao abrir, não ao fechar.** Estado no ajuste durante o render; refs num efeito, porque tocar ref durante o render é proibido pelo lint do React.
- **Dois lugares, uma casca só.** `SaleDialog` aceita `variant`: `dialog` (a partir do card do funil, onde é o único modal) e `panel` (dentro do modal do lead, onde renderiza só o `<form>` com rodapé próprio). O modal do lead troca o corpo pelo painel e mostra "Voltar ao lead" — nunca abre um segundo `Dialog`.
- Validação: **um `safeParse` só**, com o schema compartilhado com a rota, e os erros espalhados por campo com `aria-invalid` + `aria-describedby`.

### §5.6 Combobox de catálogo com criação inline (filas, planos)

`CatalogCombobox` (`components/forms/catalog-combobox.tsx`) é a referência para escolher de um catálogo dentro de um campo, com `mode="single"` (plano) ou `mode="adder"` (filas do contrato, em chips removíveis de 44 px).

- **O valor é um objeto `{id, name, …}`**, com `itemToStringLabel`/`isItemEqualToValue` por id: o UUID nunca aparece no campo. Item arquivado que já estava escolhido entra como "(arquivado)".
- **Um só caminho de seleção** (`onValueChange`), para item e para "Criar «X»" — nada de `onClick` paralelo.
- **"Criar" só com `createUrl`**, que só é passado a admin. A criação tem trava contra duplo envio.
- **Sem arquivar dentro do combobox** nesta fase: a gestão de filas vem com a tela de filas (Fase 4f).

O que segue vale para o padrão (herdado do combobox de procedimentos da origem):

- O catálogo desce **por prop do servidor** e revalida com `router.refresh()` — sem estado espelhado no cliente.
- **Criar** aparece como linha da lista, com 2+ caracteres e sem correspondência exata. `409` seleciona o que já existe em vez de mostrar erro: é corrida entre abas, não erro de quem digitou.
- **Apagar arquiva.** O botão fica no item, visível em `hover` **e** em `data-highlighted`, e **sempre visível no mobile** — hover-only não existe no toque.
- **Caminho de teclado obrigatório**: `Delete` sobre o item destacado abre a mesma confirmação. O botão é `tabIndex={-1}` porque `role="option"` é folha em ARIA.
- **Confirmação inline, na própria linha.** Um `Dialog` dentro do popup do combobox dentro do modal é armadilha de foco garantida.
- (Histórico) No combobox de procedimentos o valor era texto; no `CatalogCombobox` é o objeto com id, porque contrato e ticket gravam a referência.

### §5.6.1 Badge de largura variável dentro de coluna estreita

O primitivo `Badge` é `shrink-0` + `w-fit` + `overflow-hidden`. Isso significa que ele **não encolhe** quando o pai aperta: com `max-w-[14rem]` numa coluna de 12%, a badge de campanha do Meta vazava por cima da coluna Status.

- **`max-w-full`, nunca uma largura fixa em `rem`.** A largura da coluna é quem manda.
- **O texto interno precisa de `min-w-0`** para o `truncate` agir — item de flex não encolhe abaixo do conteúdo sem isso.
- **Dentro de linha flex, embrulhe num `div min-w-0`**, porque o `shrink-0` do primitivo vence.
- O nome completo vai no `title`.

### §5.7 Chat (`/app/chat`)

Superfície própria com tokens `--wa-*` no `globals.css` (bolhas, fundo). É a **única** exceção autorizada à paleta semântica geral, porque replica a leitura de uma conversa de WhatsApp. Não estenda esses tokens para fora do chat.

### §5.7.9 Ações da lista de conversas

- **Desktop:** o botão `…` aparece no hover/foco da linha e abre `DropdownMenu` sem cor fixa; a superfície segue `bg-popover`, portanto permanece clara no tema claro e escura no tema escuro.
- ⚠️ **O gatilho `…` tem calha própria: `lg:pr-8` nas duas linhas de conteúdo.** Ele é `absolute right-2 top-1/2 size-8` — centrado numa linha de ~68 px, cai exatamente sobre o horário e sobre o balão de não lidas. Fundo opaco para mascarar o que está embaixo não resolve, esconde. O padding vai nas **linhas**, nunca no bloco que carrega o `border-b`: aquele borda é o divisor da lista e precisa continuar chegando à margem. Com a calha, o botão não precisa de fundo nem de sombra — sombra ali significaria sobreposição, e não há mais nenhuma (§3.3).
- **Invisível é inerte** também aqui: `pointer-events` acompanha a opacidade, e `data-[popup-open]` mantém o gatilho aceso enquanto o menu dele está aberto — senão levar o mouse até o menu tira o hover da linha e o botão some por baixo do próprio popup. Mesmo par do §5.7.3.
- **Celular:** 500 ms de toque contínuo abrem `Drawer` diretamente, com avatar, nome, grupos arredondados, linhas de 56 px e área segura inferior. O chat permanece em layout móvel até `lg`, portanto usar o `Dialog` responsivo (que troca só abaixo de `sm`) abriria uma caixa central em celular deitado/tablet. Os primeiros 400 ms ignoram o clique fantasma deixado pelo toque longo.
- **Arraste horizontal para a esquerda:** revela duas ações de 76 px — “Mais” e “Arquivar”. Ao soltar, 35% da largura total é o limiar de abertura.

**Três armadilhas do gesto, todas já pagas — não as reintroduza:**

- ⚠️ **Quem desliza é a camada que envolve o toque, não o botão de dentro dela.** A faixa de ações é `absolute right-0`; a camada do toque é `z-10` e tem largura cheia. Transladando só o botão interno, a camada fica parada por cima das ações e **engole o toque destinado a “Mais”/“Arquivar”** — os botões apareciam e não respondiam a nada. Transladando a camada, o lado direito fica realmente descoberto.
- ⚠️ **Toque é toque.** O eixo só é capturado a partir de **12 px** e com o horizontal vencendo o vertical por **1,5×**: um toque de polegar escorrega de 6 a 10 px, e com 8 px / 1,15× ele era classificado como arraste. Pior, o clique seguinte era engolido por 400 ms **mesmo com a linha parada no lugar** — o resultado era “clico no nome e não entra na conversa”. O clique só é descartado quando a linha **andou de verdade** (`conversationSwipeMoved`). A tolerância do toque longo (10 px) é menor que o limiar do eixo de propósito: entre os dois valores o gesto não é nem menu nem arraste, e segue sendo clique.
- ⚠️ **Rolar mata o toque longo pendente**, por um listener de `scroll` em `capture` (o evento não borbulha) preso ao `AbortController` do próprio temporizador. Encostar o dedo para segurar a inércia da lista não pode virar menu meio segundo depois. Rolar também fecha a linha aberta, com carência de 350 ms — o arraste pode terminar com resto de inércia vertical no iOS, e sem a carência o primeiro `scroll` desfazia o gesto recém-feito.

**Custo do gesto em lista longa (419 conversas medidas em 2026-08-08):** `ConversationItem` é `memo` e os handlers descem de `conversations-list` com `useCallback`, senão cada `setSwipedId` no meio do arraste re-renderiza a lista inteira. As duas faixas de ação só são montadas durante o gesto e enquanto a linha está aberta. `will-change: transform` vale **só durante o arraste** — fixo, promovia uma camada de composição por linha; e a linha fechada não recebe `transform` nenhum, para não criar 419 contextos de empilhamento à toa.

**Conversa que sobe não sequestra a rolagem (419 conversas medidas em 2026-08-08):** quando o Realtime promove uma linha acima da viewport, a lista compensa uma altura de linha antes da pintura e mantém o conteúdo que estava sob o dedo. O scroller usa `overflow-anchor: none` para a compensação manual não somar com a nativa dos navegadores que já a implementam; no WebKit, onde ela não existe, o resultado fica igual. Se a promoção aconteceu fora do topo visível, aparece um botão discreto “N conversas novas ↑”; ele acumula conversas promovidas de verdade, leva o próprio contêiner ao topo e some quando a pessoa chega lá. Atualização duplicada sem mudança de posição não incrementa o aviso.

- Só entram ações persistidas: arquivar/desarquivar, marcar como lida/não lida, limpar e remover da lista. Silenciar, bloquear e trancar ficam fora até existirem contrato de provedor e persistência reais.
- **Arquivar não é resolver.** `archived_at` apenas organiza a lista e a aba “Arquivadas”; não altera `status`, não dispara takeover e não pausa a IA.
- Limpar marca as mensagens locais como removidas, zera prévia/contagem e registra um evento sem conteúdo; preserva conversa e pessoa. **Remover da lista** preenche `removed_at`, preserva vínculo e mensagens e restaura a conversa no próximo contato. Limpar é irreversível e usa ênfase destrutiva; remover não finge apagar o histórico nem usa vermelho. As duas ações exigem confirmação e explicam seu alcance real.

### §5.7.8 Respostas rápidas

**Usar e gerenciar vivem na mesma superfície, dentro do chat.** O cadastro morava em `/app/configuracoes`; gerenciar de lá exigia sair do atendimento, e a resposta nasce no meio da conversa em que alguém percebe que digita a mesma frase todo dia.

- O botão fica **dentro da cápsula do compositor**, à direita. Um quarto botão externo estreitaria demais o campo em telas de 320–390 px. É **um** ponto de entrada, não dois: o seletor é o gerenciador.
- Selecionar uma resposta **insere no cursor e devolve o foco ao campo**; nunca envia automaticamente. O operador sempre revisa antes de enviar.
- No desktop, o catálogo é um painel ancorado ao compositor; no celular, vira a gaveta responsiva do `Dialog`. Ambos têm busca por título, atalho e conteúdo, alvo de toque de 44 px e mensagem vazia explícita.
- Cabeçalho traz **`+` (Nova resposta)**; cada linha traz **editar** e **excluir**. Criar/editar é `ModalShell size="medium"` com título, atalho, mensagem e status; excluir tem `Dialog sm:max-w-sm` próprio e diz que não há desfazer.
- ⚠️ **Abrir um diálogo FECHA o seletor antes.** No celular o seletor já é gaveta, e gaveta sobre gaveta é o anti-padrão do §9 — dois backdrops e dois donos do `Esc`. Ele não reabre sozinho depois de salvar: quem acabou de cadastrar volta para o campo de texto, que é de onde saiu.
- ⚠️ **Os botões da linha ficam FORA dela.** A linha é um `<button>` quando a resposta está ativa, e botão dentro de botão é HTML inválido — o navegador fecha o de fora e a linha inteira para de funcionar (§5.7.5). Eles são irmãos absolutos, com a linha reservando `pr-20`.
- ⚠️ **Hover-only se decide por `(hover: none)`, não por largura.** O chat fica em layout móvel até `lg`: num tablet de 800 px o seletor já é o painel de desktop, e amarrar a visibilidade a `sm:` deixaria editar e excluir inalcançáveis no toque. Mesma regra do §5.6.
- **Resposta inativa continua na lista, mas não é inserível.** Ela aparece esmaecida com o selo "Inativa" e deixa de ser botão — mostrar e deixar enviar seria mentir sobre o que "inativa" significa. Ela precisa aparecer para poder ser reativada, e por isso a rota aceita `?scope=all`; o padrão continua devolvendo só as ativas.
- A lista é buscada **uma vez por sessão do seletor** e as mutações emendam o resultado no estado local (a rota devolve o item salvo). Recarregar a lista inteira a cada gravação piscaria a tela por nada.
- `chat_quick_replies` é a fonte única. **Toda a equipe cria, edita e exclui** — quem digita a mesma frase todo dia é quem sabe qual vale salvar; `created_by_user_id` registra o autor. Não crie uma segunda tabela nem consulta anônima.

### Busca e cadastro manual em Leads

- A busca da tabela é **server-side e global**, preservada na URL (`q` + `column`) e aplicada antes da paginação. Filtrar só os 20 itens montados fazia um lead existente em outra página parecer ausente.
- Nome, telefone e contexto usam busca textual; origem/status traduzem os rótulos de UI para os valores persistidos; entrada usa o dia em `America/Sao_Paulo`, igual ao formatador da tabela.
- Ao salvar manualmente, a confirmação declara que o contato está em Leads e no Funil e oferece “Conversar no WhatsApp”. Essa ação usa Number Check e não cria conversa para número inexistente.

### Geometria mobile do Chat no iOS

- A conversa aberta é um **overlay fixo próprio**, acima da casca móvel. Cabeçalho, lista e navegação permanecem montados e com a mesma geometria atrás dele; abrir ou fechar conversa não altera padding nem atributo do `body`.
- A camada externa pinta `100dvh` mais a extensão inferior da área segura. A camada interna usa `100dvh` no estado normal e acompanha a **viewport visual somente enquanto existe teclado real**: `--chat-vh` controla a altura e `--chat-vtop` compensa o pan aplicado pelo navegador.
- As variáveis são escritas no próprio painel da conversa e removidas no blur, na rotação e ao sair. Nunca pertencem a `html`, `body`, `.chat-page` ou à lista.
- O hook escuta `resize` **e** `scroll` do `visualViewport`. Há uma segunda leitura curta depois do evento porque o WebKit em modo PWA pode publicar `offsetTop = 0` antes de estabilizar.
- A referência é a altura visual observada **antes** do teclado. Uma viewport permanentemente menor em PWA não é teclado; só foco editável + redução contra essa referência + escala estável ativa a geometria transitória. O inset inferior vira zero apenas nesse estado.
- **Não simplifique para publicar `visualViewport.height` o tempo todo.** Ela pode nascer ou permanecer curta em PWA. No Chrome/Android normalmente só a altura muda; no Safari iOS a viewport também pode mudar de posição.

### §5.6.2 Fundo do painel de conversa

`\.wa-doodle` ladrilha `public/chat/conversation-canvas-{light,dark}.webp` sobre `--wa-bg`.

- **A classe vai no container que NÃO rola.** O ladrilho tem 785px; no elemento de scroll o desenho desliza junto com as mensagens e denuncia a emenda.
- `background-color: var(--wa-bg)` fica como base — é o que aparece enquanto o PNG carrega.
- Trocar o par claro/escuro é trocar só os dois arquivos; nenhum componente referencia o caminho.
- **WebP sem perda.** Traço de contraste baixíssimo sobre fundo chapado é o pior caso para compressão com perda: em `quality 70` os doodles viram borrão. Se for reexportar, compare um recorte ampliado — não confie na diferença de tamanho.

### §5.7.0 Avatar do contato

`ContactAvatar` é o único caminho — `conversation-item` e `chat-header` tinham cada um a sua cópia de `getInitials` e um `<img>` cru.

- **`onError` é obrigatório.** As URLs de `pps.whatsapp.net` são **assinadas e expiram** (medido: parte já devolve 403). Sem o fallback, o navegador desenha o ícone de imagem quebrada — o "?" que aparecia na lista.
- **Silhueta, não iniciais de telefone.** Iniciais só quando há nome com letra; caso contrário `UserRoundIcon`, como no WhatsApp Web. Círculo cinza neutro (`--wa-avatar-bg`), nunca a cor de marca.
- **Zerar o estado de erro quando a URL muda.** O header reaproveita a mesma instância ao trocar de conversa; sem isso uma foto quebrada contamina a conversa seguinte.
- A foto é **re-hospedada** no `chat-media` (privado) no `upsertMessage`, comparando pelo **caminho** da URL (a query é assinatura). Sem isso ela expira e nunca acompanha a troca de foto do contato. Ela fica no contato (`contacts.avatar_*`) e a conversa guarda `/api/contacts/<id>/avatar?v=<versão>`: o `v` muda com a foto, senão o navegador reaproveitaria a antiga.
- **Mídia do chat é servida pela rota do app** (`/api/chat/media/<id>`, e `?variant=thumb` para a miniatura), que redireciona para URL assinada curta. Componente nenhum monta URL do storage; usa `media_url` e `metadata.thumbUrl` como vêm.

### §5.7.1 Bolha de mensagem: formatação e resposta

- **Formatação do WhatsApp é só leitura.** `*negrito*`, `_itálico_`, `~riscado~`, `` `mono` `` e o bloco ```` ``` ```` são renderizados por `FormattedText`; o que trafega e o que fica gravado é o texto cru com os marcadores, igual ao WhatsApp. Nada reescreve o conteúdo.
- **Nunca `dangerouslySetInnerHTML` em mensagem.** O texto chega pela API do WhatsApp, escrito por quem estiver do outro lado. `parseWhatsappText` devolve nós React; montar HTML aqui seria XSS com porta de entrada pública.
- **Marcador sem par fica literal.** `2 * 3 = 6` e `snake_case` não viram formatação — o marcador precisa de espaço/início antes e conteúdo colado depois.
- **Menu da mensagem: hover no desktop, toque longo no celular.** O botão `…` fica no canto superior direito da bolha, invisível até o hover. No toque não existe hover: 500 ms sobre a bolha abrem o mesmo menu, e o botão vira só âncora do popup (`pointer-events-none`). Botão sempre visível cobriria o texto de toda mensagem.
- **O toque longo usa composição própria do iOS, não o dropdown desktop ampliado.** Uma única camada escurece e embaça a conversa; a mensagem selecionada fica nítida, e mensagem + painel sobem juntos quando não cabem abaixo. O painel permanece sob a mensagem, com 264 px no máximo, raio de 20 px, linhas de 56 px, texto de 16,5 px e ícones de 22 px. A superfície acompanha o tema: clara translúcida no modo claro e escura translúcida no modo escuro.
- **Movimento em camadas:** backdrop entra em 220 ms; mensagem em 240 ms; painel cresce da quina junto à bolha em 280 ms; itens aparecem em sequência curta. O fechamento mantém o `Dialog` montado até a animação terminar. `prefers-reduced-motion` reduz tudo pelo reset global.
- **Só entram ações reais.** O painel mobile mostra Responder, Encaminhar, Copiar, Editar, Apagar e “Mais…” conforme capacidade. “Mais…” entra no modo de seleção já existente. Reações, Favoritar ou qualquer controle sem persistência não aparecem como decoração.
- **A citação é um bloco clicável dentro da bolha**, com borda à esquerda, autor e duas linhas do original. Clicar leva até a mensagem original e **pisca** ela (`.wa-quoted-flash`) — sem o pisca o scroll chega lá e o olho não acha qual é.
- **Trocar de conversa ou ir para anotação interna cancela a resposta pendente.** Citação de outro contato é erro garantido, e anotação não vai ao contato.
- **O botão do menu fica FORA da bolha**, na faixa livre da linha, e o popup abre para esse lado (`side="inline-start"` na saída, `inline-end` na entrada). Dentro da bolha ele cobria o texto e o menu abria por cima da própria mensagem.
- **Geometria do WhatsApp Web:** raio `7.5px`, `px-[9px] pt-[6px] pb-[8px]`, sombra `0 1px .5px rgba(11,20,26,.13)`. Não `rounded-md` + `shadow-sm`.
- **Texto colado nunca define a largura da bolha.** A bolha e seus filhos flex usam `min-w-0`; texto, legenda, citação e nota interna usam `overflow-wrap:anywhere`. Isso quebra URL/token sem espaços dentro do limite de 84% no mobile e 68% no desktop, sem cortar conteúdo nem criar rolagem horizontal.
- **URL `http(s)` é link de verdade**, preserva o texto visível e abre em nova aba com `noopener noreferrer`. URL dentro de código monoespaçado continua literal: formatação técnica não vira ação escondida.
- **O primeiro link ganha preview acima do texto.** A uazapi gera o preview real no envio (`linkPreview: true`) e seus metadados enriquecem o card com imagem, título e descrição; sem metadados, o card mínimo ainda mostra o domínio. O CRM não baixa Open Graph de URL arbitrária — isso abriria SSRF por conteúdo recebido de qualquer pessoa.
- **Telefone escrito abre o menu `Conversar com… · Copiar número`.** “Conversar” chama o Number Check da uazapi no servidor; só número registrado cria/abre conversa. Data, hora e protocolo curto não viram telefone.
- **Hora e ticks encaixam na última linha do texto**, não numa linha própria: um `<span>` inline de altura zero reserva a largura no fim do parágrafo e a hora vai `absolute` no canto. Só para texto puro — em mídia a hora ficaria por cima da imagem.
- **A prévia da conversa também passa por `stripWhatsappFormat`.** A bolha renderizava `*Carla:*` em negrito enquanto a lista mostrava os asteriscos crus.
- **Imagem é `<button>`, não `<img onClick>`.** Sem isso não há foco nem tecla. O diálogo do lightbox só monta na primeira ampliação — e depois **fica montado**, senão fechar o desmonta no mesmo render e a animação de saída não roda.
- **Toque longo dispara `click` no filho depois de soltar.** A bolha barra isso em `onClickCapture`; sem a barreira, segurar sobre uma imagem abria o menu **e** o lightbox, e sobre o card de contato chegava a criar lead sem querer.
- **Divisor de não lidas é ancorado por ID, calculado uma vez ao abrir.** Recalcular a cada render moveria a linha conforme mensagem nova chega — ela marca onde o operador parou, não onde a conversa está. Por ser ID, carregar páginas antigas não a desloca.
- **Busca da conversa vive no servidor, não no que está montado.** A tela carrega 100 mensagens por vez; medido, 22 de 26 resultados de um termo comum ficavam fora dessa janela. Clicar num resultado **recarrega** a conversa em volta da mensagem (`?around=`), não pagina até ela.
- **Depois de pular para uma mensagem antiga, "ir para a última" recarrega.** A janela passa a terminar no passado — rolar até o fim dela pararia centenas de mensagens antes do presente.
- **Destaque do termo por fatias marcadas**, nunca HTML. Mesma regra da bolha: o texto vem do WhatsApp.
### §5.7.3 Bolha de mídia

- **A mídia encosta na borda.** Bolha de imagem/vídeo/figurinha usa `p-[3px]` + `w-fit`; texto puro mantém `px-[9px] pt-[6px] pb-[8px]`. Com o padding de texto, a foto ganha moldura branca e a bolha parece pequena.
- **Raio aninhado:** interno = externo − padding. Bolha `7.5px` com `3px` → mídia `rounded-[5px]`. Com `6px` o canto interno estoura o externo e incha.
- **Sem legenda, a hora vai SOBRE a mídia**, em pílula com véu `bg-black/50`. Numa linha própria, a bolha ganha uma tarja vazia embaixo da foto. Com legenda, a hora encaixa no fim do texto (§5.7.1).
- **O véu preto é deliberado** e não viola §3.1: o fundo é uma foto arbitrária, não uma superfície do tema. Token de tema não garante contraste sobre foto clara.
- **Gatilho do menu muda de lugar conforme o conteúdo.** Em mídia: quadradinho translúcido no canto superior direito, DENTRO da imagem. Em texto: fora da bolha, porque dentro cobriria a mensagem.
- **Menu translúcido** com `bg-popover/85 backdrop-blur-xl` — mantém o token do tema, não é cor solta.
- ⚠️ **O gatilho é `<button>` puro, NÃO o primitivo `Button`.** A variante `icon-sm` injeta `size-7` e `rounded-[min(...)]`, e o `twMerge` **não** resolve `size-*` contra `h-*`/`w-*` — os dois pares sobreviviam no atributo e quem vencia era a ordem do CSS gerado. O resto da superfície do chat (header, busca, barra de seleção) já usa botão puro pelo mesmo motivo.
- ⚠️ **Invisível tem de ser inerte.** O `pointer-events-auto` valia sempre no desktop, sem depender do hover: cada bolha de mídia tinha um alvo transparente de 28px no canto engolindo o clique destinado à foto. Agora `pointer-events` acompanha `opacity` (hover, `focus-visible` e `data-[popup-open]`), e o gatilho tem `z-10` em vez de depender da ordem de pintura.
- O `pointer-events` **não** bloqueia foco por teclado: o Tab alcança o gatilho, ele aparece e volta a aceitar clique.
- ⚠️ **Na bolha vai MINIATURA, nunca o arquivo original.** `chatImageThumbUrl` troca a URL pública do Storage pelo transformador (`render/image?width=640`). Medido na produção: a mesma foto sai de 900x1600 / **5,49 MB de RAM** para 640x1138 / **2,78 MB**. O original é servido em duas situações — quando a pessoa amplia (lightbox e "Abrir original") e em monitor acima de 1600px, via `<picture>` + `source media`, porque só ali a bolha passa de 640px de largura. Ver §9, "Peso no fio não é peso na memória".
- **`width`/`height` no `<img>` quando o provedor mandou as dimensões** (`metadata.mediaWidth`/`mediaHeight`). Reserva a altura antes de a foto chegar; sem isso cada carregamento remede a linha e a conversa salta debaixo do dedo. **Mensagem antiga não tem o dado e fica sem o atributo** — não se estima proporção.
- **Áudio: o `<audio>` sai do DOM ao sair da viewport**, e só fica preso depois que a pessoa mexeu no player (desmontar no meio cortaria a reprodução). A duração medida vive no estado do componente, então o rótulo continua na tela com o elemento fora do DOM.

### §5.7.16 Documento na conversa

- **Documento é um card interno no padrão do WhatsApp**, não um link de texto: ícone de arquivo, nome truncado, extensão explícita, tamanho quando esse metadado existe e ação circular de abrir. O card inteiro é o alvo, com pelo menos 56 px de altura e foco visível.
- **Nome e legenda são dados distintos.** `metadata.fileName` vence; mensagem antiga cujo `content` termina numa extensão usa esse conteúdo como nome e não o repete abaixo. Texto livre continua sendo legenda. MIME e URL servem apenas para recuperar a extensão quando o nome não existe.
- **Fallback não inventa identidade.** Sem nome real, a apresentação é `Documento.pdf`/`Documento.docx`; nunca expõe UUID do Storage como se fosse nome escolhido pela pessoa. Sem tamanho persistido, a linha omite tamanho em vez de estimar.
- **Arquivo ausente não vira `href="#"`.** O mesmo card permanece para preservar o histórico, mas mostra “Arquivo indisponível” e deixa de ser interativo.
- **Sem overflow:** card `max-w-full`, trilha de texto `min-w-0`, nome e metadados truncáveis e ícones `shrink-0`. A largura nominal de 256 px encolhe dentro da bolha de 84% no celular.
- **A exceção tipográfica de 11 px é deliberada.** É metadado secundário dentro da superfície WhatsApp, coerente com hora/ticks de 10,5 px; nome e legenda permanecem em tamanho de leitura.

### §5.7.10 Anotação interna

- **Toda nota é assinada.** "Nota interna · Carla", ou "Você" para o próprio autor. Sem autor conhecido, **sem assinatura** — nota antiga fica sem, e isso é honesto. Não se inventa nome para preencher a linha.
- **Só o autor edita e apaga.** Nota é registro de equipe: quem reescreve o que a colega anotou apaga o histórico de quem falou o quê com o paciente. O mesmo predicado (`note-actions.ts`) decide o item do menu e a recusa da rota.
- **Sem janela de tempo para editar**, ao contrário da mensagem: não há celular do outro lado mostrando a versão antiga.
- **A confirmação de apagar diz a verdade**: "some para toda a equipe; o contato nunca a viu". A copy de mensagem promete apagar para o contato — usá-la aqui seria mentira.
- **Nota não responde nem encaminha.** Ela não vai ao paciente; encaminhar seria vazamento interno.
- **A entrada é a aba, não o clipe** — inclusive no celular. Clipe promete anexar arquivo; anotação escondida ali é feature que, no telefone, não existe.
- **Gatilho do menu com 44px no toque**, transparente até o hover, e calha reservada no cabeçalho para o nome do autor não passar por baixo dele.

### §5.7.9 Respostas rápidas pelo `/` no compositor

- **A barra só é comando no COMEÇO do campo.** No meio é barra: "das 8/9h", "1/2 comprimido", "a/c Dra. Ana". Abrir a lista ali roubaria o Enter e as setas de quem está escrevendo — pior que não abrir.
- **A lista só abre quando há o que escolher.** Painel vazio segurando o teclado é ruído.
- **Ordem: prefixo do atalho > prefixo do título > contém.** Quem digita `/te` está mirando `/teste`. Resposta inativa não entra — ela nem é inserível no seletor.
- **Esc fecha o menu e MANTÉM o texto.** Voltar a digitar reabre a lista (o "dispensado" zera a cada termo novo). A versão anterior limpava o campo inteiro para o menu não reabrir na tecla seguinte — cobrava o texto da pessoa por um Esc, e texto do operador não se apaga por conveniência de implementação.
- **O botão de enviar obedece ao menu igual ao Enter**: com a lista aberta, ele insere a resposta destacada em vez de enviar o comando como texto.
- **Item de menu ancorado em campo usa `onPointerDown` com `preventDefault`**, nunca `onClick`: o clique tira o foco do campo antes de disparar, e o campo sem foco fecha o menu antes da escolha.
- **`aria-expanded` não vale em `textarea`** (papel implícito `textbox`), e `role="combobox"` num campo de várias linhas confunde o leitor de tela. Quem anuncia a lista é uma região `aria-live` com a contagem e como navegar.
- **Uma lista, um dono.** O seletor do ícone e o menu do `/` leem a mesma `store` (`useQuickReplies`, chamado uma vez no `ChatFooter`). Duas buscas separadas fariam a resposta criada num lugar não aparecer no outro.

### §5.7.11 Voltar no celular devolve a lista

- **Conversa aberta é estado, não URL** — então precisa de uma entrada de histórico própria, senão o gesto de voltar do iOS sai de `/app/chat` inteiro e cai no dashboard, no meio do atendimento.
- **Uma entrada por sessão de conversa, não por conversa.** Trocar de A para B não empilha de novo: a segunda entrada ficaria órfã e o operador precisaria de dois toques para sair da lista.
- **A seta do cabeçalho chama `history.back()`**, não limpa o estado na mão. Limpar direto deixaria a entrada empilhada órfã, com o mesmo efeito acima.
- Vale só abaixo de `lg`: acima disso lista e conversa convivem na tela e não há "voltar" a fazer.

### §5.7.2b Tela de envio de anexo: sheet lateral contido na conversa

- **É sheet, não drawer.** Entra da direita e ocupa toda a área da conversa; não nasce do rodapé, não tem alça e não arredonda somente o topo.
- **Não usa offset em pixel.** O portal do Base UI é montado dentro do `ChatView`, que é `relative`; sheet e backdrop são `absolute inset-0`. Assim a borda esquerda é sempre a borda real da conversa, inclusive com sidebar principal aberta/recolhida e nos breakpoints de 360/400 px.
- **O wrapper do portal também tem geometria.** Ele é `absolute inset-0 overflow-hidden`: recorta a entrada lateral na borda da conversa e neutraliza por herança o backdrop interno `fixed` que a Base UI cria para modais. Somente o overlay visual e o popup usam `pointer-events-auto` enquanto abertos.
- **Fechou visualmente, liberou o compositor imediatamente.** Overlay e popup recebem `data-closed:pointer-events-none`; mesmo durante os últimos quadros da animação ou se o WebKit atrasar o evento de conclusão, nenhuma camada transparente pode bloquear “Digite uma mensagem”.
- **A lista fica fora da camada por construção.** Nem painel nem véu são `fixed` no viewport. No celular, onde a lista já está escondida pela conversa imersiva, o mesmo sheet ocupa toda a tela útil.
- **Tema claro é branco de verdade** (`--wa-preview-bg: #ffffff`); o escuro preserva a superfície `#0b141a`. Controles e textos têm contraste próprio nos dois temas.
- **Enter envia, Shift+Enter quebra linha** — a mesma regra do compositor. Duas convenções na mesma tela obrigariam a pessoa a lembrar de qual está usando.
- **O foco acompanha a animação em duas etapas.** Enquanto o sheet entra, o próprio painel recebe foco com `preventScroll`; somente depois de `onOpenChangeComplete(true)` a legenda é focada, também sem rolagem. Focar a legenda enquanto o painel ainda está deslocado para a direita faz Safari/WebKit tentar revelar um elemento off-screen e deslocar a página inteira por um quadro.
- **Enquanto envia, o sheet não fecha** pelo X nem pelo Esc: o arquivo já está a caminho, e sumir com a tela esconderia o resultado. Fora do envio, a desmontagem espera a animação lateral terminar.
- **Barra de progresso indeterminada, nunca porcentagem.** O upload não reporta progresso; "47%" seria número inventado (UI.md §9). O que ela comunica é "está acontecendo".
- **O destinatário vira região viva** durante o envio ("Enviando para Fulano…"), que é o retorno que faltava para quem não vê a tela.
- **Metadados reais no cabeçalho**: tipo, tamanho e — quando a imagem carrega — as dimensões medidas. Nada é estimado.

### §5.7.12 Dados do contato: sheet lateral contido na conversa

Abre tocando na **foto ou no nome** dentro da conversa (`ChatHeader` → `ContactInfoSheet`). Mesma mecânica de portal do §5.7.2b — o portal nasce no `ChatView`, o sheet é `absolute inset-0`, e a lista fica fora da camada por construção.

- **O formato é do iOS; o conteúdo é do CRM.** A referência (WhatsApp) mostra **perfil comercial** — horário, categoria, descrição, site, mapa. Nada disso existe neste banco; copiar os campos seria inventar dado na tela (§1). O que entra é o que o CRM sabe: **o contato (e-mail, desde quando, notas), a empresa dele e o selo do contrato, e as etiquetas**.
- **Grupo "Empresa"**, entre as pílulas e as etiquetas: nome da empresa, razão social · CNPJ formatado em 13px `tabular-nums`, a linha "Contrato" com o `ContractStatusBadge` (é aqui que o analista vê **"Contrato suspenso"**), "Abrir empresa" (`next/link` para a ficha) e "Trocar empresa". Sem empresa: "Sem empresa vinculada" + "Ligar a uma empresa". **Nunca valor** — o painel é tela de quem atende.
- **Ligar, trocar e desligar** usam a vista "customer" do próprio sheet, com o `CustomerPicker appearance="chat"` (lista de botões, não popup: no sheet do chat o popup iria para o `body`). A gravação é o `PATCH /api/contacts/[id]` com `customer_id`, e o sucesso **espelha a empresa localmente** (o item escolhido já traz o selo), sem rebuscar — senão o esqueleto piscaria sobre as notas.
- **Esc volta um passo** nas vistas "tags" e "customer" (`details.cancel()` + volta para "info"), coerente com o §5.7.18.
- **Grupo "Tickets"** (Fase 4), entre Empresa e Etiquetas (`conversation-tickets-group`):
  - o ticket em foco (protocolo, título, selos) com até 2 ações rápidas, "Abrir ticket" (`next/link` para o detalhe), "Trocar foco (N abertos)" e "Novo ticket";
  - a falha da leitura tem "Tentar de novo" próprio, e o resto do painel continua.
- **Vistas do ticket** no próprio sheet:
  - "tickets": os abertos da conversa, para trocar o foco (`PUT active-ticket`);
  - "ticket-new": o formulário.

  Um **mapa de vista-pai** decide para onde o Esc e o voltar levam: "ticket-new" volta de onde veio. O cabeçalho abre o painel direto numa vista pela prop `initialView`, aplicada quando o painel abre.
- **Formulário "Novo ticket":**
  - RHF + zod compartilhado com a rota;
  - Título; Prioridade e Fila em **pílulas** (no sheet, popup iria para o `body`); Descrição;
  - "Assumir o atendimento" ligado por padrão;
  - `idempotency_key` gerada **ao abrir** (`newUuid`, com fallback para `http://` em IP da rede, onde `crypto.randomUUID` não existe), mais uma trava de `useRef`: duplo clique = 1 ticket;
  - Esc ou toque fora com o formulário sujo pergunta "Descartar?" na própria vista.

  Um reenvio depois de erro de rede que devolve o ticket da 1ª tentativa avisa com `toast.warning`, e não diz "aberto".
- ⚠️ **Colar com o painel aberto não vira anexo:** o colar global do chat ignora a colagem quando o painel está aberto. Um print colado na Descrição fica na Descrição.
- **Lista agrupada, no padrão da tabela do iOS.** Cartão `rounded-xl` por seção, título em versalete acima do cartão, `divide-y` entre linhas (sem borda na última), rótulo à esquerda e valor à direita.
- **Fundo da página e fundo do cartão são superfícies diferentes.** `--wa-info-bg` × `--wa-info-card`, com par claro/escuro. É o degrau entre as duas que desenha o cartão; igualá-las apaga a estrutura e obriga a devolver borda em tudo.
- **A identidade não espera a rede.** Foto, nome e telefone vêm da conversa e pintam no primeiro quadro; só o bloco de lead tem esqueleto — a tela nunca troca de tamanho quando o dado chega (§9).
- **Erro tem saída.** Falha de rede vira linha com "Tentar de novo", não uma linha morta. Sem lead, a tela **diz** que não há lead em vez de mostrar campos vazios que parecem defeito.
- **Notas editáveis gravam pela rota do contato** (`PATCH /api/contacts/[id]`). Rota nova seria um segundo caminho para o mesmo campo, com duas validações que divergem. O par Descartar/Salvar só aparece com alteração pendente — botão permanente convida a gravar o que não mudou.
- ⚠️ **O texto de apoio das notas é cinza, não verde.** Na referência "Adicionar notas" é uma **linha que se toca**; aqui o campo já está aberto. Verde num placeholder promete um clique que não existe.
- ⚠️ **Saída do chat é `next/link`, não `<a>`** ("Abrir empresa"): sair por documento inteiro pisca branco no PWA.
- ⚠️ **O selo não é ao vivo.** Não há Realtime em `customers` (decisão de segurança: `authenticated` só lê as tabelas de chat); outra aba só vê a mudança ao reabrir o painel.
- **Foto e nome são um alvo só** no cabeçalho, com `py-1` para o toque chegar a 48px sem mexer na altura fixa de 64px. Os textos viraram `span`: `<button>` aceita só conteúdo de frase, e `<p>` dentro dele é HTML inválido.
- **Ampliar a foto ficou de fora de propósito** — seria diálogo sobre diálogo, que é anti-padrão aqui (§9). Também fora: galeria de mídia, silenciar, bloquear e exportar; nada disso existe no back-end.

### §5.7.20 Ticket em foco no cabeçalho da conversa (Fase 4)

- **Linha de apoio**, dentro do botão de identidade, só texto: "IA · SUP-1024 Em atendimento", com `truncate`.
- **Chip a partir de `lg`** (`conversation-ticket-chip`):
  - com foco: `next/link` para o ticket, com protocolo e `SlaBadge`, mais o menu (ações rápidas, Abrir ticket, "Trocar foco (N abertos)");
  - sem foco: "Abrir ticket", que abre o painel em "ticket-new".
  - **No celular, nada novo** na coluna de ações (`h-16`).
- **Espaço no cabeçalho:** a coluna de ações só encolhe quando o chip é o de foco (`has-[[data-ticket-chip=focus]]`), que é o único que trunca. O botão Assumir/Devolver é `shrink-0` e nunca quebra em duas linhas.
- **Uma leitura de tickets por conversa:** o `ChatView` usa `useConversationTickets` e passa os dados ao painel. A releitura acontece ao mudar foco ou status, no `visibilitychange`, depois de cada ação e quando chega mensagem do cliente (debounce de 1 s). O foco vem do Realtime de `chat_conversations` (`active_ticket_id`): mudar o foco em outra aba troca o chip aqui.
- **"Assumir"** com ticket em foco é o take-over do ticket (conversa `human`, responsável e `em_atendimento`), e a conversa devolvida pela rota é aplicada na hora, sem esperar o Realtime.
  - Com `already_assigned`, abre o diálogo "SUP-1024 está com <nome>. [Assumir conversa e ticket] [Só a conversa]".
  - O diálogo entra no `anyDialogOpen`.
  - Sem foco, é o PATCH de sempre.
- **PATCH de status:** aplica só `{id, status}`, que é o que a rota grava, e nunca a linha da resposta. Uma resposta que chega depois de um evento mais novo do Realtime desfaria a prévia, a ordem e as não lidas (e o `updated_at`).

### §5.7.13 Etiquetas do chat e caixa de arquivadas

Etiquetar é gesto de **meio de atendimento**, então tem porta em quatro lugares: toque longo na conversa (celular), menu ⋯ (desktop), dados do contato, e a tela de etiquetas. Todas montam o **mesmo** `ConversationTagsPicker`.

- **Reusa a tabela `tags` do funil, não uma nova.** Uma etiqueta "Novo cliente" é a mesma coisa no chat e no funil; duas tabelas dariam dois vocabulários ao mesmo operador. O que nasceu foi só o vínculo (`conversation_tags`), espelhando `lead_tags`.
- ⚠️ **O chip usa `badge`, não `solid` — e isso é acessibilidade, não gosto.** A referência mostra pílula sólida com texto branco, e a variante existe na paleta. Mas ela foi desenhada para botão e barra de kanban: `bg-yellow-500 text-white` dá **1,98:1**, e a pessoa escolhe entre as 19 cores num seletor — amarelo, lima, âmbar, ciano e azul-céu sairiam ilegíveis. O `badge` passa no AA em qualquer cor por construção, nos dois temas, e é o mesmo chip que a tabela de leads já desenha para a mesma tag.
- ⚠️ **O chip vai em linha própria, e isso mudou a lista de altura fixa para altura variável.** `promotedConversationScrollShift` decide **se** compensa (por índice); quem converte para pixel agora mede as linhas de verdade (`measureConversationRows`), e o índice de viewport sai de `viewportIndexFromHeights`, não de `scrollTop / alturaDaPrimeiraLinha`.
- ⚠️ **A medição procura `[data-conversation-row]`, nunca `firstElementChild`.** Acima das conversas moram os atalhos; medi-los como linha daria a altura errada para toda a lista.
- ⚠️ **As etiquetas descem com referência estável.** A linha é `memo` e o arraste depende disso: `mergeTagAssignment` devolve o MESMO array para conversa que não mudou, e conversa sem etiqueta recebe a constante congelada `NO_TAGS` — `?? []` no ponto de uso mataria a memo da maioria das linhas.
- **Nenhuma superfície empilha camada.** A gaveta do toque longo e o sheet de contato **trocam o próprio miolo** por "Etiquetas", com "Voltar"; o dropdown do desktop não é modal, então ele fecha e um diálogo abre. Apagar etiqueta confirma **dentro da linha**, com a contagem na frase ("Sai de 12 conversas").
- ⚠️ **O seletor tem teto de altura próprio (`max-h-[min(50dvh,22rem)]`), não `flex-1`.** Ele é montado em três cascas e só uma dá altura definida ao filho; com `flex-1` num pai de altura automática o scroller colapsa e a lista não rola.
- **"Arquivadas" saiu dos chips de filtro e virou linha** com contador, como na referência. Chip e linha para o mesmo lugar seriam duas portas na mesma tela — a linha ganha porque mostra quantas são. Dentro da caixa, os atalhos dão lugar a um cabeçalho de voltar: sem o chip, não haveria outra saída.
- **Filtro por etiqueta é dimensão à parte do `statusFilter`** — dá para ver "só IA" e "só Novo cliente" ao mesmo tempo. Lista vazia por causa dele **diz o nome da etiqueta** e oferece "Mostrar todas": some a lista sem explicação e a pessoa acha que perdeu as conversas.
- **Etiqueta não propaga por Realtime.** O canal escuta `chat_conversations`, e `conversation_tags` é fechada por RLS de propósito. Quem etiqueta vê na hora; outra aba vê ao recarregar.

### §5.7.14 Arrastar a linha para os dois lados

- **Esquerda revela "Mais" e "Arquivar"** (era o único lado). **Direita revela "Não lida" e "Fixar"**, na ordem do iOS: a ação de ponta fica na borda da tela e a segunda encosta na linha.
- `clampConversationSwipe` passou a aceitar deslocamento **positivo**; antes ele cortava tudo acima de zero, e era isso que impedia o arraste para a direita de existir. Quem decide onde a linha assenta é `settleConversationSwipe`, que devolve **o lado** (`leading` / `trailing` / `null`) — com booleano não dava para dizer qual das duas faixas ficou aberta.
- **Só a faixa do lado para onde o dedo foi é montada.** Montar as duas em todas as linhas eram ~700 botões parados no DOM do celular.
- **Fixar guarda data, não booleano.** `chat_conversations.pinned_at` ordena as fixadas entre si — a fixada mais recente fica acima, como no WhatsApp. Com `boolean` isso exigiria uma segunda coluna só para o desempate.
- ⚠️ **A ordem da consulta e a de `compareByLastMessage` têm de ser idênticas** — agora `pinned_at desc` e depois `last_message_at desc` nas duas. Se discordarem, a lista se reordena sozinha no primeiro evento do realtime.
- ⚠️ **`mergeConversationUpdate` compara `pinned_at` junto de `last_message_at`.** Fixar não mexe na hora da última mensagem; sem essa comparação a conversa fixada só subia ao topo na próxima recarga.
- **A linha fixada leva um alfinete** ao lado do balão de não lidas. Sem ele, a conversa aparece no topo sem explicação e parece defeito de ordenação.

### §5.7.15 Encaminhar: a lista é sempre completa

- ⚠️ **A tela de encaminhar busca a própria lista** em vez de reusar a da barra lateral. A lateral é filtrada — por status e por etiqueta — e encaminhar a partir da caixa de arquivadas oferecia como destino **apenas conversas arquivadas**. Para onde a mensagem pode ir não tem relação com o filtro da tela.
- A lista lateral entra como **semente**: a tela abre preenchida com o que já está em memória e completa quando a busca volta, em vez de piscar vazia. Falha de rede não esvazia — a semente continua servindo.
- **A consulta traz só as colunas desenhadas** (id, nome, telefone, foto, prévia). `select("*")` puxaria as 425 linhas inteiras, com `metadata` e o resto, para mostrar cinco campos.
- **A bolha encaminhada mostra "Encaminhada"** com seta e itálico, acima do conteúdo e antes da citação — o rótulo vale para a mensagem inteira, não para o trecho citado. O dado (`metadata.forwarded`) já era gravado pela rota desde sempre; faltava quem o lesse.

### §5.7.4 Arrastar arquivo para a conversa

- Moldura tracejada em `--wa-green` sobre véu escuro, com "Solte o arquivo nesta tela". Cai no **mesmo fluxo** do clipe: abre a tela de envio (§5.7.2).
- **O estado do anexo mora no `ChatView`, não no rodapé.** Foi o que permitiu a área de mensagens virar alvo de soltura sem duplicar a tela de envio.
- **Contador de profundidade, não booleano:** `dragleave` dispara ao passar por cada filho, e um booleano faz a moldura piscar enquanto o arquivo atravessa a lista.
- **A camada é `pointer-events-none`** — senão engole o próprio `drop`, escutado no contêiner — e `aria-hidden`, porque leitor de tela não arrasta arquivo.
- ⚠️ **Soltar respeita o mesmo bloqueio do clipe.** Com a conversa em modo IA o clipe é desabilitado; sem a mesma trava no `drop`, o operador manda anexo por trás da IA sem perceber.

### §5.7.5 Encaminhar, editar e apagar

O menu da bolha completo: `Responder · Copiar · Encaminhar · Editar · ─── · Apagar`. Cada item só aparece quando a ação é possível de verdade — os predicados vivem em `features/chat/lib/message-actions.ts` e são os **mesmos** que a rota usa para recusar. Regra duplicada nos dois lados é como se ganha um item que sempre dá erro.

- **"Apagar" no menu mobile é vermelho**, como no menu contextual do iOS; o separador fica antes de “Mais…”. No dropdown desktop, a confirmação continua sendo o ponto de maior ênfase destrutiva.
- **Apagar confirma antes.** A ação é irreversível e sai da nossa mão — o WhatsApp apaga do celular do paciente. `Dialog` `sm:max-w-sm`, uma linha de texto, Cancelar + Apagar (`variant="destructive"`).
- **"Editar" some depois de 15 minutos** (limite do WhatsApp). Item que sempre falha é pior que item ausente.
- **A janela de edição é medida quando o menu ABRE**, não a cada render: ler o relógio durante a renderização é impuro (`react-hooks/purity`), e recalcular faria o item sumir debaixo do cursor. Quem decide se o *gatilho* existe é `isEditableMessage`, que não olha a hora.
- **"Editada" ao lado da hora** quando há `metadata.editedAt` — sem isso o texto muda sozinho e ninguém sabe por quê. O `<span>` de reserva da última linha (§5.7.1) cresce junto, senão o texto passa por baixo.

**Diálogo de editar** — cabeçalho com ✕ à esquerda, a mensagem sobre `.wa-doodle`, e o campo com sublinhado verde de 2 px, emoji e botão redondo verde.

- **A prévia é a `MessageBubble` de verdade**, dentro de um embrulho `pointer-events-none`. Redesenhar a bolha aqui seria a segunda cópia da geometria do WhatsApp; o embrulho é o que impede o gatilho do menu de aparecer no hover e o lightbox de abrir por cima do diálogo.
- A bolha mostra o texto **original**, parado: comparar o antes com o que se digita é o valor da tela.

**Encaminhar** — o item do menu entra no **modo de seleção** com a mensagem já marcada, e a barra inferior substitui o compositor (`✕ · N selecionada(s) · ↷`).

- A caixa de seleção fica **fora da `MessageBubble`** (`SelectableRow`, em `chat-view.tsx`), à esquerda de toda linha, independente da direção. Assim a bolha não ganha um segundo modo: menu, lightbox e player ficam inertes só com o `pointer-events-none` do embrulho.
- A caixa é o único controle focável da linha; a bolha é o rótulo dela, e por isso a prévia da mensagem vai no `aria-label`.
- **Soltar arquivo fica bloqueado** no modo de seleção, pelo mesmo motivo do modo IA (§5.7.4): o compositor não existe ali.
- **Máximo de 5 conversas**, que é o limite do próprio WhatsApp. Ao encher, as outras linhas desabilitam **e o rodapé diz por quê** — opacidade sozinha não explica nada.
- ⚠️ **Nada de `Checkbox` dentro da linha do seletor de destino.** O primitivo renderiza um `<button>`, e botão dentro de botão é HTML inválido: o navegador fecha o de fora e a linha para de funcionar. Ali a caixa é um `<span>` decorativo, e quem carrega o estado é o `aria-pressed` da linha.
- ⚠️ **`wa-surface` vai no próprio `DialogContent`.** Os diálogos são portalados para o `body`, fora da árvore do chat — sem a classe, `--wa-green` não existe naquele ramo e o verde cai no padrão claro mesmo no tema escuro. A classe só declara variáveis, não pinta nada.

### §5.7.17 Enviar é instantâneo: o estado é da mensagem, não do compositor

**O compositor nunca fica em espera.** Aperta-se Enter, o texto sai do campo, a bolha entra na conversa e o campo continua focado e pronto para a próxima frase. Quem mostra o andamento é **cada mensagem**, na régua de hora dela.

| Estado | O que aparece | Quando |
|---|---|---|
| Enviando | 🕐 relógio (`ClockIcon`) | Da bolha otimista até o provedor confirmar (`delivery_status: pending`) |
| Enviada | ✓ | `sent` |
| Entregue / Lida | ✓✓ apagado / ✓✓ em `--wa-tick` | `delivered` / `read` |
| Não enviada | ✕ vermelho + **Tentar novamente** | `failed` |

- **Nada de estado visual novo.** A bolha já desenhava os quatro; a mensagem otimista é apenas mais uma `pending` que ainda não tem linha no banco.
- **A bolha otimista já nasce com a assinatura do operador** (`*Ana:*`). Sem isso a linha em negrito brotava ~1s depois e a bolha crescia na cara de quem enviou.
- **Enquanto não voltou do servidor, a mensagem não oferece responder, encaminhar nem toque longo** — ela ainda não tem id que alguém consiga citar. Editar e apagar já dependiam do `external_id`.
- **Falhou? A bolha vira o aviso** — ✕ e "Tentar novamente" ali mesmo, sem toast e sem perder o texto. O reenvio reusa a **mesma** mensagem (idempotência por `clientId` na rota); nunca nasce uma segunda. Toast só quando o operador já trocou de conversa e não há bolha para avisar.
- ⚠️ **Nunca desabilite o `textarea` durante uma requisição.** Campo desabilitado **perde o foco** no navegador e ele não volta sozinho — era a causa única do composer travado *e* do foco perdido depois do Enter.
- **Rascunho é por conversa.** O texto não enviado espera o operador voltar. O dono do rascunho é o `ChatShell`, porque o `ChatView` é desmontado a cada troca de conversa.
- **Rolagem:** a própria mensagem sempre leva a conversa ao fim (instantâneo, não suave). Mensagem que chega enquanto se lê o histórico **não** move a tela — acende a seta de "ir para a última".

**Foco: o compositor se prepara sozinho.** Gesto que significa "vou escrever agora" não pode cobrar um clique a mais no campo.

| Gesto | Foco vai para o campo? |
|---|---|
| **Responder** numa mensagem | **sim**, inclusive no celular — o toque já disse que a próxima coisa é digitar (e volta ao modo mensagem: citação não existe em anotação interna) |
| Cancelar a resposta (✕) | sim — o ✕ some junto com a barra e o foco cairia no `body` |
| Enviar (Enter ou botão) | sim — ver acima |
| **Abrir a conversa** | só no desktop |
| **Assumir** o atendimento | só no desktop — o campo estava `disabled`, o navegador soltou o foco e ninguém devolvia |
| Fechar a tela de envio de anexo | só no desktop, por `focusToken` (o diálogo devolveria o foco ao clipe, ou a lugar nenhum quando o anexo entrou por colar/arrastar) |
| Emoji, resposta rápida | sim, preservando a posição do cursor |

- ⚠️ **No celular, foco automático = teclado subindo.** Por isso abrir conversa, assumir e fechar o anexo **não** focam ali: o teclado cobriria justamente a conversa que a pessoa abriu para ler. Responder foca nos dois, porque ali o teclado é o que se quer.
- ⚠️ **Foco automático nunca rouba de outro campo.** Antes de puxar o cursor, verifica-se o `activeElement`: se for `input`/`textarea`/`contenteditable` ou algo dentro de um diálogo, desiste. Sem isso, um "Assumir" feito por outra pessoa chega por Realtime e arranca o cursor de dentro da busca.
- `focus({ preventScroll: true })` sempre: o navegador rolando até o campo por cima do teclado subindo sacode a conversa inteira.
- Cursor vai para o **fim** do texto: com rascunho guardado (§5.7.17), o padrão do navegador é o começo, e a pessoa escreveria antes do que já tinha digitado.
- **Encaminhar** também abre com o cursor na busca (desktop): a lista tem 425 nomes, e quem abre está procurando alguém.

**Enter e quebra de linha:** no desktop, Enter envia e Shift+Enter quebra linha. **Com teclado virtual, Enter quebra linha** — no celular não existe Shift+Enter, e interceptá-lo tornaria mensagem de várias linhas impossível; o botão de enviar está do lado. A distinção é por ponteiro (`(hover: none) and (pointer: coarse)`), não por largura: janela estreita no desktop continua tendo teclado físico. Durante composição de IME (acento morto, sugestão do Android) o Enter pertence ao teclado, nunca ao envio.

### §5.7.18 Esc em camadas: cada tecla desfaz uma coisa, a última fecha a conversa

**Lei do Esc no chat:** cada Esc desfaz **exatamente uma** coisa, da mais interna para a mais externa. Quando não sobra nada aberto, ele **fecha a conversa** e devolve a tela vazia — como no WhatsApp Web. No desktop essa é a única saída: a seta do cabeçalho é `lg:hidden`.

Ordem, de dentro para fora:

1. Diálogo do Base UI (editar, apagar, encaminhar, enviar anexo, menu de contexto, dados do contato) — fecha sozinho.
2. Painel do compositor: menu do `/`, seletor de emoji, painel do clipe. Gravação de áudio em curso (ou já gravada) é **descartada**.
3. Modo de seleção → sai da seleção.
4. Busca na conversa → fecha a busca.
5. Barra "Respondendo" → cancela a resposta.
6. Nada aberto → **fecha a conversa**.

- ⚠️ **Quem abre algo dismissível trata o próprio Esc e chama `preventDefault()`.** Esse é o protocolo: o `ChatView` só age em `event.defaultPrevented === false`. Sem ele, um Esc com o seletor de emoji aberto fechava o painel **e** a conversa inteira — e um Esc durante a gravação levava o áudio junto.
- ⚠️ **Popover solto não herda o Esc do Base UI.** O seletor de emoji e o painel do clipe são `div` com backdrop próprio (§9: gaveta dentro de gaveta é anti-padrão), então precisam do handler deles. Ao criar outro painel assim no chat, ele entra nesta lista.
- **Fechar pelo teclado devolve o foco ao campo de contatos** (o mesmo contador de `focusSearchToken` do Ctrl+F). Largar o foco no `<body>` faria o próximo Tab recomeçar do topo do documento. **Só no desktop** — no celular abriria o teclado virtual sobre a lista que o operador pediu para ver.
- **Fecha pelo mesmo caminho da seta do cabeçalho** (`onBack`), não limpando o estado na mão: no celular é ela que devolve a entrada de histórico em vez de deixá-la órfã (§5.7.11).
- O rascunho **sobrevive** ao fechamento (§5.7.17), então sair com Esc no meio de uma frase não custa o texto.

### §5.7.19 Filtros da lista: o que é frequente fica à vista, o resto vai para o painel

**Não existe rolagem horizontal aqui — e isso é a decisão, não um detalhe.**

A primeira versão foi um trilho `overflow-x-auto` com todos os chips (responsável, não lidas, cada etapa do funil, cada etiqueta). Falhou duas vezes em produção, e a causa não era ajuste fino: **a quantidade de filtros não cabe numa faixa de 360px, e nenhum truque de rolagem conserta isso.** Roda de mouse não rola na horizontal; o gesto de dois dedos vira "voltar" do navegador; a barra de rolagem escondida não avisa que há mais; e o que está fora da vista é, na prática, invisível.

```
Linha 1 (sempre):  [Tudo] [IA] [Humano] [Não lidas]  [⚙ Filtros ②▾]
Linha 2 (só com etapa/etiqueta escolhida, quebra linha):
                   [Em atendimento ✕] [●VIP ✕]  Limpar
```

- **Linha 1 nunca transborda.** Quatro chips que cabem + o botão do painel. `flex-wrap` é a rede de segurança: se um dia não couber, **quebra a linha** — nunca vaza, nunca esconde.
- **Painel (`DropdownMenu`).** Etapa do funil e etiquetas em lista vertical com marcação. Rolagem **vertical** dentro do popup — confiável, esperada e já pronta no primitivo (`max-h-(--available-height) overflow-y-auto`). Portalizado: não é cortado por `overflow` de ancestral e não disputa `z-index`.
- **Linha 2 mostra o que está filtrando**, como chip removível. A **pílula inteira** é o botão de remover — o alvo tem a largura do rótulo em vez de exigir mira num ✕ de 12px.
- **Marcar não fecha o painel.** `Menu.CheckboxItem` do Base UI tem `closeOnClick` com padrão `false` (conferido no pacote, não presumido) — dá para montar `Atendimento + VIP` sem reabrir.
- ⚠️ **A largura do painel vai por `style`, não por classe.** O primitivo traz `w-(--anchor-width)`: ancorado num botão de ~90px, o painel nasceria com 90px. Sobrescrever por classe dependeria de o `twMerge` desduplicar a forma `w-(--var)` do Tailwind v4 — se não desduplicar, as duas sobrevivem e quem vence é a ordem do CSS gerado. Estilo inline ganha sempre.
- **Sumiu a engrenagem de "quais etapas aparecem".** Ela só existia para caber tudo na faixa; com o painel, cabe tudo por construção.
- **"Resolvidos" não é chip** (pedido do cliente): conversa resolvida continua em "Tudo" e no status da própria linha.

#### Etiqueta carrega a cor dela

Chip da linha 2 e ponto no painel usam a cor da própria etiqueta — é o que permite reconhecê-la sem ler.

- ⚠️ **Variante `badge` da paleta, nunca a `solid`.** Mesma decisão de acessibilidade do `conversation-tag-chips`: `solid` foi desenhada para botão, e `bg-yellow-500 text-white` dá **1,98:1**. Como a cor é escolhida pelo operador entre 19 opções, amarelo, lima, âmbar e ciano sairiam ilegíveis. O `badge` (borda + fundo a 10% + texto em `-700`/`-300`) passa no AA por construção, nos dois temas.
- **Etapa não tem cor.** O funil tem cor de domínio (§3.4), mas colorir etapa ao lado de etiqueta faria a linha competir consigo mesma — a cor fica reservada para quem a usa como identidade.

**O que combina com o quê**

| Grupo | Comportamento | Onde |
|---|---|---|
| Tudo · IA · Humano | **exclusivo** (um por vez) | linha 1 |
| Não lidas | alternável | linha 1 |
| Etapa do funil | multi, **OU** entre etapas | painel |
| Etiqueta | multi, **OU** entre etiquetas | painel |

Entre grupos é **E**. Dentro de etapa e de etiqueta é **OU** — o lead está numa etapa só, e exigir duas etiquetas ao mesmo tempo devolveria lista vazia quase sempre, o que parece defeito e não precisão. Tocar num chip nunca apaga o filtro de outro grupo.

**Onde cada filtro acontece:** servidor só decide a caixa (ativas × arquivadas) e a busca; responsável, não lidas, etapa e etiqueta filtram a lista já carregada. Clique em filtro custa **zero rede**, e o Realtime acerta sozinho. ⚠️ Vale porque a lista da lateral vem inteira (não há `.range()`); quando ganhar paginação, etapa e não-lidas viram filtro de query.

**Etapa do funil é `leads.status`**, resolvida no embed que a listagem já fazia (`lead:leads(name, phone, status)`) — mesma consulta, sem N+1 e sem segunda fonte da verdade. As etapas vêm do **servidor com a página** (`getBoardColumns()`).

### §5.7.6 Teclado, colar e largura da coluna

**Colar (Ctrl/⌘ + V)** é a terceira porta para o mesmo fluxo do clipe e do arrastar (§5.7.4): cai na tela de envio, com legenda.

- Escuta na **janela**, não num campo. No WhatsApp Web colar um print funciona sem clicar no compositor antes, e é assim que se cola um print recém-tirado.
- **Só intercepta quando há arquivo** no clipboard. Colar texto no compositor continua igual.
- Inerte com diálogo aberto (a legenda, a edição e a busca do encaminhar têm os próprios campos) e no modo de seleção.
- ⚠️ **Com a IA no comando, colar avisa em vez de falhar calado.** O clipe fica visivelmente desabilitado e o arrastar não acende a moldura, mas colar não tem afordância nenhuma — sem o toast, nada acontecia e o operador não sabia por quê.

**Ctrl/⌘ + F** busca na conversa aberta; sem conversa, vai para o campo de contatos. **Ctrl/⌘ + Shift + F** vai sempre para os contatos.

- O estado da busca da conversa mora no **`ChatShell`**, não no `ChatView`: o atalho precisa escolher entre as duas buscas, e só ele enxerga as duas. O campo de contatos recebe o foco por um **contador**, não um booleano — apertar duas vezes seguidas tem de funcionar nas duas.
- Substituir o "localizar" do navegador é o que Slack, Discord e o WhatsApp Web fazem. Aqui tem uma razão a mais: a conversa chega a 684 mensagens e só 100 estão no DOM, então o localizar nativo procuraria no lugar errado.
- **Diálogo aberto fica com o atalho** (guarda por `[data-slot='dialog-content']`): sem isso o Cmd+F abriria a busca **atrás** do diálogo, invisível.
- O atalho se anuncia no `title` e no `aria-keyshortcuts` dos dois campos. Atalho que rouba tecla do navegador e não se anuncia é armadilha.

**Coluna única e fluida em toda largura.** Lista, rodapé e busca reutilizam `CHAT_COLUMN_CLASS`: `px-2` no celular, `sm:px-5` no tablet e `lg:px-[clamp(2rem,3vw,4.5rem)]` no desktop. Não existe `max-w`: o teto antigo de 1024 px deixava centenas de pixels vazios em monitores largos e afastava as bolhas das bordas do painel. O `clamp` aproxima a conversa sem colá-la na moldura e limita o gutter a 72 px em ultrawide.

- ⚠️ **A largura vai num embrulho, nunca na caixa que já tem `px-`.** O `twMerge` descarta o padding base contra o padding interno da caixa, mas **os variantes `sm:`/`lg:` sobrevivem** — a barra "Respondendo" ganharia respiro interno diferente em cada breakpoint. Mesma armadilha do `sm:max-w-*` no lightbox.

### §5.7.7 Celular: conversa imersiva e toque longo

**Conversa aberta no celular esconde a casca do app.** Cabeçalho (56px) e nav inferior (64px) comiam 120px de uma tela curta — num iPhone SE sobravam ~390px de mensagens. A volta é pela seta do cabeçalho da conversa, que já existia.

- O `ChatShell` aplica `.chat-mobile-overlay` à sua própria raiz sob `lg`. O overlay fica acima da casca (`z-index: 40`), então ela some visualmente sem ser reconfigurada nem desmontada.
- ⚠️ **Não volte a controlar este estado por atributo no `body`.** A casca possui transição de padding; alterná-la ao voltar reproduz o defeito em que a lista nasce deslocada e desce gradualmente.
- ⚠️ **Quem encosta no entalhe é `.chat-mobile-viewport`.** O respiro vem como padding nessa camada interna. A camada externa continua pintando `--wa-panel` até além da área segura inferior, portanto o fundo global nunca aparece abaixo do compositor.
- Fechar a conversa desfoca primeiro o campo editável e só então revela a lista; isso impede o teclado de continuar governando a viewport durante a troca.

**Toque longo abre o menu de contexto** (`message-context-menu.tsx`), no formato do WhatsApp no celular: o fundo embaça, a mensagem tocada continua nítida no lugar dela, e o painel abre colado nela. No desktop o gatilho continua sendo o chevron — são dois caminhos para o mesmo conjunto de ações.

- **A bolha do menu é um CLONE, não a original.** A original vive dentro do contêiner que rola; não existe `z-index` que a levante acima de uma camada de tela cheia sem arrastar a lista junto. Clonar é o que permite embaçar tudo e manter só ela em foco.
- O retângulo é **copiado** do `getBoundingClientRect`, não guardado por referência: um `DOMRect` vivo muda se a lista mexer e o clone sai do lugar.
- Vai no primitivo `Dialog` pela armadilha de foco, o Esc e a **trava de rolagem** — sem ela a lista rolaria por baixo e o clone ficaria pairando longe da mensagem.
- O painel permanece **abaixo** da bolha; quando o conjunto não cabe, ele sobe inteiro. Mensagens excepcionalmente altas ocupam no máximo 45% da viewport no clone, com fade no corte, e o painel rola dentro do espaço restante. A altura natural das ações é medida por `scrollHeight` em `useLayoutEffect`; a estimativa (`itens × 56`) só existe para o primeiro quadro não nascer no lugar errado.
- ⚠️ **O `click` fantasma fecha o menu no mesmo gesto.** O toque longo termina em `touchend` e o navegador ainda dispara um `click` nas coordenadas do dedo — que agora caem na camada do menu. Sem a carência de 400 ms, o menu abria e fechava junto, e a funcionalidade parecia não existir.
- `navigator.vibrate?.(10)` confirma o gesto. No toque não há cursor para avisar que pegou; o encadeamento opcional é porque o iOS não implementa.
- ⚠️ **`preventDefault` no `contextmenu` NÃO impede a seleção de texto do iOS.** São dois comportamentos distintos: o toque longo do WebKit também inicia seleção, e aí sobem as alças azuis e a barra nativa ("Copiar · Pesquisar · Traduzir") **por cima** do nosso menu. Só `-webkit-user-select: none` + `-webkit-touch-callout: none` matam isso. No painel e na bolha clonada valem sempre (nenhum dos dois é texto para copiar); na bolha real valem **só** sob `@media (hover: none) and (pointer: coarse)`, porque no desktop selecionar um trecho da mensagem é uso legítimo. "Copiar" não depende da seleção — lê `message.content` do estado.
- ⚠️ **O painel é material translúcido, não cor sólida.** Estava em 94%/92% de opacidade, o que na prática é um retângulo pintado; o iOS deixa o fundo atravessar com blur forte e saturação alta. Fundo e blur vivem em `.wa-context-panel` no `globals.css`, e **não** em utilitário do Tailwind: o material precisa de `@supports (backdrop-filter)` para cair em `--wa-context-bg-solid` onde não há suporte, e isso não se escreve em classe. Duas fontes para a mesma propriedade brigariam por ordem no CSS gerado.
- ⚠️ **Translucidez tem custo de contraste, e ele foi medido.** O pior caso é o menu abrir sobre uma foto clara, quando o fundo sobe através do material. Com o vermelho antigo (`#ff6482`) o destrutivo caía para **4,1:1** — abaixo do AA para texto de 16,5px. Daí o painel escuro a 76% e `--wa-context-danger: #ff7a90`: pior caso **4,70:1**, caso comum 7,06:1, e o texto normal nunca abaixo de 10,7:1. Ao mexer nessas opacidades, refaça a conta — não confie no olho sobre fundo escuro.
- Fora do menu, de propósito: reagir, "Dados", "Favoritar" e "Mais…". Aparecem no print do WhatsApp e **nenhuma existe aqui** — cada uma é feature de banco própria.

**"Apagar" é vermelho nos dois menus.** O print do WhatsApp Web mostra branco, o do celular mostra vermelho; venceu o vermelho, que também é o que o nosso sistema pede para ação irreversível. Um menu só no código.

**Editar e encaminhar viram folha de tela cheia no celular** (`sm:` restaura a caixa centrada), como a tela de envio de anexo. Uma lista de 348 conversas dentro de uma caixinha de 85vh no telefone mostra 4 linhas.

- ⚠️ **Não misture `inset-*` com `top-*`/`left-*` no mesmo elemento.** O `twMerge` deixa um `inset-*` posterior apagar um `top-*` anterior, mas **não o contrário** — a posição acaba na mão da ordem do CSS gerado. Use só `top`/`left`, que é o que o primitivo já usa.

### §5.7.2 Tela de envio de anexo

Copia o formato do WhatsApp Desktop: sheet lateral na área da conversa, fechar à esquerda, nome do arquivo ao centro, prévia contida no meio e rodapé com legenda, destinatário e botão verde. No tema claro a superfície é branca; no escuro, permanece quase preta.

- **A tela existe pela LEGENDA**, não pela estética. Antes o anexo saía direto da tirinha do rodapé e comentar a imagem exigia uma segunda mensagem.
- **Vai no primitivo `Dialog` com `presentation="sheet"`**, não numa `div` solta. O Base UI traz armadilha de foco, Esc e trava de rolagem; `portalContainer` ancora painel e backdrop na raiz real da conversa.
- **Seleção múltipla aceita até 10 anexos por lote.** Clipe, arrastar e colar convergem para a mesma revisão; arquivos repetidos são ignorados com aviso explícito.
- **Cada anexo possui legenda própria.** A faixa inferior guarda apenas número, nome e estado ativo. Somente a prévia ativa monta imagem/vídeo e cria `objectURL`; trocar o item desmonta a prévia anterior e revoga a URL. Não crie miniaturas decodificadas para o lote inteiro no PWA.
- **O envio é serial e mostra `N de total`.** Isso mantém o pico de memória próximo ao envio unitário. Na primeira falha, os anexos já enviados saem da fila e o item falho mais os restantes permanecem editáveis para nova tentativa.
- **Uma resposta citada pertence somente ao primeiro anexo.** Repetir a mesma citação em cada arquivo criaria várias mensagens respondendo ao mesmo trecho.
- **Fora de escopo, de propósito:** HD, cortar, texto sobre a imagem, desenhar e figurinha. Aquilo é editor de imagem.
- **A legenda NÃO ocupa o rótulo do documento.** O nome do arquivo vai para `metadata.fileName`; `content` guarda a legenda. Sem essa separação a bolha rotularia o anexo com o texto da legenda.

- **Card de contato replica a leitura do WhatsApp:** avatar com inicial, nome, conta comercial e telefone; a ação de rodapé é “Conversar”. Ela usa o mesmo Number Check do telefone escrito e cria uma conversa `human` somente quando o número existe. Copiar e salvar contato (`POST /api/contacts`, origem `indicacao`) permanecem ações secundárias; o aviso diz se o contato é novo ou já existia.

### §5.8 Banda de KPI do dashboard

- **Porcentagem que não é zero não pode virar "0%".** `formatPercentage` mostra um dígito significativo abaixo de meio ponto: 1 venda em 318 leads é `0,3%`, não `0%`. Arredondar ali fazia uma conversão real parecer nenhuma — mesmo princípio de `formatMoneyExact` no §5.5.
- **Todo KPI diz a janela dele.** A banda mistura métrica do período com métrica de agora, e sem rótulo o leitor supõe que tudo segue o seletor de período. `Aguardando contato` e `Em atendimento` são a base inteira em tempo real: `hint` = "no funil agora".
- **Taxa vem com o lastro junto.** "Conversão 0,3%" sozinho não deixa checar; `hint` = "1 de 320 · Cliente, Recorrente". Numerador e denominador já existem em `where.converted` / `where.total` — não recalcule no componente.
- **Métrica configurável diz o que está contando.** As etapas de conversão são escolha do usuário (§5.9), então o `hint` lista os rótulos marcados. Sem nenhuma marcada, o texto é "nenhuma etapa marcada como conversão" — não "0%" sem explicação.

### §5.9 Etapa que conta como conversão (Configurar funil)

O que é conversão muda por clínica: aqui o marco é **Compareceu**, que é etapa aberta. `board_columns.counts_as_conversion` é o campo; `stage_type` continua respondendo outra coisa (se a etapa fecha o card).

- **Dois caminhos para a mesma chave, um clique cada.** Selo "Conversão" na linha da etapa + item "Contar como conversão" no menu `…`. Marcar 3 etapas não pode exigir abrir 3 formulários.
- **Fora do toggle "Mostrar probabilidade e situação".** Probabilidade e situação são metadados opcionais; conversão é a definição de uma métrica da home. Fica sempre visível, e por isso o `PATCH` sempre envia o campo.
- **O selo é ícone + texto** (`TargetIcon` + "Conversão"), nunca só cor — §6.
- **Podem existir várias etapas marcadas, e conta só quem está exatamente numa delas.** Sem inferência por `position`: quem sobe de etapa e sai da marcada sai da conta. Está escrito na descrição do campo, porque não é adivinhável.
- **Precedência na classificação** (`classifyLead`): conversão > perdido > entrada > em etapa. Uma etapa aberta marcada como conversão cairia em dois baldes do card "Leads capturados no período" e os percentuais passariam de 100%.

---

### §5.10 Modal no celular é gaveta (`Dialog` responsivo)

O `Dialog` de `src/components/ui/dialog.tsx` **troca de superfície sozinho**: caixa centrada (Base UI) no desktop, gaveta que sobe pelo rodapé (`vaul`) abaixo de 640px. São 20+ modais no app — a troca vive no primitivo justamente para não haver 20 chances de divergir.

O motivo é concreto e foi relatado em uso: no celular o diálogo centrado nascia colado no topo, **com o botão de fechar embaixo do entalhe do iOS** e a altura estourando quando o teclado subia. A gaveta é ancorada embaixo, tem teto de 92dvh, respeita a área segura e fecha arrastando.

- **`variant="dialog"`** escapa da troca. É para o modal que **já** é tela cheia de propósito: tela de envio de anexo, lightbox e o menu de contexto do chat. Virar gaveta ali seria regressão.
- ⚠️ **`vaul` traz `@radix-ui/react-dialog`.** É a única porta do Radix no repositório, confinada a `drawer.tsx`. Os primitivos continuam Base UI e o desktop não passa por lá (`SKILLS.md` §Não invoque).
- ⚠️ **A área segura vai como ESPAÇADOR, não como `pb-[env(...)]`.** Qualquer `p-*` vindo do `className` de quem chama venceria o padding no `twMerge` e o respiro sumiria em silêncio. Um elemento não some.
- ⚠️ **A gaveta neutraliza a geometria de caixa DEPOIS do `className`.** O `ModalShell` manda `w-[calc(100vw-2rem)]` e `rounded-xl`; numa gaveta isso vira uma folha 32px mais estreita que a tela, encostada à esquerda e arredondada embaixo. Largura e raio da gaveta não são negociáveis por quem chama.
- ⚠️ **A superfície é congelada enquanto o modal está aberto.** Girar o telefone cruza os 640px (390px em pé viram 844px deitado); sem congelar, o conteúdo desmonta, remonta e **perde o que já foi digitado**.
- ⚠️ **Popup portado no `body` fica visível, mas intocável dentro da gaveta.** O Vaul modal aplica `pointer-events: none` ao `body` e libera somente a árvore do drawer. `DialogContent` fornece seu elemento por `FloatingPortalContainerProvider`; `SelectContent` e `ComboboxPopup` usam esse contêiner. Não remova nem volte a portar esses popups diretamente no `body`.
- Listas de `Select` e `Combobox` respeitam a altura disponível, isolam o overscroll e mantêm inércia no WebKit. Cada opção tem alvo mínimo de 44 px no toque; o desktop reduz a densidade a partir de `sm`.
- O breakpoint é lido com **`useMediaQuery`/`useSyncExternalStore`** (`src/lib/use-media-query.ts`), nunca `useState` + `useEffect`: o padrão comum começa em `false` e corrige depois de montar — e quando isso decide *qual componente renderizar*, o resultado não é um pisca, é o conteúdo montando duas vezes. Mesmo motivo do `useFunnelView` (§9).
- O X continua na gaveta, apesar da alça: o `ModalShell` reserva `pr-16` no cabeçalho contando com ele.

### §5.11 Campo de texto no celular: 16px é obrigatório

**Todo controle de entrada de texto tem fonte ≥16px no celular.** Não é escolha estética: abaixo disso o **iOS amplia a página sozinho** ao focar o campo, e depois de fechar o teclado a viewport fica panorâmica com o componente cortado.

```
text-sm      →  text-base md:text-sm
text-[15px]  →  text-base md:text-[15px]
```

É o par que `src/components/ui/input.tsx` e `textarea.tsx` já usavam — quem quebra é **campo feito à mão**, e o chat é quase todo assim.

- **Não resolva com `maximum-scale=1`.** Tira a pinça de quem precisa ampliar para ler (§8, WCAG). O `viewport` do app mantém `maximumScale: 5` de propósito.
- **Não resolva com regra global** em `globals.css`: precisaria de `!important` para vencer as classes do Tailwind, e encolheria campo intencionalmente maior.
- ⚠️ **Fonte maior muda quantas linhas cabem.** O compositor tinha teto de `120px`, que a 14px dava 4 linhas e a 16px daria 3. O teto passou a ser em **`lh`** (`5lh`), que é o mesmo número de linhas em qualquer tamanho de fonte.
- Só `<input>` de texto, `<textarea>` e `<select>` nativo disparam o zoom. `hidden`, `file`, `range`, `checkbox` e afins não.

### §5.14 Agenda: editar e registrar venda no mesmo modal

`AppointmentDetailsDialog` tem **quatro modos** no mesmo diálogo — detalhes, edição do agendamento, edição do lead e venda. Um modal só: quem já está dentro troca o conteúdo, com "Voltar ao agendamento" (§9). É o mesmo desenho do `lead-detail-dialog` (§5.5).

- O rodapé do modal existe **só no modo de leitura** (Excluir · Registrar venda · Editar agendamento · Visitou, quando elegível). Cada painel traz o rodapé dele. “Fechar” não ocupa mais uma ação no rodapé: X, backdrop, `Esc` e o gesto da gaveta já fecham a superfície.
- **WhatsApp e Editar lead pertencem ao bloco do cliente**, no começo do detalhe. Não entram no rodapé da agenda: seis ações ali virariam uma pilha alta no drawer e esconderiam o evento. WhatsApp reutiliza o Number Check e a resolução de conversa da tela de Leads; sem telefone, a ação não aparece.
- **A edição do lead reutiliza `LeadEditPanel`**, compartilhado por Leads, Funil e Agenda. O painel tem scroller próprio com `overscroll-contain` e rodapé fixo; não abre outro modal e não cria rolagem horizontal em 320 px. Etapa e telefone inalterados não são reenviados ao servidor.
- **Todo caminho de fechar volta para `details`.** Reabrir no formulário surpreenderia quem só queria conferir.
- **“Visitou” fica no ponto de decisão.** Mês, semana, dia e lista abrem o mesmo `AppointmentDetailsDialog`, portanto a ação não pode existir apenas no card da lista. Ela reutiliza `POST /api/appointments/[id]/attended`; não duplica a cascata de lead/funil.
- **Lista mobile mostra um dia por vez.** O `FormSelect` lista somente dias com agendamentos e abre hoje, o próximo dia relevante ou o evento passado mais recente. A troca é imediata e elimina a rolagem serial pelo mês; a partir de `md`, a lista mensal completa permanece visível. Ele **não tem rótulo acima**: o próprio valor é o dia por extenso com a contagem ("Terça-feira, 11 de agosto · 4 agendamentos"), e o nome acessível vive no `aria-label`. Ver §5.20.
- ⚠️ **Editar não mexe em status nem no cliente.** Status tem cascata — carimba o lead e move o card no funil (`syncDealsOnAttendance`) — e vive no botão "Marcar compareceu", o único caminho que faz a cascata inteira. Duplicar a regra é como as duas versões divergem. O `PATCH` recusa os dois pelo schema, e o painel explica isso na tela.
- **Registrar venda reusa o `SaleDialog variant="panel"`**, o mesmo do funil e do lead. O card de destino é resolvido no servidor a partir do lead — a agenda não carrega `deals`.
- **O catálogo de procedimentos é buscado sob demanda**, ao abrir a venda. A alternativa era arrastá-lo por prop da página até aqui (6 arquivos, 4 níveis, 3 ramos de visualização) e carregá-lo em toda renderização da agenda por causa de uma ação ocasional. Este modal já busca `/api/app-users` assim.
- ⚠️ **Campo `datetime-local` se monta no fuso do APP, nunca com `getHours()`.** O app inteiro trabalha em `America/Sao_Paulo` e `parseAppDate` lê o campo assim ao salvar; com o fuso do navegador, abrir e salvar sem tocar em nada deslocaria o horário. Use `toAppDateKey` + `formatTime`.

### §5.20 Agenda: o cromo cede espaço para a lista

No telefone a agenda tinha **quatro faixas empilhadas** antes do conteúdo — período, segmentado, ⚙ + "Novo agendamento" em largura total, busca, "Filtros", contagem — mais o título e a descrição da própria lista. Somadas, comiam cerca de metade da viewport e sobrava **~27%** para os agendamentos, que são o motivo de a tela existir.

**Agora são três linhas, e nenhuma é só de um controle:**

| Linha | Conteúdo |
|---|---|
| 1 | `Hoje` · `‹` `›` · **título do período** (`flex-1 truncate`) · ⚙ |
| 2 | segmentado Mês/Semana/Dia/Lista (`flex-1`) · `+` Novo agendamento |
| 3 | busca (`flex-1`) · `Filtros (n)` · contagem · atualizar |

- **Ação com ícone no telefone, rótulo a partir de `sm`.** O padrão já existia no gatilho de `AgendaSettingsDialog` (`<span className="hidden sm:inline">`); `AppointmentDialog` ganhou `triggerLabelClassName` para fazer o mesmo. O nome acessível **nunca** depende do rótulo visível — vem sempre do `aria-label`.
- ⚠️ **Botão sem rótulo precisa de piso de largura.** Só com o ícone o botão desce para ~34 px e fica abaixo do alvo de toque. `min-w-11 sm:min-w-0` resolve sem brigar com o `has-data-[icon=inline-start]:pl-2` do `buttonVariants`.
- **A `DataToolbar` padrão saiu da agenda**, só ali. Ela empilha no mobile (`flex-col sm:flex-row`), o que está certo para Leads mas custava três faixas aqui. As **peças** continuam as mesmas — `ToolbarSearch`, `FilterButton`, `FilterField`, `ActiveFilters`; muda o arranjo, não o vocabulário.
- **"Limpar filtros" desceu para dentro do popover de Filtros.** Em linha única ele espremia a busca a nada justamente quando havia filtro ativo. O aviso de que existe filtro continua no contador do próprio botão (`Filtros (2)`).
- **A contagem perde a palavra, não o significado.** Abaixo de `sm` fica só o número (`max-sm:sr-only` na palavra) e o `<p>` é `aria-live="polite"`: para quem não vê a lista, o número é a única confirmação de que o filtro pegou.
- **Título e descrição da lista viraram `sr-only`.** "Agenda em lista" e "Agendamentos de \<mês\>, agrupados por dia" repetiam a aba marcada e o título da toolbar. O cabeçalho continua existindo para navegação por títulos — só não cobra altura de quem enxerga.

Resultado: ~220 px devolvidos ao conteúdo em 375 px. Abaixo de 360 px o título do período trunca — é a troca deliberada, porque `Hoje`, as setas e a engrenagem mantêm 44 px de alvo e o segmentado precisa caber "Semana" legível.

### §5.21 Agenda: feedback ao trocar de visualização

Trocar de Lista para Mês é um `<Link>` para `?view=…`. A página é `force-dynamic` e refaz a consulta, mas **só os search params mudam**: o segmento não remonta, então o `loading.tsx` **não aparece**. A tela antiga ficava intacta por quase um segundo, sem sinal nenhum de que o toque foi registrado — "não tem nenhum feedback e demora".

**Duas respostas, em camadas:**

1. **Seleção otimista** (`AgendaViewTabs`). A aba acende no toque, não quando o servidor responde. O palpite local é derrubado assim que a prop `view` muda — inclusive ao voltar pelo histórico — usando o padrão de ajustar estado durante a renderização, não `useEffect`.
   - ⚠️ **`aria-current` continua seguindo a `view` real.** Pintar a aba é uma promessa visual; dizer ao leitor de tela que a página já é outra seria mentira. O estado visual mora em `data-active`, separado.
2. **Barra indeterminada de 2 px** na base da faixa (`AgendaNavProgress`). Vem de `useLinkStatus` (Next ≥ 15.3) dentro de cada `<Link>` de navegação, e de `useTransition` na faixa de filtros, que navega por `router.push`.

Armadilhas que o desenho evita:

- ⚠️ **`useLinkStatus` só funciona dentro de um `<Link>`.** Fora dele devolve `pending: false` para sempre. Por isso a barra é filha do link e se posiciona `absolute` contra a **faixa** (`relative`) — o segmentado de propósito **não** é `relative`, senão cada aba teria a própria barrinha em vez de uma faixa só.
- ⚠️ **`bottom-0`, nunca `-bottom-px`.** A faixa seguinte também é `relative` com `bg-background` e pinta depois: um pixel dos dois seria comido.
- ⚠️ **Atraso de 150 ms antes de aparecer.** Navegação rápida termina antes disso e a barra nunca chega a surgir; sem o atraso, todo toque daria um flash. É a recomendação da própria doc do `useLinkStatus`.
- ⚠️ **Movimento reduzido apagava o indicador.** O bloco global de `prefers-reduced-motion` zera `animation-duration` e `iteration-count`: a faixa correria uma vez, instantânea, e pararia **fora da tela**. `motion-reduce:w-full motion-reduce:animate-none` a transforma numa barra parada de largura cheia.
- **Prefetch foi considerado e recusado.** `prefetch` nas quatro abas dispararia quatro renderizações do servidor com consulta ao banco a cada carga da agenda, para economizar uma que talvez nunca aconteça.

### §5.17 Agenda: bloqueio de datas e horários

Um bloqueio é um **intervalo concreto** — férias, feriado, congresso, cirurgia, almoço. Mora em `agenda_blocks` e é editado na aba **Bloqueios** de Configurações da agenda.

⚠️ **Bloqueio não é recorrência.** Recorrência já é a grade de `agenda_hours`: dia da semana sem horário nenhum é dia sem expediente. Duas formas de dizer a mesma coisa divergiriam na primeira mudança de horário da clínica.

**Como aparece, em quatro lugares:**

| Onde | Sinal |
|---|---|
| Grade de semana/dia | Faixa proporcional ao horário, atrás dos cards, com intervalo + motivo |
| Mês (desktop) | Dia inteiro hachura a célula; parcial vira linha compacta com relógio, motivo e intervalo |
| Mês (celular) | Dia inteiro mantém hachura + número riscado; parcial usa relógio. O dia aberto mostra motivo e intervalo |
| Modal de agendar/remarcar | Horário rápido desabilitado e riscado + aviso vermelho com o motivo |

- ⚠️ **Avisa, não impede** — igual ao conflito de horário e ao fora-de-expediente (§5.16). Encaixe existe; recusar a gravação transformaria uma exceção do consultório em parede.
- **`all_day` decide a representação.** Só bloqueio de dia inteiro hachura a célula mensal e risca o número. Um intervalo como 17:00–20:00 nunca pinta o dia todo: aparece como `Motivo · 17:00–20:00`.
- **Nunca só a hachura.** Dia inteiro também mostra motivo + “Dia inteiro”. No mobile, relógio e calendário cortado distinguem parcial e integral; o cabeçalho do dia escreve todos os intervalos. `title` e `aria-label` preservam o contexto completo (§1.4, §8).
- **Múltiplos bloqueios são preservados.** A célula usa rolagem interna já existente, cada bloqueio fica no fluxo antes dos agendamentos e textos longos truncam somente o motivo; o horário permanece visível.
- **Horário rápido bloqueado fica desabilitado com o motivo no `title` e no `aria-label`.** Desabilitado mudo não explica nada.
- A faixa da grade é `pointer-events-none`, recortada pela própria coluna e vem **antes** dos cards no fluxo: é leitura de fundo, não cria `z-index` e não pode roubar nem cobrir o clique de um encaixe marcado por cima.
- ⚠️ **A hachura vai como `background-image` (`bg-[repeating-linear-gradient(...)]`), não como cor.** O `twMerge` não a colapsa contra `bg-background` justamente por serem propriedades diferentes — a célula mantém o fundo do tema e ganha as listras por cima.

**Regras que moram em `agenda-blocks.ts`, testadas à parte:**

- **Fim exclusivo.** Bloqueio até 14:00 libera a consulta das 14:00. Mesmo critério do cruzamento de agendamentos.
- **"Dia inteiro" termina na MEIA-NOITE SEGUINTE**, não às 23:59 — senão o último minuto do dia ficaria livre. Na leitura, a descrição mostra o dia anterior ao fim, senão anunciaria um dia a mais de férias.
- **`blockMinutesInDay` recorta o bloqueio dentro do dia.** Três dias de férias viram faixa cheia em cada coluna, não uma barra gigante saindo pela primeira.
- ⚠️ **`localToIso` monta data local por partes.** `new Date("2026-08-07T09:00Z")` cairia três horas fora e o bloqueio da manhã passaria a valer de madrugada.
- `all_day` é guardado mesmo sendo redundante com o intervalo: sem ele a tela teria que adivinhar, a partir de 00:00–00:00, se quem cadastrou queria o dia todo ou uma faixa que por acaso bate.
- **Bloqueio é apagado de verdade**, diferente de unidade e tipo de atendimento. Aqueles são referenciados por agendamentos gravados e precisam sobreviver como histórico; um bloqueio não é referenciado por nada.

### §5.16.1 Data e hora: dois campos, nunca `datetime-local`

⚠️ **`input[type=datetime-local]` transborda em coluna estreita.** Os segmentos internos (dd/mm/aaaa, hh:mm) são desenhados pelo navegador num tamanho que `w-full min-w-0` não encolhe — o conteúdo escapava da moldura. `DateTimeFields` separa em `type="date"` + `type="time"`.

- No toque é melhor de qualquer forma: o celular abre o seletor de calendário e o de relógio, cada um com a roda certa, em vez de um controle combinado que no iOS vira lista longa.
- O valor externo continua `"AAAA-MM-DDTHH:MM"` — a divisão é de apresentação, não de contrato.
- Hora vazia vira `09:00` ao escolher a data: preencher a data primeiro é o caminho natural, e um valor pela metade faria o formulário recusar sem dizer por quê.
- A seção já se chamava "Data e horário" e o campo dentro dela também. Agora os campos são **Data** e **Hora** — o mesmo rótulo duas vezes na tela era a repetição que já tinha acontecido com "Serviço".

**Enquanto a configuração carrega, o modal não afirma nada.** Antes ele dizia "Nenhum horário configurado para este dia" com toda a confiança durante o voo da requisição — e continuaria dizendo se ela falhasse. Agora existe um estado de carregando explícito.

### §5.16 Agenda: configuração e modal de agendamento

**Três coisas saíram do código e viraram dado**: os tipos de atendimento (eram a constante `tipoServicoOptions`, com "Reunião / Demonstração / Proposta / Onboarding" — vocabulário de software B2B numa agenda de clínica), a grade de horários (era um objeto literal em `agenda-utils.ts`) e a unidade de atendimento (não existia). Mudar o expediente exigia deploy.

**Configurações da agenda** (`agenda-settings-dialog.tsx`) fica num botão da toolbar, em três abas: Horários · Unidades · Tipos.

- **Grade de horários**: uma linha por dia da semana, com os horários como pílulas removíveis e um `input[type=time]` para acrescentar. Grava os sete dias de uma vez — é lista curta editada como bloco, e gravar dia a dia deixaria metade da configuração para trás se algo falhasse no meio.
- **Dia vazio significa "não configurado", não "fechado".** Ele não bloqueia nada, apenas não sugere. Por isso também não dispara o aviso de horário fora do expediente: alarme em todo agendamento vira ruído e ninguém lê mais.
- **Unidade e tipo são arquivados, nunca apagados.** `appointments.tipo_ensaio` guarda o NOME em texto e `unit_id` é FK `on delete set null`; remover a linha do catálogo não pode reescrever o histórico de quem já foi atendido.

**Tipo de atendimento usa o combobox com criar/apagar em linha** — o mesmo desenho do de procedimentos da venda (§5.6), inclusive a confirmação na própria linha e o `Delete` como caminho de teclado.

- ⚠️ **Ele NÃO usa `router.refresh()`, diferente do irmão do financeiro.** Lá o catálogo desce por prop de um Server Component; aqui é buscado quando o modal abre, então revalidar a rota não traria lista nova. Quem devolve a mudança é `onCatalogChange`.
- ⚠️ **`buildAppointmentTypeOptions` é duplicação deliberada** de `procedure-options.ts`. Segundo uso do padrão: a regra do projeto manda duplicar no segundo e abstrair no terceiro (AGENTS §0.2.2).
- O campo virou texto livre e perdeu o `required` do `<select>`, que sempre tinha um padrão. A obrigatoriedade passou a ser checada no submit — senão o asterisco na etiqueta seria decoração.

**Dois avisos no modal, e os dois avisam sem bloquear:**

- **Conflito de horário.** Pedido do próprio médico depois de dois pacientes caírem às 19:00 no mesmo dia. `cancelado` e `faltou` não contam — o horário voltou a ficar livre. Fim exclusivo: quem termina 09:00 não conflita com quem começa 09:00, senão uma agenda de 30 em 30 minutos acusaria colisão em toda linha. Vale ao criar **e** ao remarcar, e ali o próprio agendamento sai da conta (`ignore`).
- **Horário fora do expediente**, quando a grade daquele dia existe e não contém o horário escolhido. Era o buraco relatado: dava para trocar a data para sexta mantendo 19:00 sem que nada na tela dissesse que sexta é só de manhã.
- ⚠️ **Nenhum dos dois é parede.** Encaixe existe, e recusar a gravação transformaria uma exceção do consultório em obstáculo. Quem decide é quem está olhando a tela.
- O `debounce` de 400 ms na consulta de conflito não é enfeite: `datetime-local` dispara `change` a cada dígito digitado.

**Layout do modal**

- ⚠️ **Duas pilhas de seções, não um grid com `row-span` contado à mão.** O layout anterior posicionava cada seção com `lg:col-start` + `lg:row-start` + `lg:row-span-3` manuais: acrescentar uma seção desalinhava a coluna da direita, e era de onde vinha o transbordo. Agora cada coluna empilha o que é dela.
- A casca passou a ser o **`ModalShell`** canônico (§5.3), no lugar de header e footer próprios — ganha o `pr-16` que reserva o botão de fechar e a área segura do rodapé.
- Havia uma seção **"Serviço" com um campo "Serviço" dentro**: o mesmo rótulo duas vezes na mesma tela, um deles sem significar nada. A seção virou "Atendimento".
- **Unidade só aparece no presencial.** Na teleconsulta o campo é substituído por uma nota — oferecer endereço para um atendimento que não acontece em lugar nenhum convidaria a gravar dado falso.

**Filtro de serviço da agenda vem dos agendamentos em tela**, não de lista fixa. Com o tipo virando catálogo do usuário, uma constante no código passaria a oferecer "Demonstração" e a esconder o que a clínica criou — filtro que nunca casa com nada. É calculado sobre a lista **antes** do filtro, senão escolher um serviço faria os outros sumirem das próprias opções.

⚠️ **A unidade no modal de detalhes é resolvida por busca, não por `clinic_units(name)` embutido na query da agenda.** A embutida depende da FK existir: subir o código antes da migration quebraria a listagem inteira em vez de faltar um rótulo.

### §5.15 Agenda: um card só para mês, semana e dia

O card do calendário é **o mesmo nas três visões**, e a cor vem de `appointmentToneClass` em `agenda-utils.ts`. Antes a grade de horários tinha a própria função de cor, e a mesma consulta trocava de tom ao alternar entre mês e semana.

Anatomia, em duas densidades:

```
HH:MM  Nome do cliente        ← sempre, na mesma linha
       Serviço                ← só quando a altura permite
```

- ⚠️ **A cor é opaca.** A grade usava uma escala `/10`, 90% transparente: dois agendamentos que se cruzavam deixavam o texto de baixo **atravessar** o card de cima — era o "Adalberto"/"Consulta" borrado sobre o card seguinte. Fundo translúcido sobre linha de grade suja a leitura mesmo sem sobreposição.
- ⚠️ **Sem `google_event_id` é âmbar**, e esse caso vem antes do geral: é o agendamento criado à mão no CRM. A grade ignorava isso e pintava tudo de roxo.
- **Hora e nome dividem a primeira linha.** Empilhados, um bloco de 30 minutos só tinha altura para o horário — daí os cards que mostravam "10:30" e mais nada. O serviço entra numa segunda linha a partir de `TWO_LINE_HEIGHT`.
- Todo texto trunca, e o card é `overflow-hidden` com `min-w-0`. Numa coluna estreita o nome encurta; nada sai da moldura.
- `ring-1 ring-inset` no lugar de `border`: moldura que não soma largura, para faixas vizinhas ficarem do mesmo tamanho.

**Faixas (`src/features/appointments/lib/time-grid-layout.ts`)**

⚠️ **Bloco de horário não pode ser `absolute inset-x-*`.** Era assim, com largura cheia da coluna — dois horários que se cruzavam ficavam literalmente um sobre o outro. Agora `layoutTimeGrid` distribui em colunas paralelas.

- **A largura é decidida pelo aglomerado, não pelo par.** Numa corrente A↔B↔C, onde A e C não se cruzam, os três saem com a mesma largura. Calculando par a par, B encolheria no meio da corrente e a mesma consulta mudaria de tamanho conforme a vizinha.
- **Faixa que vagou é reaproveitada** antes de abrir uma nova: três agendamentos podem caber em duas faixas.
- **1 px por minuto** (`MINUTE_HEIGHT`). `top` e `height` passam a ser o próprio horário — some a conversão `duração / 60 * alturaDaHora`, que era onde os 26 px de meia hora nasciam.
- **Horário fora da grade encosta na borda, não some.** O agendamento existe no banco; escondê-lo seria o frontend decidindo o que o operador pode ver.
- A matemática é pura e testada à parte. Mexeu em faixa ou altura? O teste é `time-grid-layout.test.ts`, não a tela.

⚠️ **O `+` do cabeçalho do dia não pode ser só `group-hover`.** No Tailwind v4 o `hover:` já vive dentro de `@media (hover: hover)`, então no toque ele nunca aparecia — e a grade, diferente do mês, não tem versão mobile alternativa. `[@media(hover:none)]:opacity-100` o mantém visível onde não há cursor.

**Semana no celular** rola na horizontal, com piso de `45rem`. Sete colunas legíveis não cabem em 390 px, e espremer viraria tira de 40 px. O dia não tem piso e ocupa a largura disponível.

### §5.13 Teclado no iOS: `100dvh` não basta

⚠️ **O teclado do iPhone não encolhe o `dvh`.** Ele não mexe na viewport de *layout*, só na *visual*. Um contêiner de `100dvh` continua mais alto que a área visível, o Safari **acrescenta altura rolável** ao documento para revelar o campo focado, e sobra uma faixa branca embaixo do compositor — que **continua lá depois de fechar o teclado**, porque a rolagem não se desfaz.

As peças trabalham juntas:

1. **O overlay fixa a conversa, não o documento.** `.chat-mobile-overlay` cobre a viewport e pinta uma extensão inferior da área segura. A casca e a lista ficam estáveis atrás dele.
2. **`--chat-vh`** (`src/lib/use-viewport-height.ts`) só publica `visualViewport.height` quando foco editável, redução contra a linha de base e escala estável comprovam um teclado. A variável vive em `.chat-mobile-viewport`, sem re-render a cada quadro.
3. **O inset inferior vira zero enquanto há teclado.** O WebKit não atualiza `safe-area-inset-bottom`, portanto mantê-lo soma uma faixa vazia entre o compositor e o teclado.
4. **Blur, rotação e saída limpam a geometria local.** Pan e altura residuais são descartados antes de revelar a lista; `html` e `body` voltam a `scrollTop = 0`.

No estado normal, no Android e no desktop, o CSS usa `100dvh`; não existe altura JavaScript persistente.

### §5.12 O que NÃO vira gaveta

A regra do §5.10 é "modal no celular é gaveta". Quatro coisas ficam de fora, pois têm geometria própria ou não são formulários comuns.

| Componente | Fica como | Por quê |
|---|---|---|
| `image-lightbox` | tela cheia | Visualizador de foto. Gaveta encolheria a imagem, que é o conteúdo. |
| `message-context-menu` | tela cheia | É a camada que embaça a conversa e posiciona o clone da bolha (§5.7.7). |
| `file-preview-dialog` | sheet lateral | Precisa ocupar exatamente a conversa e preservar a lista; drawer inferior produz a geometria errada. |
| `emoji-picker` | popover | ⚠️ **Vive DENTRO** do diálogo de editar e do sheet de envio. Transformá-lo em outro modal empilharia duas superfícies e dois donos do Esc. |

As duas de tela cheia ganharam **área segura** — era o defeito real delas: o cabeçalho encostava no entalhe e os controles caíam na barra de gestos. No menu de contexto o travamento é feito em CSS (`max(calc(env(safe-area-inset-top) + 12px), …)`) porque **`env()` não existe em JavaScript** e `window.innerHeight` no iOS inclui o entalhe.

⚠️ **Menu ancorado num botão não pode virar `Dialog` no desktop.** Diálogo é posicionado pela viewport: o menu de anexo passou a nascer no canto da tela, sobre a lista de conversas, em vez de ao lado do clipe. A troca é explícita por `useIsMobile()` — gaveta no celular, popover ancorado no desktop.

**No celular as abas "Mensagem / Anotação interna" somem** do compositor: são três barras empilhadas numa tela curta e anotação interna é uso raro. A entrada passa a ser a gaveta de anexo; a aba de volta só aparece enquanto o modo está ligado.

### §5.22 Navegação no celular: cinco destinos e uma gaveta

A barra inferior tinha **4 abas + "Mais"**, e as 4 saíam de um `slice(0, 4)` da lista de navegação. Consequência: num CRM de WhatsApp, o **WhatsApp** ficava escondido atrás de dois toques, e os outros seis destinos moravam num popover de 224 px encostado no rodapé, sem título de seção e sem dizer onde a pessoa estava.

- **A barra é uma escolha explícita**, não um `slice`: `mobileTabHrefs` em `config/navigation.ts` lista hoje **Início · Tickets · WhatsApp · Clientes** (Fase 4); Agenda entra quando existir. Item novo na navegação **não** entra na barra por acidente.
- **O menu completo é uma gaveta `vaul` pelo rodapé**, não um popover. Ocupa 88 dvh, agrupa por seção (`Operação` · `Análise` · `Administração`) e fecha arrastando — a superfície que o sistema já usa para "escolher um caminho".
- **A gaveta lista tudo, inclusive o que já está na barra.** Um menu "completo" que esconde metade dos itens obriga a decorar em qual das duas superfícies cada coisa mora. O item atual aparece marcado.
- **O gatilho fica no cabeçalho, no lugar da marca.** A marca não sumiu: foi para dentro da gaveta, onde tem função (dizer de que app é este menu) em vez de ocupar o canto mais valioso da tela sem levar a lugar nenhum.
- **Altura da barra: 56 px, não 64.** Somada à área segura do iPhone, a antiga comia quase 90 px de conteúdo.
- ⚠️ **A altura mora num token, `--mobile-nav-height`.** Cinco telas de altura cheia (chat, funil, agenda + o skeleton dela, e o banner do PWA) descontam esse valor num `calc()`. Enquanto era `4rem` escrito à mão em cada uma, mudar a barra significava caçar cinco `calc()` e torcer para não faltar nenhum.
- ⚠️ **`DrawerClose` do `vaul` não aceita `render`.** É Radix por baixo, não Base UI: recebe as classes direto, como no chat e no `dialog.tsx`.
- ⚠️ **`LogoutButton variant="menu"` renderiza um `DropdownMenuItem`** e exige o contexto do menu do Base UI. Fora dele, use `variant="full"`.
- Onde não existe segundo destino (`paid_traffic`), não há barra nem gaveta — e a marca volta ao cabeçalho. Ver §5.18.

### §5.18 Navegação da role de tráfego pago

- `paid_traffic` vê somente **Rastreamento**. Dashboard, Leads, Funil, Agenda, WhatsApp, Follow-ups, Perfil e áreas administrativas não aparecem.
- Em mobile, uma única rota não justifica barra inferior: ela é omitida, junto com o espaço reservado no rodapé.
- Busca global e “Atalhos” também somem quando não existe outro destino útil.
- O menu do avatar preserva identidade, tema e logout. Não oferece link para Perfil.
- A seleção do papel usa o `FormSelect` existente. Campos exclusivos do atendimento ficam ocultos para `paid_traffic`; email, senha e troca obrigatória continuam disponíveis.

### §5.19 Configurações (`/app/configuracoes`)

- A tela administrativa usa três abas lineares: **Variáveis**, **API do CRM** e **Agente de IA**. Tokens e webhook permanecem visíveis, mas não disputam altura com credenciais de provedores.
- Variáveis são uma lista operacional única, não um card por chave. Desktop usa tabela; mobile usa linhas empilhadas. A página nunca mostra o valor já salvo.
- Origem é explícita: **Cofre** sobrescreve **Servidor**. Remover a substituição restaura o fallback da VPS quando ele existir.
- Criar ou substituir usa `ModalShell`; valor começa oculto, pode ser revelado durante a digitação e desaparece da memória visual ao fechar.
- O modelo de transcrição OpenAI usa `FormSelect` com opções compatíveis. `whisper-1` continua como padrão para evitar mudança silenciosa de custo ou comportamento.
- Variáveis públicas embutidas no bundle continuam exigindo rebuild. O editor administra runtime do servidor; não promete alterar `NEXT_PUBLIC_*` já compilada.
- Abas podem rolar dentro do próprio trilho em telas estreitas. A página não ganha overflow horizontal; ações mobile mantêm alvo de 44 px.

### §5.23 Formulário: react-hook-form + zod compartilhado com a rota (Fase 3)

A partir da Fase 3, formulário novo usa **react-hook-form + `zodResolver` com o MESMO schema que a rota valida** (`features/*/schemas/*.ts`, arquivo neutro). Uma regra, dois lugares que a aplicam. Os formulários anteriores seguem em `FormData` até serem tocados.

- Tipagem de entrada e saída: `useForm<z.input<S>, unknown, z.output<S>>`. O `preprocess`/`transform` do zod muda o tipo entre os dois.
- **Erro do servidor vai para o campo** com `setError(campo)` (a rota devolve `errors: {campo: [...]}`); erro sem campo vira alerta `role="alert"` no topo do formulário, não toast que some.
- **PATCH manda só `dirtyFields`**: campo ausente não é campo apagado (o schema de edição não transforma ausente em `null`).
- **Envio travado** contra duplo clique, e o `Dialog` não fecha durante o envio.
- **CNPJ:** sem `inputMode="numeric"` — o CNPJ alfanumérico tem letras, e o teclado numérico as esconderia. `autoCapitalize="characters"`, formatação ao sair do campo quando válido.
- **Datas** com `z.iso.date()` (recusa 30/02); **dinheiro** como texto `1500.00` validado por regex e convertido; **vencimento** de 1 a 28, sem valor padrão.

### §5.24 Tickets: lista e detalhe (Fase 4)

Molde: §5.1 (lista) e a ficha de Clientes (detalhe). Arquivos em `src/features/tickets/components/`.

**Selos** (`ticket-status-badge`, `ticket-priority-badge`, `sla-badge`):
- `<span>` no molde do `ContractStatusBadge`, com o texto sempre presente (a cor nunca é a única pista) e o rótulo inteiro no `title`.
- Status: rótulo e cor vêm do catálogo; cor fora de `isColorName` cai na de recurso.
- SLA: `getSlaState` (`lib/sla.ts`, a mesma regra da view `ticket_queue`), com o tom em `data-tone`:

| Tom | Estilo |
|---|---|
| `ok` | contorno padrão |
| `warn` | âmbar |
| `breached`/`missed` | `destructive` |
| `paused`/`none` | `muted` |
| `met` | esmeralda |

- ⚠️ Âmbar e esmeralda são paleta de domínio, porque ainda não existe token semântico de aviso nem de sucesso.
- Com a 1ª resposta pendente, um ticket pausado mostra "1ª resposta…", não "Pausado".
- **O relógio é `useNow(fetchedAt)`:** começa no instante da leitura do servidor (sem divergência de hidratação) e avança a cada 60 s.

**Lista `/app/tickets`:**
- **Filtros na URL:** status, prioridade, fila, responsável e SLA, mais busca e ordem (`lib/ticket-list-url.ts`, neutro: servidor e cliente usam o mesmo).
  - O padrão é "ativos".
  - Buscar por protocolo ("SUP-1024", "#1024", "1024") **ignora o status**: quem digita o número quer aquele ticket.
- **Layout:**
  - tabela a partir de `lg` (8 colunas; "Atualizado" só a partir de `xl`);
  - abaixo disso, `article` com barra de acento pela cor do **SLA**, protocolo e selo de SLA na 1ª linha e link esticado.
- **Menu ⋯:** Abrir conversa, Atribuir a mim, Mover para… (só destinos permitidos pela matriz; "Cancelado" pede motivo) e Copiar protocolo.
- **Sem ações em massa e sem KPI.** Cada ticket exige a sua versão, e as métricas são da Fase 9.
- **Estados** (a falha nunca parece vazio):

| Estado | Tela |
|---|---|
| Falha | "Tentar de novo" |
| Nenhum ativo | "Ver todos os tickets" |
| Base vazia | "Tickets nascem de uma conversa no WhatsApp." |
| Filtro sem resultado | "Limpar filtros" |

**Detalhe `/app/tickets/[number]`** (o protocolo na URL):
- **Cabeçalho:** protocolo com "Copiar", título editável e os selos.
- **Ações:**
  - "Responder no WhatsApp" põe o ticket em foco se preciso (toast só quando mudou) e abre `/app/chat?conversation=`. Em ticket encerrado, só abre a conversa;
  - as ações rápidas (`lib/ticket-actions.ts`);
  - o menu com Atribuir, Pôr em foco, Copiar e Cancelar (confirmação na linha, motivo obrigatório).
- **Linha de fatos:** Aberto em · 1ª resposta · Solução.
- **Grade `lg:grid-cols-3`:**
  - principal: descrição e timeline;
  - lateral: `DetailRow` de `contract-card` com Empresa, Contato, Fila e categoria, Prioridade (a dica é o SLA **gravado no ticket**; só ao escolher outra prioridade mostra a política do catálogo, que é o que o novo snapshot aplicaria), Responsável, Origem, Reaberturas e Anexos;
  - no celular, a lateral fica abaixo da timeline.
- **Fila e categoria se editam juntas e só gravam em "Salvar":** o `CatalogCombobox` zera o valor enquanto a pessoa busca. Trocar a fila limpa a categoria no mesmo PATCH. A fila e a categoria atuais vêm do ticket, mesmo arquivadas.
- **Conflito de versão (409):** alerta no topo, "Este ticket mudou em outro lugar", **mais um toast** e `router.refresh()`. No celular a lateral fica abaixo da timeline, e o alerta sozinho sairia da tela de quem agiu lá embaixo.
- **Transição inválida:** toast "De X só vai para A, B".
- **Falha parcial não some em silêncio:**
  - sem a matriz de transições, o cabeçalho diz "Não foi possível carregar as ações de status." e oferece "Tentar de novo";
  - sem a equipe, o filtro de responsável da lista oferece só "Eu" e "Sem responsável", com "Não foi possível carregar a equipe." junto ao campo.
- **Sem Realtime de tickets:** `router.refresh()` depois de cada ação e no `visibilitychange`.
- **Timeline** (`ticket-timeline`), com o `ol` em `border-s`, sem `max-h`:
  - itens: status, evento, "Nota do ticket" (editar e apagar só pelo autor), "Nota no chat", mensagem compacta (Cliente, IA, Analista, Celular da empresa) com link para a conversa, e anexo;
  - "Carregar anteriores" monta o cursor com `URLSearchParams` (o `+` do fuso) e junta as páginas sem duplicar;
  - composer com Ctrl/⌘+Enter.
- **Anexos** (`ticket-attachments`):
  - `DocumentMessageCard`, e `ImageLightbox` só para PNG, JPEG, WebP e GIF;
  - o teto de 50 MB é conferido antes do envio;
  - ⚠️ não há miniatura: a foto é decodificada inteira, com altura limitada (`max-h-48`). A variante `thumb` na rota é backlog.
- ⚠️ **404 com `loading.tsx`:** a resposta já saiu em streaming (200), e o `notFound()` vira a tela de 404 no corpo, com `noindex`. É o mesmo da ficha de Clientes. Teste pelo corpo, não pelo status.

## §6. Estados de interface

| Estado | Padrão |
|---|---|
| Loading de bloco | `Skeleton` com a geometria aproximada do conteúdo |
| Loading de página | `loading.tsx` com `ListPageSkeleton` / `KanbanPageSkeleton` |
| Loading de ação | Botão desabilitado + `Loader2Icon` girando + rótulo curto |
| Vazio | `EmptyState`, frase curta, ação quando útil |
| Erro recuperável | Toast `sonner` ou mensagem junto ao campo, com "tentar novamente" |
| Erro de leitura em lista | Lista vazia + log no servidor. **A página não cai.** |
| Confirmação destrutiva | Confirmação inline no rodapé do próprio modal (padrão do `lead-detail-dialog`) ou `Dialog` dedicado |
| Sucesso | Toast curto. Não abra modal se a ação já é evidente. |
| Status persistente | `Badge` com texto — nunca só cor |

---

## §7. Responsividade

- Sem largura fixa. `min-w-0` em filho de flex/grid que pode transbordar.
- Tabela larga rola **dentro do próprio contêiner** (`overflow-x-auto`). A página **nunca** rola na horizontal.
- Desktop → `Table`. Mobile → lista de cards com a mesma informação, não uma tabela espremida.
- Altura: `100dvh` descontando header, ou altura pelo conteúdo. Evite `100vh` (a barra do browser no iOS mente).
- Alvo de toque ≥ 44 px no mobile (`h-11`), reduzindo para `h-8`/`h-9` no desktop (`sm:h-8`).
- Área segura: `pb-[max(env(safe-area-inset-bottom),0.75rem)]` em rodapé fixo.

---

### §5.8.1 Fila de tickets no Início (Fase 4)

`ticket-queue-panel.tsx`, **acima do mural**, em largura cheia: a fila é o trabalho do dia, com prazo correndo, e o mural é lembrete pessoal.
- **Duas seções em `lg:grid-cols-2`:**
  - **Minha fila:** meus tickets com relógio correndo ou pausado, **mais os resolvidos em que o cliente respondeu depois** (`replied_after_resolve` da view), estes primeiro, com o selo "Respondeu após resolver" e Reabrir · Fechar na linha;
  - **Não atribuídos:** o mesmo recorte sem responsável, com o botão **Atender** (take-over). Com `already_assigned`, o toast "<nome> já pegou SUP-1024." e a tela relida. O resolvido respondido mostra Reabrir · Fechar no lugar de Atender, porque o take-over não reabre ticket resolvido.
- **Até 8 por seção**, com "Ver todos (N)". O link leva à lista com o **mesmo recorte** (status "pendentes", filtro `onlyPending`, o mesmo da fila), então o total bate. Só a ordem difere: na lista, "prazo" põe o resolvido respondido no fim, porque ele não tem prazo.
- **Resolvido sem resposta do cliente não está na fila:** o trabalho ali acabou. Ele continua na lista, em "Resolvidos".
- **Estados:** vazio próprio de cada seção; falha isolada com "Tentar de novo". Uma seção que falha não derruba a outra nem o mural.

### §5.8 Mural de post-its (`/app`, bloco "Minhas notas")

`notes-panel.tsx`. O bloco é **só post-its** — o "Lembrete rápido" saiu da tela em 2026-08-18 (a coluna dele virou espaço de mural; a rota `PUT /api/notes` e a linha `kind = 'quick'` continuam existindo, sem interface).

- **Grade:** 1 coluna no celular, 2 em `sm`, **3 em `lg`**. Cartão com `min-h-44`, texto `text-sm`.
- **Post-it nasce em branco.** `createStickySchema` aceita conteúdo vazio de propósito; o cartão mostra `placeholder`, nunca texto real. Criar com "Novo post-it" escrito obrigava o usuário a apagar antes de escrever.
- **Ordem arrastável**, gravada em `user_notes.position` via `PUT /api/notes/reorder` (o cliente manda o arranjo inteiro, não um delta). Otimista: move na tela e reverte se o servidor recusar.
- **Sensores iguais aos do kanban:** mouse com `distance: 8` (clique continua clique), toque com `delay: 200` (o dedo ainda rola a página), teclado.
- **`listeners` no cartão inteiro** (mural se pega em qualquer lugar) e **`attributes` + `setActivatorNodeRef` na alça** — assim o arrasto por teclado tem alvo declarado sem transformar em `role="button"` o elemento que contém a área de texto.
- **`stopPropagation` no `onPointerDown`** do textarea (para selecionar texto) e do botão de excluir (senão o clique começa um arrasto).
- Post-it novo entra **na frente**: `position = menor − 1`, sem reescrever a ordem que o usuário arrumou.

> ⚠️ **`rounded-none` no textarea do post-it não é enfeite.** O primitivo traz `rounded-lg`, que nesta base vale `--radius` = 1.1rem ≈ **17,6px**, e o navegador recorta o conteúdo de um `<textarea>` pelo retângulo **arredondado**. Com `p-0`, a primeira letra da primeira e da última linha some dentro da curva.
>
> **Como saber se um campo está em risco** (varredura de 2026-08-18: o post-it era o único caso em toda a UI — não saia "consertando" os outros). O que importa não é `padding < raio`, é a curva na ALTURA em que o texto começa. Com raio `r` e o topo do texto a `y` px da borda, o recorte entra até `r − √(r² − (r−y)²)`:
> - post-it com `p-0`: `y = 0` → recorte de **17,6px**. Come metade da letra. É o bug.
> - `Textarea` padrão (`rounded-lg px-2.5 py-2`): `y = 8` → recorte de **2,85px**, contra 10px de padding. **Sobra folga: está correto.**
>
> Ou seja: padding vertical zero é o que mata. Só `px` pequeno, com `py` normal, costuma estar a salvo.

> ⚠️ **Todo `DndContext` precisa de `id`.** Sem ele o dnd-kit gera o `aria-describedby` das alças com um contador global de módulo, o servidor manda `DndDescribedBy-0`, o navegador tem outro número e a hidratação quebra. Use `useId()` do React — nunca uma string fixa, que colidiria com dois boards na mesma página.

---

## §8. Acessibilidade mínima

- Foco visível sempre (`focus-visible:ring-3 ring-ring/50` — já vem no `Button`).
- Botão só com ícone precisa de `aria-label`.
- `Dialog` precisa de `DialogTitle`.
- Status nunca só por cor — combine texto ou ícone.
- Preserve a navegação por teclado dos componentes Base UI. Não monte elemento clicável em `div` sem suporte a teclado.
- Tabela com header semântico.
- Contagem de resultados com `aria-live="polite"`.
- Texto redundante para leitor de tela via `sr-only` quando o rótulo visual for só um ícone.

---

## §9. Anti-padrões

Cada item abaixo já foi tentado, causou problema, e está proibido até que uma task específica o revise.

**Sistema visual**
- Criar primitivo local quando existe equivalente em `src/components/ui`.
- Hardcode de `#hex` / `oklch()` / `rgb()` dentro de componente.
- Gerar classe Tailwind por interpolação (`` `bg-${cor}-500` ``) — não existe no CSS final.
- Procurar/editar `tailwind.config.js`. Ele **não existe**; os tokens estão no `globals.css`.
- Usar `asChild` (API do Radix). Aqui é Base UI: `render={<Button />}`.
- ⚠️ **Escrever nome de classe com reticências literais** — `pb-[env(...)]`, `text-[...]`. O Tailwind v4 varre **todo arquivo de texto do projeto** atrás de candidatos a classe, inclusive comentário de código e markdown, e gera a regra correspondente. Com `...` dentro de `env()` o CSS sai inválido: no `next build` vira warning e passa batido, no `pnpm dev` o Turbopack trata como **erro fatal** e a aplicação não abre. Cite a classe por inteiro (`pb-[env(safe-area-inset-bottom)]`) ou descreva em prosa. O `globals.css` já tira markdown da varredura (`@source not`), mas código sempre é varrido.

**Layout**
- Empilhar um card para cada dado pequeno em dashboard. Três ou mais indicadores lado a lado = uma banda (`StatBand`), não N cartões.
- Faixa horizontal própria só para um botão. A ação mora junto do bloco sobre o qual ela age.
- Manter aberto, ocupando altura, um bloco que só interessa quando algo quebra. Colapse, e abra sozinho na condição de erro.
- Colocar controle de filtro dentro de outro card.
- Excesso de radius, sombra, gradiente e animação em superfície operacional.
- `h-screen` / `min-h-screen` / `calc(100vh - …)` dentro da casca autenticada — a casca já resolve altura.
- Footer de modal dentro da área que rola.
- Rolagem horizontal na página (a tabela rola, a página não).
- Publicar `visualViewport.height` em `html`, `body`, `.chat-page` ou na lista. A medida pode nascer/restituir curta em PWA; `--chat-vh` é local ao painel da conversa e só existe durante teclado comprovado.

**Comportamento**
- **Modal sobre modal.** Dois backdrops, dois focus traps, dois donos do `Esc` — e no mobile o de baixo já ocupa a tela toda. Quem já está dentro de um modal **troca o conteúdo** (o `lead-detail-dialog` faz isso para editar o lead e para editar a venda), com um "Voltar" explícito. Vale também para `Dialog` dentro de popup de `Combobox`.
- Arraste como único caminho para mover card.
- **Matiz decorativo**: cor atribuída por hash (avatar por pessoa, ponto por categoria) onde a cor não significa nada. No funil a cor significa etapa — qualquer outra cor disputa essa leitura.
- Ação que grava sem dar sinal enquanto grava.
- Coluna ou board vazio sem explicação nem saída.
- Grid de conteúdo sem `grid-cols-[minmax(0,1fr)]` quando há texto longo: a trilha vira `max-content` e o conteúdo vaza em vez de truncar.
- Ler preferência de `localStorage` dentro de `useEffect` para decidir layout — causa troca visível depois da montagem. Use `useSyncExternalStore`.
- Copy longa explicando o que o controle já mostra.
- Modal grande para confirmação de uma linha.
- Inventar número, rótulo ou regra que não veio do banco.
- Mudar aparência de tela não pedida como efeito colateral ("já que estou aqui").
- Estado de loading que apaga a estrutura da tela e mostra um spinner solto.
- ⚠️ **Autofocus num descendente que ainda está fora da viewport por `transform`.** O navegador pode rolar a página inteira para revelar o foco antes da animação terminar. Em sheet lateral, foque primeiro o painel com `preventScroll` e transfira o foco ao campo em `onOpenChangeComplete`.
- ⚠️ **`backdrop-filter` em sheet contido.** No WebKit, um elemento com `backdrop-filter` dentro de ancestral que recorta (`overflow`) e cria contexto de empilhamento pode amostrar a **viewport inteira** no quadro em que a camada de composição é desmontada — um clarão de tela cheia ao fechar, no PWA. E num sheet o véu não tem função nenhuma: o painel cobre 100% do contêiner, então não há o que ver através dele. Sheet contido usa véu translúcido **sem blur**, com a mesma duração do painel (o véu em 100ms sumia com o painel ainda deslizando em 200ms).
- ⚠️ **Portal contido com wrapper sem geometria ou política de ponteiro.** O Base UI adiciona um backdrop interno `fixed inset-0` além do overlay visível; se o wrapper não neutralizá-lo, uma camada transparente pode bloquear o PWA inteiro durante/ao fim da saída. Sheet contido usa wrapper absoluto, recorte de overflow e ponteiros liberados em `data-closed`.
- ⚠️ **Servir arquivo original num `<img>` que aparece pequeno.** Peso no fio não é peso na memória: o WebKit decodifica pela dimensão **original**, não pela da tela. Medido em produção — 5,0 MB de fotos viraram **154 MB** de bitmap, e o processo do Safari no iPhone morre por volta de **100 MB**. Foi o que derrubava o PWA em `/app/chat` com "Um problema ocorreu repetidamente". Imagem de usuário passa pelo transformador do Storage (`chatImageThumbUrl`); o original só quando a pessoa amplia. Ao investigar crash de mídia, meça `largura × altura × 4`, nunca o `Content-Length`.
- ⚠️ **Adiar renderização de linha em lista rolável** (`content-visibility: auto` + `contain-intrinsic-size`). Economiza layout na abertura e **destrói a rolagem no iPhone**: a linha fora da tela não é renderizada, então cada uma que entra precisa de layout e pintura naquele quadro. Numa rolagem rápida o aparelho não acompanha e a pessoa vê a linha em branco se preenchendo depois — a queixa literal foi *"vai quebrando e carregando; quando carrega, fica normal"*. Some-se que o WebKit **não tem scroll anchoring** (chegou só no Safari 27 beta): toda correção de altura acima da viewport vira solavanco, sem a compensação que Chrome e Firefox fazem sozinhos. Esteve nas duas listas do chat e foi removido das duas. A troca certa é a inversa: **pagar o layout uma vez, na abertura, e deixar a rolagem ser só composição**. Rolagem é gesto contínuo e o dedo denuncia qualquer quadro perdido; abertura é evento único.
- ⚠️ **Contêiner rolável sem `overscroll-contain`.** Chegar no fim entrega o gesto para o ancestral e a página inteira balança junto — no celular parece que o app vai sair do lugar. Vale para **todo** scroller: lista, conversa, gaveta, diálogo, popover. O par do repo é `overflow-y-auto overscroll-contain [-webkit-overflow-scrolling:touch]`.
- ⚠️ **Ler `scrollHeight`/`scrollTop`/`clientHeight` dentro do `onScroll`.** Cada leitura força o navegador a recalcular layout na hora, e o iOS dispara `scroll` a cada quadro durante a inércia. Junte a rajada num `requestAnimationFrame` e tire as três medidas do mesmo instante (`chat-view.tsx`).
- ⚠️ **`scrollIntoView` para rolar uma lista.** Ele rola **todos** os ancestrais roláveis até revelar o elemento — no celular mexe na página junto. Para levar um contêiner ao fim, use `el.scrollTo({ top: el.scrollHeight })` no próprio contêiner.
- Elemento de mídia (`<audio>`/`<video>`) que monta e **nunca desmonta**. Cada um segura um carregador vivo; numa conversa com 21 áudios isso é orçamento de memória gasto com o que ninguém está ouvindo.

**Verificação**
- Playwright ou teste de browser (AGENTS §3.12).
- Declarar visual "ok" sem `pnpm build` — é o único check que pega módulo de servidor vazando para componente client.

---

## §10. Critério de aceite visual

Uma tela está pronta quando:

- [ ] Dá para identificar **título, ação principal, filtros ativos e estado dos dados** sem depender de cor.
- [ ] Não há rolagem horizontal inesperada em 320 px.
- [ ] Teclado e leitor de tela alcançam todos os controles.
- [ ] A mesma informação não aparece em dois cartões só para preencher espaço.
- [ ] Vazio, carregando e erro foram vistos de verdade — não só imaginados.
- [ ] Claro e escuro conferidos.
- [ ] 320 px, 375 px, tablet e desktop conferidos.

---

## §11. Divergências a preservar até task específica

Não autorizam refatoração incidental. Reuse o padrão dominante da tela alvo.

- Restam `select` nativos em formulários antigos; o padrão novo é `FormSelect`.
- Diálogos administrativos secundários (Configurações, tokens, usuários) ainda não seguem inteiramente o `ModalShell`.
- A toolbar compartilhada ainda não chegou a todas as tabelas de gestão.
- O Dashboard tem redundância de informação entre blocos; reduzir exige antes validar quais blocos apoiam decisão diária.

## §12. Backlog visual conhecido

- Migrar os `select` nativos restantes para `FormSelect`.
- Padronizar os diálogos administrativos secundários no `ModalShell`, com tamanho proporcional à tarefa.
- Levar a `DataToolbar` às tabelas de gestão restantes.
- Revisão manual em 320 px / 375 px / tablet / desktop, claro e escuro, zoom 200%, nomes longos e listas vazias.
- Validar com usuários se busca global agrega valor antes de introduzir a complexidade.
