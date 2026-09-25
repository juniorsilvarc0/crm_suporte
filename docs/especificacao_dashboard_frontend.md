# Especificação de Front-end — Dashboard Principal

## 1. Objetivo

Desenvolver a **tela principal do dashboard** seguindo visualmente o layout de referência fornecido.

A tela deve funcionar como uma visão rápida da operação do usuário, concentrando:

- busca por leads/pacientes;
- cards de clientes/pacientes;
- lembretes;
- notas rápidas em formato de post-it;
- atalhos para outros módulos;
- preview semanal do calendário;
- agendamentos;
- botão flutuante do WhatsApp;
- navegação rápida para o chat interno do sistema.

O objetivo é reproduzir a mesma sensação visual da referência: **interface leve, sofisticada, moderna, com cards arredondados, bastante espaço em branco, tons claros, transparências suaves e detalhes em degradê lilás/azul/rosa.**

---

# 2. Estrutura geral da tela

A página deve ocupar praticamente toda a viewport e ser dividida em **duas colunas principais**.

```text
┌───────────────────────────────────────────────────────────────────────┐
│                        DASHBOARD PRINCIPAL                            │
├───────────────────────────────┬───────────────────────────────────────┤
│                               │                                       │
│   COLUNA ESQUERDA             │   COLUNA DIREITA                      │
│                               │                                       │
│   Busca                       │   Atalhos rápidos                      │
│   Filtros                     │   Navegação do calendário             │
│   Cards de pacientes/leads    │   Preview semanal                     │
│                               │   Agendamentos                        │
│   Minhas notas                │                                       │
│   Post-its                    │                                       │
│                               │                                       │
│                               │                           WhatsApp ◉   │
└───────────────────────────────┴───────────────────────────────────────┘
```

Sugestão de proporção desktop:

```css
grid-template-columns: minmax(520px, 1fr) minmax(620px, 1fr);
gap: 16px;
```

Em telas maiores, manter as duas colunas aproximadamente em proporção **50/50**.

---

# 3. Container principal

Criar um container geral com:

- `min-height: 100vh`;
- background muito claro;
- bordas arredondadas;
- leve efeito de vidro;
- sombra extremamente suave;
- padding entre `16px` e `24px`.

Referência visual:

```css
background:
  radial-gradient(circle at top right, rgba(186, 132, 255, 0.14), transparent 35%),
  radial-gradient(circle at bottom left, rgba(100, 130, 255, 0.12), transparent 35%),
  #f8f9ff;

border: 1px solid rgba(255,255,255,.7);
border-radius: 28px;
box-shadow: 0 20px 60px rgba(80, 70, 140, 0.08);
```

Não usar cores muito saturadas.

---

# 4. Direção visual

## 4.1 Estilo

A interface precisa transmitir:

- tecnologia;
- organização;
- saúde/bem-estar;
- suavidade;
- produtividade;
- sofisticação.

Usar:

- branco;
- cinza muito claro;
- lilás;
- violeta;
- azul;
- rosa muito suave;
- amarelo pastel nos post-its.

---

## 4.2 Bordas

Todos os principais componentes devem ter bordas arredondadas.

Sugestão:

```css
--radius-sm: 10px;
--radius-md: 14px;
--radius-lg: 18px;
--radius-xl: 24px;
--radius-pill: 999px;
```

---

## 4.3 Sombras

Usar sombras discretas.

```css
box-shadow:
  0 4px 16px rgba(56, 44, 100, 0.04),
  0 1px 3px rgba(56, 44, 100, 0.04);
```

Nada de sombras escuras ou pesadas.

---

# 5. Coluna esquerda

A coluna esquerda possui três blocos principais:

1. barra superior;
2. lista de pacientes/leads;
3. seção de notas.

---

# 6. Barra superior da coluna esquerda

Criar uma linha contendo:

```text
[ Buscar paciente ou lead                         ] [ícone] [ícone] [Baralhos] [Supervisão]
```

## 6.1 Campo de busca

Placeholder:

```text
Busque seu paciente ou lead
```

