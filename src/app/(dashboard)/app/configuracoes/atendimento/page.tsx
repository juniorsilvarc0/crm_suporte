import { PageHeader } from "@/components/layout/page-header";
import { ProductsManager } from "@/features/products/components/products-manager";
import { ServiceSettingsTabs } from "@/features/tickets/components/service-settings-tabs";
import { SlaPoliciesManager } from "@/features/tickets/components/sla-policies-manager";
import { TicketCategoriesManager } from "@/features/tickets/components/ticket-categories-manager";
import { TicketStatusesManager } from "@/features/tickets/components/ticket-statuses-manager";
import { getServiceSettings } from "@/features/tickets/queries/get-service-settings";
import { requireAdminPage } from "@/lib/auth/require-dashboard-session";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Atendimento",
};

export default async function AtendimentoPage() {
  // Admin confirmado no BANCO antes da leitura: member vai para /app, e quem
  // foi desativado (com cookie ainda válido) sai pelo logout.
  await requireAdminPage();
  // Cada parte vem `null` quando a leitura dela falhou: o gerenciador da aba
  // diz que falhou, sem derrubar as outras.
  const settings = await getServiceSettings();

  return (
    <>
      <PageHeader
        title="Atendimento"
        description="Filas, categorias, prazos de SLA e status dos tickets"
      />
      <main className="min-w-0 p-4 sm:p-6 lg:p-8">
        <ServiceSettingsTabs
          panels={{
            filas: <ProductsManager products={settings.products} />,
            categorias: (
              <TicketCategoriesManager
                categories={settings.categories}
                products={settings.products}
              />
            ),
            sla: <SlaPoliciesManager policies={settings.policies} />,
            status: <TicketStatusesManager statuses={settings.statuses} />,
          }}
        />
      </main>
    </>
  );
}
