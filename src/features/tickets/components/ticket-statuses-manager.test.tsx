import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { refreshMock, toastMock } = vi.hoisted(() => ({
  refreshMock: vi.fn(),
  toastMock: { success: vi.fn(), error: vi.fn() },
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: refreshMock }) }));
vi.mock("sonner", () => ({ toast: toastMock }));

import { getColorStyle } from "@/features/tags/schemas/colors";
import { TicketStatusesManager } from "@/features/tickets/components/ticket-statuses-manager";
import type { TicketStatusOption } from "@/features/tickets/types";

// A semente da migration, fora da ordem de propósito: a tela ordena por position.
const STATUSES: TicketStatusOption[] = [
  { key: "resolvido", label: "Resolvido", color: "emerald", position: 60, sla_mode: "stopped", is_terminal: false },
  { key: "novo", label: "Novo", color: "sky", position: 10, sla_mode: "running", is_terminal: false },
  { key: "em_triagem", label: "Em triagem", color: "violet", position: 20, sla_mode: "running", is_terminal: false },
  { key: "em_atendimento", label: "Em atendimento", color: "blue", position: 30, sla_mode: "running", is_terminal: false },
  { key: "aguardando_cliente", label: "Aguardando cliente", color: "amber", position: 40, sla_mode: "paused", is_terminal: false },
  { key: "aguardando_interno", label: "Aguardando interno", color: "orange", position: 50, sla_mode: "running", is_terminal: false },
  { key: "fechado", label: "Fechado", color: "slate", position: 70, sla_mode: "stopped", is_terminal: true },
  { key: "cancelado", label: "Cancelado", color: "gray", position: 80, sla_mode: "stopped", is_terminal: true },
];

const NOVO = STATUSES[1];
const EM_ATENDIMENTO = STATUSES[3];

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

function setup(statuses: TicketStatusOption[] | null = STATUSES) {
  render(<TicketStatusesManager statuses={statuses} />);
  return userEvent.setup();
}

function row(label: string) {
  return screen.getByRole("form", { name: `Status ${label}` });
}

function preview(form: HTMLElement) {
  const group = within(form).getByRole("group", { name: "Prévia" });
  const badge = group.querySelector<HTMLElement>('[data-slot="badge"]');
  if (!badge) throw new Error("sem selo na prévia");
  return badge;
}