ou, caso o sistema esteja em modo exclusivamente clínico:

```text
Busque seu paciente
```

A busca deve localizar registros por:

- nome;
- telefone;
- e-mail;
- identificador;
- tags.

Adicionar ícone de lupa à esquerda.

A busca deve ocorrer com debounce entre `250ms` e `400ms`.

---

## 6.2 Atalhos superiores

Após o campo de busca, exibir pequenos botões circulares ou pills.

Exemplos:

- visualizar/ocultar informações;
- documentos;
- modo noturno;
- módulo "Baralhos";
- módulo "Supervisão".

Os módulos precisam ser configuráveis.

Estrutura sugerida:

```ts
type DashboardShortcut = {
  id: string;
  label: string;
  icon: React.ReactNode;
  href: string;
  variant?: "default" | "primary" | "secondary";
};
```

---

# 7. Barra de filtros dos pacientes/leads

Logo abaixo da busca, criar uma segunda linha.

Referência:

```text
[ ordenar ] [ filtro ] [ Aniversariantes ] [ Ativos ▾ ] [ + Adicionar ] [ Gerar Link ]
```

## Botões

### Ordenar

Deve permitir:

- nome;
- próxima sessão;
- último contato;
- data de cadastro.

### Filtro

Exemplos:

- ativos;
- inativos;
- aniversariantes;
- sem sessão;
- sessão hoje;
- sessão próxima;
- leads;
- pacientes.

### Aniversariantes

Filtro rápido para pessoas que fazem aniversário no dia/período.

### Status

Dropdown:

```text
Ativos
Inativos
Todos
```

### Adicionar

Botão principal:

```text
+ Adicionar
```

Abrir modal ou rota de criação de lead/paciente.

### Gerar Link

Botão secundário.

Pode ser utilizado para:

- link de agendamento;
- ficha;
- formulário;
- cadastro;
- outra funcionalidade definida posteriormente.

---

# 8. Cards de pacientes/leads

Abaixo dos filtros, apresentar os contatos em formato de cards.

No desktop:

```text
┌─────────────────────────┐  ┌─────────────────────────┐
│ Ana Martins         (W) │  │ Bruno Almeida       (W) │
│ Hoje é aniversário      │  │ Próxima sessão 11h      │
└─────────────────────────┘  └─────────────────────────┘
```

Utilizar **grid com duas colunas**.

```css
display: grid;
grid-template-columns: repeat(2, minmax(0, 1fr));
gap: 10px;
```

---

# 9. Estrutura de cada card

Cada card deve conter:

- avatar/ícone;
- nome;
- status secundário;
- indicador de cor;
- botão WhatsApp;
- possibilidade de clique no card.

Exemplo:

```ts
type PersonCard = {
  id: string;
  name: string;
  avatarUrl?: string;
  type: "lead" | "patient";
  status: "active" | "inactive";
  subtitle?: string;
  nextAppointment?: string;
  birthday?: boolean;
  phone?: string;
};
```

---

## 9.1 Exemplos de subtítulo

```text
Hoje é aniversário de Ana! · 36 anos
```

```text
Próxima sessão em 11 horas
```

```text
Próxima sessão em 1 dia
```

```text
Sem sessões agendadas
```

```text
Último contato há 3 dias
```

---

## 9.2 Indicadores

Usar pequenos pontos coloridos no subtítulo.

Sugestões:

- azul: próxima sessão;
- rosa: aniversário;
- cinza: sem agendamento;
- verde: novo lead;
- laranja: atenção;
- vermelho: atraso.

---

# 10. Ação do WhatsApp no card

Cada card deve possuir um pequeno botão de WhatsApp do lado direito.

Ao clicar:

- não navegar para WhatsApp Web;
- abrir o chat interno do sistema;
- navegar para:

```text
/app/chat
```

Preferencialmente enviando o identificador da pessoa.

Exemplo:

```ts
router.push(`/app/chat?contactId=${person.id}`)
```

ou:

```ts
router.push(`/app/chat/${person.id}`)
```

