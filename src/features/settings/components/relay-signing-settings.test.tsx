import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
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

import { RelaySigningSettings } from "@/features/settings/components/relay-signing-settings";

// O bloco da chave de assinatura no DESKTOP (caixa do Base UI). A gaveta do
// celular está em relay-signing-settings.mobile.test.tsx.

const ENDPOINT = "/api/connection/agent/signing-secret";
const SECRET = "9f2c4e6a8b0d1f3a5c7e9b1d3f5a7c9e0b2d4f6a8c0e1b3d5f7a9c1e3b5d7f90";
const OTHER_SECRET = "0a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f9";
const STAMP = "2026-10-01T12:00:00.123456+00:00";
const OTHER_STAMP = "2026-10-01T12:30:00.654321+00:00";
const absent = { state: "absent" } as const;
const configured = { state: "configured", updatedAt: STAMP } as const;
const unreadable = { state: "unreadable" } as const;

const GENERATE = "O CRM passa a assinar os pedidos ao agente com ela.";
const ROTATE = "Ao confirmar, a chave atual deixa de valer.";
const REMOVE = "Os pedidos ao agente passam a sair sem assinatura.";
const REMOVED = "Chave removida: os pedidos ao agente passam a sair sem assinatura.";
const UNKNOWN =
  "Não foi possível confirmar se a operação foi feita. Releia o estado da chave antes de tentar de novo.";
const UNCONFIRMED = "Não foi possível confirmar a última operação: o estado da chave pode ter mudado.";
const STALE = "A chave mudou depois que esta tela foi carregada. Confira o estado e tente de novo.";

let fetchMock: ReturnType<typeof vi.fn>;
const originalMatchMedia = window.matchMedia;

// O Dialog decide entre caixa e gaveta pela largura: neste arquivo, desktop.
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

