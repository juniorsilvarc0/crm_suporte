// Decisão de QUAIS cards do funil acompanham um comparecimento, isolada do
// Supabase para ser testável — mesmo padrão de lib/auth/route-guard.ts.
//
// Contexto: o funil renderiza `deals`, não `leads`. Marcar comparecimento
// escrevia só em `appointments` e `leads`, então o card ficava parado na etapa
// antiga. Ver PROGRESS.md.

export const ATTENDED_STAGE = "compareceu";

export type DealForAttendance = {
  id: string;
  stage: string;
  appointment_id: string | null;
};

export type PickAttendedDealsArgs = {
  /** Cards do lead que compareceu. */
  deals: DealForAttendance[];
  /** Agendamento marcado como compareceu, quando conhecido. */
  appointmentId?: string | null;
  /** Etapas de fechamento (stage_type won/lost) vindas de board_columns. */
  closedStages: string[];
  /** Etapa de destino. Parametrizada porque o board é dinâmico. */
  attendedStage?: string;
};

export type AttendedDealSelection = {
  ids: string[];
  ambiguous: boolean;
};

/**
 * Regras, nesta ordem:
 *
 * 1. Card já na etapa de destino não se move.
 * 2. Card em etapa de fechamento (ganho/perdido) NUNCA se move — rebaixar um
 *    card já vendido desfaria a venda registrada.
 * 3. Existe card do próprio agendamento? Ele manda, e só ele se move. Se ele
 *    estiver inelegível pelas regras 1–2, nada se move: aquele atendimento já
 *    está resolvido, e mexer nos outros cards seria adivinhação.
 * 4. Sem vínculo, só a única oportunidade aberta pode ser inferida. Duas ou
 *    mais exigem escolha explícita: mover todas misturaria negócios distintos.
 */
export function selectAttendedDeals({
  deals,
  appointmentId,
  closedStages,
  attendedStage = ATTENDED_STAGE,
}: PickAttendedDealsArgs): AttendedDealSelection {
  const closed = new Set(closedStages);
  const isEligible = (deal: DealForAttendance) =>
    deal.stage !== attendedStage && !closed.has(deal.stage);

  if (appointmentId) {
    const linked = deals.find((deal) => deal.appointment_id === appointmentId);
    if (linked) {
      return { ids: isEligible(linked) ? [linked.id] : [], ambiguous: false };
    }
  }

  const eligible = deals.filter(isEligible);
  if (eligible.length > 1) return { ids: [], ambiguous: true };
  return { ids: eligible.map((deal) => deal.id), ambiguous: false };
}

/** Compatibilidade dos consumidores que precisam somente dos ids. */
export function pickAttendedDeals(args: PickAttendedDealsArgs): string[] {
  return selectAttendedDeals(args).ids;
}