Caso a rota atualmente disponível seja somente `/app/chat`, utilizar:

```ts
router.push("/app/chat")
```

---

# 11. Scroll da lista

A área dos cards não deve expandir infinitamente.

Criar um container com altura controlada.

Exemplo:

```css
max-height: 360px;
overflow-y: auto;
```

Scrollbar discreta ou oculta visualmente.

---

# 12. Seção "Minhas notas"

Abaixo da lista de pacientes/leads, criar um painel chamado:

```text
Minhas notas
```

Na direita do título, incluir ações semelhantes a:

```text
[6 páginas] [21 post-its] [Espaços] [Recolher]
```

Os números devem vir dinamicamente.

---

# 13. Estrutura da área de notas

Dividir a seção em duas áreas.

```text
┌──────────────────────────┬──────────────────────────┐
│ Caderno principal        │ Lembrete rápido          │
│                          │                          │
│ Meu caderno              │ [ textarea amarelo ]     │
│ Última página            │                          │
│ Nova página              │ [post-it][post-it]...    │
│                          │                          │
│ [ Abrir ]  [ + Nova ]    │                          │
└──────────────────────────┴──────────────────────────┘
```

---

# 14. Caderno principal

Criar um card visual semelhante a um caderno/bloco.

Informações:

- nome do caderno;
- última página;
- data de atualização;
- número de páginas;
- quantidade de post-its.

Exemplo:

```text
Meu caderno
Última página
Nova página

Atualizado 16 de jul, 02:55
```

Botões:

```text
Abrir
+ Nova
```

---

# 15. Lembrete rápido

Criar uma área de anotação rápida com visual de post-it amarelo pastel.

Placeholder:

```text
Escreva um lembrete rápido...
```

Requisitos:

- salvar automaticamente;
- debounce de aproximadamente `600ms`;
- exibir status `Salvo`;
- exibir menu `...`;
- aceitar texto multilinha.

Estrutura:

```ts
type QuickNote = {
  id: string;
  content: string;
  updatedAt: string;
};
```

---

# 16. Post-its

Abaixo do lembrete rápido, mostrar pequenos post-its.

Exemplo:

```text
[ Post-it ] [ Post-it ] [ Novo post-it ] [ teste ]
```

Os post-its devem:

- ter fundo amarelo claro;
- borda arredondada;
- possuir sombra suave;
- aceitar clique;
- permitir editar;
- permitir excluir;
- permitir criar novo.

Opcional posteriormente:

- drag and drop;
- reorganização;
- cores;
- tags;
- associação com paciente.

---

# 17. Botão de novo post-it

Adicionar um card ou botão:

```text
+ Novo post-it
```

Abrir um modal simples contendo:

- título opcional;
- conteúdo;
- cor;
- salvar.

---

# 18. Coluna direita

A coluna direita concentra o calendário.

Estrutura:

1. atalhos;
2. navegação;
3. resumo;
4. calendário semanal;
5. botão flutuante do WhatsApp.

---

# 19. Barra de atalhos do calendário

Criar uma barra no topo semelhante à referência.

```text
[ Agendar Sessão ] [ Bloquear horário ] [ ✈ ] [ Sincronizar ] [ Expandir ]
```

## Ações

### Agendar Sessão

Abre modal de novo agendamento.

### Bloquear horário

Permite criar bloqueio de agenda.

### Ícone intermediário

Pode representar:

- automação;
- envio;
- ação rápida;
- integração.

Manter configurável.

### Sincronizar

Sincronização com calendário externo.

Exemplos:

- Google Calendar;
- Outlook.

### Expandir

Abre calendário completo.

Exemplo:

```text
/app/calendar
```

---

# 20. Navegação do calendário

Linha seguinte:

```text
[ ← ] [ → ] [ hoje ]              19 – 25 de jul. de 2026               [ mês ] [ semana ] [ dia ]
```

Requisitos:

- seta anterior;
- seta próxima;
- botão "hoje";
- intervalo da semana;
- tabs mês/semana/dia.

