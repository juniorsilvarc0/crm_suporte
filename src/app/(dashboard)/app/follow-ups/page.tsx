import { PageHeader } from "@/components/layout/page-header";
import { FollowupsTable } from "@/features/followups/components/followups-table";
import { NovoFollowupDialog } from "@/features/followups/components/novo-followup-dialog";
import { getFollowups } from "@/features/followups/queries/get-followups";

export const dynamic = "force-dynamic";

export default async function FollowupsPage() {
  const followups = await getFollowups();

  return (
    <>
      <PageHeader title="Follow-ups" description="Recuperação de leads" />
      <main className="p-4 sm:p-6 lg:p-8">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-border/70 pb-3">
          <div><h1 className="font-display text-2xl font-semibold tracking-tight">Follow-ups</h1><p className="text-sm text-muted-foreground">Recuperação de leads</p></div>
          <NovoFollowupDialog />
        </div>
        <FollowupsTable followups={followups} />
      </main>
    </>
  );
}
