import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeftIcon } from "lucide-react";

import { EmptyState } from "@/components/data-display/empty-state";
import { getContractAmounts } from "@/features/contracts/queries/get-contract-amounts";
import { getSupportPlans } from "@/features/contracts/queries/get-support-plans";
import type { AdminContractView } from "@/features/contracts/types";
import { CustomerDetail } from "@/features/customers/components/customer-detail";
import { getCustomerDetail } from "@/features/customers/queries/get-customer-detail";
import { getProducts } from "@/features/products/queries/get-products";
import { getDashboardViewer } from "@/lib/auth/require-dashboard-session";

export const dynamic = "force-dynamic";

// Mesmo regex das rotas (api/customers/[id]): id fora de UUID nem chega ao banco.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const PAGE_CLASS = "mx-auto w-full max-w-screen-xl p-4 sm:p-6 lg:p-8";

/**
 * Ficha da empresa. O papel é decidido AQUI, no servidor, com o usuário lido do
 * banco: o member recebe contratos sem valor e sem dia de vencimento (a
 * consulta dele nem pede as colunas); o admin recebe o valor pela RPC que
 * confere de novo que ele é admin ativo, mais os catálogos do formulário.
 */
export default async function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const viewer = await getDashboardViewer();
  if (!viewer) redirect("/api/auth/logout");

  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();

  if (viewer.role === "admin") {
    const detail = await getCustomerDetail(id, { admin: true });
    if (detail.status === "not_found") notFound();
    if (detail.status === "error") return <DetailUnavailable />;

    const [amounts, products, plans] = await Promise.all([
      getContractAmounts(viewer.id, id),
      getProducts(),
      getSupportPlans(),
    ]);
    // Valor ausente (RPC falhou, ou o contrato não veio nela) = "Valor
    // indisponível" na tela, nunca R$ 0.
    const contracts: AdminContractView[] | null =
      detail.contracts === null
        ? null
        : detail.contracts.map((contract) => ({
            ...contract,
            monthly_amount: amounts?.get(contract.id) ?? null,
          }));

    return (
      <main className={PAGE_CLASS}>
        <CustomerDetail
          role="admin"
          customer={detail.customer}
          contacts={detail.contacts}
          contracts={contracts}
          products={products}
          plans={plans}
        />
      </main>
    );
  }

  const detail = await getCustomerDetail(id, { admin: false });
  if (detail.status === "not_found") notFound();
  if (detail.status === "error") return <DetailUnavailable />;

  return (
    <main className={PAGE_CLASS}>
      <CustomerDetail
        role="member"
        customer={detail.customer}
        contacts={detail.contacts}
        contracts={detail.contracts}
      />
    </main>
  );
}

function DetailUnavailable() {
  return (
    <main className={`${PAGE_CLASS} space-y-3`}>
      <Link
        href="/app/clientes"
        className="-ms-2 inline-flex h-11 items-center gap-1.5 rounded-full px-2 text-sm text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 sm:h-8"
      >
        <ArrowLeftIcon className="size-4" aria-hidden />
        Clientes
      </Link>
      <EmptyState>Não foi possível carregar a empresa. Recarregue a página.</EmptyState>
    </main>
  );
}