O modo padrão deste dashboard deve ser:

```text
semana
```

---

# 21. Resumo do calendário

Acima da grade, criar card de resumo.

Exemplo:

```text
Vidas sendo cuidadas

Pacientes em acompanhamento                     143 ativos | 1 hoje
```

Os textos devem ser configuráveis.

Para uma aplicação genérica:

```text
Atendimentos

Pacientes em acompanhamento
```

Indicadores:

- quantidade de ativos;
- atendimentos hoje.

---

# 22. Preview semanal do calendário

A agenda precisa reproduzir a ideia da referência:

- 7 colunas;
- domingo até sábado;
- horários na lateral;
- linhas horizontais;
- cards coloridos dentro dos horários.

Exemplo:

```text
           dom     seg     ter     qua     qui     sex     sáb

10:00
11:00
12:00             [Bruno]
13:00                     [Clara]          [Elisa]
14:00                             [Daniel]
15:00                     [Bruno]                  [Clara]
16:00             [Meet]                  [Felipe]
17:00
...
23:00
```

---

# 23. Horários

Mostrar intervalo padrão:

```text
10:00 até 23:00
```

Idealmente configurável por usuário.

```ts
type CalendarSettings = {
  startHour: number;
  endHour: number;
};
```

---

# 24. Card de agendamento

Cada agendamento deve exibir:

- horário inicial/final;
- nome do paciente;
- cor;
- tooltip ao passar o mouse.

Exemplo:

```text
12h30–13h30
Bruno Almeida
```

Cards precisam ter:

- border-radius `7px–10px`;
- texto branco quando a cor for forte;
- leve sombra;
- hover.

---

# 25. Cores dos agendamentos

Usar paleta pastel.

Exemplo:

```ts
const appointmentColors = [
  "blue",
  "purple",
  "orange",
  "yellow",
  "red",
  "green",
];
```

As cores podem representar:

- profissional;
- tipo de sessão;
- status;
- sala.

---

# 26. Interação com o agendamento

Ao clicar em um evento, abrir popover ou modal contendo:

- paciente;
- data;
- horário;
- profissional;
- status;
- telefone;
- observação;
- botão abrir ficha;
- botão abrir WhatsApp;
- remarcar;
- cancelar.

---

# 27. Botão flutuante do WhatsApp

Criar um botão flutuante na parte inferior direita da coluna de calendário.

Visual:

- círculo verde;
- ícone branco do WhatsApp;
- sombra;
- tamanho entre `48px` e `58px`.

Posição desktop:

```css
position: absolute;
right: 18px;
bottom: 18px;
z-index: 30;
```

Ação obrigatória:

```ts
router.push("/app/chat");
```

Ou, usando link:

```tsx
<Link href="/app/chat">
  <WhatsAppIcon />
</Link>
```

### Importante

Este botão **não deve abrir WhatsApp Web nem link wa.me**.

Ele deve navegar para o módulo interno:

```text
/app/chat
```

---

# 28. Responsividade

## Desktop acima de 1280px

Manter duas colunas.

```text
50% | 50%
```

---

## Tablet entre 768px e 1279px

Pode usar:

```text
45% | 55%
```

ou empilhar caso não exista espaço suficiente.

---

## Mobile abaixo de 768px

Empilhar:

```text
Busca
Cards
Notas
Atalhos
Calendário
```

Cards de pacientes:

```css
grid-template-columns: 1fr;
```

No calendário mobile:

- permitir scroll horizontal;
- ou utilizar modo `dia`.

---

# 29. Componentização

Criar componentes separados.

Estrutura sugerida:

```text
dashboard/
├── DashboardPage.tsx
├── DashboardHeader.tsx
├── PatientSearch.tsx
├── PatientFilters.tsx
├── PatientGrid.tsx
├── PatientCard.tsx
├── NotesPanel.tsx
├── NotebookCard.tsx
├── QuickNote.tsx
├── StickyNotes.tsx
├── CalendarPanel.tsx
├── CalendarActions.tsx
├── CalendarNavigation.tsx
├── CalendarSummary.tsx
├── WeekCalendar.tsx
├── AppointmentCard.tsx
└── FloatingWhatsappButton.tsx
```

