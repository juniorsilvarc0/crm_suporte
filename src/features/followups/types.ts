import type { Database } from "@/lib/supabase/types";

import type { FollowupKind } from "@/features/followups/lib/followup-kind";
import type { FollowupStatus } from "@/features/followups/lib/followup-status";

type FollowupRow = Database["public"]["Tables"]["followups"]["Row"];

/** O ticket a que o retorno pertence, como o embed devolve. */
export type FollowupTicket = {
  id: string;
  number: number;
  title: string;
  status: string;
};

/**
 * Um follow-up como a UI consome: a linha, com `kind`/`status` já estreitados
 * pelos type guards, e o ticket embutido (para a fila cruzar tickets).
 */
export type FollowupListItem = Omit<FollowupRow, "kind" | "status"> & {
  kind: FollowupKind;
  status: FollowupStatus;
  ticket: FollowupTicket | null;
};

// ---------------------------------------------------------------------------
// Fila /app/follow-ups: os retornos cruzando tickets. Tipos neutros (o client
// importa), como em features/contacts/types.ts.

/** Recortes da fila. `pendentes` inclui os vencidos; `vencidos` é só o atraso. */
export const FOLLOWUP_QUEUE_SITUATIONS = [
  "pendentes",
  "vencidos",
  "concluidos",
  "cancelados",
  "todos",
] as const;

export type FollowupQueueSituation = (typeof FOLLOWUP_QUEUE_SITUATIONS)[number];

/** `responsavel=eu`: só os retornos dos tickets atribuídos a quem vê a fila. */
export type FollowupQueueParams = {
  situacao: FollowupQueueSituation;
  responsavel: "todos" | "eu";
  page: number;
};

/** O ticket na fila: o protocolo leva a ele, e a empresa dá o contexto. */
export type FollowupQueueTicket = FollowupTicket & {
  customer: { id: string; legal_name: string; trade_name: string | null } | null;
};

/** Uma linha da fila: só o que a tela mostra. */
export type FollowupQueueItem = {
  id: string;
  kind: FollowupKind;
  status: FollowupStatus;
  due_at: string;
  notes: string | null;
  done_at: string | null;
  ticket: FollowupQueueTicket;
};

export type FollowupsQueuePage = {
  items: FollowupQueueItem[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
  /** A leitura falhou: a tela diz "não foi possível carregar", não "nenhum". */
  failed: boolean;
  /** O instante da leitura (ISO): o "vencido" da tela parte daqui. */
  fetchedAt: string;
};
