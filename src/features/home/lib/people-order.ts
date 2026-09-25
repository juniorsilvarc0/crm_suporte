import type { HomePerson } from "@/features/home/types";

/**
 * Faz aniversário hoje? Compara só o dia e o mês.
 *
 * ⚠️ `todayKey` entra por parâmetro (`getTodayAppDateKey()`), já fixado no fuso
 * do app. Calcular "hoje" aqui dentro usaria o fuso de quem executa: no
 * servidor, que roda em UTC, depois das 21h de Brasília o dia já virou e o
 * aniversariante de amanhã subiria para o topo hoje.
 *
 * Nascido em 29/02 só aniversaria em ano bissexto — é o comportamento
 * escolhido, não um esquecimento: antecipar para 28/02 ou empurrar para 01/03
 * seria a clínica inventar uma data que a certidão não tem.
 */
export function isBirthdayToday(
  birthDate: string | null | undefined,
  todayKey: string
): boolean {
  if (!birthDate || !todayKey) return false;
  return birthDate.slice(5, 10) === todayKey.slice(5, 10);
}

/**
 * A ordem da lista de pessoas na tela de Início — uma lista só, sem agrupar:
 *
 * 1. aniversariante do dia primeiro (é o contato que não pode esperar);
 * 2. depois quem tem sessão mais próxima: hoje antes de amanhã e, dentro do
 *    mesmo dia, a hora mais próxima em cima;
 * 3. por último quem não tem sessão marcada, na ordem em que o banco já trouxe
 *    (conversa mais recente primeiro).
 *
 * Devolve um comparador em vez de ordenar direto porque "hoje" precisa vir de
 * fora — ver o aviso de fuso em `isBirthdayToday`.
 */
export function comparePeopleForHome(todayKey: string) {
  return (a: HomePerson, b: HomePerson): number => {
    const birthday =
      Number(isBirthdayToday(b.birthDate, todayKey)) -
      Number(isBirthdayToday(a.birthDate, todayKey));
    if (birthday !== 0) return birthday;

    // Comparar por instante, não por texto: as duas datas vêm do banco no mesmo
    // formato hoje, mas ordenar string ISO é uma armadilha esperando um fuso
    // diferente aparecer.
    // Data impossível de ler conta como "sem sessão": um NaN aqui tornaria o
    // comparador inconsistente e a ordem daquele trecho, arbitrária.
    const nextA = a.nextAppointmentAt ? Date.parse(a.nextAppointmentAt) : NaN;
    const nextB = b.nextAppointmentAt ? Date.parse(b.nextAppointmentAt) : NaN;
    const hasA = Number.isFinite(nextA);
    const hasB = Number.isFinite(nextB);

    if (hasA && hasB) return nextA - nextB;
    if (hasA) return -1;
    if (hasB) return 1;

    // `Array.prototype.sort` é estável: devolver 0 preserva a ordem do banco.
    return 0;
  };
}