---

# 30. Separação de responsabilidade

Não criar a tela inteira em um único componente.

Cada componente deve possuir responsabilidade específica.

Exemplo:

```tsx
<DashboardPage>
  <DashboardLeftColumn>
    <PatientSearch />
    <PatientFilters />
    <PatientGrid />
    <NotesPanel />
  </DashboardLeftColumn>

  <DashboardRightColumn>
    <CalendarActions />
    <CalendarNavigation />
    <CalendarSummary />
    <WeekCalendar />
    <FloatingWhatsappButton />
  </DashboardRightColumn>
</DashboardPage>
```

---

# 31. Tipos de dados

## Paciente/lead

```ts
interface DashboardPerson {
  id: string;
  name: string;
  avatarUrl?: string;
  phone?: string;
  email?: string;

  type: "lead" | "patient";

  status:
    | "active"
    | "inactive"
    | "new"
    | "no_appointment";

  birthday?: {
    isToday: boolean;
    age?: number;
  };

  nextAppointment?: {
    id: string;
    startsAt: string;
  };
}
```

---

## Agendamento

```ts
interface DashboardAppointment {
  id: string;
  patientId: string;
  patientName: string;

  start: string;
  end: string;

  status:
    | "scheduled"
    | "confirmed"
    | "completed"
    | "cancelled";

  color?: string;

  professionalId?: string;
  professionalName?: string;
}
```

---

## Post-it

```ts
interface StickyNote {
  id: string;
  title?: string;
  content: string;
  color?: string;
  createdAt: string;
  updatedAt: string;
}
```

---

# 32. Estados da interface

Criar estados apropriados.

## Loading

Usar skeleton.

Não usar apenas texto:

```text
Carregando...
```

---

## Lista vazia

Exemplo:

```text
Nenhum paciente encontrado.
```

Com botão:

```text
Adicionar paciente
```

---

## Agenda vazia

```text
Nenhum atendimento agendado nesta semana.
```

---

## Erro

Mostrar mensagem discreta com opção:

```text
Tentar novamente
```

---

# 33. Hover e microinterações

Adicionar microinterações suaves.

Exemplo:

```css
transition:
  transform 160ms ease,
  box-shadow 160ms ease,
  background 160ms ease;
```

Nos cards:

```css
:hover {
  transform: translateY(-1px);
}
```

Não exagerar em animações.

---

# 34. Ícones

Utilizar uma biblioteca única.

Sugestão:

```text
lucide-react
```

Ícones sugeridos:

```text
Search
Eye
FileText
Moon
Users
UserRound
Cake
Filter
ArrowUpDown
Plus
Link2
CalendarDays
Ban
Plane
RefreshCw
Maximize2
ChevronLeft
ChevronRight
MessageCircle
NotebookTabs
StickyNote
Star
```

Para WhatsApp, utilizar ícone próprio da biblioteca de ícones adotada no projeto ou SVG consistente com o design.

---

# 35. Tipografia

Utilizar fonte moderna e limpa.

Preferências:

```text
Inter
Manrope
Plus Jakarta Sans
DM Sans
```

Sugestão principal:

```text
Inter
```

Pesos:

```text
400
500
600
700
```

---

# 36. Hierarquia tipográfica

## Título

```css
font-size: 20px;
font-weight: 700;
```

## Nome de paciente

```css
font-size: 14px;
font-weight: 600;
```

## Texto secundário

```css
font-size: 11px;
font-weight: 400;
```

## Botões

```css
font-size: 12px;
font-weight: 500;
```

---

# 37. Acessibilidade

Todos os botões precisam possuir:

- `aria-label`;
- foco visível;
- tooltip quando for somente ícone;
- contraste mínimo adequado.

Exemplo:

```tsx
<button aria-label="Abrir chat">
  <MessageCircle />
</button>
```

---

# 38. Regras importantes de implementação

