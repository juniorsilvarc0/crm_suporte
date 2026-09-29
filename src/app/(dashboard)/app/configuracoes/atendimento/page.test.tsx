import { isValidElement, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";

import type { ProductOption } from "@/features/products/types";
import type { ServiceSettingsTab } from "@/features/tickets/components/service-settings-tabs";
import type {
  ServiceSettings,
  TicketCategoryOption,
  TicketSlaPolicy,
  TicketStatusOption,
} from "@/features/tickets/types";

// A página é fina: confirma o admin no banco, lê as configurações e entrega
// cada parte ao gerenciador da sua aba. O guard, a leitura, as abas e os
// gerenciadores viram marcadores; as abas montam todos os painéis de uma vez.
const { adminMock, settingsMock, tabsMock, productsMock, categoriesMock, slaMock, statusesMock } =
  vi.hoisted(() => ({
    adminMock: vi.fn(),
    settingsMock: vi.fn(),
    tabsMock: vi.fn<(props: { panels: Record<ServiceSettingsTab, ReactNode> }) => ReactNode>(
      ({ panels }) => <>{Object.values(panels)}</>
    ),
    productsMock: vi.fn<(props: { products: ProductOption[] | null }) => null>(() => null),
    categoriesMock: vi.fn<
      (props: { categories: TicketCategoryOption[] | null; products: ProductOption[] | null }) => null
    >(() => null),
    slaMock: vi.fn<(props: { policies: TicketSlaPolicy[] | null }) => null>(() => null),
    statusesMock: vi.fn<(props: { statuses: TicketStatusOption[] | null }) => null>(() => null),
  }));

// Só o guard de admin: trocar por outro (getDashboardViewer, que não olha o
// papel) faz a página falhar aqui, e o teste do redirect acusa.
vi.mock("@/lib/auth/require-dashboard-session", () => ({ requireAdminPage: adminMock }));
vi.mock("@/features/tickets/queries/get-service-settings", () => ({
  getServiceSettings: settingsMock,
}));
vi.mock("@/features/tickets/components/service-settings-tabs", () => ({
  ServiceSettingsTabs: tabsMock,
}));
vi.mock("@/features/products/components/products-manager", () => ({
  ProductsManager: productsMock,
}));
vi.mock("@/features/tickets/components/ticket-categories-manager", () => ({
  TicketCategoriesManager: categoriesMock,
}));
vi.mock("@/features/tickets/components/sla-policies-manager", () => ({
  SlaPoliciesManager: slaMock,
}));
vi.mock("@/features/tickets/components/ticket-statuses-manager", () => ({
  TicketStatusesManager: statusesMock,
}));
vi.mock("@/components/layout/page-header", () => ({ PageHeader: () => null }));

import AtendimentoPage from "@/app/(dashboard)/app/configuracoes/atendimento/page";

const ADMIN = { id: "5b0e0c2a-1d3f-4c55-9a77-0c1d2e3f4a5b", role: "admin" };

// As duas leituras se completam: cada parte aparece uma vez nula (a leitura
// dela falhou) e uma vez vazia, que é outra coisa ("nenhum cadastrado").
const READS: Array<[string, ServiceSettings]> = [
  ["filas, SLA e status falharam", { products: null, categories: [], policies: null, statuses: null }],
  ["só as categorias falharam", { products: [], categories: null, policies: [], statuses: [] }],
];

/** O componente montado na aba (os gerenciadores são os marcadores acima). */
function panelComponent(tab: ServiceSettingsTab) {
  const panel = tabsMock.mock.calls[0]![0].panels[tab];
  return isValidElement(panel) ? panel.type : null;
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("Configurações › Atendimento", () => {
  it("sem admin confirmado no banco, o redirect do guard interrompe antes da leitura", async () => {
    adminMock.mockRejectedValue(new Error("NEXT_REDIRECT"));

    await expect(AtendimentoPage()).rejects.toThrow("NEXT_REDIRECT");

    expect(adminMock).toHaveBeenCalledOnce();
    expect(settingsMock).not.toHaveBeenCalled();
    expect(tabsMock).not.toHaveBeenCalled();
  });

  it("cada gerenciador fica na sua aba", async () => {
    adminMock.mockResolvedValue(ADMIN);
    settingsMock.mockResolvedValue(READS[0]![1]);

    render(await AtendimentoPage());

    expect(panelComponent("filas")).toBe(productsMock);
    expect(panelComponent("categorias")).toBe(categoriesMock);
    expect(panelComponent("sla")).toBe(slaMock);
    expect(panelComponent("status")).toBe(statusesMock);
  });

  it.each(READS)(
    "%s: cada parte chega ao seu gerenciador como veio (nula nunca vira [])",
    async (_, settings) => {
      adminMock.mockResolvedValue(ADMIN);
      settingsMock.mockResolvedValue(settings);

      render(await AtendimentoPage());

      expect(settingsMock).toHaveBeenCalledOnce();
      expect(productsMock.mock.calls[0]![0]).toEqual({ products: settings.products });
      expect(categoriesMock.mock.calls[0]![0]).toEqual({
        categories: settings.categories,
        products: settings.products,
      });
      expect(slaMock.mock.calls[0]![0]).toEqual({ policies: settings.policies });
      expect(statusesMock.mock.calls[0]![0]).toEqual({ statuses: settings.statuses });
    }
  );
});
