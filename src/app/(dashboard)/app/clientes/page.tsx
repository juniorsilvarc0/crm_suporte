import { redirect } from "next/navigation";

import { ListPagination } from "@/components/data-display/list-pagination";
import { CustomerFormDialog } from "@/features/customers/components/customer-form-dialog";
import { CustomersTable } from "@/features/customers/components/customers-table";
import {
  getCustomersPage,
  parseCustomerListParams,
} from "@/features/customers/queries/get-customers-page";
import { getDashboardViewer } from "@/lib/auth/require-dashboard-session";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Clientes",
};

export default async function ClientesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Usuário confirmado no BANCO antes de qualquer leitura: o layout não roda
  // de novo na navegação pelo cliente, e o proxy só confere a assinatura do
  // cookie — um usuário desativado segue com cookie válido por até 7 dias.
  const viewer = await getDashboardViewer();
  if (!viewer) redirect("/api/auth/logout");

  const params = parseCustomerListParams(await searchParams);
  const customers = await getCustomersPage(params);

  return (
    <main className="mx-auto w-full max-w-screen-xl space-y-4 p-4 sm:p-6 lg:p-8">
      <CustomersTable page={customers} params={params} actions={<CustomerFormDialog />} />
      <ListPagination
        basePath="/app/clientes"
        // Os filtros já lidos, não a URL crua: valor fora da allowlist não
        // viaja de página em página.
        searchParams={{
          q: params.q,
          situacao: params.situacao === "todas" ? undefined : params.situacao,
        }}
        page={customers.page}
        pageCount={customers.pageCount}
        total={customers.total}
        pageSize={customers.pageSize}
        noun={["empresa", "empresas"]}
      />
    </main>
  );
}
