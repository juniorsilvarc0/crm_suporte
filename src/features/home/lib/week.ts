import {
  addDaysToAppDateKey,
  getTodayAppDateKey,
  getWeekDateKeys,
  getWeekQueryRange,
} from "@/lib/formatters/date";

/**
 * A semana da tela de Início.
 *
 * ⚠️ Tudo em **chave de dia** (`AAAA-MM-DD`) no fuso do app, nunca em `Date`
 * crua. `new Date(iso).getHours()` responde no fuso de quem executa — servidor
 * em UTC e navegador em -03 dão respostas diferentes, o que quebra a hidratação
 * e, pior, posiciona o agendamento na hora errada. Os helpers de
 * `lib/formatters/date` já fixam `America/Sao_Paulo`; use-os.
 */
export type HomeWeek = {
  /** Os 7 dias, de domingo a sábado. */
  dayKeys: string[];
  /** Intervalo para consultar o banco. */
  startIso: string;
  endIso: string;
  /** Chaves para navegar entre semanas. */
  previousKey: string;
  nextKey: string;
};

/** Lê `?semana=AAAA-MM-DD`; qualquer coisa inválida cai na semana de hoje. */
export function resolveHomeWeek(raw: string | undefined): HomeWeek {
  const requested = raw && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : getTodayAppDateKey();
  const dayKeys = getWeekDateKeys(requested);
  const startKey = dayKeys[0] ?? requested;
  const { startIso, endIso } = getWeekQueryRange(requested);

  return {
    dayKeys,
    startIso,
    endIso,
    previousKey: addDaysToAppDateKey(startKey, -7),
    nextKey: addDaysToAppDateKey(startKey, 7),
  };
}
