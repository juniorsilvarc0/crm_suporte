"use client";

import { useEffect, useMemo, useState } from "react";

// Um minuto: o selo do SLA fala em minutos ("em 25 min") e arredonda para baixo.
export const NOW_TICK_MS = 60_000;

/**
 * Relógio da tela de tickets, para o selo do SLA.
 *
 * Começa no `fetchedAt` do servidor (o instante da leitura), e não no relógio
 * do navegador: o texto do selo sai IGUAL no HTML do servidor e na hidratação.
 * Depois do mount avança sozinho a cada `intervalMs`, e o intervalo é limpo ao
 * desmontar.
 *
 * Nunca volta no tempo: devolve o mais recente entre o tique do navegador e o
 * `fetchedAt`. Assim o `router.refresh()` (sem Realtime de tickets) adota o
 * instante da leitura nova, e um navegador com relógio atrasado não faz o
 * prazo "voltar". `fetchedAt` inválido cede ao tique assim que ele existe.
 */
export function useNow(fetchedAt: string, intervalMs: number = NOW_TICK_MS): Date {
  const fetched = useMemo(() => new Date(fetchedAt), [fetchedAt]);
  // null até o 1º tique: a hidratação usa só o fetchedAt.
  const [tick, setTick] = useState<Date | null>(null);

  useEffect(() => {
    const id = window.setInterval(() => setTick(new Date()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);

  if (tick === null) return fetched;
  if (Number.isNaN(fetched.getTime())) return tick;
  return tick.getTime() > fetched.getTime() ? tick : fetched;
}
