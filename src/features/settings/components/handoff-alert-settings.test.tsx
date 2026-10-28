import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { refreshMock, toastMock } = vi.hoisted(() => ({
  refreshMock: vi.fn(),
  toastMock: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: refreshMock }),
}));
vi.mock("sonner", () => ({ toast: toastMock }));

import { HandoffAlertSettings } from "@/features/settings/components/handoff-alert-settings";

const GROUP = "120363000000000001@g.us";
const EMPTY = { number: null, groupJid: null, groupName: null };

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  fetchMock = vi.fn(async (url: string) =>
    String(url).startsWith("/api/connection/groups")
      ? Response.json({ ok: true, connected: true, groups: [{ jid: GROUP, name: "Equipe de suporte" }] })
      : Response.json({ ok: true, number: "sent", group: "off" })
  );
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("HandoffAlertSettings", () => {
  it("salvo: o telefone formatado, o grupo pelo nome e o teste liberado; a lista de grupos chega sozinha", async () => {
    render(<HandoffAlertSettings config={{ number: "5586999990000", groupJid: GROUP, groupName: "Equipe" }} />);

    expect(screen.getByLabelText("Telefone da equipe")).toHaveValue("(86) 99999-0000");
    expect(screen.getByRole("button", { name: "Salvar" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Enviar teste" })).toBeEnabled();
    await waitFor(() => expect(screen.getByText("Os grupos em que o WhatsApp do CRM está.")).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledWith("/api/connection/groups", { cache: "no-store" });
  });

  it("telefone novo: salva o que foi digitado, e o teste espera o save", async () => {
    const user = userEvent.setup();
    render(<HandoffAlertSettings config={EMPTY} />);

    await user.type(screen.getByLabelText("Telefone da equipe"), "86 99999-0000");
    expect(screen.getByRole("button", { name: "Enviar teste" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Salvar" }));

    const save = fetchMock.mock.calls.find(([url]) => url === "/api/settings/handoff-alert");
    expect(JSON.parse(String((save?.[1] as RequestInit).body))).toStrictEqual({
      number: "86 99999-0000",
      group_jid: "",
      group_name: "",
    });
    expect(refreshMock).toHaveBeenCalled();
  });

  it("telefone inválido: avisa e não deixa salvar", async () => {
    const user = userEvent.setup();
    render(<HandoffAlertSettings config={EMPTY} />);

    await user.type(screen.getByLabelText("Telefone da equipe"), "9999");

    expect(screen.getByText("Telefone inválido: use DDD + número.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Salvar" })).toBeDisabled();
  });

  it("Enviar teste: diz para onde saiu", async () => {
    const user = userEvent.setup();
    render(<HandoffAlertSettings config={{ number: "5586999990000", groupJid: null, groupName: null }} />);

    await user.click(screen.getByRole("button", { name: "Enviar teste" }));

    await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith("Teste enviado ao telefone."));
  });
});
