import { AppointmentsTable } from "@/features/appointments/components/appointments-table";
import { getAgendaConfig } from "@/features/appointments/queries/get-agenda-config";
import { getAppointmentsBoard } from "@/features/appointments/queries/get-appointments-board";
import {
  getDayQueryRange,
  getMonthQueryRange,
  getTodayAppDateKey,
  getWeekQueryRange,
  normalizeAppMonthKey,
} from "@/lib/formatters/date";

export const dynamic = "force-dynamic";

export default async function AppointmentsPage({
  searchParams,
}: {
  searchParams: Promise<{
    month?: string | string[];
    date?: string | string[];
    view?: string | string[];
    status?: string | string[];
    tipo?: string | string[];
    q?: string | string[];
  }>;
}) {
  const params = await searchParams;
  const rawMonth = Array.isArray(params.month) ? params.month[0] : params.month;
  const rawDate = Array.isArray(params.date) ? params.date[0] : params.date;
  const rawView = Array.isArray(params.view) ? params.view[0] : params.view;
  const rawStatus = Array.isArray(params.status) ? params.status[0] : params.status;
  const rawTipo = Array.isArray(params.tipo) ? params.tipo[0] : params.tipo;
  const rawQuery = Array.isArray(params.q) ? params.q[0] : params.q;
  const view = rawView === "list" || rawView === "semana" || rawView === "dia" ? rawView : "month";
  const monthKey = normalizeAppMonthKey(rawMonth);
  const todayKey = getTodayAppDateKey();
  const dateKey = rawDate && /^\d{4}-\d{2}-\d{2}$/.test(rawDate)
    ? rawDate
    : rawMonth && monthKey !== todayKey.slice(0, 7)
      ? `${monthKey}-01`
      : todayKey;
  const range = view === "semana"
    ? getWeekQueryRange(dateKey)
    : view === "dia"
      ? getDayQueryRange(dateKey)
      : getMonthQueryRange(monthKey);
  // Bloqueios vêm do servidor porque quem desenha a faixa é a grade, que é
  // Server Component. O modal continua buscando por conta própria: ele precisa
  // da lista fresca depois de alguém cadastrar um bloqueio sem recarregar.
  const [items, agendaConfig] = await Promise.all([
    getAppointmentsBoard(range),
    getAgendaConfig(),
  ]);

  return (
    // A agenda é uma superfície só: vira um cartão flutuante sobre a água, com
    // folga em volta. A altura da tela vem do padding + `h-full` do cartão.
    // Sem `overflow-hidden` aqui: o recorte é do próprio cartão (`main`), e o
    // clipe do pai comeria a sombra que faz o painel flutuar.
    <div className="flex h-[calc(100dvh-var(--app-chrome-top)-var(--mobile-nav-height)-env(safe-area-inset-top)-env(safe-area-inset-bottom))] flex-col p-2 sm:p-3 lg:h-[calc(100dvh-var(--app-chrome-top))] lg:px-4 lg:pb-4">
      <h1 className="sr-only">Agenda</h1>
      <main className="panel-float flex min-h-0 flex-1 flex-col overflow-hidden">
        <AppointmentsTable
          items={items}
          blocks={agendaConfig.blocks}
          monthKey={monthKey}
          dateKey={dateKey}
          view={view}
          filters={{
            status: rawStatus ?? "",
            tipo: rawTipo ?? "",
            q: rawQuery ?? "",
          }}
        />
      </main>
    </div>
  );
}
