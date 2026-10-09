import { redirect } from "next/navigation";

import { AgendaCalendar } from "@/features/appointments/components/agenda-calendar";
import { agendaRange, parseAgendaParams } from "@/features/appointments/lib/agenda-view";
import { getAgendaBlocks } from "@/features/appointments/queries/get-agenda-blocks";
import { getAppointments } from "@/features/appointments/queries/get-appointments";
import { getDashboardViewer } from "@/lib/auth/require-dashboard-session";
import { getTodayAppDateKey } from "@/lib/formatters/date";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Agenda",
};

export default async function AgendaPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Usuário confirmado no BANCO antes de qualquer leitura (o layout não roda de
  // novo na navegação pelo cliente; o proxy só confere a assinatura do cookie).
  const viewer = await getDashboardViewer();
  if (!viewer) redirect("/api/auth/logout");

  // "Hoje" sai do servidor e desce por prop: o mesmo dia no HTML e na hidratação.
  const todayKey = getTodayAppDateKey();
  const period = parseAgendaParams(await searchParams, todayKey);
  const range = agendaRange(period);
  const [appointments, blocks] = await Promise.all([
    getAppointments(range),
    // Bloqueio é contexto: se a leitura falhar, a agenda abre sem eles.
    getAgendaBlocks(range).then((result) => result ?? []),
  ]);

  return (
    // A agenda é uma superfície só, na altura da tela (UI.md §5.20): o cartão
    // flutuante recorta o conteúdo, e cada visão rola por dentro.
    <div className="flex h-[calc(100dvh-var(--app-chrome-top)-var(--mobile-nav-height)-env(safe-area-inset-top)-env(safe-area-inset-bottom))] flex-col p-2 sm:p-3 lg:h-[calc(100dvh-var(--app-chrome-top))] lg:px-4 lg:pb-4">
      <h1 className="sr-only">Agenda</h1>
      <main className="panel-float flex min-h-0 flex-1 flex-col overflow-hidden">
        <AgendaCalendar period={period} todayKey={todayKey} appointments={appointments} blocks={blocks} />
      </main>
    </div>
  );
}
