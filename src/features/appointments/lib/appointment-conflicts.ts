import type { AppointmentListItem } from "@/features/appointments/types";

// Conflito de horário entre compromissos do MESMO técnico — recuperado da
// clínica (tag legado-clinica) e adaptado: lá era um médico só, aqui são
// vários técnicos, e um compromisso do técnico A não ocupa a agenda do B.
// Função pura, testada à parte. ⚠️ É aviso, não bloqueio (UI.md §5.16): há
// encaixe legítimo, e quem decide é quem está olhando a tela.

export type ConflictCandidate = Pick<
  AppointmentListItem,
  "id" | "scheduled_at" | "duration_min" | "status" | "assignee_id"
>;

/** Situações que não ocupam a agenda: o horário voltou a ficar livre. */
const FREED_STATUSES = new Set(["cancelado"]);

/**
 * Dois intervalos se cruzam? Fim exclusivo: a visita que termina 09:00 NÃO
 * conflita com a que começa 09:00 — senão uma agenda de hora em hora acusaria
 * colisão em toda linha.
 */
export function intervalsOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/**
 * Os compromissos do técnico que cruzam o horário do que está sendo criado ou
 * editado. Sem técnico escolhido não há conflito a apontar (a agenda é de
 * vários técnicos); editar não conflita consigo mesmo (`ignoreId`); duração
 * ausente conta 1 hora, como a grade da Agenda desenha.
 */
export function findAppointmentConflicts<T extends ConflictCandidate>({
  candidates,
  assigneeId,
  startIso,
  durationMin,
  ignoreId,
}: {
  candidates: T[];
  assigneeId: string | null | undefined;
  startIso: string;
  durationMin: number;
  ignoreId?: string | null;
}): T[] {
  if (!assigneeId) return [];
  const start = Date.parse(startIso);
  if (Number.isNaN(start)) return [];
  const end = start + Math.max(1, durationMin) * 60_000;

  return candidates.filter((candidate) => {
    if (ignoreId && candidate.id === ignoreId) return false;
    if (candidate.assignee_id !== assigneeId) return false;
    if (FREED_STATUSES.has(candidate.status)) return false;

    const candidateStart = Date.parse(candidate.scheduled_at);
    if (Number.isNaN(candidateStart)) return false;
    const candidateEnd = candidateStart + Math.max(1, candidate.duration_min ?? 60) * 60_000;

    return intervalsOverlap(start, end, candidateStart, candidateEnd);
  });
}