/** O selo pinta com TODAS as classes da cor na paleta (features/tags/schemas/colors.ts). */
function hasColor(badge: HTMLElement, color: string) {
  return getColorStyle(color)
    .badge.split(" ")
    .every((name) => badge.classList.contains(name));
}

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("TicketStatusesManager", () => {
  it("mostra os 8 status na ordem de position, com relógio e encerramento só de leitura", () => {
    setup();

    expect(screen.getAllByRole("form").map((form) => form.getAttribute("aria-label"))).toEqual([
      "Status Novo",
      "Status Em triagem",
      "Status Em atendimento",
      "Status Aguardando cliente",
      "Status Aguardando interno",
      "Status Resolvido",
      "Status Fechado",
      "Status Cancelado",
    ]);

    const aguardando = row("Aguardando cliente");
    expect(within(aguardando).getByText("Relógio do SLA:").nextElementSibling).toHaveTextContent("Pausado");
    expect(within(aguardando).getByText("Encerra o ticket:").nextElementSibling).toHaveTextContent("Não");

    const fechado = row("Fechado");
    expect(within(fechado).getByText("Relógio do SLA:").nextElementSibling).toHaveTextContent("Parado");
    expect(within(fechado).getByText("Encerra o ticket:").nextElementSibling).toHaveTextContent("Sim");

    expect(within(row("Novo")).getByText("Relógio do SLA:").nextElementSibling).toHaveTextContent(
      "Correndo"
    );
    // Só rótulo e cor se editam: nenhum campo para o modo nem para o encerramento.
    expect(within(fechado).getAllByRole("textbox")).toHaveLength(1);
  });

  it("a prévia do selo acompanha o rótulo e a cor que estão sendo editados", async () => {
    const user = setup();
    const novo = row("Novo");

    expect(preview(novo)).toHaveTextContent("Novo");
    expect(hasColor(preview(novo), "sky")).toBe(true);

    const label = within(novo).getByLabelText("Rótulo");
    await user.clear(label);
    await user.type(label, "Aberto");
    await user.click(within(novo).getByRole("radio", { name: "violet" }));

    expect(preview(novo)).toHaveTextContent("Aberto");
    expect(hasColor(preview(novo), "violet")).toBe(true);
    expect(hasColor(preview(novo), "sky")).toBe(false);
  });

  it("manda só o que mudou (a cor) para a chave do status", async () => {
    const fetchMock = stubFetch(() => jsonResponse({ ok: true, item: { ...NOVO, color: "violet" } }));
    const user = setup();
    const novo = row("Novo");
    const save = within(novo).getByRole("button", { name: "Salvar" });

    expect(save).toBeDisabled();
    await user.click(within(novo).getByRole("radio", { name: "violet" }));
    await user.click(save);

    await waitFor(() => expect(refreshMock).toHaveBeenCalledTimes(1));
    expect(requestOf(fetchMock)).toEqual({
      url: "/api/ticket-statuses/novo",
      method: "PATCH",
      body: { color: "violet" },
    });
    expect(toastMock.success).toHaveBeenCalledWith("Status «Novo» salvo.");
    expect(within(novo).getByRole("button", { name: "Salvar" })).toBeDisabled();
  });

  it("rótulo vai aparado, sem a cor que não mudou", async () => {
    const fetchMock = stubFetch(() => jsonResponse({ ok: true, item: { ...NOVO, label: "Aberto" } }));
    const user = setup();
    const novo = row("Novo");

    const label = within(novo).getByLabelText("Rótulo");
    await user.clear(label);
    await user.type(label, "  Aberto ");
    await user.click(within(novo).getByRole("button", { name: "Salvar" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(requestOf(fetchMock).body).toEqual({ label: "Aberto" });
    expect(toastMock.success).toHaveBeenCalledWith("Status «Aberto» salvo.");
  });

  it("409 de rótulo repetido: erro no campo e o status que já o usa", async () => {
    stubFetch(() =>
      jsonResponse(
        {
          ok: false,
          code: "duplicate",
          message: "Já existe um status com este rótulo.",
          errors: { label: ["Já existe um status com este rótulo."] },
          item: EM_ATENDIMENTO,
        },
        409
      )
    );
    const user = setup();
    const novo = row("Novo");

    const label = within(novo).getByLabelText("Rótulo");
    await user.clear(label);
    await user.type(label, "em atendimento");
    await user.click(within(novo).getByRole("button", { name: "Salvar" }));

    const error = await within(novo).findByRole("alert");
    expect(error).toHaveTextContent("Já existe um status com este rótulo.");
    expect(error).toHaveTextContent("Em uso por");
    expect(within(error).getByTitle("Em atendimento")).toHaveTextContent("Em atendimento");
    expect(label).toHaveAttribute("aria-invalid", "true");
    expect(label).toHaveFocus();
    expect(refreshMock).not.toHaveBeenCalled();

    // Mexer no rótulo depois do envio revalida: outro erro no campo não cita o
    // status do 409, e o rótulo válido tira o erro.
    await user.clear(label);
    await user.type(label, "N");
    expect(await within(novo).findByText("Use ao menos 2 caracteres.")).toBeInTheDocument();
    expect(within(novo).queryByText("Em uso por")).not.toBeInTheDocument();
    await user.type(label, "ovo aberto");
    await waitFor(() => expect(within(novo).queryByRole("alert")).not.toBeInTheDocument());
  });

  it("409 sem o item (releitura falhou) mostra só o erro no campo", async () => {
    stubFetch(() =>
      jsonResponse(
        {
          ok: false,
          code: "duplicate",
          message: "Já existe um status com este rótulo.",
          errors: { label: ["Já existe um status com este rótulo."] },
        },
        409
      )
    );
    const user = setup();
    const novo = row("Novo");

    const label = within(novo).getByLabelText("Rótulo");
    await user.clear(label);
    await user.type(label, "Fechado");
    await user.click(within(novo).getByRole("button", { name: "Salvar" }));

    expect(await within(novo).findByRole("alert")).toHaveTextContent(
      "Já existe um status com este rótulo."
    );
    expect(within(novo).queryByText("Em uso por")).not.toBeInTheDocument();
  });

  it("rótulo curto é recusado antes de enviar", async () => {
    const fetchMock = stubFetch(() => jsonResponse({ ok: true, item: NOVO }));
    const user = setup();
    const novo = row("Novo");

    const label = within(novo).getByLabelText("Rótulo");
    await user.clear(label);
    await user.type(label, "N");
    await user.click(within(novo).getByRole("button", { name: "Salvar" }));

    expect(await within(novo).findByText("Use ao menos 2 caracteres.")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("erro sem campo e falha de rede viram alerta na linha", async () => {
    let respond: () => Response | Promise<Response> = () =>
      jsonResponse({ ok: false, message: "Supabase admin não está configurado neste ambiente." }, 500);
    stubFetch(() => respond());
    const user = setup();
    const novo = row("Novo");

    await user.click(within(novo).getByRole("radio", { name: "violet" }));
    await user.click(within(novo).getByRole("button", { name: "Salvar" }));
    expect(await within(novo).findByRole("alert")).toHaveTextContent(
      "Supabase admin não está configurado neste ambiente."
    );

    respond = () => Promise.reject(new TypeError("Failed to fetch"));
    await user.click(within(novo).getByRole("button", { name: "Salvar" }));
    await waitFor(() =>
      expect(within(novo).getByRole("alert")).toHaveTextContent(
        "Não foi possível salvar o status. Confira a conexão e tente de novo."
      )
    );
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("cor gravada fora da paleta aparece como a de recurso e pode ser trocada", async () => {
    const fetchMock = stubFetch(() => jsonResponse({ ok: true, item: { ...NOVO, color: "violet" } }));
    const user = setup([{ ...NOVO, color: "marrom" }]);
    const novo = row("Novo");

    expect(within(novo).getByRole("radio", { name: "sky" })).toHaveAttribute("aria-checked", "true");
    expect(hasColor(preview(novo), "sky")).toBe(true);

    await user.click(within(novo).getByRole("radio", { name: "violet" }));
    await user.click(within(novo).getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(requestOf(fetchMock).body).toEqual({ color: "violet" });
  });

  it("cor gravada fora da paleta não barra salvar só o rótulo", async () => {
    const fetchMock = stubFetch(() => jsonResponse({ ok: true, item: { ...NOVO, label: "Aberto" } }));
    const user = setup([{ ...NOVO, color: "marrom" }]);
    const novo = row("Novo");

    const label = within(novo).getByLabelText("Rótulo");
    await user.clear(label);
    await user.type(label, "Aberto");
    await user.click(within(novo).getByRole("button", { name: "Salvar" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(requestOf(fetchMock).body).toEqual({ label: "Aberto" });
    expect(within(novo).queryByText("Cor inválida.")).not.toBeInTheDocument();
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
    const novo = row("Novo");

    await user.click(within(novo).getByRole("radio", { name: "violet" }));
    const save = within(novo).getByRole("button", { name: "Salvar" });
    // No mesmo tique: o React ainda não desenhou o `disabled` do 1º envio.
    act(() => {
      fireEvent.click(save);
      fireEvent.click(save);
    });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await act(async () => release(jsonResponse({ ok: true, item: { ...NOVO, color: "violet" } })));
    await waitFor(() => expect(refreshMock).toHaveBeenCalledTimes(1));
    // Depois da resposta: o 2º envio, se saísse, já teria passado pelo resolver.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(toastMock.success).toHaveBeenCalledTimes(1);
  });

  it("valor novo do servidor atualiza só o que mudou e guarda o que está sendo digitado", async () => {
    const fetchMock = stubFetch(() => jsonResponse({ ok: true, item: NOVO }));
    const { rerender } = render(<TicketStatusesManager statuses={[NOVO, EM_ATENDIMENTO]} />);
    const user = userEvent.setup();

    // Digitação em curso noutra linha e noutro campo da linha que vai mudar.
    const other = within(row("Em atendimento")).getByLabelText("Rótulo");
    await user.clear(other);
    await user.type(other, "Atendendo");
    await user.click(within(row("Novo")).getByRole("radio", { name: "violet" }));

    // Outra aba renomeou Novo para Aberto e o refresh traz o rótulo novo.
    rerender(<TicketStatusesManager statuses={[{ ...NOVO, label: "Aberto" }, EM_ATENDIMENTO]} />);

    const aberto = row("Aberto");
    expect(within(aberto).getByLabelText("Rótulo")).toHaveValue("Aberto");
    expect(within(aberto).getByRole("radio", { name: "violet" })).toHaveAttribute(
      "aria-checked",
      "true"
    );
    expect(other).toHaveValue("Atendendo");

    // O que foi escolhido continua sendo a mudança: vai só ele.
    await user.click(within(aberto).getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(requestOf(fetchMock).body).toEqual({ color: "violet" });
  });

  it("salvar pelo Enter deixa o foco no campo quando a página relida chega", async () => {
    stubFetch(() => jsonResponse({ ok: true, item: { ...NOVO, label: "Recebido" } }));
    const { rerender } = render(<TicketStatusesManager statuses={[NOVO, EM_ATENDIMENTO]} />);
    const user = userEvent.setup();

    const label = within(row("Novo")).getByLabelText("Rótulo");
    await user.clear(label);
    await user.type(label, "Recebido{Enter}");
    await waitFor(() => expect(refreshMock).toHaveBeenCalledTimes(1));

    rerender(<TicketStatusesManager statuses={[{ ...NOVO, label: "Recebido" }, EM_ATENDIMENTO]} />);

    // A linha não remonta: o mesmo campo continua na tela e com o foco.
    expect(row("Recebido")).toContainElement(label);
    expect(label).toHaveFocus();
    expect(label).toHaveValue("Recebido");
  });

  it("depois de salvar, a linha não envia de novo até a página relida chegar", async () => {
    const fetchMock = stubFetch(() => jsonResponse({ ok: true, item: { ...NOVO, label: "Aberto" } }));
    // O refresh preso: a transição fica pendente, como no app enquanto a
    // página relida não chega.
    let arrive: () => void = () => {};
    refreshMock.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        arrive = resolve;
      })
    );
    const { rerender } = render(<TicketStatusesManager statuses={[NOVO, EM_ATENDIMENTO]} />);
    const user = userEvent.setup();
    const novo = row("Novo");
    const save = within(novo).getByRole("button", { name: "Salvar" });

    const label = within(novo).getByLabelText("Rótulo");
    await user.clear(label);
    await user.type(label, "Aberto{Enter}");
    await waitFor(() => expect(refreshMock).toHaveBeenCalledTimes(1));

    // Outra mudança no intervalo: o Salvar segue travado e o Enter não envia.
    await user.click(within(novo).getByRole("radio", { name: "violet" }));
    expect(novo).toHaveAttribute("aria-busy", "true");
    expect(save).toBeDisabled();
    await user.type(label, "{Enter}");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // A página relida chega: a mudança do intervalo fica e pode ir.
    await act(async () => arrive());
    rerender(<TicketStatusesManager statuses={[{ ...NOVO, label: "Aberto" }, EM_ATENDIMENTO]} />);
    expect(within(novo).getByRole("radio", { name: "violet" })).toHaveAttribute(
      "aria-checked",
      "true"
    );
    expect(save).toBeEnabled();
    await user.click(save);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(requestOf(fetchMock, 1).body).toEqual({ color: "violet" });
  });

  it("leitura que falhou (null) diz que falhou e oferece Tentar de novo", async () => {
    const user = setup(null);

    expect(screen.getByText("Não foi possível carregar os status.")).toBeInTheDocument();
    expect(screen.queryByRole("form")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Tentar de novo" }));
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });
});
