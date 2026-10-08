import { redirect } from "next/navigation";

import { AppointmentsTable } from "@/features/appointments/components/appointments-table";
import { getAppointments } from "@/features/appointments/queries/get-appointments";
import { getDashboardViewer } from "@/lib/auth/require-dashboard-session";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Agenda",
};

export default async function AgendaPage() {
  // Usuário confirmado no BANCO antes de qualquer leitura (o layout não roda de
  // novo na navegação pelo cliente; o proxy só confere a assinatura do cookie).
  const viewer = await getDashboardViewer();
  if (!viewer) redirect("/api/auth/logout");

  const appointments = await getAppointments();

  return (
    <main className="mx-auto w-full max-w-screen-xl space-y-4 p-4 sm:p-6 lg:p-8">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight">Agenda</h1>
        <p className="text-sm text-muted-foreground">
          Visitas técnicas, treinamentos, implantações e acessos remotos.
        </p>
      </div>
      <AppointmentsTable appointments={appointments} />
    </main>
  );
}
