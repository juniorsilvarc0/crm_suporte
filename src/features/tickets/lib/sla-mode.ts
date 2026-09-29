import type { SlaMode } from "@/features/tickets/types";

// Os modos do relógio de SLA (check ticket_statuses_sla_mode_check). 3º uso
// (AGENTS §0.2.2): a lista, o catálogo e Configurações › Atendimento conferiam
// o `sla_mode` que o banco devolve com uma cópia deste guard. Neutro: só tipos.
const SLA_MODES = ["running", "paused", "stopped"] as const satisfies readonly SlaMode[];

export function isSlaMode(value: unknown): value is SlaMode {
  return SLA_MODES.some((mode) => mode === value);
}
