import { Suspense, use, useEffect, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// A URL é o estado: `search` faz o papel da barra de endereço, e o replace do
// roteador a reescreve, como o Next faz quando a navegação conclui. No teste
// da navegação pendente, a URL vem do `UrlContext` (estado do React).
const { nav, PATH, UrlContext } = await vi.hoisted(async () => {
  const { createContext } = await import("react");
  return {
    nav: {
      search: new URLSearchParams(),
      replace: vi.fn<(href: string, options?: { scroll?: boolean }) => void>(),
    },
    PATH: "/app/configuracoes/atendimento",
    UrlContext: createContext<URLSearchParams | null>(null),
  };
});
vi.mock("next/navigation", async () => {
  const { useContext } = await import("react");
  return {
    useRouter: () => ({ replace: nav.replace }),
    usePathname: () => PATH,
    useSearchParams: () => useContext(UrlContext) ?? nav.search,
  };
});

import {
  parseServiceSettingsTab,
  serviceSettingsHref,
  ServiceSettingsTabs,
} from "@/features/tickets/components/service-settings-tabs";

const PANEL_TEXT = {
  filas: "Painel das filas",
  categorias: "Painel das categorias",
  sla: "Painel do SLA",
  status: "Painel dos status",
};

const PANELS = {
  filas: <p>{PANEL_TEXT.filas}</p>,
  categorias: <p>{PANEL_TEXT.categorias}</p>,
  sla: <p>{PANEL_TEXT.sla}</p>,
  status: <p>{PANEL_TEXT.status}</p>,
};

function setup(query = "") {
  nav.search = new URLSearchParams(query);
  nav.replace.mockImplementation((href) => {
    nav.search = new URLSearchParams(href.split("?")[1] ?? "");
  });
  const view = render(<ServiceSettingsTabs panels={PANELS} />);
  return {
    user: userEvent.setup(),
    rerender: () => view.rerender(<ServiceSettingsTabs panels={PANELS} />),
  };
}

function expectOpen(label: string, panel: string) {
  expect(screen.getByRole("tab", { name: label })).toHaveAttribute("aria-selected", "true");
  expect(screen.getByRole("tabpanel")).toHaveTextContent(panel);
  // Só a aba aberta fica montada: as outras nem estão no DOM (escondidas).
  for (const text of Object.values(PANEL_TEXT)) {
    if (text !== panel) expect(screen.queryByText(text)).toBeNull();
  }
}

// Uma leitura já resolvida: `use` devolve sem suspender.
const READY: Promise<void> = Object.assign(Promise.resolve(), { status: "fulfilled" });

function Arrival({ page }: { page: Promise<void> }) {
  use(page);
  return null;
}

// Como o Next: o replace muda a URL numa transição que só termina quando a
// página relida chega (`page`). Até lá, o React mantém a tela que está no ar.
function PendingNavigation({ page }: { page: Promise<void> }) {
  const [url, setUrl] = useState({ search: new URLSearchParams(), arrival: READY });
  useEffect(() => {
    nav.replace.mockImplementation((href) => {
      setUrl({ search: new URLSearchParams(href.split("?")[1] ?? ""), arrival: page });
    });
  }, [page]);
  return (
    <UrlContext value={url.search}>
      <Suspense fallback={<p>Carregando a página</p>}>
        <Arrival page={url.arrival} />
        <ServiceSettingsTabs panels={PANELS} />
      </Suspense>
    </UrlContext>
  );
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("parseServiceSettingsTab", () => {
  it.each(["filas", "categorias", "sla", "status"])("aceita %s", (value) => {
    expect(parseServiceSettingsTab(value)).toBe(value);
  });

  it.each([null, undefined, "", "quadro", "SLA", " sla", ["sla"]])(
    "cai em filas com %j",
    (value) => {
      expect(parseServiceSettingsTab(value)).toBe("filas");
    }
  );
});

describe("serviceSettingsHref", () => {
  it("põe a aba em ?aba=", () => {
    expect(serviceSettingsHref(PATH, "categorias")).toBe(`${PATH}?aba=categorias`);
    expect(serviceSettingsHref(PATH, "status")).toBe(`${PATH}?aba=status`);
  });

  it("deixa a aba padrão (Filas) fora da URL", () => {
    expect(serviceSettingsHref(PATH, "filas")).toBe(PATH);
  });
});

describe("ServiceSettingsTabs", () => {
  it("mostra as quatro abas, na ordem", () => {
    setup();

    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
      "Filas",
      "Categorias",
      "SLA",
      "Status",
    ]);
  });

  it("sem ?aba= abre Filas", () => {
    setup();

    expectOpen("Filas", PANEL_TEXT.filas);
  });

  it("abre a aba que está na URL (recarregar mantém a aba)", () => {
    setup("aba=sla");

    expectOpen("SLA", PANEL_TEXT.sla);
    expect(nav.replace).not.toHaveBeenCalled();
  });

  it("valor desconhecido em ?aba= cai em Filas, sem reescrever a URL", () => {
    setup("aba=quadro");

    expectOpen("Filas", PANEL_TEXT.filas);
    expect(nav.replace).not.toHaveBeenCalled();
  });

  it("trocar de aba substitui a URL com ?aba=, sem rolar, e abre o painel", async () => {
    const { user } = setup();

    await user.click(screen.getByRole("tab", { name: "Categorias" }));

    expect(nav.replace).toHaveBeenCalledTimes(1);
    expect(nav.replace).toHaveBeenCalledWith(`${PATH}?aba=categorias`, { scroll: false });
    expectOpen("Categorias", PANEL_TEXT.categorias);
  });

  it("voltar para Filas limpa a URL", async () => {
    const { user } = setup("aba=status");

    await user.click(screen.getByRole("tab", { name: "Filas" }));

    expect(nav.replace).toHaveBeenCalledWith(PATH, { scroll: false });
    expectOpen("Filas", PANEL_TEXT.filas);
  });

  it("clicar na aba que já está aberta não navega", async () => {
    const { user } = setup("aba=sla");

    await user.click(screen.getByRole("tab", { name: "SLA" }));

    expect(nav.replace).not.toHaveBeenCalled();
    expectOpen("SLA", PANEL_TEXT.sla);
  });

  it("pelo teclado: seta leva o foco e Enter troca de aba", async () => {
    const { user } = setup();

    await user.click(screen.getByRole("tab", { name: "Filas" }));
    await user.keyboard("{ArrowRight}{ArrowRight}");
    expect(screen.getByRole("tab", { name: "SLA" })).toHaveFocus();
    // A seta só leva o foco: nenhuma navegação a cada tecla.
    expect(nav.replace).not.toHaveBeenCalled();

    await user.keyboard("{Enter}");

    expect(nav.replace).toHaveBeenCalledWith(`${PATH}?aba=sla`, { scroll: false });
    expectOpen("SLA", PANEL_TEXT.sla);
  });

  it("a aba troca na hora, sem esperar a página relida; a URL confirma quando ela chega", async () => {
    let arrive = () => {};
    const page = new Promise<void>((resolve) => {
      arrive = resolve;
    });
    render(<PendingNavigation page={page} />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("tab", { name: "SLA" }));

    expect(nav.replace).toHaveBeenCalledWith(`${PATH}?aba=sla`, { scroll: false });
    expectOpen("SLA", PANEL_TEXT.sla);
    // A tela não dá lugar a um "carregando" enquanto a página é relida.
    expect(screen.queryByText("Carregando a página")).toBeNull();

    await act(async () => {
      arrive();
      await page;
    });

    expectOpen("SLA", PANEL_TEXT.sla);
  });

  it("segue a URL quando ela muda por fora (o item do menu, voltar do navegador)", () => {
    const { rerender } = setup("aba=sla");

    nav.search = new URLSearchParams();
    rerender();

    expectOpen("Filas", PANEL_TEXT.filas);
    expect(nav.replace).not.toHaveBeenCalled();
  });
});
