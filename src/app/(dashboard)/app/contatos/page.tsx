import { ListPagination } from "@/components/data-display/list-pagination";
import { ContactsTable } from "@/features/contacts/components/contacts-table";
import {
  getContactsPage,
  parseContactListParams,
} from "@/features/contacts/queries/get-contacts-page";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Contatos",
};

export default async function ContatosPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
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
