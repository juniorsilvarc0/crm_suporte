import { PageHeader } from "@/components/layout/page-header";
import { ConnectionPanel } from "@/features/connection/components/connection-panel";
import { requireAdminPage } from "@/lib/auth/require-dashboard-session";

export const dynamic = "force-dynamic";

export default async function ConexaoPage() {
  await requireAdminPage();
  return (
    <>
      <PageHeader
        title="Conexão"
        description="Conecte o WhatsApp do suporte à instância uazapi e acompanhe o status"
      />
      <main className="p-4 sm:p-6 lg:p-8">
        <ConnectionPanel />
      </main>
    </>
  );
}
