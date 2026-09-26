import { redirect } from "next/navigation";

import { ListPagination } from "@/components/data-display/list-pagination";
import { ContactsTable } from "@/features/contacts/components/contacts-table";
import {
  getContactsPage,
  parseContactListParams,
} from "@/features/contacts/queries/get-contacts-page";
import { getDashboardViewer } from "@/lib/auth/require-dashboard-session";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Contatos",
};

export default async function ContatosPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Usuário confirmado no BANCO antes de qualquer leitura: o layout não roda
  // de novo na navegação pelo cliente, e o proxy só confere a assinatura do
  // cookie — um usuário desativado segue com cookie válido por até 7 dias.
  const viewer = await getDashboardViewer();
  if (!viewer) redirect("/api/auth/logout");

  const query = await searchParams;
  const params = parseContactListParams(query);
  const contacts = await getContactsPage(params);

  return (
    <main className="mx-auto w-full max-w-screen-xl space-y-4 p-4 sm:p-6 lg:p-8">
      <ContactsTable page={contacts} params={params} />
      <ListPagination
        basePath="/app/contatos"
        searchParams={query}
        page={contacts.page}
        pageCount={contacts.pageCount}
        total={contacts.total}
        pageSize={contacts.pageSize}
        noun={["contato", "contatos"]}
      />
    </main>
  );
}
