import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  LeadEditPanel,
  type EditableLead,
} from "@/features/leads/components/lead-edit-panel";

const { refreshMock, successMock, errorMock } = vi.hoisted(() => ({
  refreshMock: vi.fn(),
  successMock: vi.fn(),
  errorMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

vi.mock("sonner", () => ({
  toast: { success: successMock, error: errorMock },
}));

function editableLead(phone: string | null = "5586999999999"): EditableLead {
  return {
    id: "8dfa29f0-9851-4b67-8b87-2d654587fe43",
    name: "João da Silva",
    phone,
    instagram_user: null,
    email: "joao@example.com",
    status: "agendado",
    source: "whatsapp",
    tipo_ensaio: "consulta",
    valor_estimado: 650,
    is_recorrente: false,
    interesse: "Consulta",
    notes: "Retorno em agosto",
  };
}

describe("LeadEditPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("salva pelo mesmo contrato usado em Leads e Funil", async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ ok: true }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <LeadEditPanel
        lead={editableLead()}
        onSaved={onSaved}
        onCancel={vi.fn()}
      />
    );

    const name = screen.getByLabelText("Nome");
    await user.clear(name);
    await user.type(name, "João Atualizado");
    await user.click(screen.getByRole("button", { name: "Salvar alterações" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const payload = JSON.parse(String(init.body)) as Record<string, unknown>;

    expect(url).toBe("/api/leads/8dfa29f0-9851-4b67-8b87-2d654587fe43");
    expect(init.method).toBe("PATCH");
    expect(payload.name).toBe("João Atualizado");
    expect(payload).not.toHaveProperty("phone");
    expect(payload).not.toHaveProperty("status");
    expect(onSaved).toHaveBeenCalledWith({ notes: "Retorno em agosto" });
    expect(refreshMock).toHaveBeenCalledOnce();
    expect(successMock).toHaveBeenCalledWith("Lead atualizado.");
  });

  it("permite editar pessoa originalmente sem telefone", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ ok: true }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <LeadEditPanel
        lead={editableLead(null)}
        onSaved={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    await user.click(screen.getByRole("button", { name: "Salvar alterações" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const payload = JSON.parse(String(init.body)) as Record<string, unknown>;

    expect(payload).not.toHaveProperty("phone");
  });
});
