// Tempo relativo em texto ("em 25 min", "há 3 horas"). humanizeUntil e
// humanizeSince vêm do Início antigo (home/lib, fora desde a Fase 1), com três
// correções para o SLA dos tickets:
//   1. arredonda PARA BAIXO: o selo nunca promete mais tempo do que existe;
//   2. a unidade sai normalizada: com floor, 59 min 59 s é "59 min", nunca
//      "60 minutos", e 23 h 59 min é "23 horas", nunca "24 horas";
//   3. o prazo que já passou sai com "há", nunca "agora" (esconderia o estouro).
//
// Puro e sem relógio próprio: quem chama passa o `now` (na tela, o do hook que
// começa no fetchedAt do servidor), então não há Date.now() na renderização.

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function plural(count: number, singular: string, pluralForm: string): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

/**
 * Duração sem direção: "menos de 1 min", "25 min", "1 hora", "2 horas",
 * "3 dias". É o "restavam 3 horas" do ticket pausado.
 *
 * Valor negativo ou não finito (data inválida na conta) devolve "": a tela
 * não inventa um número.
 */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "";
  if (ms < MINUTE) return "menos de 1 min";
  if (ms < HOUR) return `${Math.floor(ms / MINUTE)} min`;
  if (ms < DAY) return plural(Math.floor(ms / HOUR), "hora", "horas");
  return plural(Math.floor(ms / DAY), "dia", "dias");
}

/**
 * "em 25 min", "em 2 horas". Prazo que já passou (inclusive o exato instante,
 * como `<=` da view ticket_queue) vira "há …": o estouro nunca some.
 */
export function humanizeUntil(target: Date, now: Date): string {
  const diff = target.getTime() - now.getTime();
  if (!Number.isFinite(diff)) return "";
  if (diff <= 0) return humanizeSince(target, now);
  return `em ${formatDuration(diff)}`;
}

/**
 * "há 3 horas", "há menos de 1 min". Instante no futuro (relógio do navegador
 * atrás do servidor) vira "em …": a frase nunca troca a direção do tempo.
 */
export function humanizeSince(target: Date, now: Date): string {
  const diff = now.getTime() - target.getTime();
  if (!Number.isFinite(diff)) return "";
  if (diff < 0) return humanizeUntil(target, now);
  return `há ${formatDuration(diff)}`;
}
