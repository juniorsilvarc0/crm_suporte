import { PageHeader } from "@/components/layout/page-header";
import { AgendaPanel } from "@/features/home/components/agenda-panel";
import { FloatingChatButton } from "@/features/home/components/floating-chat-button";
import { NotesPanel } from "@/features/home/components/notes-panel";
import { PeoplePanel } from "@/features/home/components/people-panel";
import { resolveHomeWeek } from "@/features/home/lib/week";
import {
  getHomeAppointments,
  getHomePeople,
  getHomeSummary,
} from "@/features/home/queries/get-home-data";
import { getNotes } from "@/features/home/queries/get-notes";
import { getDashboardViewer } from "@/lib/auth/require-dashboard-session";
import { getDayQueryRange, getTodayAppDateKey } from "@/lib/formatters/date";

export const dynamic = "force-dynamic";

/**
 * Início — a tela de abertura do dia.
 *
 * Duas colunas: quem precisa de atenção (pessoas + notas) e o que vai acontecer
 * (agenda da semana). As métricas do negócio moram em `/app/metricas`; aqui é
 * operação, não relatório.
 */
export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // O layout de `/app` já barra sessão inválida; aqui o viewer serve só para
  // saber DE QUEM são as notas.
  const viewer = await getDashboardViewer();
  const params = await searchParams;
  const rawWeek = Array.isArray(params.semana) ? params.semana[0] : params.semana;

  const now = new Date();
  const week = resolveHomeWeek(rawWeek);
  const today = getDayQueryRange(getTodayAppDateKey());

  const [people, appointments, summary, notes] = await Promise.all([
    getHomePeople(),
    getHomeAppointments(week.startIso, week.endIso),
    getHomeSummary(today.startIso, today.endIso),
    viewer ? getNotes(viewer.id) : Promise.resolve({ quick: { content: "", updatedAt: null }, stickies: [] }),
  ]);

  return (
    <>
      <PageHeader title="Início" />
      <main className="mx-auto w-full max-w-screen-2xl p-3 sm:p-4 lg:p-6">
        <div className="grid gap-3 lg:grid-cols-2 lg:gap-4 xl:h-[calc(100dvh-var(--app-chrome-top)-3rem)]">
          {/* Coluna esquerda: pessoas e notas. */}
          <div className="flex min-h-0 flex-col gap-3 lg:gap-4">
            {/* ⚠️ O `flex-1` é `lg:` de propósito — ele só faz sentido onde
                existe altura para dividir.
                No desktop o painel tem altura fixa (é `flex-1` numa coluna
                travada), então quem está dentro precisa ser esticado para caber
                e rolar por dentro; sem isso a lista cresce além da caixa e os
                cartões pintam por fora do cantinho arredondado.
                No celular não há altura travada, e deixar `flex-1` na base
                fazia dois irmãos `flex: 1 1 0%` inflarem a coluna e os
                scrollers internos nascerem com curso zero — com
                `overscroll-contain`, o gesto morria neles e a PÁGINA não rolava.
                `overflow-hidden` fica na base: sem excedente ele é inerte, e é
                ele que recorta o canto arredondado. */}
            <div className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-border/60 bg-card p-3 shadow-soft sm:p-4 lg:flex-1">
              <PeoplePanel people={people} now={now} />
            </div>
            <NotesPanel initial={notes} />
          </div>

          {/* Coluna direita: a semana. */}
          <AgendaPanel week={week} appointments={appointments} summary={summary} />
        </div>
      </main>
      <FloatingChatButton />
    </>
  );
}
