import type { AnchorHTMLAttributes } from "react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { refreshMock, toastMock } = vi.hoisted(() => ({
  refreshMock: vi.fn(),
  toastMock: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: refreshMock }),
}));
vi.mock("sonner", () => ({ toast: toastMock }));
vi.mock("next/link", () => ({
  default: ({ children, ...props }: AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a {...props} onClick={(event) => event.preventDefault()}>
      {children}
    </a>
  ),
  useLinkStatus: () => ({ pending: false }),
}));

import { AgendaCalendar } from "@/features/appointments/components/agenda-calendar";
import { localToIso, type AgendaBlock } from "@/features/appointments/lib/agenda-blocks";
import type { AgendaPeriod } from "@/features/appointments/lib/agenda-view";
import type { AppointmentListItem } from "@/features/appointments/types";

const TODAY = "2026-10-09";

const appointment = (overrides: Partial<AppointmentListItem> = {}): AppointmentListItem => ({
  id: "a1",
  kind: "visita_tecnica",
  title: "Trocar a impressora fiscal",
  status: "agendado",
  // 13:00 UTC = 10:00 em São Paulo.
  scheduled_at: "2026-10-09T13:00:00+00:00",
  duration_min: 60,
  location: null,
  notes: null,
  ticket_id: null,
  customer_id: "c1",
  contact_id: null,
  assignee_id: null,
  created_by_user_id: null,
  created_at: "2026-10-01T12:00:00+00:00",
  updated_at: "2026-10-01T12:00:00+00:00",
  customer: { id: "c1", legal_name: "Padaria S. João Ltda", trade_name: "Padaria São João" },
  contact: null,
  ticket: null,
  assignee: { id: "u1", name: "Ana Lima" },
  ...overrides,
});

const period = (overrides: Partial<AgendaPeriod> = {}): AgendaPeriod => ({
  view: "mes",
  monthKey: "2026-10",
  dateKey: TODAY,
  ...overrides,
});

const originalMatchMedia = window.matchMedia;

// O Dialog decide entre caixa e gaveta pela largura: no teste, desktop.
beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn().mockImplementation((media: string) => ({
      matches: false,
      media,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
});

afterAll(() => {
  Object.defineProperty(window, "matchMedia", { configurable: true, value: originalMatchMedia });
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

/** O diálogo busca a equipe ao abrir. */
function stubTeam() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ users: [] }), { status: 200 }))
  );
}

/** A grade do mês no desktop (a do celular repete os dias, como botões). */
function desktopMonth() {
  const grid = screen.getAllByRole("grid").find((element) => element.querySelector("section"));
  if (!grid) throw new Error("grade do mês não encontrada");
  return within(grid);
}

const FERIADO: AgendaBlock = {
  id: "b1",
  startsAt: localToIso("2026-10-12", "00:00"),
  endsAt: localToIso("2026-10-13", "00:00"),
  allDay: true,
  reason: "Feriado",
  assignee: null,
};

const ALMOCO_ANA: AgendaBlock = {
  id: "b2",
  startsAt: localToIso("2026-10-09", "12:00"),
  endsAt: localToIso("2026-10-09", "13:00"),
  allDay: false,
  reason: "Almoço",
  assignee: { id: "u1", name: "Ana Lima" },
};

