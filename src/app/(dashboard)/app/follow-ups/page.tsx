import { redirect } from "next/navigation";

import { ListPagination } from "@/components/data-display/list-pagination";
import { FollowupsQueue } from "@/features/followups/components/followups-queue";
import {
  getFollowupsQueuePage,
  parseFollowupQueueParams,
} from "@/features/followups/queries/get-followups-page";
import { getDashboardViewer } from "@/lib/auth/require-dashboard-session";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Retornos",
};

export default async function FollowupsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Usuário confirmado no BANCO antes de qualquer leitura: o layout não roda
  // de novo na navegação pelo cliente, e o proxy só confere a assinatura do
  // cookie. O id dele também é o "Meus tickets" do filtro.
  const viewer = await getDashboardViewer();
  if (!viewer) redirect("/api/auth/logout");

  const query = await searchParams;
  const params = parseFollowupQueueParams(query);
  const followups = await getFollowupsQueuePage(params, viewer.id);

  return (
    <main className="mx-auto w-full max-w-screen-xl space-y-4 p-4 sm:p-6 lg:p-8">
      <FollowupsQueue page={followups} params={params} />
      <ListPagination
        basePath="/app/follow-ups"
        searchParams={query}
        page={followups.page}
        pageCount={followups.pageCount}
        total={followups.total}
        pageSize={followups.pageSize}
        noun={["retorno", "retornos"]}
      />
    </main>
  );
}
