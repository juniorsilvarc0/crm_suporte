import { isBirthdayToday } from "@/features/home/lib/people-order";
import type { HomePerson } from "@/features/home/types";
import { toAppDateKey } from "@/lib/formatters/date";

/**
 * A frase que resume a pessoa no cartão — e o ponto colorido que a acompanha.
 *
 * ⚠️ Tudo aqui sai de dado que EXISTE no banco: aniversário (da ficha de
 * paciente), próximo agendamento, última mensagem e data de entrada. Nada é
 * inferido para enfeitar a tela (AGENTS §0.2.5).
 */
export type PersonSignal = {
  label: string;
  /** Classe literal do ponto — Tailwind v4 não enxerga classe interpolada. */
  dot: string;
  tone: "birthday" | "next" | "recent" | "new" | "idle";
};

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "em 3 horas", "em 2 dias", "agora" — sempre no futuro. */
export function humanizeUntil(target: Date, now: Date): string {
  const diff = target.getTime() - now.getTime();
  if (diff <= 0) return "agora";
  if (diff < HOUR) {
    const minutes = Math.max(1, Math.round(diff / MINUTE));
    return `em ${minutes} ${minutes === 1 ? "minuto" : "minutos"}`;
  }
  if (diff < DAY) {
    const hours = Math.round(diff / HOUR);
    return `em ${hours} ${hours === 1 ? "hora" : "horas"}`;
  }
  const days = Math.round(diff / DAY);
  return `em ${days} ${days === 1 ? "dia" : "dias"}`;
}

/** "há 3 dias", "há 2 horas" — sempre no passado. */
export function humanizeSince(target: Date, now: Date): string {
  const diff = now.getTime() - target.getTime();
  if (diff < HOUR) {
    const minutes = Math.max(1, Math.round(diff / MINUTE));
    return `há ${minutes} ${minutes === 1 ? "minuto" : "minutos"}`;
  }
  if (diff < DAY) {
    const hours = Math.round(diff / HOUR);
    return `há ${hours} ${hours === 1 ? "hora" : "horas"}`;
  }
  const days = Math.round(diff / DAY);
  return `há ${days} ${days === 1 ? "dia" : "dias"}`;
}

export function getPersonSignal(person: HomePerson, now: Date): PersonSignal {
  // Vem antes de tudo porque é por isso que a pessoa está no topo da lista —
  // sem esta linha, a ordem pareceria arbitrária para quem olha.
  const todayKey = toAppDateKey(now);
  if (person.birthDate && isBirthdayToday(person.birthDate, todayKey)) {
    // Só na data certa esta conta fecha, e por isso ela mora aqui dentro:
    // no aniversário, a idade é a diferença dos anos, sem ajuste de mês.
    const age = Number(todayKey.slice(0, 4)) - Number(person.birthDate.slice(0, 4));
    const parts = ["Aniversário hoje"];
    if (Number.isFinite(age) && age > 0 && age < 130) {
      parts.push(`${age} ${age === 1 ? "ano" : "anos"}`);
    }
    // A sessão continua na linha: quem faz aniversário HOJE e tem consulta em
    // 40 minutos precisa das duas informações, não de uma no lugar da outra.
    if (person.nextAppointmentAt) {
      parts.push(`sessão ${humanizeUntil(new Date(person.nextAppointmentAt), now)}`);
    }
    return { label: parts.join(" · "), dot: "bg-amber-500", tone: "birthday" };
  }

  if (person.nextAppointmentAt) {
    return {
      label: `Próxima sessão ${humanizeUntil(new Date(person.nextAppointmentAt), now)}`,
      dot: "bg-primary",
      tone: "next",
    };
  }
  if (person.lastMessageAt) {
    return {
      label: `Último contato ${humanizeSince(new Date(person.lastMessageAt), now)}`,
      dot: "bg-teal-500",
      tone: "recent",
    };
  }
  if (now.getTime() - new Date(person.createdAt).getTime() < 2 * DAY) {
    return { label: "Entrou agora — ainda sem conversa", dot: "bg-emerald-500", tone: "new" };
  }
  return { label: "Sem sessões agendadas", dot: "bg-muted-foreground/40", tone: "idle" };
}