beforeEach(() => {
  vi.clearAllMocks();
  fetchMock = vi.fn(async () => Response.json({ ok: true, secret: SECRET, message: "Chave gerada." }));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const button = (name: string) => screen.getByRole("button", { name });
/** O botão do rodapé do diálogo: o da página, de mesmo nome, fica atrás dele. */
const confirm = (name: string) => screen.getAllByRole("button", { name }).at(-1) as HTMLElement;
const dialogs = () => screen.queryAllByRole("dialog");
const closed = () => waitFor(() => expect(dialogs()).toHaveLength(0));
const overlay = () => document.querySelector('[data-slot="dialog-overlay"]') as HTMLElement;
/** Um pedido que só responde quando o teste manda. */
function gated() {
  let release: (response: Response) => void = () => undefined;
  fetchMock.mockImplementation(() => new Promise<Response>((resolve) => (release = resolve)));
  return (response: Response) => release(response);
}
const request = (method: "POST" | "DELETE", body: unknown) => [
  ENDPOINT,
  {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: expect.any(AbortSignal),
  },
];

type User = ReturnType<typeof userEvent.setup>;
/** Abre a confirmação de gerar a primeira chave e confirma. */
async function generateFirst(user: User) {
  await user.click(button("Gerar chave"));
  await screen.findByText(GENERATE);
  await user.click(confirm("Gerar chave"));
}
async function rotate(user: User) {
  await user.click(button("Gerar nova chave"));
  await screen.findByText(ROTATE);
  await user.click(confirm("Gerar nova chave"));
}
async function remove(user: User) {
  await user.click(button("Remover chave"));
  await screen.findByText(REMOVE);
  await user.click(confirm("Remover chave"));
}

describe("RelaySigningSettings: o estado", () => {
  it("sem chave: avisa que os pedidos saem sem assinatura, e só oferece gerar", () => {
    render(<RelaySigningSettings signing={absent} />);

    expect(screen.getByText("Sem chave — os pedidos ao agente saem sem assinatura.")).toBeInTheDocument();
    expect(button("Gerar chave")).toBeEnabled();
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(dialogs()).toHaveLength(0);
  });

  it("com chave: diz desde quando (no fuso do app), e oferece trocar e remover", () => {
    render(<RelaySigningSettings signing={configured} />);

    expect(
      screen.getByText("Gerada em 01/10/2026 09:00 — os pedidos ao agente saem assinados.")
    ).toBeInTheDocument();
    expect(button("Gerar nova chave")).toBeEnabled();
    expect(button("Remover chave")).toBeEnabled();
    expect(screen.getAllByRole("button")).toHaveLength(2);
    expect(screen.queryByText(/Sem chave/)).not.toBeInTheDocument();
  });

  it("cofre ilegível: não diz `sem chave`, não oferece gerar, trocar nem remover; só tentar de novo", async () => {
    const user = userEvent.setup();
    render(<RelaySigningSettings signing={unreadable} />);

    expect(screen.getByText("Não foi possível ler o cofre agora.")).toBeInTheDocument();
    expect(screen.queryByText(/Sem chave/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Gerada em/)).not.toBeInTheDocument();
    expect(screen.getAllByRole("button")).toHaveLength(1);

    await user.click(button("Tentar de novo"));

    // Relê o estado sem recarregar a página (recarregar voltaria para a aba Variáveis).
    expect(refreshMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("RelaySigningSettings: gerar a primeira chave", () => {
  it("pede confirmação antes, dizendo que a chave aparece uma vez; Cancelar não gera nada", async () => {
    const user = userEvent.setup();
    render(<RelaySigningSettings signing={absent} />);

    await user.click(button("Gerar chave"));

    expect(await screen.findByText(GENERATE)).toBeInTheDocument();
    // O título diz qual das três ações está sendo confirmada.
    expect(screen.getByRole("dialog", { name: "Gerar chave" })).toBeInTheDocument();
    expect(screen.getByText(/A chave aparece uma única vez, aqui\./)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();

    await user.click(button("Cancelar"));

    await closed();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("confirmada, gera sem pedir troca e mostra a chave no mesmo diálogo", async () => {
    const user = userEvent.setup();
    render(<RelaySigningSettings signing={absent} />);

    await generateFirst(user);

    expect(fetchMock.mock.calls).toEqual([request("POST", { replace: false })]);
    expect(await screen.findByRole("dialog", { name: "Chave gerada" })).toBeInTheDocument();
    expect(screen.getByText(SECRET)).toBeInTheDocument();
    expect(screen.getByText(/ela não será exibida novamente/)).toBeInTheDocument();
    // Sem modal sobre modal: a confirmação deu lugar à chave.
    expect(dialogs()).toHaveLength(1);
    expect(screen.queryByText(GENERATE)).not.toBeInTheDocument();
    expect(toastMock.error).not.toHaveBeenCalled();
  });

  it("com a chave à vista o estado NÃO é relido (um refresh pode recarregar a página e levar a chave); só ao fechar", async () => {
    const user = userEvent.setup();
    render(<RelaySigningSettings signing={absent} />);

    await generateFirst(user);
    await screen.findByText(SECRET);
    expect(refreshMock).not.toHaveBeenCalled();

    await user.click(button("Concluir"));

    await closed();
    expect(refreshMock).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).not.toContain(SECRET);
  });

  it("o estado muda por baixo do diálogo (outro refresh chegou): a chave gerada continua na tela", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<RelaySigningSettings signing={absent} />);

    await generateFirst(user);
    await screen.findByText(SECRET);
    rerender(<RelaySigningSettings signing={{ ...configured }} />);
    expect(screen.getByText(SECRET)).toBeInTheDocument();
    rerender(<RelaySigningSettings signing={{ ...unreadable }} />);

    expect(screen.getByText(SECRET)).toBeInTheDocument();
    expect(dialogs()).toHaveLength(1);
  });

  it("o pedido tem prazo de 30 s: com ele em curso o diálogo não fecha, e não pode ficar preso", async () => {
    const user = userEvent.setup();
    const timeout = vi.spyOn(AbortSignal, "timeout");
    render(<RelaySigningSettings signing={absent} />);

    await generateFirst(user);

    expect(timeout).toHaveBeenCalledWith(30_000);
    expect((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].signal).toBe(
      timeout.mock.results.at(-1)?.value
    );
    timeout.mockRestore();
  });

  it("copiar leva a chave para a área de transferência", async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, "writeText");
    render(<RelaySigningSettings signing={absent} />);

    await generateFirst(user);
    await user.click(await screen.findByRole("button", { name: "Copiar chave" }));

    expect(writeText).toHaveBeenCalledWith(SECRET);
    expect(toastMock.success).toHaveBeenCalledWith("Chave copiada.");
  });

  it("se a cópia falha, avisa para copiar à mão", async () => {
    const user = userEvent.setup();
    vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(new Error("negado"));
    render(<RelaySigningSettings signing={absent} />);

    await generateFirst(user);
    await user.click(await screen.findByRole("button", { name: "Copiar chave" }));

    expect(toastMock.error).toHaveBeenCalledWith("Não foi possível copiar. Selecione e copie manualmente.");
    expect(toastMock.success).not.toHaveBeenCalled();
  });

  it("depois de gerar, o foco vai para o botão de copiar (o que confirmava saiu da tela)", async () => {
    const user = userEvent.setup();
    render(<RelaySigningSettings signing={absent} />);

    await generateFirst(user);
    await screen.findByText(SECRET);

    await waitFor(() => expect(button("Copiar chave")).toHaveFocus());
  });

  it("com o pedido em curso, nada fecha o diálogo nem dispara outro: a chave aparece para quem a pediu", async () => {
    const user = userEvent.setup();
    const release = gated();
    render(<RelaySigningSettings signing={absent} />);

    await generateFirst(user);

    expect(confirm("Gerar chave")).toBeDisabled();
    expect(button("Cancelar")).toBeDisabled();
    await user.click(confirm("Gerar chave"));
    await user.click(button("Cancelar"));
    await user.keyboard("{Escape}");
    await user.click(button("Fechar"));
    await user.click(overlay());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.getByText(GENERATE)).toBeInTheDocument();

    release(Response.json({ ok: true, secret: SECRET }));

    expect(await screen.findByText(SECRET)).toBeInTheDocument();
    expect(dialogs()).toHaveLength(1);
  });

  it("com a chave à vista: um clique fora NÃO fecha (ela só aparece uma vez); Esc fecha", async () => {
    const user = userEvent.setup();
    render(<RelaySigningSettings signing={absent} />);

    await generateFirst(user);
    await screen.findByText(SECRET);
    await user.click(overlay());
    expect(screen.getByText(SECRET)).toBeInTheDocument();

    await user.keyboard("{Escape}");
    await closed();
    expect(document.body.textContent).not.toContain(SECRET);
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it("o X também fecha a chave e relê o estado", async () => {
    const user = userEvent.setup();
    render(<RelaySigningSettings signing={absent} />);

    await generateFirst(user);
    await screen.findByText(SECRET);
    await user.click(button("Fechar"));

    await closed();
    expect(document.body.textContent).not.toContain(SECRET);
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it("já existia chave (409): avisa com o motivo do servidor, fecha e relê o estado, sem mostrar chave nenhuma", async () => {
    const user = userEvent.setup();
    const message = "Já existe uma chave de assinatura. Para trocá-la, use Gerar nova chave.";
    fetchMock.mockResolvedValue(Response.json({ ok: false, message }, { status: 409 }));
    render(<RelaySigningSettings signing={absent} />);

    await generateFirst(user);

    expect(toastMock.error.mock.calls).toEqual([[message]]);
    await closed();
    expect(refreshMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(UNCONFIRMED)).not.toBeInTheDocument();
  });

  it.each([
    [400, { ok: false, message: "Pedido inválido." }, "Pedido inválido."],
    [403, { ok: false, message: "Apenas administradores podem executar esta ação." }, "Apenas administradores podem executar esta ação."],
    [499, { ok: false, message: "O pedido foi encerrado." }, "O pedido foi encerrado."],
    // O proxy responde 401 sem `message`: a sessão expirou, e nada foi feito.
    [401, { ok: false, error: "unauthorized" }, "Sua sessão expirou. Entre de novo."],
    [413, { ok: false }, "O pedido foi recusado."],
  ])("recusa (%i): nada foi feito; mostra o motivo, fecha e relê o estado", async (status, body, message) => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(Response.json(body, { status }));
    render(<RelaySigningSettings signing={absent} />);

    await generateFirst(user);

    expect(toastMock.error.mock.calls).toEqual([[message]]);
    await closed();
    expect(refreshMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(UNCONFIRMED)).not.toBeInTheDocument();
    expect(button("Gerar chave")).toBeEnabled();
  });

  it("erro do servidor que DIZ que nada foi gravado (`applied: false`): mostra o motivo, e não o aviso de desfecho desconhecido", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(
      Response.json({ ok: false, message: "Não foi possível gerar a chave.", applied: false }, { status: 500 })
    );
    render(<RelaySigningSettings signing={absent} />);

    await generateFirst(user);

    expect(toastMock.error.mock.calls).toEqual([["Não foi possível gerar a chave."]]);
    await closed();
    expect(refreshMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(UNCONFIRMED)).not.toBeInTheDocument();
  });

  it.each([
    ["o servidor falha (500) sem dizer se gravou", async () => Response.json({ ok: false, message: "Não foi possível gerar a chave." }, { status: 500 })],
    ["`applied: true` num erro não é a marca de nada gravado", async () => Response.json({ ok: false, message: "x", applied: true }, { status: 500 })],
    ["um proxy responde 502 sem JSON", async () => new Response("<html>bad gateway</html>", { status: 502 })],
    ["o pedido não volta (rede)", () => Promise.reject(new TypeError("fetch failed"))],
    ["o pedido estoura o prazo", () => Promise.reject(new DOMException("timeout", "TimeoutError"))],
    ["a resposta 200 não é JSON", async () => new Response("<html>proxy</html>", { status: 200 })],
    ["a resposta diz ok, mas não traz a chave", async () => Response.json({ ok: true })],
    ["a resposta traz a chave, mas o status é de erro", async () => Response.json({ ok: true, secret: SECRET }, { status: 502 })],
    ["o status é 200, mas a resposta diz que falhou", async () => Response.json({ ok: false, secret: SECRET, message: "x" })],
  ])("desfecho desconhecido (%s): não diz que falhou, não relê sozinho, e o bloco só oferece reler", async (_label, respond) => {
    const user = userEvent.setup();
    fetchMock.mockImplementation(respond);
    render(<RelaySigningSettings signing={absent} />);

    await generateFirst(user);

    await waitFor(() => expect(toastMock.error.mock.calls).toEqual([[UNKNOWN]]));
    await closed();
    expect(document.body.textContent).not.toContain(SECRET);
    // Com a rede fora do ar, um refresh recarregaria a página e levaria o aviso junto.
    expect(refreshMock).not.toHaveBeenCalled();
    // A chave pode ter sido gravada: a tela não afirma "sem chave", nem oferece gerar de novo às cegas.
    expect(screen.getByText(UNCONFIRMED)).toBeInTheDocument();
    expect(screen.queryByText(/Sem chave/)).not.toBeInTheDocument();
    expect(screen.getAllByRole("button")).toHaveLength(1);

    await user.click(button("Tentar de novo"));
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it("depois do desfecho desconhecido, o estado relido (um refresh chegou) devolve o bloco ao normal", async () => {
    const user = userEvent.setup();
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    const { rerender } = render(<RelaySigningSettings signing={absent} />);

    await generateFirst(user);
    await screen.findByText(UNCONFIRMED);
    // O mesmo objeto de novo não é um estado novo: o aviso fica.
    rerender(<RelaySigningSettings signing={absent} />);
    expect(screen.getByText(UNCONFIRMED)).toBeInTheDocument();

    // A gravação tinha acontecido: o refresh traz a chave que ninguém viu.
    rerender(<RelaySigningSettings signing={{ ...configured }} />);

    expect(screen.queryByText(UNCONFIRMED)).not.toBeInTheDocument();
    expect(screen.getByText(/Gerada em 01\/10\/2026 09:00/)).toBeInTheDocument();
    expect(button("Gerar nova chave")).toBeEnabled();
  });
});

describe("RelaySigningSettings: trocar", () => {
  it("pede confirmação antes, dizendo o que muda; Cancelar não gera nada", async () => {
    const user = userEvent.setup();
    render(<RelaySigningSettings signing={configured} />);

    await user.click(button("Gerar nova chave"));

    expect(await screen.findByText(ROTATE)).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Gerar nova chave" })).toBeInTheDocument();
    expect(screen.getByText(/recusa os pedidos do CRM até receber a chave nova/)).toBeInTheDocument();
    expect(screen.getByText(/não chegam à IA: não há reenvio/)).toBeInTheDocument();
    expect(screen.queryByText(GENERATE)).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();

    await user.click(button("Cancelar"));

    await closed();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("confirmada, pede a TROCA da chave que estava na tela, e mostra a nova no mesmo diálogo", async () => {
    const user = userEvent.setup();
    render(<RelaySigningSettings signing={configured} />);

    await rotate(user);

    // O carimbo da chave vista vai junto: o servidor recusa se ela já não é essa.
    expect(fetchMock.mock.calls).toEqual([request("POST", { replace: true, expectedUpdatedAt: STAMP })]);
    expect(await screen.findByText(SECRET)).toBeInTheDocument();
    expect(dialogs()).toHaveLength(1);
    expect(screen.queryByText(ROTATE)).not.toBeInTheDocument();
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("o carimbo é o de quando a confirmação ABRIU: um estado novo que chega por baixo não é trocado sem ser visto", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<RelaySigningSettings signing={configured} />);

    await user.click(button("Gerar nova chave"));
    await screen.findByText(ROTATE);
    // Outro administrador trocou a chave, e um refresh trouxe a data nova com a confirmação aberta.
    rerender(<RelaySigningSettings signing={{ state: "configured", updatedAt: OTHER_STAMP }} />);
    await user.click(confirm("Gerar nova chave"));

    expect(fetchMock.mock.calls).toEqual([request("POST", { replace: true, expectedUpdatedAt: STAMP })]);
  });

  it("com a troca em curso, nada fecha o diálogo nem dispara outra: a chave nova aparece para quem pediu", async () => {
    const user = userEvent.setup();
    const release = gated();
    render(<RelaySigningSettings signing={configured} />);

    await rotate(user);

    expect(confirm("Gerar nova chave")).toBeDisabled();
    expect(button("Cancelar")).toBeDisabled();
    await user.click(confirm("Gerar nova chave"));
    await user.click(button("Cancelar"));
    await user.keyboard("{Escape}");
    await user.click(button("Fechar"));
    await user.click(overlay());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.getByText(ROTATE)).toBeInTheDocument();

    release(Response.json({ ok: true, secret: SECRET }));

    expect(await screen.findByText(SECRET)).toBeInTheDocument();
    expect(dialogs()).toHaveLength(1);
  });

  it("gera, conclui e troca na mesma tela: o diálogo mostra a chave DESTA resposta, e não a anterior", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<RelaySigningSettings signing={absent} />);

    await generateFirst(user);
    await screen.findByText(SECRET);
    await user.click(button("Concluir"));
    await closed();
    rerender(<RelaySigningSettings signing={{ ...configured }} />);

    fetchMock.mockResolvedValue(Response.json({ ok: true, secret: OTHER_SECRET }));
    await user.click(button("Gerar nova chave"));
    // Depois de uma chave mostrada, o botão pede confirmação: não reabre "Chave gerada".
    expect(await screen.findByText(ROTATE)).toBeInTheDocument();
    expect(screen.queryByText("Chave gerada")).not.toBeInTheDocument();
    await user.click(confirm("Gerar nova chave"));

    expect(await screen.findByText(OTHER_SECRET)).toBeInTheDocument();
    expect(document.body.textContent).not.toContain(SECRET);
  });

  it("fechada a chave, ela sai do estado da tela: cancelar outra confirmação depois não relê o estado de novo", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<RelaySigningSettings signing={absent} />);

    await generateFirst(user);
    await screen.findByText(SECRET);
    await user.click(button("Concluir"));
    await closed();
    expect(refreshMock).toHaveBeenCalledTimes(1);
    rerender(<RelaySigningSettings signing={{ ...configured }} />);

    // Quem relê ao fechar é a chave à vista. Sem chave guardada, cancelar é só fechar.
    await user.click(button("Gerar nova chave"));
    await screen.findByText(ROTATE);
    await user.click(button("Cancelar"));
    await closed();

    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it("tela desatualizada (409): avisa com o motivo do servidor, fecha a confirmação e relê o estado", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(Response.json({ ok: false, message: STALE }, { status: 409 }));
    render(<RelaySigningSettings signing={configured} />);

    await rotate(user);

    expect(toastMock.error.mock.calls).toEqual([[STALE]]);
    await closed();
    expect(refreshMock).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).not.toContain(SECRET);
  });

  it.each([
    ["o servidor falha (500) sem dizer se gravou", async () => Response.json({ ok: false, message: "Não foi possível gerar a chave." }, { status: 500 })],
    ["o pedido não volta (rede)", () => Promise.reject(new TypeError("fetch failed"))],
  ])("desfecho desconhecido (%s): a chave antiga pode já não valer; a tela deixa de afirmar que os pedidos saem assinados com ela", async (_label, respond) => {
    const user = userEvent.setup();
    fetchMock.mockImplementation(respond);
    const { rerender } = render(<RelaySigningSettings signing={configured} />);

    await rotate(user);

    await waitFor(() => expect(toastMock.error.mock.calls).toEqual([[UNKNOWN]]));
    await closed();
    expect(refreshMock).not.toHaveBeenCalled();
    expect(screen.getByText(UNCONFIRMED)).toBeInTheDocument();
    expect(screen.queryByText(/Gerada em/)).not.toBeInTheDocument();
    expect(screen.getAllByRole("button")).toHaveLength(1);

    // Relido o estado, a próxima tentativa parte dele, destravada.
    rerender(<RelaySigningSettings signing={{ state: "configured", updatedAt: OTHER_STAMP }} />);
    await user.click(button("Gerar nova chave"));
    expect(confirm("Gerar nova chave")).toBeEnabled();
  });

  it("um clique fora ou o X fecham a confirmação, sem gerar nada", async () => {
    const user = userEvent.setup();
    render(<RelaySigningSettings signing={configured} />);

    await user.click(button("Gerar nova chave"));
    await screen.findByText(ROTATE);
    await user.click(button("Fechar"));
    await closed();

    await user.click(button("Gerar nova chave"));
    await screen.findByText(ROTATE);
    await user.click(overlay());
    await closed();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(refreshMock).not.toHaveBeenCalled();
  });
});

describe("RelaySigningSettings: remover", () => {
  beforeEach(() => {
    fetchMock.mockImplementation(async () => Response.json({ ok: true, message: REMOVED }));
  });

  it("pede confirmação antes, dizendo o que muda; Cancelar não remove", async () => {
    const user = userEvent.setup();
    render(<RelaySigningSettings signing={configured} />);

    await user.click(button("Remover chave"));

    // "Sem assinatura" aqui é a do pedido ao agente, e não a das mensagens da IA.
    expect(await screen.findByText(REMOVE)).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Remover chave" })).toBeInTheDocument();
    expect(screen.getByText(/passa a recusá-los/)).toBeInTheDocument();
    expect(screen.getByText(/não chegam à IA: não há reenvio/)).toBeInTheDocument();

    await user.click(button("Cancelar"));

    await closed();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("confirmada, remove a chave que estava na tela, avisa com a mensagem do servidor, fecha e relê o estado", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<RelaySigningSettings signing={configured} />);

    await remove(user);

    expect(fetchMock.mock.calls).toEqual([request("DELETE", { expectedUpdatedAt: STAMP })]);
    expect(toastMock.success.mock.calls).toEqual([[REMOVED]]);
    await closed();
    expect(refreshMock).toHaveBeenCalledTimes(1);
    // Com o estado relido, a tela não fica travada: dá para gerar de novo.
    rerender(<RelaySigningSettings signing={{ ...absent }} />);
    await user.click(button("Gerar chave"));
    expect(confirm("Gerar chave")).toBeEnabled();
  });

  it("com a remoção em curso, nada fecha o diálogo nem dispara outra", async () => {
    const user = userEvent.setup();
    const release = gated();
    render(<RelaySigningSettings signing={configured} />);

    await remove(user);

    expect(confirm("Remover chave")).toBeDisabled();
    expect(button("Cancelar")).toBeDisabled();
    await user.click(confirm("Remover chave"));
    await user.keyboard("{Escape}");
    await user.click(overlay());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.getByText(REMOVE)).toBeInTheDocument();

    release(Response.json({ ok: true, message: REMOVED }));
    await closed();
  });

  it("depois de abrir e cancelar o Remover, Gerar nova chave abre a confirmação de TROCA", async () => {
    const user = userEvent.setup();
    render(<RelaySigningSettings signing={configured} />);

    await user.click(button("Remover chave"));
    await screen.findByText(REMOVE);
    await user.click(button("Cancelar"));
    await closed();

    await user.click(button("Gerar nova chave"));

    expect(await screen.findByText(ROTATE)).toBeInTheDocument();
    expect(screen.queryByText(REMOVE)).not.toBeInTheDocument();
  });

  it.each([
    ["a chave já tinha sido removida (404)", 404, "Não há chave de assinatura."],
    ["outro administrador trocou a chave (409)", 409, STALE],
  ])("%s: avisa com o motivo do servidor, fecha e relê o estado", async (_label, status, message) => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(Response.json({ ok: false, message }, { status }));
    render(<RelaySigningSettings signing={configured} />);

    await remove(user);

    expect(toastMock.error.mock.calls).toEqual([[message]]);
    expect(toastMock.success).not.toHaveBeenCalled();
    await closed();
    expect(refreshMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(UNCONFIRMED)).not.toBeInTheDocument();
  });

  it("erro do servidor que DIZ que nada foi removido (`applied: false`): mostra o motivo, e a tela segue afirmando o que sabe", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(
      Response.json({ ok: false, message: "Não foi possível remover a chave.", applied: false }, { status: 500 })
    );
    render(<RelaySigningSettings signing={configured} />);

    await remove(user);

    expect(toastMock.error.mock.calls).toEqual([["Não foi possível remover a chave."]]);
    await closed();
    expect(refreshMock).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/Gerada em 01\/10\/2026 09:00/)).toBeInTheDocument();
  });

  it.each([
    ["o servidor falha (500) sem dizer se removeu", async () => Response.json({ ok: false, message: "Não foi possível remover a chave." }, { status: 500 })],
    ["o pedido não volta (rede)", () => Promise.reject(new TypeError("fetch failed"))],
    ["o status é 200, mas a resposta diz que falhou", async () => Response.json({ ok: false })],
    ["a resposta 200 não é JSON", async () => new Response("<html>proxy</html>", { status: 200 })],
  ])("desfecho desconhecido (%s): não diz que removeu nem que falhou, e a tela deixa de afirmar que os pedidos saem assinados", async (_label, respond) => {
    const user = userEvent.setup();
    fetchMock.mockImplementation(respond);
    render(<RelaySigningSettings signing={configured} />);

    await remove(user);

    await waitFor(() => expect(toastMock.error.mock.calls).toEqual([[UNKNOWN]]));
    expect(toastMock.success).not.toHaveBeenCalled();
    await closed();
    expect(refreshMock).not.toHaveBeenCalled();
    expect(screen.getByText(UNCONFIRMED)).toBeInTheDocument();
    expect(screen.queryByText(/saem assinados/)).not.toBeInTheDocument();
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });

  it("o carimbo é o de quando a confirmação abriu, mesmo que o estado mude por baixo", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<RelaySigningSettings signing={configured} />);

    await user.click(button("Remover chave"));
    await screen.findByText(REMOVE);
    rerender(<RelaySigningSettings signing={{ state: "configured", updatedAt: OTHER_STAMP }} />);
    await user.click(confirm("Remover chave"));

    expect(fetchMock.mock.calls).toEqual([request("DELETE", { expectedUpdatedAt: STAMP })]);
  });
});