1. Não deixar dados mockados dentro dos componentes finais.
2. Criar camada de dados/API separada.
3. Componentes precisam aceitar dados via props.
4. Todas as listas devem possuir `key` estável.
5. Não usar índice do array como key.
6. Não usar `window.location.href` para navegação interna.
7. Utilizar o router oficial do projeto.
8. Preservar estado de filtros quando possível.
9. Debounce na busca.
10. Memoização somente quando realmente necessária.
11. Não adicionar bibliotecas grandes sem necessidade.
12. Respeitar o design system existente.
13. Caso já exista componente de Button, Card, Input, Badge ou Modal, reutilizá-lo.
14. Não criar duplicações de componentes já existentes.

---

# 39. APIs esperadas

A interface deve ser preparada para consumir endpoints semelhantes a:

```text
GET /api/dashboard/people
GET /api/dashboard/appointments
GET /api/dashboard/summary
GET /api/notes
POST /api/notes
PATCH /api/notes/:id
DELETE /api/notes/:id
POST /api/appointments
PATCH /api/appointments/:id
```

Os nomes são apenas referência.

Utilizar os endpoints reais já existentes no projeto.

---

# 40. Consulta da dashboard

Idealmente, o dashboard deve carregar os dados principais de forma paralela.

Exemplo:

```ts
Promise.all([
  getDashboardPeople(),
  getDashboardAppointments(),
  getDashboardSummary(),
  getNotes(),
]);
```

Caso o projeto utilize React Query/TanStack Query:

```ts
useQuery(...)
```

Utilizar o padrão já adotado pelo projeto.

---

# 41. Performance

Não carregar toda a base de pacientes.

A API deve retornar apenas o necessário para a dashboard.

Exemplo:

```text
10–20 registros inicialmente
```

Paginação, scroll ou "ver mais" para os demais.

---

# 42. Busca

A busca deve pesquisar no backend.

Evitar filtrar exclusivamente os dados que já estão carregados na tela.

Exemplo:

```text
GET /api/dashboard/people?q=ana
```

---

# 43. Calendário

Pode utilizar componente próprio ou biblioteca já existente.

Se for necessário adicionar biblioteca, opções aceitáveis:

```text
FullCalendar
React Big Calendar
```

Porém, **antes de adicionar qualquer dependência nova, verificar se o projeto já possui uma biblioteca de calendário**.

O visual precisa ser customizado para ficar parecido com a referência.

Não usar o estilo padrão da biblioteca.

---

# 44. Preview x calendário completo

Esta tela é um **preview**.

Ela não precisa possuir todas as funcionalidades da agenda completa.

O botão:

```text
Expandir
```

deve levar ao módulo de agenda completo.

Exemplo:

```text
/app/calendar
```

Utilizar a rota real existente no projeto.

---

# 45. Comportamento do botão WhatsApp

Este requisito é obrigatório.

```text
Clique no botão flutuante
        ↓
router.push("/app/chat")
        ↓
abre módulo interno de WhatsApp/chat
```

Nunca:

```text
https://wa.me/
```

Nunca:

```text
web.whatsapp.com
```

---

# 46. Mock inicial para desenvolvimento

Enquanto a API não estiver conectada, utilizar mocks separados.

Exemplo:

```ts
export const dashboardPeopleMock = [
  {
    id: "1",
    name: "Ana Martins",
    type: "patient",
    status: "active",
    birthday: {
      isToday: true,
      age: 36,
    },
  },
  {
    id: "2",
    name: "Bruno Almeida",
    type: "patient",
    status: "active",
    nextAppointment: {
      id: "appointment-1",
      startsAt: "2026-07-20T12:30:00",
    },
  },
  {
    id: "3",
    name: "Clara Nogueira",
    type: "patient",
    status: "active",
    nextAppointment: {
      id: "appointment-2",
      startsAt: "2026-07-21T13:30:00",
    },
  },
];
```

---

# 47. Mock dos agendamentos

