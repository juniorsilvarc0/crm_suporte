import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// O comportamento da URL (aba padrão fora dela, aba desconhecida, troca
// otimista, voltar do navegador) é testado pelas abas do Atendimento
// (service-settings-tabs.test.tsx), que são um `UrlTabs`. Aqui fica o que só a
// versão genérica tem: a lista vinda de fora e o `keepMounted` por aba.
const nav = vi.hoisted(() => ({ search: new URLSearchParams(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: nav.replace }),
  usePathname: () => "/app/exemplo",
  useSearchParams: () => nav.search,
}));

import { parseUrlTab, urlTabHref } from "@/components/layout/url-tab-state";
import { UrlTabs } from "@/components/layout/url-tabs";

const TABS = [
  { value: "um", label: "Um" },
  { value: "dois", label: "Dois", keepMounted: true },
  { value: "tres", label: "Três" },
] as const;

const PANELS = { um: <p>Painel um</p>, dois: <p>Painel dois</p>, tres: <p>Painel três</p> };

describe("url-tab-state", () => {
  it("a primeira aba é a padrão, e fica fora da URL", () => {
    expect(parseUrlTab(TABS, undefined)).toBe("um");
    expect(parseUrlTab(TABS, "quatro")).toBe("um");
    expect(parseUrlTab(TABS, "tres")).toBe("tres");
    expect(urlTabHref(TABS, "/app/exemplo", "um")).toBe("/app/exemplo");
    expect(urlTabHref(TABS, "/app/exemplo", "dois")).toBe("/app/exemplo?aba=dois");
  });
});

describe("UrlTabs", () => {
  it("mostra as abas na ordem da lista e abre a da URL", () => {
    nav.search = new URLSearchParams("aba=tres");
    render(<UrlTabs tabs={TABS} panels={PANELS} />);

    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["Um", "Dois", "Três"]);
    expect(screen.getByRole("tab", { name: "Três" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Painel três")).toBeVisible();
  });

  it("a aba com keepMounted fica montada (escondida) com outra aberta; as outras, não", () => {
    nav.search = new URLSearchParams();
    render(<UrlTabs tabs={TABS} panels={PANELS} />);

    expect(screen.getByText("Painel um")).toBeVisible();
    expect(screen.getByText("Painel dois")).not.toBeVisible();
    expect(screen.queryByText("Painel três")).not.toBeInTheDocument();
  });

  it("trocar de aba reescreve a URL sem rolar a página", async () => {
    nav.search = new URLSearchParams();
    nav.replace.mockClear();
    render(<UrlTabs tabs={TABS} panels={PANELS} />);

    await userEvent.setup().click(screen.getByRole("tab", { name: "Dois" }));

    expect(nav.replace).toHaveBeenCalledExactlyOnceWith("/app/exemplo?aba=dois", { scroll: false });
  });
});
