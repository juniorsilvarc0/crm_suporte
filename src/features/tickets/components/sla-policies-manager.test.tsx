import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { refreshMock, toastMock } = vi.hoisted(() => ({
  refreshMock: vi.fn(),
  toastMock: { success: vi.fn(), error: vi.fn() },
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: refreshMock }) }));
vi.mock("sonner", () => ({ toast: toastMock }));

import {
  SlaPoliciesManager,
  durationToMinutes,
  splitMinutes,
} from "@/features/tickets/components/sla-policies-manager";
import type { TicketSlaPolicy } from "@/features/tickets/types";

// Fora da ordem de propósito: a tela ordena pelo rank. Valores da semente.
const POLICIES: TicketSlaPolicy[] = [
  { priority: "critica", rank: 4, first_response_minutes: 30, resolution_minutes: 240, warn_pct: 80 },
  { priority: "baixa", rank: 1, first_response_minutes: 480, resolution_minutes: 4320, warn_pct: 80 },
  { priority: "alta", rank: 3, first_response_minutes: 60, resolution_minutes: 480, warn_pct: 80 },
  { priority: "media", rank: 2, first_response_minutes: 240, resolution_minutes: 1440, warn_pct: 80 },
];

const ALTA = POLICIES[2];

/** A lista como a página relida a devolve, com `patch` numa prioridade. */
function refreshed(priority: TicketSlaPolicy["priority"], patch: Partial<TicketSlaPolicy>) {
  return POLICIES.map((policy) => (policy.priority === priority ? { ...policy, ...patch } : policy));
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function stubFetch(respond: () => Response | Promise<Response>) {
  const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () =>
    respond()
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function requestOf(fetchMock: ReturnType<typeof stubFetch>, index = 0) {
  const [url, init] = fetchMock.mock.calls[index];
  return { url, method: init?.method, body: JSON.parse(String(init?.body)) as unknown };
}

function setup(policies: TicketSlaPolicy[] | null = POLICIES) {
  render(<SlaPoliciesManager policies={policies} />);
  return userEvent.setup();
}

function row(name: string) {
  return screen.getByRole("form", { name });
}

function duration(form: HTMLElement, legend: "1ª resposta" | "Solução") {
  const group = within(form).getByRole("group", { name: legend });
  return {
    hours: within(group).getByLabelText<HTMLInputElement>("Horas"),
    minutes: within(group).getByLabelText<HTMLInputElement>("Minutos"),
  };
}

async function typeDuration(
  user: ReturnType<typeof userEvent.setup>,
  form: HTMLElement,
  legend: "1ª resposta" | "Solução",
  hours: string,
  minutes: string
) {
  const fields = duration(form, legend);
  await user.clear(fields.hours);
  await user.type(fields.hours, hours);
  await user.clear(fields.minutes);
  await user.type(fields.minutes, minutes);
}

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("splitMinutes e durationToMinutes", () => {
  it("minutos gravados viram horas e minutos, e voltam", () => {
    expect(splitMinutes(90)).toEqual({ hours: "1", minutes: "30" });
    expect(splitMinutes(4320)).toEqual({ hours: "72", minutes: "0" });
    expect(durationToMinutes({ hours: "2", minutes: "30" })).toBe(150);
    expect(durationToMinutes({ hours: "72", minutes: "0" })).toBe(4320);
  });

  it("parte vazia conta zero; minutos acima de 59 somam nas horas", () => {
    expect(durationToMinutes({ hours: "", minutes: "45" })).toBe(45);
    expect(durationToMinutes({ hours: "3", minutes: "" })).toBe(180);
    expect(durationToMinutes({ hours: "0", minutes: "90" })).toBe(90);
    expect(durationToMinutes({ hours: "", minutes: "" })).toBe(0);
  });

  it("o que não é só dígito dá NaN (a conversão não adivinha)", () => {
    expect(durationToMinutes({ hours: "1,5", minutes: "" })).toBeNaN();
    expect(durationToMinutes({ hours: "1", minutes: "-5" })).toBeNaN();
    expect(durationToMinutes({ hours: "1e2", minutes: "0" })).toBeNaN();
  });

  it("valor ausente ou inválido não vira número na tela", () => {
    expect(splitMinutes(undefined)).toEqual({ hours: "", minutes: "" });
    expect(splitMinutes(Number.NaN)).toEqual({ hours: "", minutes: "" });
    expect(splitMinutes(-1)).toEqual({ hours: "", minutes: "" });
  });
});

describe("SlaPoliciesManager", () => {
  it("mostra o aviso fixo e as 4 prioridades na ordem do rank, em h:min", () => {
    setup();

    expect(
      screen.getByText(
        "Vale para tickets abertos daqui em diante e para os que mudarem de prioridade. Os demais mantêm o prazo que já têm."
      )
    ).toBeInTheDocument();
    expect(screen.getAllByRole("form")).toHaveLength(4);
    expect(screen.getAllByRole("heading", { level: 3 }).map((heading) => heading.textContent)).toEqual([
      "Baixa",
      "Média",
      "Alta",
      "Crítica",
    ]);

    const baixa = row("Baixa");
    expect(duration(baixa, "1ª resposta").hours).toHaveValue("8");
    expect(duration(baixa, "1ª resposta").minutes).toHaveValue("0");
    expect(duration(baixa, "Solução").hours).toHaveValue("72");
    expect(within(baixa).getByLabelText("Aviso em")).toHaveValue("80");
  });

  it("Salvar fica desligado enquanto nada mudou", async () => {
    const user = setup();
    const alta = row("Alta");
    const save = within(alta).getByRole("button", { name: "Salvar" });

    expect(save).toBeDisabled();
    await typeDuration(user, alta, "1ª resposta", "2", "0");
    expect(save).toBeEnabled();
    // Voltar ao gravado não é mudança.
    await typeDuration(user, alta, "1ª resposta", "1", "0");
    expect(save).toBeDisabled();
  });

  it("converte h:min em minutos e manda só o campo que mudou", async () => {
    const fetchMock = stubFetch(() =>
      jsonResponse({ ok: true, item: { ...ALTA, first_response_minutes: 150 } })
    );
    const user = setup();
    const alta = row("Alta");

    await typeDuration(user, alta, "1ª resposta", "2", "30");
    await user.click(within(alta).getByRole("button", { name: "Salvar" }));

    await waitFor(() => expect(refreshMock).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(requestOf(fetchMock)).toEqual({
      url: "/api/sla-policies/alta",
      method: "PATCH",
      body: { first_response_minutes: 150 },
    });
    expect(toastMock.success).toHaveBeenCalledWith("SLA da prioridade Alta salvo.");
    // O gravado vira a base: sem mudança nova, nada a salvar.
    expect(within(alta).getByRole("button", { name: "Salvar" })).toBeDisabled();
  });

  it("só o aviso mudou: manda só warn_pct", async () => {
    const fetchMock = stubFetch(() => jsonResponse({ ok: true, item: { ...ALTA, warn_pct: 90 } }));
    const user = setup();
    const alta = row("Alta");

    const warn = within(alta).getByLabelText("Aviso em");
    await user.clear(warn);
    await user.type(warn, "90");
    await user.click(within(alta).getByRole("button", { name: "Salvar" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(requestOf(fetchMock).body).toEqual({ warn_pct: 90 });
  });

  it("minutos acima de 59 se normalizam ao sair do campo e gravam o total", async () => {
    const fetchMock = stubFetch(() => jsonResponse({ ok: true, item: ALTA }));
    const user = setup();
    const alta = row("Alta");

    await typeDuration(user, alta, "Solução", "0", "90");
    await user.tab();

    expect(duration(alta, "Solução").hours).toHaveValue("1");
    expect(duration(alta, "Solução").minutes).toHaveValue("30");

    await user.click(within(alta).getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(requestOf(fetchMock).body).toEqual({ resolution_minutes: 90 });
  });

  it("solução menor que a 1ª resposta é recusada antes de enviar", async () => {
    const fetchMock = stubFetch(() => jsonResponse({ ok: true, item: ALTA }));
    const user = setup();
    const alta = row("Alta");

    // Só a solução muda (30 min < 1 h da 1ª resposta gravada).
    await typeDuration(user, alta, "Solução", "0", "30");
    await user.click(within(alta).getByRole("button", { name: "Salvar" }));

    expect(
      await within(alta).findByText("A 1ª resposta não pode ter prazo maior que a solução.")
    ).toBeInTheDocument();
    expect(duration(alta, "1ª resposta").hours).toHaveAttribute("aria-invalid", "true");
    expect(fetchMock).not.toHaveBeenCalled();

    // Corrigir a solução tira o erro da 1ª resposta (revalida a dependente).
    await typeDuration(user, alta, "Solução", "2", "0");
    await waitFor(() =>
      expect(
        within(alta).queryByText("A 1ª resposta não pode ter prazo maior que a solução.")
      ).not.toBeInTheDocument()
    );
  });

  it("fora dos limites do banco (e campo vazio) é recusado antes de enviar", async () => {
    const fetchMock = stubFetch(() => jsonResponse({ ok: true, item: ALTA }));
    const user = setup();
    const alta = row("Alta");

    await typeDuration(user, alta, "Solução", "9000", "0");
    const warn = within(alta).getByLabelText("Aviso em");
    await user.clear(warn);
    await user.click(within(alta).getByRole("button", { name: "Salvar" }));

    expect(await within(alta).findByText("Use de 1 a 525.600 minutos.")).toBeInTheDocument();
    expect(within(alta).getByText("Informe o percentual.")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("erro de campo da rota vai para o campo", async () => {
    stubFetch(() =>
      jsonResponse(
        {
          ok: false,
          code: "validation",
          message: "A 1ª resposta não pode ter prazo maior que a solução.",
          errors: { first_response_minutes: ["A 1ª resposta não pode ter prazo maior que a solução."] },
        },
        400
      )
    );
    const user = setup();
    const alta = row("Alta");

    await typeDuration(user, alta, "1ª resposta", "3", "0");
    await user.click(within(alta).getByRole("button", { name: "Salvar" }));

    expect(
      await within(alta).findByText("A 1ª resposta não pode ter prazo maior que a solução.")
    ).toBeInTheDocument();
    expect(duration(alta, "1ª resposta").hours).toHaveFocus();
    expect(refreshMock).not.toHaveBeenCalled();
    expect(toastMock.success).not.toHaveBeenCalled();
  });

  it("erro sem campo e falha de rede viram alerta na linha", async () => {
    let respond: () => Response | Promise<Response> = () =>
      jsonResponse({ ok: false, code: "not_found", message: "Prioridade não encontrada." }, 404);
    stubFetch(() => respond());
    const user = setup();
    const alta = row("Alta");

    await typeDuration(user, alta, "1ª resposta", "2", "0");
    await user.click(within(alta).getByRole("button", { name: "Salvar" }));
    expect(await within(alta).findByRole("alert")).toHaveTextContent("Prioridade não encontrada.");

    respond = () => Promise.reject(new TypeError("Failed to fetch"));
    await user.click(within(alta).getByRole("button", { name: "Salvar" }));
    await waitFor(() =>
      expect(within(alta).getByRole("alert")).toHaveTextContent(
        "Não foi possível salvar o SLA. Confira a conexão e tente de novo."
      )
    );
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("dois cliques em Salvar antes de o botão desabilitar gravam uma vez só", async () => {
    let release: (response: Response) => void = () => {};
    const fetchMock = stubFetch(
      () =>
        new Promise<Response>((resolve) => {
          release = resolve;
        })
    );
    const user = setup();
    const alta = row("Alta");

    await typeDuration(user, alta, "1ª resposta", "2", "30");
    const save = within(alta).getByRole("button", { name: "Salvar" });
    // No mesmo tique: o React ainda não desenhou o `disabled` do 1º envio.
    act(() => {
      fireEvent.click(save);
      fireEvent.click(save);
    });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await act(async () =>
      release(jsonResponse({ ok: true, item: { ...ALTA, first_response_minutes: 150 } }))
    );
    await waitFor(() => expect(refreshMock).toHaveBeenCalledTimes(1));
    // Depois da resposta: o 2º envio, se saísse, já teria passado pelo resolver.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(toastMock.success).toHaveBeenCalledTimes(1);
  });

  it("valor novo do servidor atualiza só o que mudou e guarda o que está sendo digitado", async () => {
    const fetchMock = stubFetch(() => jsonResponse({ ok: true, item: ALTA }));
    const { rerender } = render(<SlaPoliciesManager policies={POLICIES} />);
    const user = userEvent.setup();
    const hours = (name: string) => duration(row(name), "1ª resposta").hours;

    // Digitação em curso noutra linha e noutro campo da linha que vai mudar.
    await user.clear(hours("Baixa"));
    await user.type(hours("Baixa"), "5");
    const warn = within(row("Alta")).getByLabelText("Aviso em");
    await user.clear(warn);
    await user.type(warn, "75");

    // Outra aba mudou a 1ª resposta de Alta (1 h → 2 h) e o refresh a traz.
    rerender(<SlaPoliciesManager policies={refreshed("alta", { first_response_minutes: 120 })} />);

    expect(hours("Alta")).toHaveValue("2");
    expect(warn).toHaveValue("75");
    expect(hours("Baixa")).toHaveValue("5");

    // O que foi digitado continua sendo a mudança: vai só ele.
    await user.click(within(row("Alta")).getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(requestOf(fetchMock).body).toEqual({ warn_pct: 75 });
  });

  it("salvar pelo Enter deixa o foco no campo quando a página relida chega", async () => {
    stubFetch(() => jsonResponse({ ok: true, item: { ...ALTA, warn_pct: 70 } }));
    const { rerender } = render(<SlaPoliciesManager policies={POLICIES} />);
    const user = userEvent.setup();

    const warn = within(row("Alta")).getByLabelText("Aviso em");
    await user.clear(warn);
    await user.type(warn, "70{Enter}");
    await waitFor(() => expect(refreshMock).toHaveBeenCalledTimes(1));

    rerender(<SlaPoliciesManager policies={refreshed("alta", { warn_pct: 70 })} />);

    // A linha não remonta: o mesmo campo continua na tela e com o foco.
    expect(warn).toBeInTheDocument();
    expect(warn).toHaveFocus();
    expect(warn).toHaveValue("70");
  });

  it("depois de salvar, a linha não envia de novo até a página relida chegar", async () => {
    const fetchMock = stubFetch(() => jsonResponse({ ok: true, item: { ...ALTA, warn_pct: 70 } }));
    // O refresh preso: a transição fica pendente, como no app enquanto a
    // página relida não chega.
    let arrive: () => void = () => {};
    refreshMock.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        arrive = resolve;
      })
    );
    const { rerender } = render(<SlaPoliciesManager policies={POLICIES} />);
    const user = userEvent.setup();
    const alta = row("Alta");
    const save = within(alta).getByRole("button", { name: "Salvar" });

    const warn = within(alta).getByLabelText("Aviso em");
    await user.clear(warn);
    await user.type(warn, "70{Enter}");
    await waitFor(() => expect(refreshMock).toHaveBeenCalledTimes(1));

    // Outra mudança no intervalo: o Salvar segue travado e o Enter não envia.
    await typeDuration(user, alta, "Solução", "10", "0");
    expect(alta).toHaveAttribute("aria-busy", "true");
    expect(save).toBeDisabled();
    await user.type(duration(alta, "Solução").minutes, "{Enter}");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // A página relida chega: a mudança do intervalo fica e pode ir.
    await act(async () => arrive());
    rerender(<SlaPoliciesManager policies={refreshed("alta", { warn_pct: 70 })} />);
    expect(duration(alta, "Solução").hours).toHaveValue("10");
    expect(save).toBeEnabled();
    await user.click(save);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(requestOf(fetchMock, 1).body).toEqual({ resolution_minutes: 600 });
  });

  it("leitura que falhou (null) diz que falhou e oferece Tentar de novo", async () => {
    const user = setup(null);

    expect(screen.getByText("Não foi possível carregar os prazos de SLA.")).toBeInTheDocument();
    expect(screen.queryByRole("form")).not.toBeInTheDocument();
    // O aviso continua: ele vale para a tela, não para a leitura.
    expect(screen.getByText(/Vale para tickets abertos daqui em diante/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Tentar de novo" }));
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });
});
