export type ConflictCandidate = {
  id: string;
  /** ISO do início. */
  scheduledAt: string;
  durationMin: number | null;
  leadName: string | null;
  status: string;
};

/** Status que não ocupam a agenda: o horário voltou a ficar livre. */
const FREED_STATUSES = new Set(["cancelado", "faltou"]);

/**
 * Dois intervalos se cruzam?
 *
 * Fim exclusivo de propósito: uma consulta que termina 09:00 **não** conflita
 * com a que começa 09:00. Tratar como conflito faria a agenda de 30 em 30
 * minutos acusar colisão em toda linha.
 */
export function intervalsOverlap(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number
): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/**
 * Agendamentos que ocupam o mesmo horário do que está sendo criado/editado.
 *
 * Pedido do próprio médico, depois de dois pacientes caírem às 19:00 no mesmo
 * dia: "quando a IA agenda não ocorre, pois ela não oferece o horário; mas
 * manualmente pode ocorrer por alguma desatenção".
 *
 * ⚠️ **É aviso, não bloqueio.** Existe encaixe legítimo, e recusar a gravação
 * transformaria uma exceção do consultório em parede. Quem decide é quem está
 * olhando a tela.
 */
export function findAppointmentConflicts({
  candidates,
  startIso,
  durationMin,
  ignoreId,
}: {
  candidates: ConflictCandidate[];
  startIso: string;
  durationMin: number;
  ignoreId?: string | null;
}): ConflictCandidate[] {
  const start = Date.parse(startIso);
  if (Number.isNaN(start)) return [];
  const end = start + Math.max(1, durationMin) * 60_000;

  return candidates.filter((candidate) => {
    // Editar um agendamento não pode fazer ele conflitar consigo mesmo.
    if (ignoreId && candidate.id === ignoreId) return false;
    if (FREED_STATUSES.has(candidate.status)) return false;

    const candidateStart = Date.parse(candidate.scheduledAt);
    if (Number.isNaN(candidateStart)) return false;
    const candidateEnd = candidateStart + Math.max(1, candidate.durationMin ?? 60) * 60_000;

    return intervalsOverlap(start, end, candidateStart, candidateEnd);
  });
}
