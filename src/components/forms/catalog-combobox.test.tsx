import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";

const { refreshMock } = vi.hoisted(() => ({ refreshMock: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: refreshMock }) }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { CatalogCombobox } from "@/components/forms/catalog-combobox";
import type { CatalogOption } from "@/components/forms/catalog-options";

const OPTS: CatalogOption[] = [
  { id: "p1", name: "ERP Varejo", color: "blue" },
  { id: "p2", name: "Gestão Fiscal" },
];

function Single({ onChange, initial = null, createUrl }: { onChange: (o: CatalogOption | null) => void; initial?: CatalogOption | null; createUrl?: string }) {
  const [value, setValue] = useState<CatalogOption | null>(initial);
  return (
    <>
      <CatalogCombobox id="plano" mode="single" options={OPTS} value={value} createUrl={createUrl}
        onChange={(o) => { onChange(o); setValue(o ? { ...o } : null); }} />
      <output data-testid="val">{value?.name ?? "nada"}</output>
    </>
  );
}

function Adder({ onAdd, createUrl }: { onAdd: (o: CatalogOption) => void; createUrl?: string }) {
  const [chosen, setChosen] = useState<CatalogOption[]>([]);
  return (
    <>
      <CatalogCombobox id="prod" mode="adder" options={OPTS} chosen={chosen} createUrl={createUrl}
        onAdd={(o) => { onAdd(o); setChosen((c) => [...c, o]); }} />
      <output data-testid="chips">{chosen.map((c) => c.name).join(",")}</output>
    </>
  );
}

afterEach(() => { vi.clearAllMocks(); vi.unstubAllGlobals(); });

describe("verify CatalogCombobox", () => {
  it("single: escolhe item e o campo mostra o nome, nunca o id", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Single onChange={onChange} />);
    const input = screen.getByRole("combobox");
    await user.click(input);
    await user.click(await screen.findByRole("option", { name: /Gestão Fiscal/ }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({ id: "p2", name: "Gestão Fiscal", color: null, hint: null, archived: false });
    await waitFor(() => expect((input as HTMLInputElement).value).toBe("Gestão Fiscal"));
    // digitar não é sobrescrito a cada render
    await user.clear(input);
    expect(onChange).toHaveBeenLastCalledWith(null);
    await user.type(input, "erp");
    expect((input as HTMLInputElement).value).toBe("erp");
    expect(await screen.findByRole("option", { name: /ERP Varejo/ })).toBeTruthy();
    expect(screen.queryByRole("option", { name: /Gestão/ })).toBeNull();
  });

  it("single: valor arquivado aparece com (arquivado)", async () => {
    const user = userEvent.setup();
    render(<Single onChange={vi.fn()} initial={{ id: "old", name: "Plano Ouro", archived: true }} />);
    const input = screen.getByRole("combobox");
    expect((input as HTMLInputElement).value).toBe("Plano Ouro");
    await user.click(input);
    expect(await screen.findByRole("option", { name: /Plano Ouro.*arquivado/ })).toBeTruthy();
    expect(screen.getByRole("option", { name: /ERP Varejo/ })).toBeTruthy();
  });

  it("single: criar aceita 409 com item e seleciona", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: false, message: "Já existe", item: { id: "s9", name: "Premium", description: null, archived_at: null } }), { status: 409 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<Single onChange={onChange} createUrl="/api/support-plans" />);
    const input = screen.getByRole("combobox");
    await user.type(input, "Premium");
    await user.click(await screen.findByRole("option", { name: /Criar «Premium»/ }));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith({ id: "s9", name: "Premium", color: null, hint: null, archived: false }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body))).toEqual({ name: "Premium" });
    expect(refreshMock).toHaveBeenCalled();
    // o valor nunca virou a linha "criar"
    expect(onChange).toHaveBeenCalledTimes(1);
    await waitFor(() => expect((input as HTMLInputElement).value).toBe("Premium"));
  });

  it("single: teclado Enter na linha criar cria uma vez só", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true, item: { id: "s1", name: "Novo", archived_at: null } }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<Single onChange={onChange} createUrl="/api/support-plans" />);
    const input = screen.getByRole("combobox");
    await user.type(input, "Novo");
    await user.keyboard("{ArrowDown}{ArrowDown}{ArrowDown}{Enter}");
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("adder: escolher acrescenta, some da lista, e o campo esvazia", async () => {
    const user = userEvent.setup();
    const onAdd = vi.fn();
    render(<Adder onAdd={onAdd} />);
    const input = screen.getByRole("combobox");
    await user.type(input, "erp");
    await user.click(await screen.findByRole("option", { name: /ERP Varejo/ }));
    expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({ id: "p1" }));
    expect(screen.getByTestId("chips").textContent).toBe("ERP Varejo");
    await waitFor(() => expect((input as HTMLInputElement).value).toBe(""));
    await user.click(input);
    await screen.findByRole("option", { name: /Gestão Fiscal/ });
    expect(screen.queryByRole("option", { name: /ERP Varejo/ })).toBeNull();
  });

  it("member (sem createUrl) não vê criar", async () => {
    const user = userEvent.setup();
    render(<Single onChange={vi.fn()} />);
    await user.type(screen.getByRole("combobox"), "Portal");
    expect(await screen.findByText("Nada encontrado.")).toBeTruthy();
    expect(screen.queryByRole("option", { name: /Criar/ })).toBeNull();
  });
});

describe("verify extra", () => {
  it("adder: criar acrescenta uma vez e esvazia; falha mantém o texto e avisa", async () => {
    const user = userEvent.setup();
    const onAdd = vi.fn();
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true, item: { id: "n1", name: "Portal", color: "slate", niche: null, archived_at: null } }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<Adder onAdd={onAdd} createUrl="/api/products" />);
    const input = screen.getByRole("combobox");
    await user.type(input, "Portal");
    await user.click(await screen.findByRole("option", { name: /Criar «Portal»/ }));
    await waitFor(() => expect(onAdd).toHaveBeenCalledTimes(1));
    expect(onAdd).toHaveBeenCalledWith({ id: "n1", name: "Portal", color: "slate", hint: null, archived: false });
    await waitFor(() => expect((input as HTMLInputElement).value).toBe(""));
    // já escolhido: digitar o mesmo nome não oferece criar
    await user.type(input, "portal");
    expect(await screen.findByText("Nada encontrado. Digite ao menos 2 letras para criar.")).toBeTruthy();
  });

  it("single limpável: X limpa", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Single onChange={onChange} initial={{ id: "p1", name: "ERP Varejo" }} />);
    await user.click(screen.getByRole("button", { name: "Limpar" }));
    expect(onChange).toHaveBeenCalledWith(null);
    await waitFor(() => expect((screen.getByRole("combobox") as HTMLInputElement).value).toBe(""));
  });

  it("erro 400 mostra a mensagem do campo", async () => {
    const { toast } = await import("sonner");
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: false, message: "Revise os campos destacados.", errors: { name: ["Máximo de 80 caracteres."] } }), { status: 400 })));
    render(<Single onChange={vi.fn()} createUrl="/api/support-plans" />);
    await user.type(screen.getByRole("combobox"), "Plano X");
    await user.click(await screen.findByRole("option", { name: /Criar/ }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Máximo de 80 caracteres."));
  });
});