```ts
export const appointmentMock = [
  {
    id: "1",
    patientId: "2",
    patientName: "Bruno Almeida",
    start: "2026-07-20T12:30:00",
    end: "2026-07-20T13:30:00",
    color: "blue",
    status: "scheduled",
  },
  {
    id: "2",
    patientId: "3",
    patientName: "Clara Nogueira",
    start: "2026-07-21T13:30:00",
    end: "2026-07-21T14:30:00",
    color: "orange",
    status: "scheduled",
  },
];
```

---

# 48. Resultado visual esperado

A interface final precisa visualmente seguir esta composição:

```text
╭─────────────────────────────────────────────────────────────────────╮
│                                                                     │
│  🔍 Busque seu paciente...       atalhos                             │
│                                                                     │
│  filtros                           Agendar | Bloquear | Sincronizar   │
│                                                                     │
│  ╭──────────────╮ ╭──────────────╮  ← → hoje       semana           │
│  │ Ana Martins  │ │ Bruno        │                                  │
│  │ aniversário  │ │ sessão 11h   │  Pacientes em acompanhamento     │
│  ╰──────────────╯ ╰──────────────╯                                  │
│                                                                     │
│  ╭──────────────╮ ╭──────────────╮  ┌────────────────────────────┐   │
│  │ Clara        │ │ Daniel       │  │ calendário semanal         │   │
│  ╰──────────────╯ ╰──────────────╯  │                            │   │
│                                     │      agendamentos           │   │
│  Minhas notas                       │                            │   │
│                                     │                            │   │
│  ╭──────────────╮ ╭──────────────╮  │                            │   │
│  │ Meu caderno  │ │ lembrete     │  │                            │   │
│  │              │ │ amarelo      │  │                       🟢   │   │
│  ╰──────────────╯ ╰──────────────╯  └────────────────────────────┘   │
│                                                                     │
╰─────────────────────────────────────────────────────────────────────╯
```

---

# 49. Critérios de aceite

A implementação somente deve ser considerada concluída quando:

- [ ] a tela possuir duas colunas no desktop;
- [ ] existir campo de busca por pacientes/leads;
- [ ] a busca funcionar com dados reais ou camada preparada para API;
- [ ] os cards exibirem nome e informação relevante;
- [ ] existir ação de WhatsApp nos cards;
- [ ] existir a seção "Minhas notas";
- [ ] existir lembrete rápido;
- [ ] existirem post-its;
- [ ] for possível criar um novo post-it;
- [ ] existir preview semanal do calendário;
- [ ] os agendamentos forem posicionados conforme data e horário;
- [ ] existirem controles anterior/próximo/hoje;
- [ ] existirem modos mês/semana/dia ou arquitetura preparada;
- [ ] existir botão "Agendar Sessão";
- [ ] existir botão "Bloquear horário";
- [ ] existir botão "Sincronizar";
- [ ] existir botão "Expandir";
- [ ] existir botão flutuante do WhatsApp;
- [ ] o botão flutuante navegar obrigatoriamente para `/app/chat`;
- [ ] a interface for responsiva;
- [ ] a aparência estiver visualmente próxima da referência;
- [ ] não houver componentes gigantes;
- [ ] loading, vazio e erro estiverem tratados;
- [ ] os componentes respeitarem o design system existente.

---

# 50. Instrução final para o agente

Implemente esta tela no projeto existente **sem alterar desnecessariamente a arquitetura atual**.

Antes de criar novos componentes, hooks, serviços ou dependências:

1. analise a estrutura atual do projeto;
2. procure componentes reutilizáveis;
3. identifique o design system existente;
4. identifique como o projeto realiza navegação;
5. identifique como o projeto consome APIs;
6. identifique se já existe calendário;
7. identifique as rotas reais;
8. reutilize padrões existentes.

A prioridade é:

```text
1. fidelidade visual à referência
2. boa componentização
3. integração com a arquitetura existente
4. responsividade
5. performance
6. manutenção simples
```

Não transformar a tela em um dashboard corporativo pesado.

Ela deve continuar com aparência:

```text
leve
elegante
acolhedora
moderna
organizada
premium
```