describe("AgendaCalendar", () => {
  it("mostra o período, a contagem e o compromisso no dia dele, com o resumo no nome acessível", () => {
    render(<AgendaCalendar period={period()} todayKey={TODAY} blocks={[]} appointments={[appointment()]} />);

    expect(screen.getByRole("heading", { name: "Outubro de 2026" })).toBeInTheDocument();
    // A contagem da faixa (o cabeçalho do dia no celular repete o texto, sem aria-live).
    expect(
      screen.getByText(
        (_, element) =>
          element?.tagName === "P" &&
          element.getAttribute("aria-live") === "polite" &&
          element.textContent === "1 agendamento"
      )
    ).toBeInTheDocument();
    const cell = desktopMonth().getByRole("gridcell", { name: "Sexta-feira, 09 de outubro, 1 agendamento" });
    expect(
      within(cell).getByRole("button", {
        name: "10:00–11:00, Visita técnica, Trocar a impressora fiscal, Padaria São João, Ana Lima, Agendado",
      })
    ).toBeInTheDocument();
  });

  it("no mês, a contagem é do mês do título: os dias vizinhos da grade ficam fora", () => {
    render(
      <AgendaCalendar
        period={period()}
        todayKey={TODAY} blocks={[]}
        // 28 de setembro aparece na 1ª linha da grade de outubro.
        appointments={[appointment(), appointment({ id: "a2", scheduled_at: "2026-09-28T13:00:00+00:00" })]}
      />
    );

    expect(
      screen.getByText(
        (_, element) =>
          element?.tagName === "P" &&
          element.getAttribute("aria-live") === "polite" &&
          element.textContent === "1 agendamento"
      )
    ).toBeInTheDocument();
    expect(desktopMonth().getByRole("gridcell", { name: "Segunda-feira, 28 de setembro, 1 agendamento" })).toBeInTheDocument();
  });

  it("tocar no compromisso abre a edição dele", async () => {
    const user = userEvent.setup();
    stubTeam();
    render(<AgendaCalendar period={period()} todayKey={TODAY} blocks={[]} appointments={[appointment()]} />);

    await user.click(desktopMonth().getByRole("button", { name: /Trocar a impressora fiscal/ }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Editar agendamento")).toBeInTheDocument();
    expect(within(dialog).getByLabelText(/Data/)).toHaveValue("2026-10-09");
    expect(within(dialog).getByLabelText(/Hora/)).toHaveValue("10:00");
  });

  it("o '+' de um dia abre a criação naquele dia", async () => {
    const user = userEvent.setup();
    stubTeam();
    render(<AgendaCalendar period={period()} todayKey={TODAY} blocks={[]} appointments={[]} />);

    await user.click(desktopMonth().getByRole("button", { name: "Agendar em Quarta-feira, 21 de outubro" }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Novo agendamento")).toBeInTheDocument();
    expect(within(dialog).getByLabelText(/Data/)).toHaveValue("2026-10-21");
  });

  it("'Novo agendamento' da faixa abre no dia em tela na semana", async () => {
    const user = userEvent.setup();
    stubTeam();
    render(
      <AgendaCalendar period={period({ view: "semana", dateKey: "2026-10-14" })} todayKey={TODAY} blocks={[]} appointments={[]} />
    );

    await user.click(screen.getByRole("button", { name: "Novo agendamento" }));

    expect(within(await screen.findByRole("dialog")).getByLabelText(/Data/)).toHaveValue("2026-10-14");
  });

  it("a semana mostra os sete dias e o compromisso na coluna dele", () => {
    render(
      <AgendaCalendar period={period({ view: "semana" })} todayKey={TODAY} blocks={[]} appointments={[appointment()]} />
    );

    expect(screen.getByRole("heading", { name: "04–10 de out" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^Agendar em / })).toHaveLength(7);
    expect(screen.getByRole("button", { name: /Trocar a impressora fiscal/ })).toBeInTheDocument();
  });

  it("a lista é a tabela do mês, com editar e excluir na linha", () => {
    render(<AgendaCalendar period={period({ view: "lista" })} todayKey={TODAY} blocks={[]} appointments={[appointment()]} />);

    const table = within(screen.getByRole("table"));
    expect(table.getByText("Trocar a impressora fiscal")).toBeInTheDocument();
    expect(table.getByRole("button", { name: "Editar agendamento" })).toBeInTheDocument();
    expect(table.getByRole("button", { name: "Excluir agendamento" })).toBeInTheDocument();
  });

  it("lista vazia fala do mês, não da agenda inteira", () => {
    render(<AgendaCalendar period={period({ view: "lista" })} todayKey={TODAY} blocks={[]} appointments={[]} />);

    expect(screen.getByText("Nenhum agendamento neste mês")).toBeInTheDocument();
  });

  it("cancelado risca o assunto, e a situação vai no nome acessível", () => {
    render(
      <AgendaCalendar
        period={period({ view: "dia" })}
        todayKey={TODAY} blocks={[]}
        appointments={[appointment({ status: "cancelado" })]}
      />
    );

    const event = screen.getByRole("button", { name: /Cancelado$/ });
    expect(within(event).getByText("Trocar a impressora fiscal")).toHaveClass("line-through");
  });

  it("no mês, dia inteiro hachura a célula; parcial vira linha com motivo e horário", () => {
    render(
      <AgendaCalendar period={period()} todayKey={TODAY} blocks={[FERIADO, ALMOCO_ANA]} appointments={[]} />
    );

    const feriado = desktopMonth().getByRole("gridcell", { name: /^Segunda-feira, 12 de outubro/ });
    expect(feriado).toHaveAttribute("data-block-coverage", "all-day");
    expect(feriado.className).toContain("repeating-linear-gradient");
    expect(feriado).toHaveAccessibleName("Segunda-feira, 12 de outubro, 0 agendamentos, bloqueios: Feriado · Dia inteiro");

    const almoco = desktopMonth().getByRole("gridcell", { name: /^Sexta-feira, 09 de outubro/ });
    expect(almoco).toHaveAttribute("data-block-coverage", "partial");
    expect(almoco.className).not.toContain("repeating-linear-gradient");
    expect(within(almoco).getByText("Ana Lima: Almoço")).toBeInTheDocument();
    expect(within(almoco).getByText("12:00–13:00")).toBeInTheDocument();
  });

  it("na grade, o bloqueio é uma faixa de fundo que não rouba o clique", () => {
    render(
      <AgendaCalendar period={period({ view: "dia" })} todayKey={TODAY} blocks={[ALMOCO_ANA]} appointments={[]} />
    );

    const faixa = screen.getByRole("note", { name: "Bloqueio: Ana Lima: Almoço · 12:00–13:00" });
    expect(faixa).toHaveClass("pointer-events-none");
    // 12:00 na grade que começa às 07:00, a 1 px por minuto.
    expect(faixa).toHaveStyle({ top: "300px", height: "60px" });
  });
});
